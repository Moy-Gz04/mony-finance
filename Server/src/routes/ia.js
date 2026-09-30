/* ==================================================================
   BATFINANCE · Registro inteligente de gastos (Gemini)
   ------------------------------------------------------------------
   Un solo texto libre puede traer VARIAS compras ("fui en taxi, 70 en
   efectivo; en el oxxo un monster y galletas, 89 con tarjeta...").

   POST /api/ia/gastos/analizar  { texto }
     -> { compras: [{ descripcion, categoria, monto|null, metodo|null }] }
     Solo separa y clasifica; no registra nada.

   POST /api/ia/gastos/registrar { texto, fecha, compras: [...completas] }
     -> Evalúa cada compra con el saldo real que iba quedando (una tras
        otra) y registra todas en una sola transacción (si una no
        alcanza, no se registra ninguna). Regresa los gastos creados.

   La llave vive solo en el servidor (GEMINI_API_KEY en Render).
   ================================================================== */
const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { GASTOS_COLS } = require('../sqlColumns');
const { verificarFondos } = require('../validaciones');

const router = express.Router();
router.use(requireAuth);

const { preguntarGemini } = require('../gemini');
const CATEGORIAS = ['alimentos', 'ropa', 'entretenimiento', 'tecnologia', 'pareja', 'transporte', 'salud', 'hogar', 'otros'];
const GRUPO_NECESIDAD = ['alimentos', 'hogar', 'salud', 'transporte'];
const METODOS = ['efectivo', 'electronico', 'credito'];
const UMBRALES = [
  { min: 4.5, label: 'Compra muy inteligente', tone: 'excellent' },
  { min: 3.5, label: 'Buena decisión', tone: 'good' },
  { min: 2.5, label: 'Piénsalo bien antes de comprar', tone: 'warn' },
  { min: 1.5, label: 'Compra poco recomendable', tone: 'bad' },
  { min: 0, label: 'Mejor evítala si puedes', tone: 'avoid' }
];
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const $ = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
const grupo = (cat) => (GRUPO_NECESIDAD.includes(cat) ? 'necesidades' : 'deseos');
const limpiarTexto = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 1500);

function sinLlave(res) {
  if (process.env.GEMINI_API_KEY) return false;
  res.status(503).json({ error: 'El registro inteligente no está configurado (falta GEMINI_API_KEY en el servidor).' });
  return true;
}

/* ---------- 1) Separar y clasificar ---------- */
router.post('/gastos/analizar', async (req, res) => {
  const texto = limpiarTexto((req.body || {}).texto);
  if (texto.length < 3) return res.status(400).json({ error: 'Cuéntame qué compraste' });
  if (sinLlave(res)) return;

  const prompt = `Una persona en México cuenta lo que gastó. Separa CADA compra o pago distinto en un elemento aparte.

TEXTO: """${texto}"""

Reglas:
- Una compra = un pago. Si en un mismo pago compró varias cosas (ej. "en el oxxo un monster y galletas, 89"), es UNA sola compra; describe lo principal ("Monster y galletas").
- "descripcion": concepto corto (2 a 6 palabras, mayúscula inicial, sin precio). Ej. "Taxi al trabajo", "Chocolate para mi novia".
- "categoria": una de ${CATEGORIAS.join(', ')}. "pareja" = para o con la novia/pareja. "transporte" incluye taxi, Uber, camión, gasolina.
- "monto": número en pesos si lo dijo; null si no lo dijo. No lo inventes.
- "metodo": "efectivo" si pagó en efectivo; "credito" si dijo tarjeta de crédito, a crédito o el nombre de una tarjeta de crédito (ej. Plata, Plata Card); "electronico" si fue tarjeta de débito, transferencia o app; null si no lo dijo. Si dice que pagó todo de una forma, aplícala a todas.
- No incluyas cosas que no fueron gastos (ej. "llegué al trabajo").`;

  try {
    const ia = await preguntarGemini(prompt, {
      type: 'OBJECT',
      properties: {
        compras: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              descripcion: { type: 'STRING' },
              categoria: { type: 'STRING', enum: CATEGORIAS },
              monto: { type: 'NUMBER', nullable: true },
              metodo: { type: 'STRING', enum: METODOS, nullable: true }
            },
            required: ['descripcion', 'categoria', 'monto', 'metodo']
          }
        }
      },
      required: ['compras']
    });
    const compras = (ia.compras || []).slice(0, 15).map((c) => ({
      descripcion: String(c.descripcion || '').trim().slice(0, 80) || 'Compra',
      categoria: CATEGORIAS.includes(c.categoria) ? c.categoria : 'otros',
      monto: Number(c.monto) > 0 ? Math.round(Number(c.monto) * 100) / 100 : null,
      metodo: METODOS.includes(c.metodo) ? c.metodo : null
    }));
    if (!compras.length) return res.status(422).json({ error: 'No encontré ninguna compra en tu texto. Intenta decir qué compraste y cuánto costó.' });
    res.json({ compras });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'No se pudo analizar en este momento. Usa el registro normal.' });
  }
});

/* ---------- 2) Evaluar y registrar ---------- */
router.post('/gastos/registrar', async (req, res) => {
  const texto = limpiarTexto((req.body || {}).texto);
  const fecha = FECHA_RE.test(String((req.body || {}).fecha || '')) ? req.body.fecha : new Date().toISOString().slice(0, 10);
  const compras = ((req.body || {}).compras || []).slice(0, 15).map((c) => ({
    descripcion: String(c.descripcion || '').trim().slice(0, 80),
    categoria: CATEGORIAS.includes(c.categoria) ? c.categoria : 'otros',
    monto: Math.round(Number(c.monto) * 100) / 100,
    metodo: c.metodo,
    tarjetaId: c.tarjetaId || null
  }));
  if (!compras.length) return res.status(400).json({ error: 'No hay compras que registrar' });
  if (compras.some((c) => !c.descripcion || !(c.monto > 0) || !METODOS.includes(c.metodo))) {
    return res.status(400).json({ error: 'A alguna compra le falta el monto o cómo pagaste' });
  }
  if (sinLlave(res)) return;

  try {
    /* Contexto real y saldo compra tras compra */
    const mes = fecha.slice(0, 7);
    const tcs = (await pool.query('SELECT id, nombre, (limite - usado)::float AS disp, limite::float AS limite, usado::float AS usado FROM tarjetas_credito WHERE user_id = $1 ORDER BY created_at', [req.userId])).rows;
    // Compras a crédito: si no dijo cuál tarjeta, la primera que tenga disponible.
    for (const x of compras.filter((c) => c.metodo === 'credito')) {
      const t = tcs.find((k) => k.id === x.tarjetaId) || tcs.find((k) => k.disp >= x.monto);
      if (!t || t.disp < x.monto) return res.status(400).json({ error: 'No tienes crédito disponible para "' + x.descripcion + '"' });
      x.tarjetaId = t.id; t.disp -= x.monto; t.usado += x.monto; x.tarjeta = t;
    }
    const [saldo, config, gastosMes, deudas] = await Promise.all([
      pool.query('SELECT efectivo, tarjeta FROM saldo WHERE user_id = $1', [req.userId]),
      pool.query('SELECT distribucion_necesidades, distribucion_deseos, ingreso_mensual_fijo FROM config WHERE user_id = $1', [req.userId]),
      pool.query(`SELECT categoria, SUM(monto)::float AS total FROM gastos
                  WHERE user_id = $1 AND to_char(fecha, 'YYYY-MM') = $2 GROUP BY categoria`, [req.userId, mes]),
      pool.query(`SELECT COALESCE(SUM(monto_cuota), 0)::float AS total FROM deudas
                  WHERE user_id = $1 AND NOT pagada AND proximo_pago <= $2::date + 7`, [req.userId, fecha])
    ]);
    const s = saldo.rows[0] || { efectivo: 0, tarjeta: 0 };
    const c = config.rows[0] || {};
    const base = Number(c.ingreso_mensual_fijo) || 0;
    const meta = { necesidades: base * (Number(c.distribucion_necesidades) || 0) / 100, deseos: base * (Number(c.distribucion_deseos) || 0) / 100 };
    const usado = { necesidades: 0, deseos: 0 };
    gastosMes.rows.forEach((r) => { usado[grupo(r.categoria)] += r.total; });
    const deudasProximas = Number(deudas.rows[0].total) || 0;

    const caja = { efectivo: Number(s.efectivo), electronico: Number(s.tarjeta) };
    /* Números REALES de cada compra: saldo antes/después (del método y
       total) y si todavía alcanza para las deudas de esta semana. Son la
       base de la evaluación; el presupuesto mensual es solo referencia. */
    const metricas = [];
    const lineas = compras.map((x, i) => {
      if (x.metodo === 'credito') {
        const g = grupo(x.categoria); usado[g] += x.monto;
        const t = x.tarjeta, uso = Math.round(t.usado / t.limite * 100);
        const totalCaja = caja.efectivo + caja.electronico;
        metricas.push({ pctSaldo: 0, cubreDeudas: totalCaja >= deudasProximas + x.monto, grupo: g, uso });
        return `${i}. "${x.descripcion}" (${x.categoria}, grupo ${g}): ${$(x.monto)} con TARJETA DE CRÉDITO ${t.nombre}.\n` +
          `   CRÉDITO: no salió de su saldo, pero ahora debe ${$(t.usado)} en esa tarjeta (${uso}% de su límite de ${$(t.limite)}; sano es menos de 30%). Tiene ${$(totalCaja)} de dinero real para pagarla.\n` +
          `   REFERENCIA (no es dinero disponible): plan mensual de ${g} ${$(meta[g])}, con esta compra lleva ${$(usado[g])}.`;
      }
      const antes = caja[x.metodo];
      const totalAntes = caja.efectivo + caja.electronico;
      caja[x.metodo] -= x.monto;
      const totalDespues = caja.efectivo + caja.electronico;
      const g = grupo(x.categoria);
      usado[g] += x.monto;
      const pctSaldo = totalAntes > 0 ? x.monto / totalAntes : 1;
      const cubreDeudas = totalDespues >= deudasProximas;
      metricas.push({ pctSaldo, cubreDeudas, grupo: g });
      return `${i}. "${x.descripcion}" (${x.categoria}, grupo ${g}): ${$(x.monto)} con ${x.metodo === 'efectivo' ? 'efectivo' : 'tarjeta'}.\n` +
        `   SALDO REAL: tenía ${$(antes)} en ${x.metodo === 'efectivo' ? 'efectivo' : 'tarjeta'} (${$(totalAntes)} en total); después le quedan ${$(caja[x.metodo])} (${$(totalDespues)} en total). ` +
        `La compra se llevó el ${Math.round(pctSaldo * 100)}% de todo su dinero disponible.\n` +
        `   DEUDAS: ${deudasProximas > 0 ? (cubreDeudas ? `después de la compra SÍ le alcanza para las deudas de esta semana (${$(deudasProximas)}).` : `después de la compra NO le alcanza para las deudas de esta semana (${$(deudasProximas)}); le faltarían ${$(deudasProximas - totalDespues)}.`) : 'no tiene deudas por vencer esta semana.'}\n` +
        `   REFERENCIA (no es dinero disponible): plan mensual de ${g} ${$(meta[g])}, con esta compra lleva ${$(usado[g])}.`;
    });
    const faltante = Object.keys(caja).find((k) => caja[k] < -0.001);
    if (faltante) {
      const disponible = faltante === 'efectivo' ? Number(s.efectivo) : Number(s.tarjeta);
      const requerido = compras.filter((x) => x.metodo === faltante).reduce((a, x) => a + x.monto, 0);
      return res.status(400).json({ error: 'fondos_insuficientes', metodo: faltante, disponible, requerido, faltante: Math.round((requerido - disponible) * 100) / 100 });
    }

    const prompt = `Eres un asesor de finanzas personales en México. Califica cada compra que la persona YA hizo, según su situación real.
${texto ? `Lo que contó: """${texto}"""\n` : ''}
IMPORTANTE: lo que manda es el SALDO REAL (el dinero que de verdad tiene hoy) y si le alcanza para sus deudas. El "plan mensual" es un presupuesto teórico calculado de su ingreso: NO es dinero disponible, nunca lo describas como si lo tuviera.

COMPRAS (en orden; el saldo ya descuenta las anteriores):
${lineas.join('\n')}

Para CADA compra devuelve:
- "i": su número.
- "score": 1.0 a 5.0 (un decimal). 5 = compra muy inteligente, 1 = mala. Criterios, en este orden de importancia:
  1) Qué porcentaje de su dinero disponible real se llevó (más de 20% ya es mucho; más de 40% es grave).
  2) Si después de la compra ya no le alcanza para las deudas de esta semana (eso la hace mala salvo que sea una necesidad real e inevitable).
  3) Si es necesidad o gusto: un antojo, botana, refresco o dulce es GUSTO aunque sea comida.
  4) Solo al final, si se pasa de su plan mensual.
- "razones": 1 o 2 frases cortas (máx. 20 palabras), en segunda persona. La primera SIEMPRE con su saldo real (cuánto tenía o cuánto le queda y qué porcentaje se llevó); si fue a crédito, con lo que ahora debe en la tarjeta y su % de uso (a crédito se califica peor si el uso pasa de 30% o si su dinero real no alcanza para pagarla). No uses el plan mensual como si fuera su dinero. No inventes datos.`;

    let evals = [];
    try {
      const ia = await preguntarGemini(prompt, {
        type: 'OBJECT',
        properties: {
          evaluaciones: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { i: { type: 'INTEGER' }, score: { type: 'NUMBER' }, razones: { type: 'ARRAY', items: { type: 'STRING' } } },
              required: ['i', 'score', 'razones']
            }
          }
        },
        required: ['evaluaciones']
      });
      evals = ia.evaluaciones || [];
    } catch (e) {
      return res.status(502).json({ error: 'No se pudo evaluar en este momento. Intenta de nuevo o usa el registro normal.' });
    }

    const dt = new Date(fecha + 'T00:00:00'); dt.setDate(dt.getDate() + 5);
    const seguimiento = dt.toISOString().slice(0, 10);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const creados = [];
      for (let i = 0; i < compras.length; i++) {
        const x = compras[i];
        const ev = evals.find((e) => Number(e.i) === i) || {};
        let score = Math.min(5, Math.max(1, Math.round(Number(ev.score) * 10) / 10 || 3));
        // Topes fijos con los números reales (no dependen de la IA).
        const mt = metricas[i];
        if (mt.pctSaldo > 0.4) score = Math.min(score, 2);
        else if (mt.pctSaldo > 0.2) score = Math.min(score, 3);
        if (!mt.cubreDeudas) score = Math.min(score, mt.grupo === 'necesidades' ? 3 : 2);
        if (mt.uso > 60) score = Math.min(score, 2); else if (mt.uso > 30) score = Math.min(score, 3);
        const u = UMBRALES.find((t) => score >= t.min);
        const razones = (Array.isArray(ev.razones) ? ev.razones : []).map(String).filter(Boolean).slice(0, 2);
        if (x.metodo === 'credito') {
          const tc = await client.query('UPDATE tarjetas_credito SET usado = usado + $1 WHERE id = $2 AND user_id = $3 AND limite - usado >= $1 RETURNING id', [x.monto, x.tarjetaId, req.userId]);
          if (!tc.rows.length) throw Object.assign(new Error('sin credito'), { sinCredito: x.descripcion });
        } else await verificarFondos(client, req.userId, x.metodo, x.monto);
        const ins = await client.query(
          `INSERT INTO gastos (user_id, descripcion, categoria, monto, fecha, metodo, rating, evaluacion, seguimiento_fecha, tarjeta_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${GASTOS_COLS}`,
          [req.userId, x.descripcion, x.categoria, x.monto, fecha, x.metodo, score,
            JSON.stringify({ tone: u.tone, label: u.label, fuente: 'ia', texto, razones }), seguimiento, x.metodo === 'credito' ? x.tarjetaId : null]
        );
        const key = x.metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
        if (x.metodo !== 'credito') await client.query(`UPDATE saldo SET ${key} = ${key} - $1, updated_at = now() WHERE user_id = $2`, [x.monto, req.userId]);
        creados.push(ins.rows[0]);
      }
      await client.query('COMMIT');
      res.status(201).json({ gastos: creados, restante: { efectivo: caja.efectivo, tarjeta: caja.electronico } });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.tipo === 'fondos_insuficientes') {
        return res.status(400).json({ error: 'fondos_insuficientes', metodo: err.metodo, disponible: err.disponible, requerido: err.requerido, faltante: err.faltante });
      }
      if (err.sinCredito) return res.status(400).json({ error: 'No tienes crédito disponible para "' + err.sinCredito + '"' });
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
