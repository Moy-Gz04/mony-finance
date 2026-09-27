/* ==================================================================
   NEXUSFIN · Asesor de compras (Gemini)
   ------------------------------------------------------------------
   POST /api/asesor  { pregunta, precio? }
   "¿Me compro un perfume nuevo?" -> recomendación con TODOS los
   números reales: saldo, fondo de emergencia, metas, inversiones,
   deudas, ingresos, gastos (y los de ese rubro) y suscripciones.
   Solo aconseja: no registra nada.
   ================================================================== */
const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { preguntarGemini, hayLlave } = require('../gemini');

const router = express.Router();
router.use(requireAuth);

const CATEGORIAS = ['alimentos', 'ropa', 'entretenimiento', 'tecnologia', 'pareja', 'transporte', 'salud', 'hogar', 'otros'];
const VEREDICTOS = ['comprar', 'esperar', 'no_comprar'];
const POR_MES = { semanal: 52 / 12, quincenal: 2, mensual: 1, anual: 1 / 12 };
const $ = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
const fecha = (d) => String(d).slice(0, 10);
function enDias(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

router.post('/', async (req, res) => {
  const pregunta = String((req.body || {}).pregunta || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const precioDado = Number((req.body || {}).precio) > 0 ? Math.round(Number(req.body.precio) * 100) / 100 : null;
  if (pregunta.length < 3) return res.status(400).json({ error: 'Escribe qué quieres comprar o hacer' });
  if (!hayLlave()) return res.status(503).json({ error: 'El asesor no está configurado (falta GEMINI_API_KEY en el servidor).' });
  const u = req.userId;

  try {
    const [saldo, config, fondo, metas, inv, deudas, ingresos, gastosCat, gastosMes, subs] = await Promise.all([
      pool.query('SELECT efectivo, tarjeta FROM saldo WHERE user_id = $1', [u]),
      pool.query('SELECT * FROM config WHERE user_id = $1', [u]),
      pool.query('SELECT actual, meses_objetivo, gasto_mensual FROM fondo_emergencia WHERE user_id = $1', [u]),
      pool.query('SELECT nombre, monto_objetivo, monto_actual FROM metas WHERE user_id = $1', [u]),
      pool.query('SELECT nombre, monto, tasa FROM inversiones WHERE user_id = $1', [u]),
      pool.query('SELECT nombre, monto_pendiente, monto_cuota, proximo_pago FROM deudas WHERE user_id = $1 AND NOT pagada ORDER BY proximo_pago', [u]),
      pool.query(
        "SELECT COALESCE(SUM(monto) FILTER (WHERE fecha >= date_trunc('month', CURRENT_DATE)), 0)::float AS mes, " +
        'COALESCE(SUM(monto) FILTER (WHERE fecha >= CURRENT_DATE - 90), 0)::float AS noventa FROM ingresos WHERE user_id = $1', [u]),
      pool.query(
        "SELECT categoria, COALESCE(SUM(monto) FILTER (WHERE fecha >= date_trunc('month', CURRENT_DATE)), 0)::float AS mes, " +
        'SUM(monto)::float AS noventa, COUNT(*)::int AS veces, AVG(rating)::float AS rating ' +
        'FROM gastos WHERE user_id = $1 AND fecha >= CURRENT_DATE - 90 GROUP BY categoria ORDER BY noventa DESC', [u]),
      pool.query("SELECT COALESCE(SUM(monto), 0)::float AS total FROM gastos WHERE user_id = $1 AND fecha >= date_trunc('month', CURRENT_DATE)", [u]),
      pool.query('SELECT nombre, monto, frecuencia FROM suscripciones WHERE user_id = $1 AND activa', [u])
    ]);

    const s = saldo.rows[0] || { efectivo: 0, tarjeta: 0 };
    const disponible = Number(s.efectivo) + Number(s.tarjeta);
    const c = config.rows[0] || {};
    const f = fondo.rows[0] || { actual: 0, meses_objetivo: 6, gasto_mensual: 0 };
    const fondoMeta = Number(f.gasto_mensual) * Number(f.meses_objetivo);
    const mesesCubiertos = Number(f.gasto_mensual) > 0 ? Number(f.actual) / Number(f.gasto_mensual) : 0;
    const invTotal = inv.rows.reduce((a, x) => a + Number(x.monto), 0);
    const deudaTotal = deudas.rows.reduce((a, x) => a + Number(x.monto_pendiente), 0);
    const cuotas7 = deudas.rows.filter((d) => fecha(d.proximo_pago) <= enDias(7)).reduce((a, d) => a + Number(d.monto_cuota), 0);
    const cuotas30 = deudas.rows.filter((d) => fecha(d.proximo_pago) <= enDias(30)).reduce((a, d) => a + Number(d.monto_cuota), 0);
    const subsMes = subs.rows.reduce((a, x) => a + Number(x.monto) * (POR_MES[x.frecuencia] || 1), 0);

    const ctx = [
      'DINERO DISPONIBLE HOY (real): ' + $(disponible) + ' (efectivo ' + $(s.efectivo) + ', tarjeta ' + $(s.tarjeta) + ').',
      'Ingreso mensual fijo: ' + $(c.ingreso_mensual_fijo) + '. Ingresos registrados este mes: ' + $(ingresos.rows[0].mes) + '; últimos 90 días: ' + $(ingresos.rows[0].noventa) + '.',
      'Gastos de este mes: ' + $(gastosMes.rows[0].total) + '. Suscripciones activas: ' + $(subsMes) + ' al mes' +
        (subs.rows.length ? ' (' + subs.rows.map((x) => x.nombre + ' ' + $(x.monto) + ' ' + x.frecuencia).join(', ') + ')' : '') + '.',
      'Fondo de emergencia: ' + $(f.actual) + ' de una meta de ' + $(fondoMeta) + ' (cubre ' + mesesCubiertos.toFixed(1) + ' de ' + f.meses_objetivo + ' meses de gasto de ' + $(f.gasto_mensual) + ').',
      'Metas de ahorro: ' + (metas.rows.length ? metas.rows.map((m) => m.nombre + ' ' + $(m.monto_actual) + ' de ' + $(m.monto_objetivo)).join('; ') : 'ninguna') + '.',
      'Inversiones: ' + (inv.rows.length ? $(invTotal) + ' (' + inv.rows.map((x) => x.nombre + ' ' + $(x.monto) + (x.tasa ? ' al ' + x.tasa + '%' : '')).join('; ') + ')' : 'ninguna') +
        '. Tasa SOFIPO de referencia: ' + (Number(c.tasa_sofipo_default) || 0) + '% anual.',
      'Deudas pendientes: ' + $(deudaTotal) + ' en total; cuotas que vencen en 7 días: ' + $(cuotas7) + '; en 30 días: ' + $(cuotas30) +
        (deudas.rows.length ? ' (' + deudas.rows.slice(0, 6).map((d) => d.nombre + ' cuota ' + $(d.monto_cuota) + ' el ' + fecha(d.proximo_pago)).join('; ') + ')' : '') + '.',
      'Gasto por categoría, últimos 90 días (este mes / 90 días / nº de compras / calificación promedio): ' +
        (gastosCat.rows.length ? gastosCat.rows.map((g) => g.categoria + ' ' + $(g.mes) + ' / ' + $(g.noventa) + ' / ' + g.veces + (g.rating ? ' / ' + g.rating.toFixed(1) + '★' : '')).join('; ') : 'sin gastos registrados') + '.'
    ].join('\n');

    const prompt =
      'Eres un asesor financiero personal en México: directo, honesto y concreto, como un amigo que sabe de finanzas. La persona pregunta si debe hacer una compra o gasto.\n\n' +
      'PREGUNTA: """' + pregunta + '"""\n' +
      (precioDado ? 'PRECIO QUE INDICÓ: ' + $(precioDado) + '\n'
        : 'No indicó precio: estima un precio típico en México para lo que describe (realista, gama media).\n') +
      '\nSU SITUACIÓN REAL (hoy ' + new Date().toISOString().slice(0, 10) + '):\n' + ctx + '\n\n' +
      'Cómo decidir, en orden: 1) si el precio cabe en su dinero disponible sin dejarlo sin cubrir las cuotas de deuda próximas; ' +
      '2) qué tan sano está su fondo de emergencia; 3) si es necesidad o gusto y cuánto ya gasta en ese rubro; ' +
      '4) el costo de oportunidad: cuánto rendiría en SOFIPO, cuánto avanzaría una meta o el fondo, o cuánto bajaría una deuda. ' +
      'El ingreso fijo NO es dinero disponible.\n\n' +
      'Devuelve JSON con:\n' +
      '- "categoria": una de ' + CATEGORIAS.join(', ') + '.\n' +
      '- "precio": precio usado (el indicado o tu estimado), número.\n' +
      '- "precioEstimado": true si lo estimaste tú.\n' +
      '- "veredicto": "comprar", "esperar" o "no_comprar".\n' +
      '- "score": 1.0 a 5.0 (5 = excelente momento para comprarlo).\n' +
      '- "titulo": la recomendación en una frase corta (máx. 8 palabras).\n' +
      '- "resumen": 1 o 2 frases explicando la decisión con sus números.\n' +
      '- "razones": 2 a 4 frases cortas (máx. 22 palabras), en segunda persona, cada una con un número real de arriba.\n' +
      '- "alternativa": qué haría con ese dinero en vez de gastarlo (fondo, inversión, meta o deuda) con monto y beneficio concreto; si sí conviene, un consejo para comprarlo mejor.\n' +
      '- "plan": si es "esperar", cómo juntarlo (cuánto apartar y en cuánto tiempo); si no, cadena vacía.\n' +
      'No inventes datos que no estén arriba.';

    let ia;
    try {
      ia = await preguntarGemini(prompt, {
        type: 'OBJECT',
        properties: {
          categoria: { type: 'STRING', enum: CATEGORIAS },
          precio: { type: 'NUMBER' },
          precioEstimado: { type: 'BOOLEAN' },
          veredicto: { type: 'STRING', enum: VEREDICTOS },
          score: { type: 'NUMBER' },
          titulo: { type: 'STRING' },
          resumen: { type: 'STRING' },
          razones: { type: 'ARRAY', items: { type: 'STRING' } },
          alternativa: { type: 'STRING' },
          plan: { type: 'STRING' }
        },
        required: ['categoria', 'precio', 'precioEstimado', 'veredicto', 'score', 'titulo', 'resumen', 'razones', 'alternativa', 'plan']
      }, { temperatura: 0.4 });
    } catch (e) {
      return res.status(502).json({ error: 'El asesor no respondió en este momento. Intenta de nuevo en un minuto.' });
    }

    const precio = precioDado || (Number(ia.precio) > 0 ? Math.round(Number(ia.precio)) : null);
    let score = Math.min(5, Math.max(1, Math.round(Number(ia.score) * 10) / 10 || 3));
    let veredicto = VEREDICTOS.includes(ia.veredicto) ? ia.veredicto : 'esperar';
    // Topes con números reales: si no alcanza o te deja sin pagar las cuotas de esta semana, no es "cómpralo".
    if (precio && precio > disponible) { score = Math.min(score, 2); if (veredicto === 'comprar') veredicto = 'esperar'; }
    else if (precio && disponible - precio < cuotas7) { score = Math.min(score, 2.5); if (veredicto === 'comprar') veredicto = 'esperar'; }

    res.json({
      pregunta,
      categoria: CATEGORIAS.includes(ia.categoria) ? ia.categoria : 'otros',
      precio,
      precioEstimado: !precioDado && ia.precioEstimado !== false,
      veredicto,
      score,
      titulo: String(ia.titulo || '').slice(0, 120),
      resumen: String(ia.resumen || '').slice(0, 400),
      razones: (ia.razones || []).map(String).filter(Boolean).slice(0, 4),
      alternativa: String(ia.alternativa || '').slice(0, 400),
      plan: String(ia.plan || '').slice(0, 300),
      disponible
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
