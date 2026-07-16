const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/', async (req, res) => {
  const { nombre, monto, frecuencia, fecha, metodo } = req.body || {};
  if (!nombre || !monto || monto <= 0 || !fecha || !['efectivo', 'electronico'].includes(metodo)) {
    return res.status(400).json({ error: 'Datos incompletos o inválidos' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO ingresos (user_id, nombre, monto, frecuencia, fecha, metodo)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.userId, nombre, monto, frecuencia || 'Único', fecha, metodo]
    );
    const key = metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
    await client.query(
      `UPDATE saldo SET ${key} = ${key} + $1, updated_at = now() WHERE user_id = $2`,
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
      'SELECT * FROM ingresos WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]
    );
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No encontrado' });
    }
    const ing = found.rows[0];
    await client.query('DELETE FROM ingresos WHERE id = $1', [ing.id]);
    const key = ing.metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
    await client.query(
      `UPDATE saldo SET ${key} = GREATEST(0, ${key} - $1), updated_at = now() WHERE user_id = $2`,
      [ing.monto, req.userId]
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
