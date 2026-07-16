const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { INGRESOS_COLS, GASTOS_COLS, DEUDAS_COLS, INVERSIONES_COLS, METAS_COLS, APUESTAS_COLS } = require('../sqlColumns');

const router = express.Router();
router.use(requireAuth);

/* Entrega TODO el estado del usuario en un solo objeto, con la misma
   forma que ya usaba state.js en el front (para que la migración del
   front sea mínima). */
router.get('/', async (req, res) => {
  const userId = req.userId;
  try {
    const [saldo, config, fondo, ingresos, gastos, deudas, inversiones, metas, apuestas] = await Promise.all([
      pool.query('SELECT efectivo, tarjeta FROM saldo WHERE user_id = $1', [userId]),
      pool.query('SELECT * FROM config WHERE user_id = $1', [userId]),
      pool.query('SELECT actual, meses_objetivo, gasto_mensual FROM fondo_emergencia WHERE user_id = $1', [userId]),
      pool.query(`SELECT ${INGRESOS_COLS} FROM ingresos WHERE user_id = $1 ORDER BY fecha DESC`, [userId]),
      pool.query(`SELECT ${GASTOS_COLS} FROM gastos WHERE user_id = $1 ORDER BY fecha DESC`, [userId]),
      pool.query(`SELECT ${DEUDAS_COLS} FROM deudas WHERE user_id = $1 ORDER BY proximo_pago ASC`, [userId]),
      pool.query(`SELECT ${INVERSIONES_COLS} FROM inversiones WHERE user_id = $1`, [userId]),
      pool.query(`SELECT ${METAS_COLS} FROM metas WHERE user_id = $1`, [userId]),
      pool.query(`SELECT ${APUESTAS_COLS} FROM apuestas WHERE user_id = $1 ORDER BY fecha DESC`, [userId])
    ]);

    const c = config.rows[0] || {};
    const f = fondo.rows[0] || {};

    res.json({
      saldo: saldo.rows[0] || { efectivo: 0, tarjeta: 0 },
      config: {
        tasaSofipoDefault: Number(c.tasa_sofipo_default),
        distribucion: {
          necesidades: Number(c.distribucion_necesidades),
          deseos: Number(c.distribucion_deseos),
          ahorro: Number(c.distribucion_ahorro)
        },
        pagosPendientesColapsado: c.pagos_pendientes_colapsado
      },
      fondoEmergencia: {
        actual: Number(f.actual),
        mesesObjetivo: Number(f.meses_objetivo),
        gastoMensual: Number(f.gasto_mensual)
      },
      ingresos: ingresos.rows,
      gastos: gastos.rows,
      deudas: deudas.rows,
      inversiones: inversiones.rows,
      metas: metas.rows,
      apuestas: apuestas.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
