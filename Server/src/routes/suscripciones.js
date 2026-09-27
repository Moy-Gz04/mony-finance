const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { SUSCRIPCIONES_COLS, GASTOS_COLS } = require('../sqlColumns');
const { verificarFondos } = require('../validaciones');

const router = express.Router();
router.use(requireAuth);

const FRECUENCIAS = ['semanal', 'quincenal', 'mensual', 'anual'];
const METODOS = ['efectivo', 'electronico'];
const CATEGORIAS = ['alimentos', 'ropa', 'entretenimiento', 'tecnologia', 'pareja', 'transporte', 'salud', 'hogar', 'otros'];
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function leer(body) {
  const nombre = String(body.nombre || '').trim().slice(0, 60);
  const monto = Math.round(Number(body.monto) * 100) / 100;
  const frecuencia = FRECUENCIAS.includes(body.frecuencia) ? body.frecuencia : 'mensual';
  const metodo = METODOS.includes(body.metodo) ? body.metodo : 'electronico';
  const categoria = CATEGORIAS.includes(body.categoria) ? body.categoria : 'entretenimiento';
  const proximoCobro = FECHA_RE.test(String(body.proximoCobro || '')) ? body.proximoCobro : null;
  if (!nombre) return { error: 'Escribe el nombre de la suscripción' };
  if (!(monto > 0)) return { error: 'El costo debe ser mayor a 0' };
  if (!proximoCobro) return { error: 'Elige la fecha del próximo cobro' };
  const autoCobro = body.autoCobro !== false;
  return { nombre, monto, frecuencia, metodo, categoria, proximoCobro, autoCobro };
}

function siguienteCobro(fecha, frecuencia) {
  const [y, m, d] = String(fecha).slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (frecuencia === 'semanal') dt.setUTCDate(dt.getUTCDate() + 7);
  else if (frecuencia === 'quincenal') dt.setUTCDate(dt.getUTCDate() + 15);
  else if (frecuencia === 'anual') dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  else {
    // Mismo día del mes siguiente; si no existe (31 → febrero), el último día.
    const destino = new Date(Date.UTC(y, m, 1));
    const ultimo = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
    destino.setUTCDate(Math.min(d, ultimo));
    return destino.toISOString().slice(0, 10);
  }
  return dt.toISOString().slice(0, 10);
}

router.post('/', async (req, res) => {
  const d = leer(req.body || {});
  if (d.error) return res.status(400).json({ error: d.error });
  try {
    const r = await pool.query(
      `INSERT INTO suscripciones (user_id, nombre, monto, frecuencia, metodo, categoria, proximo_cobro, auto_cobro)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${SUSCRIPCIONES_COLS}`,
      [req.userId, d.nombre, d.monto, d.frecuencia, d.metodo, d.categoria, d.proximoCobro, d.autoCobro]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.put('/:id', async (req, res) => {
  const d = leer(req.body || {});
  if (d.error) return res.status(400).json({ error: d.error });
  const activa = (req.body || {}).activa !== false;
  try {
    const r = await pool.query(
      `UPDATE suscripciones SET nombre=$1, monto=$2, frecuencia=$3, metodo=$4, categoria=$5, proximo_cobro=$6, activa=$7, auto_cobro=$8
       WHERE id=$9 AND user_id=$10 RETURNING ${SUSCRIPCIONES_COLS}`,
      [d.nombre, d.monto, d.frecuencia, d.metodo, d.categoria, d.proximoCobro, activa, d.autoCobro, req.params.id, req.userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

/* POST /api/suscripciones/:id/pagar  { metodo? }
   Registra el cobro como gasto (descuenta del saldo) y mueve la fecha
   del próximo cobro según la frecuencia. */
router.post('/:id/pagar', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const f = await client.query('SELECT * FROM suscripciones WHERE id = $1 AND user_id = $2 FOR UPDATE', [req.params.id, req.userId]);
    if (!f.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'No encontrada' }); }
    const s = f.rows[0];
    const metodo = METODOS.includes((req.body || {}).metodo) ? req.body.metodo : s.metodo;
    const fecha = String(s.proximo_cobro).slice(0, 10);
    await verificarFondos(client, req.userId, metodo, Number(s.monto));
    const gasto = await client.query(
      `INSERT INTO gastos (user_id, descripcion, categoria, monto, fecha, metodo)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${GASTOS_COLS}`,
      [req.userId, 'Suscripción: ' + s.nombre, s.categoria, s.monto, fecha <= new Date().toISOString().slice(0, 10) ? fecha : new Date().toISOString().slice(0, 10), metodo]
    );
    const key = metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
    await client.query(`UPDATE saldo SET ${key} = ${key} - $1, updated_at = now() WHERE user_id = $2`, [s.monto, req.userId]);
    const upd = await client.query(
      `UPDATE suscripciones SET proximo_cobro = $1 WHERE id = $2 RETURNING ${SUSCRIPCIONES_COLS}`,
      [siguienteCobro(fecha, s.frecuencia), s.id]
    );
    await client.query('COMMIT');
    res.json({ suscripcion: upd.rows[0], gasto: gasto.rows[0] });
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

router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM suscripciones WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.userId]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
