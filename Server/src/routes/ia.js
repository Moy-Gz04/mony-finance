/* ==================================================================
   NEXUSFIN · Registro inteligente de gastos (Gemini)
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

const MODELO = 'gemini-3.1-flash-lite';
const CATEGORIAS = ['alimentos', 'ropa', 'entretenimiento', 'tecnologia', 'pareja', 'transporte', 'salud', 'hogar', 'otros'];
const GRUPO_NECESIDAD = ['alimentos', 'hogar', 'salud', 'transporte'];
const METODOS = ['efectivo', 'electronico'];
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

async function preguntarGemini(texto, schema) {
  const llaves = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_3, process.env.GEMINI_API_KEY_5].filter(Boolean);
  const cuerpo = JSON.stringify({
    contents: [{ parts: [{ text: texto }] }],
    generationConfig: { maxOutputTokens: 2048, temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema }
  });
  // Gemini a veces responde 503 "alta demanda": hasta 4 intentos rotando llaves.
  for (let i = 0; i < 4; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${llaves[i % llaves.length]}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpo, signal: ctrl.signal });
      const data = await r.json();
      const txt = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
      if (txt) return JSON.parse(txt);
      console.warn(`IA intento ${i + 1}/4:`, JSON.stringify(data).slice(0, 160));
    } catch (e) {
      console.warn(`IA intento ${i + 1}/4:`, e.message);
    } finally {
      clearTimeout(t);
    }
    await new Promise((res) => setTimeout(res, 700 * (i + 1)));
  }
  throw new Error('Gemini no respondió');
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
- "metodo": "efectivo" si pagó en efectivo; "electronico" si fue tarjeta, transferencia o app; null si no lo dijo. Si dice que pagó todo de una forma, aplícala a todas.
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
    metodo: c.metodo
  }));
  if (!compras.length) return res.status(400).json({ error: 'No hay compras que registrar' });
  if (compras.some((c) => !c.descripcion || !(c.monto > 0) || !METODOS.includes(c.metodo))) {
    return res.status(400).json({ error: 'A alguna compra le falta el monto o cómo pagaste' });
  }
  if (sinLlave(res)) return;

  try {
    /* Contexto real y saldo compra tras compra */
    const mes = fecha.slice(0, 7);
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
    const lineas = compras.map((x, i) => {
      const antes = caja[x.metodo];
      caja[x.metodo] -= x.monto;
      const g = grupo(x.categoria);
      usado[g] += x.monto;
      return `${i}. "${x.descripcion}" (${x.categoria}, grupo ${g}): ${$(x.monto)} con ${x.metodo === 'efectivo' ? 'efectivo' : 'tarjeta'}. ` +
        `Tenía ${$(antes)} en ese método, le quedan ${$(antes - x.monto)}. ` +
        `Con esta compra lleva ${$(usado[g])} de ${$(meta[g])} de su presupuesto mensual de ${g}.`;
    });
    const faltante = Object.keys(caja).find((k) => caja[k] < -0.001);
    if (faltante) {
      const disponible = faltante === 'efectivo' ? Number(s.efectivo) : Number(s.tarjeta);
      const requerido = compras.filter((x) => x.metodo === faltante).reduce((a, x) => a + x.monto, 0);
      return res.status(400).json({ error: 'fondos_insuficientes', metodo: faltante, disponible, requerido, faltante: Math.round((requerido - disponible) * 100) / 100 });
    }

    const prompt = `Eres un asesor de finanzas personales en México. Califica cada compra que la persona YA hizo, según su situación real.
${texto ? `Lo que contó: """${texto}"""\n` : ''}
Ingreso mensual fijo: ${$(base)}. Deudas que vencen en los próximos 7 días: ${$(deudasProximas)}.

COMPRAS (en orden; el saldo ya descuenta las anteriores):
${lineas.join('\n')}

Para CADA compra devuelve:
- "i": su número.
- "score": 1.0 a 5.0 (un decimal). 5 = compra muy inteligente, 1 = mala. Considera qué parte del saldo se llevó, si rebasa o deja al límite su presupuesto, si pone en riesgo pagar las deudas próximas, y si es necesidad o gusto. Algo necesario, pequeño frente al saldo y dentro del presupuesto merece 4 o más.
- "razones": 1 o 2 frases cortas (máx. 18 palabras), en segunda persona, con números concretos de arriba. No inventes datos.`;

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
        const score = Math.min(5, Math.max(1, Math.round(Number(ev.score) * 10) / 10 || 3));
        const u = UMBRALES.find((t) => score >= t.min);
        const razones = (Array.isArray(ev.razones) ? ev.razones : []).map(String).filter(Boolean).slice(0, 2);
        await verificarFondos(client, req.userId, x.metodo, x.monto);
        const ins = await client.query(
          `INSERT INTO gastos (user_id, descripcion, categoria, monto, fecha, metodo, rating, evaluacion, seguimiento_fecha)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${GASTOS_COLS}`,
          [req.userId, x.descripcion, x.categoria, x.monto, fecha, x.metodo, score,
            JSON.stringify({ tone: u.tone, label: u.label, fuente: 'ia', texto, razones }), seguimiento]
        );
        const key = x.metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
        await client.query(`UPDATE saldo SET ${key} = ${key} - $1, updated_at = now() WHERE user_id = $2`, [x.monto, req.userId]);
        creados.push(ins.rows[0]);
      }
      await client.query('COMMIT');
      res.status(201).json({ gastos: creados, restante: { efectivo: caja.efectivo, tarjeta: caja.electronico } });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.tipo === 'fondos_insuficientes') {
        return res.status(400).json({ error: 'fondos_insuficientes', metodo: err.metodo, disponible: err.disponible, requerido: err.requerido, faltante: err.faltante });
      }
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
