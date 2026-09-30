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

router.COLS = COLS;
module.exports = router;
