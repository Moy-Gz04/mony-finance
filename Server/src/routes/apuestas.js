const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { APUESTAS_COLS } = require('../sqlColumns');
const { verificarFondos } = require('../validaciones');

const { pronosticosDelDia } = require('../pronosticos');

const router = express.Router();
router.use(requireAuth);

/* PUT /api/apuestas/presupuesto  { monto }  tope mensual (0 = sin tope) */
router.put('/presupuesto', async (req, res) => {
  const monto = Math.max(0, Math.round(Number((req.body || {}).monto) || 0));
  try {
    await pool.query('UPDATE config SET presupuesto_apuestas = $1 WHERE user_id = $2', [monto, req.userId]);
    res.json({ presupuestoApuestas: monto });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

/* GET /api/apuestas/pronosticos  partidos reales (ESPN) + análisis con IA */
router.get('/pronosticos', async (req, res) => {
  try {
    res.json(await pronosticosDelDia(req.query.forzar === '1'));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'No pude traer los partidos en este momento. Intenta más tarde.' });
  }
});

router.post('/', async (req, res) => {
  const { descripcion, montoApostado, fecha } = req.body || {};
  const cuota = Number(req.body.cuota) > 1 ? Math.round(Number(req.body.cuota) * 100) / 100 : null;
  const tipo = req.body.tipo === 'parlay' ? 'parlay' : 'sencilla';
  const deporte = req.body.deporte ? String(req.body.deporte).slice(0, 30) : null;
  if (!descripcion || !montoApostado || montoApostado <= 0 || !fecha) {
    return res.status(400).json({ error: 'Datos incompletos o inválidos' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verificarFondos(client, req.userId, 'electronico', montoApostado);
    const ins = await client.query(
      `INSERT INTO apuestas (user_id, descripcion, monto_apostado, fecha, estado, cuota, tipo, deporte)
       VALUES ($1,$2,$3,$4,'pendiente',$5,$6,$7) RETURNING ${APUESTAS_COLS}`,
      [req.userId, descripcion, montoApostado, fecha, cuota, tipo, deporte]
    );
    await client.query(
      `UPDATE saldo SET tarjeta = tarjeta - $1, updated_at = now() WHERE user_id = $2`,
      [montoApostado, req.userId]
    );
    await client.query('COMMIT');
    res.status(201).json(ins.rows[0]);
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

/* POST /api/apuestas/:id/resolver  { estado: 'ganada'|'perdida', montoGanado } */
router.post('/:id/resolver', async (req, res) => {
  const { estado, montoGanado } = req.body || {};
  if (!['ganada', 'perdida'].includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  if (estado === 'ganada' && (montoGanado == null || montoGanado < 0)) {
    return res.status(400).json({ error: 'Indica cuánto se recibió' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      'SELECT * FROM apuestas WHERE id = $1 AND user_id = $2 FOR UPDATE', [req.params.id, req.userId]
    );
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No encontrada' });
    }
    if (found.rows[0].estado !== 'pendiente') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Esta apuesta ya fue resuelta' });
    }

    const upd = await client.query(
      `UPDATE apuestas SET estado = $1, monto_ganado = $2 WHERE id = $3 RETURNING ${APUESTAS_COLS}`,
      [estado, estado === 'ganada' ? montoGanado : null, req.params.id]
    );
    if (estado === 'ganada') {
      await client.query(
        `UPDATE saldo SET tarjeta = tarjeta + $1, updated_at = now() WHERE user_id = $2`,
        [montoGanado, req.userId]
      );
    }
    await client.query('COMMIT');
    res.json(upd.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      'SELECT * FROM apuestas WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]
    );
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No encontrada' });
    }
    const a = found.rows[0];
    await client.query('DELETE FROM apuestas WHERE id = $1', [a.id]);
    await client.query(
      `UPDATE saldo SET tarjeta = tarjeta + $1, updated_at = now() WHERE user_id = $2`,
      [a.monto_apostado, req.userId]
    );
    if (a.estado === 'ganada' && a.monto_ganado) {
      await client.query(
        `UPDATE saldo SET tarjeta = GREATEST(0, tarjeta - $1), updated_at = now() WHERE user_id = $2`,
        [a.monto_ganado, req.userId]
      );
    }
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

module.exports = router;
