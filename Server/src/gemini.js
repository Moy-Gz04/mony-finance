/* ==================================================================
   BATFINANCE · Llamada a Gemini (compartida)
   ------------------------------------------------------------------
   Pide una respuesta JSON con el esquema dado.
   Google satura seguido algunos modelos (503 "alta demanda"), así que
   si uno está saturado se pasa AL SIGUIENTE MODELO de la lista en vez
   de insistir con el mismo, rotando también entre las llaves
   disponibles (GEMINI_API_KEY, _3, _5).
   ================================================================== */

// En orden de preferencia: rápido y barato primero. `sinRazonar` apaga el
// "pensamiento" de los modelos que lo usan (si no, tardan mucho más).
const MODELOS = [
  { id: 'gemini-3.1-flash-lite' },
  { id: 'gemini-3.6-flash', sinRazonar: true },
  { id: 'gemini-3.5-flash-lite' },
  { id: 'gemini-flash-latest', sinRazonar: true },
  { id: 'gemini-3.8-flash', sinRazonar: true },
  { id: 'gemini-3.5-flash', sinRazonar: true }
];

function hayLlave() {
  return !!process.env.GEMINI_API_KEY;
}

async function preguntarGemini(texto, schema, opciones) {
  const o = opciones || {};
  const llaves = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_3, process.env.GEMINI_API_KEY_5].filter(Boolean);
  const intentos = MODELOS.length + 2; // una vuelta por todos los modelos y dos extra
  for (let i = 0; i < intentos; i++) {
    const modelo = MODELOS[i % MODELOS.length];
    const llave = llaves[i % llaves.length];
    const generationConfig = {
      maxOutputTokens: o.maxTokens || 2048,
      temperature: o.temperatura == null ? 0.2 : o.temperatura,
      responseMimeType: 'application/json',
      responseSchema: schema
    };
    if (modelo.sinRazonar) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000); // si se cuelga, al siguiente modelo
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo.id}:generateContent?key=${llave}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: texto }] }], generationConfig }),
        signal: ctrl.signal
      });
      const data = await r.json();
      const txt = data?.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
      if (txt) return JSON.parse(txt);
      console.warn(`Gemini ${modelo.id} (${i + 1}/${intentos}):`, JSON.stringify(data).slice(0, 140));
    } catch (e) {
      console.warn(`Gemini ${modelo.id} (${i + 1}/${intentos}):`, e.message);
    } finally {
      clearTimeout(t);
    }
    // Pausa corta: el siguiente intento ya es con otro modelo.
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error('Gemini no respondió');
}

module.exports = { preguntarGemini, hayLlave, MODELOS };
