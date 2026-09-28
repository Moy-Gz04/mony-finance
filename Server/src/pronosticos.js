/* ==================================================================
   BATFINANCE · Pronosticador de partidos
   ------------------------------------------------------------------
   Partidos REALES de hoy y los próximos 2 días desde el marcador
   público de ESPN (sin llave): equipos, horario, récord y momio.
   Gemini solo analiza esos datos; nunca inventa partidos. El
   resultado se guarda en la tabla `pronosticos` (una fila por día)
   y se reutiliza unas horas para no gastar llamadas.
   ================================================================== */
const pool = require('./db');
const { preguntarGemini, hayLlave } = require('./gemini');
const { hoyMX } = require('./automatico');

const LIGAS = [
  ['soccer/mex.1', 'Liga MX', 'Fútbol'],
  ['soccer/uefa.champions', 'Champions League', 'Fútbol'],
  ['soccer/eng.1', 'Premier League', 'Fútbol'],
  ['soccer/esp.1', 'LaLiga', 'Fútbol'],
  ['soccer/ita.1', 'Serie A', 'Fútbol'],
  ['soccer/ger.1', 'Bundesliga', 'Fútbol'],
  ['soccer/usa.1', 'MLS', 'Fútbol'],
  ['soccer/uefa.europa', 'Europa League', 'Fútbol'],
  ['football/nfl', 'NFL', 'Fútbol americano'],
  ['basketball/nba', 'NBA', 'Básquetbol'],
  ['baseball/mlb', 'MLB', 'Béisbol']
];
const MAX_PARTIDOS = 14;
const VIGENCIA_MS = 3 * 60 * 60 * 1000;   // 3 h
const MIN_FORZAR_MS = 20 * 60 * 1000;     // actualizar a mano: máximo cada 20 min

function masDias(fecha, n) {
  const d = new Date(fecha + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function fechaMX(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

// ESPN no acepta rangos de fechas: se pide un día a la vez.
async function traerLiga([ruta, liga, deporte], dia) {
  const url = 'https://site.api.espn.com/apis/site/v2/sports/' + ruta + '/scoreboard?dates=' + dia.replace(/-/g, '');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.events || []).map((e) => {
      const c = e.competitions && e.competitions[0];
      if (!c) return null;
      const eq = (lado) => c.competitors.find((x) => x.homeAway === lado) || {};
      const local = eq('home'), visita = eq('away');
      const odds = (c.odds || [])[0] || {};
      return {
        id: String(e.id),
        liga, deporte,
        fecha: e.date,
        dia: fechaMX(e.date),
        estado: e.status && e.status.type ? e.status.type.state : 'pre', // pre | in | post
        local: local.team ? local.team.displayName : '?',
        visita: visita.team ? visita.team.displayName : '?',
        recLocal: ((local.records || [])[0] || {}).summary || '',
        recVisita: ((visita.records || [])[0] || {}).summary || '',
        momio: odds.details || '',
        overUnder: odds.overUnder || null
      };
    }).filter(Boolean);
  } catch (_) {
    return [];
  } finally {
    clearTimeout(t);
  }
}

async function armar() {
  const hoy = hoyMX();
  const hasta = masDias(hoy, 2);
  const dias = [hoy, masDias(hoy, 1), hasta];
  const vistos = new Set();
  const todos = (await Promise.all(LIGAS.flatMap((l) => dias.map((d) => traerLiga(l, d))))).flat()
    .filter((p) => !vistos.has(p.id) && vistos.add(p.id))
    .filter((p) => p.estado !== 'post' && p.dia >= hoy && p.dia <= hasta)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const partidos = todos.slice(0, MAX_PARTIDOS);
  if (!partidos.length) return { fecha: hoy, generado: new Date().toISOString(), partidos: [] };

  let analisis = {};
  if (hayLlave()) {
    const prompt =
      'Eres un analista deportivo honesto. HOY ES ' + hoy + '. Analiza SOLO estos partidos reales con los datos dados ' +
      '(récord de temporada y momio de las casas cuando lo hay). No inventes lesiones, alineaciones ni noticias que no estén aquí.\n\n' +
      partidos.map((p) => p.id + ' · ' + p.liga + ' · ' + p.visita + (p.recVisita ? ' (' + p.recVisita + ')' : '') +
        ' visita a ' + p.local + (p.recLocal ? ' (' + p.recLocal + ')' : '') +
        (p.momio ? ' · momio ' + p.momio : '') + (p.overUnder ? ' · total ' + p.overUnder : '')).join('\n') +
      '\n\nPara cada partido devuelve: "id"; "pick" (nombre exacto de un equipo o "Empate" en fútbol); ' +
      '"confianza" de 35 a 75 (se honesto: con pocos datos, baja; ningún partido es seguro); ' +
      '"razon" en 1 frase corta en español con el dato que la sustenta; ' +
      '"marcador" probable (ej. "2-1", local primero).';
    try {
      const ia = await preguntarGemini(prompt, {
        type: 'OBJECT',
        properties: {
          pronosticos: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { id: { type: 'STRING' }, pick: { type: 'STRING' }, confianza: { type: 'NUMBER' }, razon: { type: 'STRING' }, marcador: { type: 'STRING' } },
              required: ['id', 'pick', 'confianza', 'razon', 'marcador']
            }
          }
        },
        required: ['pronosticos']
      }, { temperatura: 0.3 });
      (ia.pronosticos || []).forEach((x) => {
        analisis[String(x.id)] = {
          pick: String(x.pick || '').slice(0, 60),
          confianza: Math.max(35, Math.min(75, Math.round(Number(x.confianza) || 50))),
          razon: String(x.razon || '').slice(0, 180),
          marcador: String(x.marcador || '').slice(0, 10)
        };
      });
    } catch (err) {
      console.error('pronosticos IA:', err.message);
    }
  }
  return {
    fecha: hoy,
    generado: new Date().toISOString(),
    partidos: partidos.map((p) => Object.assign({}, p, { pronostico: analisis[p.id] || null }))
  };
}

async function pronosticosDelDia(forzar) {
  const hoy = hoyMX();
  const r = await pool.query('SELECT datos, created_at FROM pronosticos WHERE fecha = $1', [hoy]);
  if (r.rows.length) {
    const edad = Date.now() - new Date(r.rows[0].created_at).getTime();
    const conIA = (r.rows[0].datos.partidos || []).some((p) => p.pronostico);
    if (edad < VIGENCIA_MS && conIA && !(forzar && edad > MIN_FORZAR_MS)) return r.rows[0].datos;
  }
  const datos = await armar();
  await pool.query(
    `INSERT INTO pronosticos (fecha, datos, created_at) VALUES ($1, $2, now())
     ON CONFLICT (fecha) DO UPDATE SET datos = EXCLUDED.datos, created_at = now()`,
    [hoy, JSON.stringify(datos)]);
  return datos;
}

module.exports = { pronosticosDelDia };
