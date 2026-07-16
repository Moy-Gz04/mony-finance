const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

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
      pool.query('SELECT * FROM ingresos WHERE user_id = $1 ORDER BY fecha DESC', [userId]),
      pool.query('SELECT * FROM gastos WHERE user_id = $1 ORDER BY fecha DESC', [userId]),
      pool.query('SELECT * FROM deudas WHERE user_id = $1 ORDER BY proximo_pago ASC', [userId]),
      pool.query('SELECT * FROM inversiones WHERE user_id = $1', [userId]),
      pool.query('SELECT * FROM metas WHERE user_id = $1', [userId]),
      pool.query('SELECT * FROM apuestas WHERE user_id = $1 ORDER BY fecha DESC', [userId])
    ]);

    const c = config.rows[0] || {};
    const f = fondo.rows[0] || {};

    res.json({
      saldo: saldo.rows[0] || { efectivo: 0, tarjeta: 0 },
      config: {
        tasaSofipoDefault: c.tasa_sofipo_default,
        distribucion: {
          necesidades: c.distribucion_necesidades,
          deseos: c.distribucion_deseos,
          ahorro: c.distribucion_ahorro
        },
        pagosPendientesColapsado: c.pagos_pendientes_colapsado
      },
      fondoEmergencia: {
        actual: f.actual,
        mesesObjetivo: f.meses_objetivo,
        gastoMensual: f.gasto_mensual
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
