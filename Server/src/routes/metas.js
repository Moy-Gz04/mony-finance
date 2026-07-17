const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { METAS_COLS } = require('../sqlColumns');
const { verificarFondos } = require('../validaciones');

const router = express.Router();
router.use(requireAuth);

router.post('/', async (req, res) => {
  const { nombre, montoObjetivo, montoActual } = req.body || {};
  if (!nombre || !montoObjetivo || montoObjetivo <= 0) {
    return res.status(400).json({ error: 'Datos incompletos o inválidos' });
  }
  const inicial = montoActual && montoActual > 0 ? montoActual : 0;
  try {
    const result = await pool.query(
      `INSERT INTO metas (user_id, nombre, monto_objetivo, monto_actual) VALUES ($1,$2,$3,$4) RETURNING ${METAS_COLS}`,
      [req.userId, nombre, montoObjetivo, inicial]
    );
    res.status(201).json(result.rows[0]);
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
