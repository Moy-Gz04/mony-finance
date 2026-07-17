const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { verificarFondos } = require('../validaciones');

const router = express.Router();
router.use(requireAuth);

/* PUT /api/fondo-emergencia  { actual, mesesObjetivo, gastoMensual }
   Cualquier campo omitido no se modifica. */
router.put('/', async (req, res) => {
  const { actual, mesesObjetivo, gastoMensual } = req.body || {};
  try {
    const result = await pool.query(
      `UPDATE fondo_emergencia SET
         actual = COALESCE($1, actual),
         meses_objetivo = COALESCE($2, meses_objetivo),
         gasto_mensual = COALESCE($3, gasto_mensual)
       WHERE user_id = $4
       RETURNING actual, meses_objetivo AS "mesesObjetivo", gasto_mensual AS "gastoMensual"`,
      [actual, mesesObjetivo, gastoMensual, req.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

/* POST /api/fondo-emergencia/aportar  { monto, metodo, descontar, fecha }
   Suma al total acumulado Y deja un registro con fecha en aportes_fondo,
   para poder saber cuánto se aportó en un mes específico (plan mensual). */
router.post('/aportar', async (req, res) => {
  const { monto, metodo, descontar, fecha } = req.body || {};
  if (!monto || monto <= 0) return res.status(400).json({ error: 'Monto inválido' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (descontar) {
      await verificarFondos(client, req.userId, metodo, monto);
    }
    const fe = await client.query(
      `UPDATE fondo_emergencia SET actual = actual + $1 WHERE user_id = $2
       RETURNING actual, meses_objetivo AS "mesesObjetivo", gasto_mensual AS "gastoMensual"`,
      [monto, req.userId]
    );
    await client.query(
      `INSERT INTO aportes_fondo (user_id, monto, fecha) VALUES ($1, $2, $3)`,
      [req.userId, monto, fecha || new Date().toISOString().slice(0, 10)]
    );
    if (descontar) {
      const key = metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
      await client.query(
        `UPDATE saldo SET ${key} = ${key} - $1, updated_at = now() WHERE user_id = $2`,
        [monto, req.userId]
      );
    }
    await client.query('COMMIT');
    res.json(fe.rows[0]);
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

module.exports = router;
