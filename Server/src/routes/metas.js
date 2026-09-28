/* ==================================================================
   BATFINANCE · Metas con plan y fecha
   ------------------------------------------------------------------
   POST   /api/metas               crear  { nombre, montoObjetivo, montoActual?, fechaObjetivo?, prioridad? }
   PUT    /api/metas/:id           editar (mismos campos)
   POST   /api/metas/:id/aportar   { monto, metodo, descontar } (queda en el historial de aportes)
   POST   /api/metas/:id/consejo   plan / consejo con IA usando los datos reales
   DELETE /api/metas/:id
   ================================================================== */
const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { METAS_COLS } = require('../sqlColumns');
const { verificarFondos } = require('../validaciones');
const { preguntarGemini, hayLlave } = require('../gemini');
const { hoyMX } = require('../automatico');

const router = express.Router();
router.use(requireAuth);

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORIDADES = ['alta', 'media', 'baja'];
const $ = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });

function leer(b) {
  const nombre = String(b.nombre || '').trim().slice(0, 60);
  const montoObjetivo = Math.round(Number(b.montoObjetivo) * 100) / 100;
  const fechaObjetivo = FECHA_RE.test(String(b.fechaObjetivo || '')) ? b.fechaObjetivo : null;
  const prioridad = PRIORIDADES.includes(b.prioridad) ? b.prioridad : 'media';
  if (!nombre || !(montoObjetivo > 0)) return { error: 'Datos incompletos o inválidos' };
  return { nombre, montoObjetivo, fechaObjetivo, prioridad };
}

router.post('/', async (req, res) => {
  const d = leer(req.body || {});
  if (d.error) return res.status(400).json({ error: d.error });
  const inicial = Number((req.body || {}).montoActual) > 0 ? Number(req.body.montoActual) : 0;
  try {
    const result = await pool.query(
      `INSERT INTO metas (user_id, nombre, monto_objetivo, monto_actual, fecha_objetivo, prioridad)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${METAS_COLS}`,
      [req.userId, d.nombre, d.montoObjetivo, inicial, d.fechaObjetivo, d.prioridad]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.put('/:id', async (req, res) => {
  const d = leer(req.body || {});
  if (d.error) return res.status(400).json({ error: d.error });
  try {
    const r = await pool.query(
      `UPDATE metas SET nombre=$1, monto_objetivo=$2, fecha_objetivo=$3, prioridad=$4, consejo=NULL
       WHERE id=$5 AND user_id=$6 RETURNING ${METAS_COLS}`,
      [d.nombre, d.montoObjetivo, d.fechaObjetivo, d.prioridad, req.params.id, req.userId]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

/* POST /api/metas/:id/aportar  { monto, metodo, descontar } */
router.post('/:id/aportar', async (req, res) => {
  const { monto, metodo, descontar } = req.body || {};
  if (!monto || monto <= 0) return res.status(400).json({ error: 'Monto inválido' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (descontar) {
      await verificarFondos(client, req.userId, metodo, monto);
    }
    const upd = await client.query(
      `UPDATE metas SET monto_actual = monto_actual + $1 WHERE id = $2 AND user_id = $3 RETURNING ${METAS_COLS}`,
      [monto, req.params.id, req.userId]
    );
    if (!upd.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No encontrada' });
    }
    // Historial de aportes: con esto se mide el ritmo real de ahorro de cada meta.
    await client.query(
      'INSERT INTO aportes_meta (user_id, meta_id, monto, fecha) VALUES ($1,$2,$3,$4)',
      [req.userId, req.params.id, monto, hoyMX()]
    );
    if (descontar) {
      const key = metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
      await client.query(
        `UPDATE saldo SET ${key} = ${key} - $1, updated_at = now() WHERE user_id = $2`,
        [monto, req.userId]
      );
    }
    await client.query('COMMIT');
    res.json(upd.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.tipo === 'fondos_insuficientes') {
      return res.status(400).json({ error: 'fondos_insuficientes', metodo: err.metodo, disponible: err.disponible, requerido: err.requerido, faltante: err.faltante });
    }
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

/* POST /api/metas/:id/consejo
   El front manda el plan ya calculado (capacidad, cuota, estado); aquí se
   agregan los gastos reales por categoría y Gemini propone ajustes. Se
   guarda en la meta y se reutiliza el mismo día. */
router.post('/:id/consejo', async (req, res) => {
  if (!hayLlave()) return res.status(503).json({ error: 'El asesor no está configurado.' });
  const p = req.body || {};
  try {
    const meta = (await pool.query(`SELECT ${METAS_COLS} FROM metas WHERE id=$1 AND user_id=$2`, [req.params.id, req.userId])).rows[0];
    if (!meta) return res.status(404).json({ error: 'No encontrada' });
    const hoy = hoyMX();
    if (!p.forzar && meta.consejo && meta.consejoFecha === hoy) return res.json(meta.consejo);

    const [cats, subs] = await Promise.all([
      pool.query(`SELECT categoria, SUM(monto)::float t, COUNT(*)::int n, AVG(rating)::float r
                  FROM gastos WHERE user_id=$1 AND fecha >= CURRENT_DATE - 90 GROUP BY categoria ORDER BY t DESC`, [req.userId]),
      pool.query('SELECT nombre, monto::float m, frecuencia FROM suscripciones WHERE user_id=$1 AND activa', [req.userId])
    ]);

    const prompt =
      'Eres un coach de ahorro personal en México: concreto, honesto y motivador. Ayuda a cumplir esta meta con los números REALES.\n\n' +
      'HOY ES ' + hoy + '. Toda fecha que des debe ser posterior a hoy.\n' +
      'META: "' + meta.nombre + '" · objetivo ' + $(meta.montoObjetivo) + ' · lleva ' + $(meta.montoActual) +
      ' · falta ' + $(meta.montoObjetivo - meta.montoActual) + ' · prioridad ' + meta.prioridad +
      (meta.fechaObjetivo ? ' · fecha límite ' + meta.fechaObjetivo : ' · sin fecha límite') + '.\n' +
      'PLAN CALCULADO: ' + (p.resumenPlan || '') + '\n' +
      'ESTADO: ' + (p.estado || 'sin datos') + '.\n' +
      'CAPACIDAD DE AHORRO MENSUAL (ingresos − gastos promedio − cuotas de deuda): ' + $(p.capacidad) + '; ya comprometido en otras metas: ' + $(p.comprometido) + '.\n' +
      'GASTOS DE LOS ÚLTIMOS 90 DÍAS POR CATEGORÍA (total / nº compras / calificación promedio): ' +
        (cats.rows.map((c) => c.categoria + ' ' + $(c.t) + ' / ' + c.n + (c.r ? ' / ' + c.r.toFixed(1) + '★' : '')).join('; ') || 'sin gastos') + '.\n' +
      'SUSCRIPCIONES: ' + (subs.rows.map((s) => s.nombre + ' ' + $(s.m) + ' ' + s.frecuencia).join(', ') || 'ninguna') + '.\n\n' +
      'Devuelve JSON:\n' +
      '- "diagnostico": 1-2 frases sobre cómo va y por qué, con números.\n' +
      '- "ajustes": 2 o 3 cambios concretos en sus gastos reales, cada uno { "accion": texto corto, "ahorroMensual": número }. Basados en las categorías y suscripciones de arriba; no inventes gastos.\n' +
      '- "reto": un reto para esta semana (1 frase, con monto).\n' +
      '- "fechaConAjustes": fecha YYYY-MM-DD estimada si aplica los ajustes (o cadena vacía si no se puede calcular).\n' +
      'No inventes datos.';

    const ia = await preguntarGemini(prompt, {
      type: 'OBJECT',
      properties: {
        diagnostico: { type: 'STRING' },
        ajustes: { type: 'ARRAY', items: { type: 'OBJECT', properties: { accion: { type: 'STRING' }, ahorroMensual: { type: 'NUMBER' } }, required: ['accion', 'ahorroMensual'] } },
        reto: { type: 'STRING' },
        fechaConAjustes: { type: 'STRING' }
      },
      required: ['diagnostico', 'ajustes', 'reto', 'fechaConAjustes']
    }, { temperatura: 0.4 });

    const consejo = {
      diagnostico: String(ia.diagnostico || '').slice(0, 400),
      ajustes: (ia.ajustes || []).slice(0, 3).map((a) => ({ accion: String(a.accion || '').slice(0, 140), ahorroMensual: Math.max(0, Math.round(Number(a.ahorroMensual) || 0)) })),
      reto: String(ia.reto || '').slice(0, 200),
      fechaConAjustes: FECHA_RE.test(String(ia.fechaConAjustes || '')) && ia.fechaConAjustes > hoy ? ia.fechaConAjustes : '',
      fecha: hoy
    };
    await pool.query('UPDATE metas SET consejo=$1, consejo_fecha=$2 WHERE id=$3', [JSON.stringify(consejo), hoy, meta.id]);
    res.json(consejo);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'El coach no respondió en este momento. Intenta de nuevo.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM metas WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
