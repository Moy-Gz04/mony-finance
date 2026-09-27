/* ==================================================================
   BATFINANCE · Notificaciones push y tarea diaria
   ------------------------------------------------------------------
   /api/push/clave       llave pública para suscribir el dispositivo
   /api/push/suscribir   guarda el dispositivo
   /api/push/probar      manda una notificación de prueba
   /api/cron/diario?turno=manana|tarde
       La llama una tarea programada (GitHub Actions) que despierta al
       servidor. Aplica los automáticos y manda los recordatorios del
       día. Cada aviso se manda una sola vez (notificaciones_enviadas).
   Las llaves VAPID se generan solas la primera vez y se guardan en la
   base (app_config): no hace falta configurar nada en Render.
   ================================================================== */
const express = require('express');
const webpush = require('web-push');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { procesarAutomaticos, hoyMX } = require('../automatico');
const { generarResumen } = require('./resumen');

const push = express.Router();
const cron = express.Router();
push.use(requireAuth);

const $ = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
const f10 = (f) => String(f).slice(0, 10);

let llaves = null;
async function prepararLlaves() {
  if (llaves) return llaves;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    llaves = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    const r = await pool.query("SELECT valor FROM app_config WHERE clave = 'vapid'");
    if (r.rows.length) llaves = JSON.parse(r.rows[0].valor);
    else {
      llaves = webpush.generateVAPIDKeys();
      await pool.query("INSERT INTO app_config (clave, valor) VALUES ('vapid', $1) ON CONFLICT (clave) DO NOTHING", [JSON.stringify(llaves)]);
      llaves = JSON.parse((await pool.query("SELECT valor FROM app_config WHERE clave = 'vapid'")).rows[0].valor);
    }
  }
  webpush.setVapidDetails('https://mony-finance.netlify.app', llaves.publicKey, llaves.privateKey);
  return llaves;
}

async function enviar(userId, aviso) {
  await prepararLlaves();
  const subs = await pool.query('SELECT id, endpoint, claves FROM push_suscripciones WHERE user_id = $1', [userId]);
  let enviados = 0;
  for (const s of subs.rows) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.claves }, JSON.stringify(aviso), { TTL: 60 * 60 * 12 });
      enviados++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await pool.query('DELETE FROM push_suscripciones WHERE id = $1', [s.id]);
      else console.warn('Push:', e.statusCode, e.body || e.message);
    }
  }
  return enviados;
}

/* Manda el aviso solo si no se mandó ya hoy con esa clave. */
async function avisarUnaVez(userId, clave, aviso, fecha) {
  const hay = await pool.query('SELECT 1 FROM push_suscripciones WHERE user_id = $1 LIMIT 1', [userId]);
  if (!hay.rows.length) return 0; // sin dispositivos: no se marca como enviado
  const r = await pool.query(
    'INSERT INTO notificaciones_enviadas (user_id, clave, fecha) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING clave',
    [userId, clave, fecha]);
  if (!r.rows.length) return 0;
  return enviar(userId, aviso);
}

push.get('/clave', async (req, res) => {
  try { res.json({ clave: (await prepararLlaves()).publicKey }); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Error del servidor' }); }
});

push.post('/suscribir', async (req, res) => {
  const s = (req.body || {}).suscripcion || {};
  if (!s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) return res.status(400).json({ error: 'Suscripción inválida' });
  try {
    await pool.query(
      `INSERT INTO push_suscripciones (user_id, endpoint, claves) VALUES ($1,$2,$3)
       ON CONFLICT (endpoint) DO UPDATE SET claves = EXCLUDED.claves, user_id = EXCLUDED.user_id`,
      [req.userId, s.endpoint, JSON.stringify(s.keys)]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error del servidor' }); }
});

push.post('/probar', async (req, res) => {
  try {
    const n = await enviar(req.userId, { titulo: 'BATFINANCE', cuerpo: 'Las notificaciones ya están activas 🦇', url: '/' });
    res.json({ ok: true, enviados: n });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ---------------- Tarea diaria ---------------- */
function masDias(fecha, n) {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
async function recordatorios(userId, turno) {
  const hoy = hoyMX();
  const manana = masDias(hoy, 1);
  const en2 = masDias(hoy, 2);
  let n = 0;

  if (turno === 'manana') {
    // Lo que la app registró sola
    const autos = await pool.query(
      "SELECT id, tipo, nombre, monto, estado FROM movimientos_auto WHERE user_id=$1 AND NOT visto AND created_at > now() - interval '2 days'", [userId]);
    for (const a of autos.rows) {
      const cuerpo = a.tipo === 'ingreso' ? 'Se registró tu ingreso "' + a.nombre + '" de ' + $(a.monto) + '.'
        : a.estado === 'sin_saldo' ? 'No alcanzó el saldo para cobrar ' + a.nombre + ' (' + $(a.monto) + '). Quedó pendiente.'
        : 'Se cobró ' + a.nombre + ' (' + $(a.monto) + '). Si no era así, puedes deshacerlo en la app.';
      n += await avisarUnaVez(userId, 'auto:' + a.id, { titulo: a.tipo === 'ingreso' ? 'Ingreso registrado' : 'Suscripción', cuerpo, url: '/' }, hoy);
    }
    // Suscripciones que cobran mañana
    const subs = await pool.query('SELECT id, nombre, monto FROM suscripciones WHERE user_id=$1 AND activa AND proximo_cobro = $2', [userId, manana]);
    for (const s of subs.rows) {
      n += await avisarUnaVez(userId, 'sub:' + s.id, { titulo: 'Mañana cobra ' + s.nombre, cuerpo: 'Se descontarán ' + $(s.monto) + '. Revisa que tengas saldo.', url: '/' }, hoy);
    }
    // Deudas que vencen en 2 días o menos (o ya vencidas)
    const deudas = await pool.query('SELECT id, nombre, monto_cuota, proximo_pago FROM deudas WHERE user_id=$1 AND NOT pagada AND proximo_pago <= $2', [userId, en2]);
    for (const d of deudas.rows) {
      const fp = f10(d.proximo_pago);
      const cuando = fp < hoy ? 'ya venció' : fp === hoy ? 'vence hoy' : fp === manana ? 'vence mañana' : 'vence en 2 días';
      n += await avisarUnaVez(userId, 'deuda:' + d.id, { titulo: 'Pago de ' + d.nombre, cuerpo: 'Tu cuota de ' + $(d.monto_cuota) + ' ' + cuando + '.', url: '/' }, hoy);
    }
    // Presupuestos al 80% o más (un aviso por categoría al mes)
    const mes = hoy.slice(0, 7);
    const pp = await pool.query(
      `SELECT p.categoria, p.monto::float lim, COALESCE(SUM(g.monto),0)::float usado
       FROM presupuestos p LEFT JOIN gastos g ON g.user_id = p.user_id AND g.categoria = p.categoria AND to_char(g.fecha,'YYYY-MM') = $2
       WHERE p.user_id = $1 GROUP BY p.categoria, p.monto`, [userId, mes]);
    for (const p of pp.rows) {
      const pct = p.usado / p.lim;
      if (pct >= 0.8) {
        n += await avisarUnaVez(userId, 'ppto:' + p.categoria + (pct >= 1 ? ':100' : ':80'),
          { titulo: 'Presupuesto de ' + p.categoria, cuerpo: 'Llevas ' + $(p.usado) + ' de ' + $(p.lim) + ' (' + Math.round(pct * 100) + '%) este mes.', url: '/' }, mes + '-01');
      }
    }
    // Domingo: resumen semanal
    const esDomingo = new Date(hoy + 'T12:00:00Z').getUTCDay() === 0;
    if (esDomingo) {
      const r = await generarResumen(userId);
      n += await avisarUnaVez(userId, 'resumen', { titulo: r.titular || 'Tu semana', cuerpo: (r.resumen || ('Gastaste ' + $(r.gastado) + ' esta semana.')).slice(0, 180), url: '/' }, hoy);
    }
  } else {
    // Tarde: metas de gym del día que no se han cumplido
    const items = await pool.query(
      `SELECT s.id, s.nombre, s.tipo, s.unidad, s.meta_diaria::float meta, s.cantidad_por_toma::float cpt,
              COALESCE((SELECT cantidad FROM tomas_suplemento t WHERE t.suplemento_id = s.id AND t.fecha = $2), 0) hechas
       FROM suplementos s WHERE s.user_id = $1 AND s.meta_diaria > 0`, [userId, hoy]);
    for (const it of items.rows) {
      const hecho = it.hechas * it.cpt;
      if (hecho >= it.meta) continue;
      const cuerpo = it.tipo === 'ejercicio'
        ? 'Llevas ' + hecho + ' de ' + it.meta + ' ' + it.unidad + ' de ' + it.nombre + ' hoy.'
        : (hecho ? 'Llevas ' + hecho + ' de ' + it.meta + ' ' + it.unidad + ' de ' + it.nombre + ' hoy.' : '¿Ya tomaste tu ' + it.nombre + '?');
      n += await avisarUnaVez(userId, 'gym:' + it.id, { titulo: it.tipo === 'ejercicio' ? 'Meta de hoy' : 'Suplementos', cuerpo, url: '/' }, hoy);
    }
  }
  return n;
}

cron.all('/diario', async (req, res) => {
  const turno = req.query.turno === 'tarde' ? 'tarde' : 'manana';
  try {
    const usuarios = await pool.query('SELECT id FROM users');
    let avisos = 0;
    for (const u of usuarios.rows) {
      await procesarAutomaticos(u.id);
      avisos += await recordatorios(u.id, turno);
    }
    res.json({ ok: true, turno, avisos });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error del servidor' }); }
});

module.exports = { push, cron };
