const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/', async (req, res) => {
  const { nombre, montoTotal, montoCuota, tipo, proximoPago, duracion } = req.body || {};
  if (!nombre || !montoTotal || montoTotal <= 0 || !montoCuota || montoCuota <= 0 || !['unico', 'mensual', 'quincenal'].includes(tipo)) {
    return res.status(400).json({ error: 'Datos incompletos o inválidos' });
  }
  if (tipo !== 'unico' && (!duracion || duracion <= 0)) {
    return res.status(400).json({ error: 'Indica en cuántos pagos se liquida' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO deudas (user_id, nombre, monto_total, monto_pendiente, monto_cuota, tipo, proximo_pago, duracion, pagos_realizados)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7,0) RETURNING *`,
      [req.userId, nombre, montoTotal, montoCuota, tipo, proximoPago, tipo === 'unico' ? 1 : duracion]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

/* POST /api/deudas/:id/pagar  { metodo }
   Misma lógica que tenía el front: resta la cuota del saldo pendiente,
   avanza la fecha o marca como liquidada, y descuenta del saldo real. */
router.post('/:id/pagar', async (req, res) => {
  const { metodo } = req.body || {};
  if (!['efectivo', 'electronico'].includes(metodo)) {
    return res.status(400).json({ error: 'Método de pago inválido' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      'SELECT * FROM deudas WHERE id = $1 AND user_id = $2 FOR UPDATE', [req.params.id, req.userId]
    );
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No encontrada' });
    }
    const d = found.rows[0];
    if (d.pagada) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Esta deuda ya está liquidada' });
    }

    let pagosRealizados = d.pagos_realizados;
    let montoPendiente = Number(d.monto_pendiente);
    let pagada = false;
    let proximoPago = d.proximo_pago;

    if (d.tipo === 'unico') {
      pagada = true;
      montoPendiente = 0;
    } else {
      pagosRealizados += 1;
      montoPendiente = Math.max(0, montoPendiente - Number(d.monto_cuota));
      if ((d.duracion && pagosRealizados >= d.duracion) || montoPendiente <= 0) {
        pagada = true;
        montoPendiente = 0;
      } else {
        const dt = new Date(proximoPago);
        if (d.tipo === 'mensual') dt.setMonth(dt.getMonth() + 1);
        else dt.setDate(dt.getDate() + 15);
        proximoPago = dt.toISOString().slice(0, 10);
      }
    }

    const upd = await client.query(
      `UPDATE deudas SET pagos_realizados = $1, monto_pendiente = $2, pagada = $3, proximo_pago = $4
       WHERE id = $5 RETURNING *`,
      [pagosRealizados, montoPendiente, pagada, proximoPago, d.id]
    );

    const key = metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
    await client.query(
      `UPDATE saldo SET ${key} = GREATEST(0, ${key} - $1), updated_at = now() WHERE user_id = $2`,
      [d.monto_cuota, req.userId]
    );

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
  try {
    const result = await pool.query(
      'DELETE FROM deudas WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
