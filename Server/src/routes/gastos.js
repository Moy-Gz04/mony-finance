const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/', async (req, res) => {
  const { descripcion, categoria, monto, fecha, metodo, rating, evaluacion } = req.body || {};
  if (!descripcion || !categoria || !monto || monto <= 0 || !fecha || !['efectivo', 'electronico'].includes(metodo)) {
    return res.status(400).json({ error: 'Datos incompletos o inválidos' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO gastos (user_id, descripcion, categoria, monto, fecha, metodo, rating, evaluacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.userId, descripcion, categoria, monto, fecha, metodo, rating || null, evaluacion ? JSON.stringify(evaluacion) : null]
    );
    const key = metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
    await client.query(
      `UPDATE saldo SET ${key} = GREATEST(0, ${key} - $1), updated_at = now() WHERE user_id = $2`,
      [monto, req.userId]
    );
    await client.query('COMMIT');
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      'SELECT * FROM gastos WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]
    );
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No encontrado' });
    }
    const g = found.rows[0];
    await client.query('DELETE FROM gastos WHERE id = $1', [g.id]);
    const key = g.metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
    await client.query(
      `UPDATE saldo SET ${key} = ${key} + $1, updated_at = now() WHERE user_id = $2`,
      [g.monto, req.userId]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

module.exports = router;
