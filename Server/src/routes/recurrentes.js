/* ==================================================================
   BATFINANCE · Ingresos recurrentes y movimientos automáticos
   ------------------------------------------------------------------
   /api/recurrentes        CRUD de ingresos que llegan solos
   /api/automaticos/:id    deshacer / marcar como visto lo que la app
                           registró sola (ingresos y cobros)
   ================================================================== */
const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { procesarAutomaticos } = require('../automatico');

const recurrentes = express.Router();
const automaticos = express.Router();
recurrentes.use(requireAuth);
automaticos.use(requireAuth);

const COLS = `id, nombre, monto, frecuencia, metodo, proximo, activo`;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function leer(b) {
  const nombre = String(b.nombre || '').trim().slice(0, 60);
  const monto = Math.round(Number(b.monto) * 100) / 100;
  const frecuencia = ['semanal', 'quincenal', 'mensual'].includes(b.frecuencia) ? b.frecuencia : 'quincenal';
  const metodo = b.metodo === 'efectivo' ? 'efectivo' : 'electronico';
  const proximo = FECHA_RE.test(String(b.proximo || '')) ? b.proximo : null;
  if (!nombre) return { error: 'Escribe de dónde viene el ingreso' };
  if (!(monto > 0)) return { error: 'El monto debe ser mayor a 0' };
  if (!proximo) return { error: 'Elige la fecha del próximo depósito' };
  return { nombre, monto, frecuencia, metodo, proximo, activo: b.activo !== false };
}

recurrentes.post('/', async (req, res) => {
  const d = leer(req.body || {});
  if (d.error) return res.status(400).json({ error: d.error });
  try {
    const r = await pool.query(
      `INSERT INTO ingresos_recurrentes (user_id, nombre, monto, frecuencia, metodo, proximo)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLS}`,
      [req.userId, d.nombre, d.monto, d.frecuencia, d.metodo, d.proximo]);
    await procesarAutomaticos(req.userId); // si la fecha ya pasó, se registra de una vez
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error del servidor' }); }
});

recurrentes.put('/:id', async (req, res) => {
  const d = leer(req.body || {});
  if (d.error) return res.status(400).json({ error: d.error });
  try {
    const r = await pool.query(
      `UPDATE ingresos_recurrentes SET nombre=$1, monto=$2, frecuencia=$3, metodo=$4, proximo=$5, activo=$6
       WHERE id=$7 AND user_id=$8 RETURNING ${COLS}`,
      [d.nombre, d.monto, d.frecuencia, d.metodo, d.proximo, d.activo, req.params.id, req.userId]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error del servidor' }); }
});

recurrentes.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM ingresos_recurrentes WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.userId]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error del servidor' }); }
});

/* Deshacer: borra el ingreso/gasto creado, revierte el saldo y regresa
   la fecha programada para que no se vuelva a aplicar solo. */
automaticos.post('/:id/deshacer', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const m = (await client.query('SELECT * FROM movimientos_auto WHERE id=$1 AND user_id=$2 FOR UPDATE', [req.params.id, req.userId])).rows[0];
    if (!m) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'No encontrado' }); }
    if (m.estado !== 'aplicado') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Ya no se puede deshacer' }); }
    if (m.tipo === 'ingreso') {
      const i = (await client.query('DELETE FROM ingresos WHERE id=$1 AND user_id=$2 RETURNING monto, metodo', [m.registro_id, req.userId])).rows[0];
      if (i) {
        const key = i.metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
        await client.query(`UPDATE saldo SET ${key} = ${key} - $1, updated_at = now() WHERE user_id = $2`, [i.monto, req.userId]);
      }
    } else {
      const g = (await client.query('DELETE FROM gastos WHERE id=$1 AND user_id=$2 RETURNING monto, metodo', [m.registro_id, req.userId])).rows[0];
      if (g) {
        const key = g.metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
        await client.query(`UPDATE saldo SET ${key} = ${key} + $1, updated_at = now() WHERE user_id = $2`, [g.monto, req.userId]);
      }
    }
    // Se queda registrado como "deshecho": así no se vuelve a aplicar esa misma fecha.
    await client.query("UPDATE movimientos_auto SET estado='deshecho', visto=true WHERE id=$1", [m.id]);
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

automaticos.post('/:id/visto', async (req, res) => {
  try {
    await pool.query('UPDATE movimientos_auto SET visto=true WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error del servidor' }); }
});

module.exports = { recurrentes, automaticos, COLS };
