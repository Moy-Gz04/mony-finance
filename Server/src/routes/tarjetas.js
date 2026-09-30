const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { verificarFondos } = require('../validaciones');

/* Tarjetas de crédito: se guarda el límite y lo usado; lo disponible
   es límite − usado. Una compra sube lo usado (no toca tu saldo, es
   crédito); un pago lo baja y sí sale de tu efectivo o tarjeta de débito. */
const COLS = `
  id, nombre,
  limite::float AS limite,
  usado::float AS usado,
  (limite - usado)::float AS disponible,
  dia_corte AS "diaCorte",
  dia_pago AS "diaPago"`;

const router = express.Router();
router.use(requireAuth);

function dia(v) { const n = parseInt(v, 10); return n >= 1 && n <= 31 ? n : null; }

router.post('/', async (req, res) => {
  const { nombre, limite, disponible, diaCorte, diaPago } = req.body || {};
  const lim = Number(limite);
  const disp = disponible === undefined || disponible === '' ? lim : Number(disponible);
  if (!nombre || !(lim > 0) || !(disp >= 0) || disp > lim) {
    return res.status(400).json({ error: 'Revisa el nombre, el límite y lo disponible' });
  }
  try {
    const r = await pool.query(
      `INSERT INTO tarjetas_credito (user_id, nombre, limite, usado, dia_corte, dia_pago)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLS}`,
      [req.userId, nombre, lim, +(lim - disp).toFixed(2), dia(diaCorte), dia(diaPago)]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error del servidor' }); }
});

router.put('/:id', async (req, res) => {
  const { nombre, limite, disponible, diaCorte, diaPago } = req.body || {};
  const lim = Number(limite), disp = Number(disponible);
  if (!nombre || !(lim > 0) || !(disp >= 0) || disp > lim) {
    return res.status(400).json({ error: 'Revisa el nombre, el límite y lo disponible' });
  }
  try {
    const r = await pool.query(
      `UPDATE tarjetas_credito SET nombre=$1, limite=$2, usado=$3, dia_corte=$4, dia_pago=$5
       WHERE id=$6 AND user_id=$7 RETURNING ${COLS}`,
      [nombre, lim, +(lim - disp).toFixed(2), dia(diaCorte), dia(diaPago), req.params.id, req.userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error del servidor' }); }
});

/* POST /:id/compra { monto } — gasto con la tarjeta de crédito */
router.post('/:id/compra', async (req, res) => {
  const monto = Number((req.body || {}).monto);
  if (!(monto > 0)) return res.status(400).json({ error: 'Monto inválido' });
  try {
    const r = await pool.query(
      `UPDATE tarjetas_credito SET usado = usado + $1
       WHERE id=$2 AND user_id=$3 AND limite - usado >= $1 RETURNING ${COLS}`,
      [monto, req.params.id, req.userId]
    );
    if (!r.rows.length) return res.status(400).json({ error: 'La compra rebasa lo disponible de la tarjeta' });
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error del servidor' }); }
});

/* POST /:id/pago { monto, metodo } — abono a la tarjeta, sale de tu saldo */
router.post('/:id/pago', async (req, res) => {
  const { metodo } = req.body || {};
  const monto = Number((req.body || {}).monto);
  if (!(monto > 0) || !['efectivo', 'electronico'].includes(metodo)) {
    return res.status(400).json({ error: 'Monto o método inválido' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const f = await client.query('SELECT usado FROM tarjetas_credito WHERE id=$1 AND user_id=$2 FOR UPDATE', [req.params.id, req.userId]);
    if (!f.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'No encontrada' }); }
    if (monto > Number(f.rows[0].usado) + 0.009) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'El pago es mayor a lo que debes en la tarjeta' }); }
    await verificarFondos(client, req.userId, metodo, monto);
    const r = await client.query(`UPDATE tarjetas_credito SET usado = GREATEST(0, usado - $1) WHERE id=$2 RETURNING ${COLS}`, [monto, req.params.id]);
    const key = metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
    await client.query(`UPDATE saldo SET ${key} = ${key} - $1, updated_at = now() WHERE user_id = $2`, [monto, req.userId]);
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.tipo === 'fondos_insuficientes') {
      return res.status(400).json({ error: 'fondos_insuficientes', metodo: err.metodo, disponible: err.disponible, requerido: err.requerido, faltante: err.faltante });
    }
    console.error(err); res.status(500).json({ error: 'Error del servidor' });
  } finally { client.release(); }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM tarjetas_credito WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.userId]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error del servidor' }); }
});


/* POST /analisis — diagnóstico de tus créditos con IA y números reales */
const { preguntarGemini, hayLlave } = require('../gemini');
const { contextoCredito } = require('../credito');
router.post('/analisis', async (req, res) => {
  if (!hayLlave()) return res.status(503).json({ error: 'El análisis no está configurado (falta GEMINI_API_KEY en el servidor).' });
  try {
    const u = req.userId;
    const cred = await contextoCredito(u);
    if (!cred.tarjetas.length) return res.status(400).json({ error: 'Agrega una tarjeta de crédito primero' });
    const [saldo, config, deudas, gastos] = await Promise.all([
      pool.query('SELECT efectivo::float e, tarjeta::float t FROM saldo WHERE user_id = $1', [u]),
      pool.query('SELECT ingreso_mensual_fijo::float i FROM config WHERE user_id = $1', [u]),
      pool.query("SELECT COALESCE(SUM(monto_cuota), 0)::float c FROM deudas WHERE user_id = $1 AND NOT pagada AND proximo_pago <= CURRENT_DATE + 30", [u]),
      pool.query("SELECT COALESCE(SUM(monto), 0)::float g FROM gastos WHERE user_id = $1 AND fecha >= CURRENT_DATE - 30", [u])
    ]);
    const s = saldo.rows[0] || { e: 0, t: 0 };
    const $ = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
    const dinero = s.e + s.t;
    const prompt = 'Eres un asesor financiero personal en México, directo y concreto. Analiza el uso de sus tarjetas de crédito.\n\n' +
      'HOY ' + new Date().toISOString().slice(0, 10) + '. ' + cred.texto + '\n' +
      'Dinero real disponible: ' + $(dinero) + ' (efectivo ' + $(s.e) + ', débito ' + $(s.t) + '). Ingreso mensual fijo: ' + $((config.rows[0] || {}).i) +
      '. Gastos de los últimos 30 días: ' + $(gastos.rows[0].g) + '. Cuotas de otras deudas en 30 días: ' + $(deudas.rows[0].c) + '.\n\n' +
      'Devuelve JSON: "estado" ("sano", "cuidado" o "riesgo"); "titulo" (máx. 8 palabras); "diagnostico" (2 frases con sus números: uso de crédito, si su dinero real alcanza para liquidar lo usado); ' +
      '"pagoSugerido" (monto en pesos que debería pagar ya a la tarjeta, sin dejarlo sin dinero para sus cuotas; 0 si no debe); ' +
      '"acciones" (2 a 4 acciones concretas, máx. 20 palabras cada una, en segunda persona, con montos y fechas si existen: pagar total antes de la fecha límite para no pagar intereses, bajar el uso a menos de 30%, no usar crédito para gustos, etc.). No inventes datos.';
    const ia = await preguntarGemini(prompt, {
      type: 'OBJECT',
      properties: {
        estado: { type: 'STRING', enum: ['sano', 'cuidado', 'riesgo'] }, titulo: { type: 'STRING' }, diagnostico: { type: 'STRING' },
        pagoSugerido: { type: 'NUMBER' }, acciones: { type: 'ARRAY', items: { type: 'STRING' } }
      },
      required: ['estado', 'titulo', 'diagnostico', 'pagoSugerido', 'acciones']
    }, { temperatura: 0.3 });
    const pago = Math.max(0, Math.min(Number(ia.pagoSugerido) || 0, cred.usado, dinero));
    res.json({ ...ia, pagoSugerido: Math.round(pago * 100) / 100, uso: cred.uso, usado: cred.usado, limite: cred.limite, dinero });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'El análisis no respondió en este momento. Intenta de nuevo en un minuto.' });
  }
});

router.COLS = COLS;
module.exports = router;
