const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.put('/', async (req, res) => {
  const { tasaSofipoDefault, distribucion, pagosPendientesColapsado } = req.body || {};
  try {
    await pool.query(
      `UPDATE config SET
         tasa_sofipo_default = COALESCE($1, tasa_sofipo_default),
         distribucion_necesidades = COALESCE($2, distribucion_necesidades),
         distribucion_deseos = COALESCE($3, distribucion_deseos),
         distribucion_ahorro = COALESCE($4, distribucion_ahorro),
         distribucion_inversion = COALESCE($5, distribucion_inversion),
         pagos_pendientes_colapsado = COALESCE($6, pagos_pendientes_colapsado)
       WHERE user_id = $7`,
      [
        tasaSofipoDefault,
        distribucion ? distribucion.necesidades : null,
        distribucion ? distribucion.deseos : null,
        distribucion ? distribucion.ahorro : null,
        distribucion ? distribucion.inversion : null,
        pagosPendientesColapsado,
        req.userId
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
