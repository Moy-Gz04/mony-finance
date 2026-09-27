const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { SUPLEMENTOS_COLS, TOMAS_SUPLEMENTO_COLS } = require('../sqlColumns');

const router = express.Router();
router.use(requireAuth);

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNIDADES = ['g', 'cápsula', 'scoop', 'ml'];

// Paleta validada (dark, contraste y daltonismo). Cada suplemento nuevo
// toma el siguiente color según su orden; el color queda fijo al
// suplemento aunque luego se borren otros.
const PALETA = ['#009E86', '#8B6BFF', '#C97C22', '#3D8FE8', '#E8456A', '#2A9CB2', '#8F8C2E'];

function leerDatos(body) {
  const nombre = String(body.nombre || '').trim();
  const cantidadPorToma = Number(body.cantidadPorToma);
  const unidad = UNIDADES.includes(body.unidad) ? body.unidad : 'g';
  if (!nombre) return { error: 'Escribe el nombre del suplemento' };
  if (!(cantidadPorToma > 0)) return { error: 'La cantidad por toma debe ser mayor a 0' };
  return { nombre, cantidadPorToma, unidad };
}

async function todasLasTomas(userId) {
  const r = await pool.query(
    `SELECT ${TOMAS_SUPLEMENTO_COLS} FROM tomas_suplemento WHERE user_id = $1 ORDER BY fecha DESC`, [userId]
  );
  return r.rows;
}

/* POST /api/suplementos  { nombre, cantidadPorToma, unidad } */
router.post('/', async (req, res) => {
  const d = leerDatos(req.body || {});
  if (d.error) return res.status(400).json({ error: d.error });
  try {
    const orden = (await pool.query(
      'SELECT COALESCE(MAX(orden), 0) + 1 AS n FROM suplementos WHERE user_id = $1', [req.userId]
    )).rows[0].n;
    const result = await pool.query(
      `INSERT INTO suplementos (user_id, nombre, orden, cantidad_por_toma, unidad, color)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${SUPLEMENTOS_COLS}`,
      [req.userId, d.nombre, orden, d.cantidadPorToma, d.unidad, PALETA[(orden - 1) % PALETA.length]]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

/* PUT /api/suplementos/:id  { nombre, cantidadPorToma, unidad } */
router.put('/:id', async (req, res) => {
  const d = leerDatos(req.body || {});
  if (d.error) return res.status(400).json({ error: d.error });
  try {
    const result = await pool.query(
      `UPDATE suplementos SET nombre = $1, cantidad_por_toma = $2, unidad = $3
       WHERE id = $4 AND user_id = $5 RETURNING ${SUPLEMENTOS_COLS}`,
      [d.nombre, d.cantidadPorToma, d.unidad, req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

/* POST /api/suplementos/:id/toma  { fecha: 'YYYY-MM-DD', cantidad: n }
   Fija cuántas tomas hubo ese día (0 = ninguna, se borra el registro). */
router.post('/:id/toma', async (req, res) => {
  const { fecha } = req.body || {};
  const cantidad = Math.floor(Number((req.body || {}).cantidad));
  if (!FECHA_RE.test(String(fecha || ''))) return res.status(400).json({ error: 'Fecha inválida' });
  if (!(cantidad >= 0 && cantidad <= 50)) return res.status(400).json({ error: 'Cantidad inválida' });
  try {
    const sup = await pool.query('SELECT id FROM suplementos WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (!sup.rows.length) return res.status(404).json({ error: 'No encontrado' });
    if (cantidad > 0) {
      await pool.query(
        `INSERT INTO tomas_suplemento (user_id, suplemento_id, fecha, cantidad) VALUES ($1,$2,$3,$4)
         ON CONFLICT (suplemento_id, fecha) DO UPDATE SET cantidad = EXCLUDED.cantidad`,
        [req.userId, req.params.id, fecha, cantidad]
      );
    } else {
      await pool.query('DELETE FROM tomas_suplemento WHERE suplemento_id = $1 AND fecha = $2 AND user_id = $3',
        [req.params.id, fecha, req.userId]);
    }
    res.json({ ok: true, tomas: await todasLasTomas(req.userId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM suplementos WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
