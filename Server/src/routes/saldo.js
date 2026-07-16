const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/* PUT /api/saldo  { efectivo, tarjeta }  -> reemplaza el saldo absoluto
   (usado por el modal "Ajustar saldo") */
router.put('/', async (req, res) => {
  const { efectivo, tarjeta } = req.body || {};
  if (efectivo == null || tarjeta == null || efectivo < 0 || tarjeta < 0) {
    return res.status(400).json({ error: 'Montos inválidos' });
  }
  try {
    await pool.query(
      `INSERT INTO saldo (user_id, efectivo, tarjeta, updated_at) VALUES ($1,$2,$3, now())
       ON CONFLICT (user_id) DO UPDATE SET efectivo = $2, tarjeta = $3, updated_at = now()`,
      [req.userId, efectivo, tarjeta]
    );
    res.json({ efectivo, tarjeta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

/* PUT /api/saldo/ajustar  { metodo, delta } -> mueve el saldo +/- delta
   (usado internamente por ingresos, gastos, inversiones y apuestas;
   también disponible si el front lo necesita directo) */
router.put('/ajustar', async (req, res) => {
  const { metodo, delta } = req.body || {};
  const key = metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
  if (delta == null || isNaN(delta)) {
    return res.status(400).json({ error: 'Delta inválido' });
  }
  try {
    const result = await pool.query(
      `UPDATE saldo SET ${key} = GREATEST(0, ${key} + $1), updated_at = now()
       WHERE user_id = $2 RETURNING efectivo, tarjeta`,
      [delta, req.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
