const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { GASTOS_COLS } = require('../sqlColumns');
const { verificarFondos } = require('../validaciones');

const router = express.Router();
router.use(requireAuth);

router.post('/', async (req, res) => {
  const { descripcion, categoria, monto, fecha, metodo, rating, evaluacion, tarjetaId } = req.body || {};
  if (!descripcion || !categoria || !monto || monto <= 0 || !fecha || !['efectivo', 'electronico', 'credito'].includes(metodo) || (metodo === 'credito' && !tarjetaId)) {
    return res.status(400).json({ error: 'Datos incompletos o inválidos' });
  }
  // Si la compra pasó por el asistente (tiene rating), programamos el
  // seguimiento post-compra 5 días después de la fecha del gasto.
  let seguimientoFecha = null;
  if (rating != null) {
    const dt = new Date(fecha + 'T00:00:00');
    dt.setDate(dt.getDate() + 5);
    seguimientoFecha = dt.toISOString().slice(0, 10);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (metodo === 'credito') {
      // Crédito: no sale del saldo, sube lo usado de la tarjeta (si alcanza lo disponible).
      const t = await client.query(
        'UPDATE tarjetas_credito SET usado = usado + $1 WHERE id = $2 AND user_id = $3 AND limite - usado >= $1 RETURNING id',
        [monto, tarjetaId, req.userId]
      );
      if (!t.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'La compra rebasa lo disponible de la tarjeta de crédito' });
      }
    } else {
      await verificarFondos(client, req.userId, metodo, monto);
    }
    const ins = await client.query(
      `INSERT INTO gastos (user_id, descripcion, categoria, monto, fecha, metodo, rating, evaluacion, seguimiento_fecha, tarjeta_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${GASTOS_COLS}`,
      [req.userId, descripcion, categoria, monto, fecha, metodo, rating || null, evaluacion ? JSON.stringify(evaluacion) : null, seguimientoFecha, metodo === 'credito' ? tarjetaId : null]
    );
    const key = metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
    if (metodo !== 'credito') await client.query(
      `UPDATE saldo SET ${key} = ${key} - $1, updated_at = now() WHERE user_id = $2`,
      [monto, req.userId]
    );
    await client.query('COMMIT');
    res.status(201).json(ins.rows[0]);
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

/* POST /api/gastos/:id/seguimiento  { respuesta: 'contento'|'neutral'|'arrepentido' }
   Registra la respuesta del seguimiento post-compra. */
router.post('/:id/seguimiento', async (req, res) => {
  const { respuesta } = req.body || {};
  if (!['contento', 'neutral', 'arrepentido'].includes(respuesta)) {
    return res.status(400).json({ error: 'Respuesta inválida' });
  }
  try {
    const result = await pool.query(
      `UPDATE gastos SET seguimiento_respuesta = $1, seguimiento_hecho = true
       WHERE id = $2 AND user_id = $3 RETURNING ${GASTOS_COLS}`,
      [respuesta, req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
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
    if (g.metodo === 'credito') {
      if (g.tarjeta_id) await client.query('UPDATE tarjetas_credito SET usado = GREATEST(0, usado - $1) WHERE id = $2', [g.monto, g.tarjeta_id]);
    } else await client.query(
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
