const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/', async (req, res) => {
  const { descripcion, montoApostado, fecha } = req.body || {};
  if (!descripcion || !montoApostado || montoApostado <= 0 || !fecha) {
    return res.status(400).json({ error: 'Datos incompletos o inválidos' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO apuestas (user_id, descripcion, monto_apostado, fecha, estado)
       VALUES ($1,$2,$3,$4,'pendiente') RETURNING *`,
      [req.userId, descripcion, montoApostado, fecha]
    );
    await client.query(
      `UPDATE saldo SET tarjeta = GREATEST(0, tarjeta - $1), updated_at = now() WHERE user_id = $2`,
      [montoApostado, req.userId]
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

/* POST /api/apuestas/:id/resolver  { estado: 'ganada'|'perdida', montoGanado } */
router.post('/:id/resolver', async (req, res) => {
  const { estado, montoGanado } = req.body || {};
  if (!['ganada', 'perdida'].includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  if (estado === 'ganada' && (montoGanado == null || montoGanado < 0)) {
    return res.status(400).json({ error: 'Indica cuánto se recibió' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      'SELECT * FROM apuestas WHERE id = $1 AND user_id = $2 FOR UPDATE', [req.params.id, req.userId]
    );
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No encontrada' });
    }
    if (found.rows[0].estado !== 'pendiente') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Esta apuesta ya fue resuelta' });
    }

    const upd = await client.query(
      `UPDATE apuestas SET estado = $1, monto_ganado = $2 WHERE id = $3 RETURNING *`,
      [estado, estado === 'ganada' ? montoGanado : null, req.params.id]
    );
    if (estado === 'ganada') {
      await client.query(
        `UPDATE saldo SET tarjeta = tarjeta + $1, updated_at = now() WHERE user_id = $2`,
        [montoGanado, req.userId]
      );
    }
    await client.query('COMMIT');
    res.json(upd.rows[0]);
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
      'SELECT * FROM apuestas WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]
    );
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No encontrada' });
    }
    const a = found.rows[0];
    await client.query('DELETE FROM apuestas WHERE id = $1', [a.id]);
    // Revierte lo que esta apuesta haya movido, sin importar su estado.
    await client.query(
      `UPDATE saldo SET tarjeta = tarjeta + $1, updated_at = now() WHERE user_id = $2`,
      [a.monto_apostado, req.userId]
    );
    if (a.estado === 'ganada' && a.monto_ganado) {
      await client.query(
        `UPDATE saldo SET tarjeta = GREATEST(0, tarjeta - $1), updated_at = now() WHERE user_id = $2`,
        [a.monto_ganado, req.userId]
      );
    }
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
