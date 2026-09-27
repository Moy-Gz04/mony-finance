const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const CATEGORIAS = ['alimentos', 'ropa', 'entretenimiento', 'tecnologia', 'pareja', 'transporte', 'salud', 'hogar', 'otros'];

/* PUT /api/presupuestos  { categoria, monto }  (monto 0 = quitar el presupuesto) */
router.put('/', async (req, res) => {
  const { categoria } = req.body || {};
  const monto = Math.round(Number((req.body || {}).monto) * 100) / 100;
  if (!CATEGORIAS.includes(categoria)) return res.status(400).json({ error: 'Categoría inválida' });
  if (!(monto >= 0)) return res.status(400).json({ error: 'Monto inválido' });
  try {
    if (monto === 0) {
      await pool.query('DELETE FROM presupuestos WHERE user_id=$1 AND categoria=$2', [req.userId, categoria]);
    } else {
      await pool.query(
        `INSERT INTO presupuestos (user_id, categoria, monto) VALUES ($1,$2,$3)
         ON CONFLICT (user_id, categoria) DO UPDATE SET monto = EXCLUDED.monto`, [req.userId, categoria, monto]);
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error del servidor' }); }
});

module.exports = router;
