const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { INGRESOS_COLS, GASTOS_COLS, DEUDAS_COLS, INVERSIONES_COLS, METAS_COLS, APUESTAS_COLS, APORTES_FONDO_COLS, SUPLEMENTOS_COLS, TOMAS_SUPLEMENTO_COLS, SUSCRIPCIONES_COLS } = require('../sqlColumns');

const { procesarAutomaticos } = require('../automatico');
const { COLS: RECURRENTES_COLS } = require('./recurrentes');

const router = express.Router();
router.use(requireAuth);

/* Entrega TODO el estado del usuario en un solo objeto, con la misma
   forma que ya usaba state.js en el front (para que la migración del
   front sea mínima). */
router.get('/', async (req, res) => {
  const userId = req.userId;
  try {
    // Antes de responder, se aplica lo automático (ingresos y cobros que ya tocaron).
    await procesarAutomaticos(userId);
    const [saldo, config, fondo, ingresos, gastos, deudas, inversiones, metas, apuestas, aportesFondo, suplementos, tomasSuplementos, suscripciones, recurrentes, automaticos, asesorHist, presupuestos, patrimonio, aportesMetas] = await Promise.all([
      pool.query('SELECT efectivo, tarjeta FROM saldo WHERE user_id = $1', [userId]),
      pool.query('SELECT * FROM config WHERE user_id = $1', [userId]),
      pool.query('SELECT actual, meses_objetivo, gasto_mensual FROM fondo_emergencia WHERE user_id = $1', [userId]),
      pool.query(`SELECT ${INGRESOS_COLS} FROM ingresos WHERE user_id = $1 ORDER BY fecha DESC`, [userId]),
      pool.query(`SELECT ${GASTOS_COLS} FROM gastos WHERE user_id = $1 ORDER BY fecha DESC`, [userId]),
      pool.query(`SELECT ${DEUDAS_COLS} FROM deudas WHERE user_id = $1 ORDER BY proximo_pago ASC`, [userId]),
      pool.query(`SELECT ${INVERSIONES_COLS} FROM inversiones WHERE user_id = $1`, [userId]),
      pool.query(`SELECT ${METAS_COLS} FROM metas WHERE user_id = $1`, [userId]),
      pool.query(`SELECT ${APUESTAS_COLS} FROM apuestas WHERE user_id = $1 ORDER BY fecha DESC`, [userId]),
      pool.query(`SELECT ${APORTES_FONDO_COLS} FROM aportes_fondo WHERE user_id = $1 ORDER BY fecha DESC`, [userId]),
      pool.query(`SELECT ${SUPLEMENTOS_COLS} FROM suplementos WHERE user_id = $1 ORDER BY orden, created_at`, [userId]),
      pool.query(`SELECT ${TOMAS_SUPLEMENTO_COLS} FROM tomas_suplemento WHERE user_id = $1 ORDER BY fecha DESC`, [userId]),
      pool.query(`SELECT ${SUSCRIPCIONES_COLS} FROM suscripciones WHERE user_id = $1 ORDER BY activa DESC, proximo_cobro`, [userId]),
      pool.query(`SELECT ${RECURRENTES_COLS} FROM ingresos_recurrentes WHERE user_id = $1 ORDER BY activo DESC, proximo`, [userId]),
      pool.query("SELECT id, tipo, nombre, monto, fecha, estado, created_at AS \"creado\" FROM movimientos_auto WHERE user_id = $1 AND NOT visto AND created_at > now() - interval '10 days' ORDER BY created_at DESC", [userId]),
      pool.query('SELECT id, pregunta, precio, respuesta, created_at AS "creado" FROM asesor_historial WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [userId]),
      pool.query('SELECT categoria, monto FROM presupuestos WHERE user_id = $1', [userId]),
      pool.query("SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, liquido, ahorro, deudas FROM patrimonio_diario WHERE user_id = $1 AND fecha > CURRENT_DATE - 400 ORDER BY fecha", [userId]),
      pool.query("SELECT meta_id AS \"metaId\", monto, to_char(fecha, 'YYYY-MM-DD') AS fecha FROM aportes_meta WHERE user_id = $1 ORDER BY fecha", [userId])
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
          ahorro: Number(c.distribucion_ahorro),
          inversion: Number(c.distribucion_inversion)
        },
        ingresoMensualFijo: Number(c.ingreso_mensual_fijo),
        pagosPendientesColapsado: c.pagos_pendientes_colapsado,
        presupuestoApuestas: Number(c.presupuesto_apuestas || 0)
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
      apuestas: apuestas.rows,
      aportesFondo: aportesFondo.rows,
      suplementos: suplementos.rows,
      tomasSuplementos: tomasSuplementos.rows,
      suscripciones: suscripciones.rows,
      recurrentes: recurrentes.rows,
      automaticos: automaticos.rows,
      asesorHistorial: asesorHist.rows,
      presupuestos: presupuestos.rows,
      patrimonio: patrimonio.rows,
      aportesMetas: aportesMetas.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
