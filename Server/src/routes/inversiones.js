const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/', async (req, res) => {
  const { nombre, monto, tasa } = req.body || {};
  if (!nombre || !monto || monto <= 0) {
    return res.status(400).json({ error: 'Datos incompletos o inválidos' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO inversiones (user_id, nombre, monto, tasa) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.userId, nombre, monto, tasa || null]
    );
    // Siempre sale de tarjeta / dinero electrónico, como pediste.
    await client.query(
      `UPDATE saldo SET tarjeta = GREATEST(0, tarjeta - $1), updated_at = now() WHERE user_id = $2`,
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
      'SELECT * FROM inversiones WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]
    );
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No encontrada' });
    }
    const inv = found.rows[0];
    await client.query('DELETE FROM inversiones WHERE id = $1', [inv.id]);
    await client.query(
      `UPDATE saldo SET tarjeta = tarjeta + $1, updated_at = now() WHERE user_id = $2`,
      [inv.monto, req.userId]
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
