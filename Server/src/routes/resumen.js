/* ==================================================================
   BATFINANCE · Resumen semanal (Gemini)
   ------------------------------------------------------------------
   GET /api/resumen-semanal
   Resumen de los 7 días que terminan el domingo más reciente (hoy si
   es domingo). Se genera una vez por semana y se guarda.
   ================================================================== */
const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { preguntarGemini, hayLlave } = require('../gemini');
const { hoyMX } = require('../automatico');

const router = express.Router();
router.use(requireAuth);
const $ = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });

function domingoReciente(hoy) {
  const [y, m, d] = hoy.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay()); // getUTCDay: 0 = domingo
  return dt.toISOString().slice(0, 10);
}
function menosDias(fecha, n) {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}

async function generarResumen(userId) {
  const semana = domingoReciente(hoyMX());
  const guardado = await pool.query('SELECT contenido FROM resumenes_semanales WHERE user_id=$1 AND semana=$2', [userId, semana]);
  if (guardado.rows.length) return { semana, ...guardado.rows[0].contenido };

  const desde = menosDias(semana, 6), prevDesde = menosDias(semana, 13), prevHasta = menosDias(semana, 7);
  const [gastos, gastosPrev, porCat, ingresos, deudas, saldo, fondo, top] = await Promise.all([
    pool.query('SELECT COALESCE(SUM(monto),0)::float t, COUNT(*)::int n FROM gastos WHERE user_id=$1 AND fecha BETWEEN $2 AND $3', [userId, desde, semana]),
    pool.query('SELECT COALESCE(SUM(monto),0)::float t FROM gastos WHERE user_id=$1 AND fecha BETWEEN $2 AND $3', [userId, prevDesde, prevHasta]),
    pool.query('SELECT categoria, SUM(monto)::float t FROM gastos WHERE user_id=$1 AND fecha BETWEEN $2 AND $3 GROUP BY categoria ORDER BY t DESC', [userId, desde, semana]),
    pool.query('SELECT COALESCE(SUM(monto),0)::float t FROM ingresos WHERE user_id=$1 AND fecha BETWEEN $2 AND $3', [userId, desde, semana]),
    pool.query("SELECT nombre, monto_pendiente::float p, monto_cuota::float c, proximo_pago FROM deudas WHERE user_id=$1 AND NOT pagada ORDER BY proximo_pago", [userId]),
    pool.query('SELECT (efectivo + tarjeta)::float v FROM saldo WHERE user_id=$1', [userId]),
    pool.query('SELECT actual::float a, (gasto_mensual * meses_objetivo)::float m FROM fondo_emergencia WHERE user_id=$1', [userId]),
    pool.query('SELECT descripcion, monto::float m FROM gastos WHERE user_id=$1 AND fecha BETWEEN $2 AND $3 ORDER BY monto DESC LIMIT 3', [userId, desde, semana])
  ]);
  const datos = {
    gastado: gastos.rows[0].t, compras: gastos.rows[0].n, gastadoSemanaAnterior: gastosPrev.rows[0].t,
    ingresos: ingresos.rows[0].t, saldo: saldo.rows[0] ? saldo.rows[0].v : 0,
    porCategoria: porCat.rows, top: top.rows,
    deudaTotal: deudas.rows.reduce((a, d) => a + d.p, 0),
    fondo: fondo.rows[0] || { a: 0, m: 0 }
  };

  let texto = { titular: 'Tu semana', resumen: '', recomendacion: '' };
  if (hayLlave()) {
    const prompt = 'Eres el asesor financiero de una app personal en México. Escribe el resumen de la semana del ' + desde + ' al ' + semana + ', directo y concreto, en segunda persona.\n\n' +
      'Gastaste ' + $(datos.gastado) + ' en ' + datos.compras + ' compras (la semana anterior: ' + $(datos.gastadoSemanaAnterior) + '). Ingresos de la semana: ' + $(datos.ingresos) + '. ' +
      'Dinero disponible hoy: ' + $(datos.saldo) + '. Por categoría: ' + (datos.porCategoria.map((c) => c.categoria + ' ' + $(c.t)).join(', ') || 'sin gastos') + '. ' +
      'Compras más grandes: ' + (datos.top.map((t) => t.descripcion + ' ' + $(t.m)).join(', ') || 'ninguna') + '. ' +
      'Deudas pendientes: ' + $(datos.deudaTotal) + (deudas.rows.length ? ' (' + deudas.rows.slice(0, 4).map((d) => d.nombre + ' cuota ' + $(d.c) + ' el ' + String(d.proximo_pago).slice(0, 10)).join('; ') + ')' : '') + '. ' +
      'Fondo de emergencia: ' + $(datos.fondo.a) + ' de ' + $(datos.fondo.m) + '.\n\n' +
      'Devuelve JSON: "titular" (máx. 8 palabras), "resumen" (2 frases con los números clave, comparando con la semana anterior), "recomendacion" (1 acción concreta para la próxima semana, con monto si aplica). No inventes datos.';
    try {
      texto = await preguntarGemini(prompt, {
        type: 'OBJECT',
        properties: { titular: { type: 'STRING' }, resumen: { type: 'STRING' }, recomendacion: { type: 'STRING' } },
        required: ['titular', 'resumen', 'recomendacion']
      }, { temperatura: 0.4 });
    } catch (e) { /* sin IA: se muestra solo con números */ }
  }
  const contenido = { desde, hasta: semana, ...datos, titular: String(texto.titular || '').slice(0, 100), resumen: String(texto.resumen || '').slice(0, 500), recomendacion: String(texto.recomendacion || '').slice(0, 300) };
  // Solo se guarda si la semana ya terminó o es domingo (si no, se recalcula).
  await pool.query(
    `INSERT INTO resumenes_semanales (user_id, semana, contenido) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, semana) DO NOTHING`, [userId, semana, JSON.stringify(contenido)]);
  return { semana, ...contenido };
}

router.get('/', async (req, res) => {
  try { res.json(await generarResumen(req.userId)); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Error del servidor' }); }
});

module.exports = { router, generarResumen };
