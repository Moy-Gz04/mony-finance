/* ==================================================================
   BATFINANCE · Llamada a Gemini (compartida)
   ------------------------------------------------------------------
   Pide una respuesta JSON con el esquema dado. Gemini a veces responde
   503 "alta demanda": hasta 4 intentos rotando entre las llaves
   disponibles (GEMINI_API_KEY, _3, _5) con una pausa corta.
   ================================================================== */
const MODELO = 'gemini-3.1-flash-lite';

function hayLlave() {
  return !!process.env.GEMINI_API_KEY;
}

async function preguntarGemini(texto, schema, opciones) {
  const o = opciones || {};
  const llaves = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_3, process.env.GEMINI_API_KEY_5].filter(Boolean);
  const cuerpo = JSON.stringify({
    contents: [{ parts: [{ text: texto }] }],
    generationConfig: {
      maxOutputTokens: o.maxTokens || 2048,
      temperature: o.temperatura == null ? 0.2 : o.temperatura,
      responseMimeType: 'application/json',
      responseSchema: schema
    }
  });
  for (let i = 0; i < 4; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${llaves[i % llaves.length]}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpo, signal: ctrl.signal });
      const data = await r.json();
      const txt = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
      if (txt) return JSON.parse(txt);
      console.warn(`Gemini intento ${i + 1}/4:`, JSON.stringify(data).slice(0, 160));
    } catch (e) {
      console.warn(`Gemini intento ${i + 1}/4:`, e.message);
    } finally {
      clearTimeout(t);
    }
    await new Promise((res) => setTimeout(res, 700 * (i + 1)));
  }
  throw new Error('Gemini no respondió');
}

module.exports = { preguntarGemini, hayLlave };
