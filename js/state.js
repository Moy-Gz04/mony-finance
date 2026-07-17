/* ==================================================================
   NEXUSFIN · STATE
   ------------------------------------------------------------------
   Modelo de datos + cliente de la API (Node/Express + Postgres en
   Render/Neon). Ya no se guarda nada de dinero en localStorage — solo
   el token de sesión, para no pedir login cada vez que abres la app.
   ================================================================== */

/* URL de tu backend en Render. Si alguna vez pruebas en local con
   npm start dentro de Server/, cambia esto temporalmente por
   'http://localhost:3000/api' y regrésalo después. */
const API_BASE = 'https://mony-finance.onrender.com/api';

const TOKEN_KEY = 'nexusfin-token';

/* Iconos SVG tipo "outline", en la misma línea visual que el resto de la
   interfaz (stroke-width 1.7, sin relleno, esquinas redondeadas). Se
   pintan con currentColor, así toman automáticamente el color de cada
   categoría desde el contenedor donde se insertan. */
const ICON_SVG = {
  alimentos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="2.5" x2="7" y2="21.5"/><path d="M4.5 2.5v6a2.5 2.5 0 0 0 5 0v-6"/><path d="M17 2.5c-1.8.3-3 2.4-3 5.5 0 2.6 1.1 4 3 4.3V21.5"/></svg>',
  ropa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 6.5 6 9l1.5-1V20a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V8l1.5 1 2-2.5L16 3c-.7 1.6-2.2 2.5-4 2.5S8.7 4.6 8 3Z"/></svg>',
  entretenimiento: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="8" width="19" height="10" rx="5"/><path d="M6 11v4M4 13h4"/><circle cx="15.3" cy="11.3" r="1"/><circle cx="18" cy="14" r="1"/></svg>',
  tecnologia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4.5" width="16" height="10.5" rx="1.5"/><path d="M2 19.5h20l-1.6-3.5H3.6L2 19.5Z"/></svg>',
  pareja: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.8-9.3C.7 7.8 2.4 4.5 6 4c2.3-.3 4.3 1 6 3 1.7-2 3.7-3.3 6-3 3.6.5 5.3 3.8 3.8 7.2-2.3 4.7-9.8 9.3-9.8 9.3Z"/></svg>',
  transporte: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16V11l2-5h12l2 5v5"/><path d="M2.5 16h19v3a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1v-1h-11v1a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1v-3Z"/><circle cx="7" cy="16" r="1.4"/><circle cx="17" cy="16" r="1.4"/></svg>',
  salud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12h4l2-6 3 12 2-9 1.5 3h6.5"/></svg>',
  hogar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9h5v-5h2v5h5v-9"/></svg>',
  otros: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/></svg>',
  apuestas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4.5"/><circle cx="8" cy="8" r="1.15" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.15" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.15" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.15" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none"/></svg>'
};
const CATEGORIAS = [
  { id: 'alimentos', label: 'Alimentos', icon: ICON_SVG.alimentos, color: '#7CD992' },
  { id: 'ropa', label: 'Ropa', icon: ICON_SVG.ropa, color: '#8B6BFF' },
  { id: 'entretenimiento', label: 'Entretenimiento', icon: ICON_SVG.entretenimiento, color: '#FF9F5A' },
  { id: 'tecnologia', label: 'Tecnología', icon: ICON_SVG.tecnologia, color: '#00E6C3' },
  { id: 'pareja', label: 'Novia / Pareja', icon: ICON_SVG.pareja, color: '#FF4F70' },
  { id: 'transporte', label: 'Transporte', icon: ICON_SVG.transporte, color: '#5AA9FF' },
  { id: 'salud', label: 'Salud', icon: ICON_SVG.salud, color: '#FFD35A' },
  { id: 'hogar', label: 'Hogar', icon: ICON_SVG.hogar, color: '#B98BFF' },
  { id: 'otros', label: 'Otros', icon: ICON_SVG.otros, color: '#8792A6' }
];
const GRUPO_NECESIDAD = ['alimentos', 'hogar', 'salud', 'transporte'];

/* Métodos de pago: cada ingreso/gasto/inversión se liga a uno de estos,
   y el servidor mueve el saldo correspondiente automáticamente. */
const METODOS_PAGO = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'electronico', label: 'Tarjeta / dinero electrónico' }
];

function defaultState() {
  return {
    saldo: { efectivo: 0, tarjeta: 0 },
    ingresos: [],
    gastos: [],
    deudas: [],
    inversiones: [],
    metas: [],
    apuestas: [],
    aportesFondo: [],
    fondoEmergencia: { actual: 0, mesesObjetivo: 6, gastoMensual: 6000 },
    config: {
      tasaSofipoDefault: 12,
      distribucion: { necesidades: 50, deseos: 20, ahorro: 10, inversion: 20 },
      ingresoMensualFijo: 0,
      pagosPendientesColapsado: false
    }
  };
}

let state = defaultState();
let currentView = 'inicio';
let currentSub = 'gastos';

/* ---------- sesión (token JWT) ---------- */
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/* ---------- cliente de la API ----------
   Todas las llamadas pasan por aquí: agrega el token, arma el JSON,
   y convierte errores HTTP en excepciones de JS con el mensaje que
   mandó el servidor (para poder mostrarlo directo en un toast). */
async function apiFetch(path, options) {
  options = options || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  let res;
  try {
    res = await fetch(API_BASE + path, Object.assign({}, options, { headers }));
  } catch (networkErr) {
    throw new Error('No se pudo conectar con el servidor. Revisa tu internet o si el backend está despierto.');
  }

  let data = null;
  try { data = await res.json(); } catch (e) { /* respuesta sin cuerpo, ej. en algunos 204 */ }

  if (!res.ok) {
    const isFondosInsuficientes = data && data.error === 'fondos_insuficientes';
    const err = new Error(isFondosInsuficientes ? 'Fondos insuficientes' : ((data && data.error) || 'Error del servidor (' + res.status + ')'));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* Trae TODO el estado del usuario desde el servidor y reemplaza el
   objeto state en memoria. Se llama al iniciar sesión y después de
   cada acción que cambia datos, para que la app siempre muestre
   exactamente lo que hay guardado en la base de datos. */
async function loadState() {
  const data = await apiFetch('/estado');
  state = Object.assign(defaultState(), data);
  if (!state.config.distribucion) state.config.distribucion = defaultState().config.distribucion;
}

/* Vuelve a pedir el estado completo y repinta la pantalla. Se usa
   después de cualquier crear/editar/eliminar. */
async function refresh() {
  await loadState();
  renderAll();
}

/* ---------- helpers ---------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function money(n) {
  n = Number(n) || 0;
  return '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function moneyDec(n) {
  n = Number(n) || 0;
  return '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
}
function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00'); d.setMonth(d.getMonth() + months); return d.toISOString().slice(0, 10);
}
function daysUntil(dateStr) {
  const d = new Date(dateStr + 'T00:00:00'); const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}
function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}
function catInfo(id) { return CATEGORIAS.find(function (c) { return c.id === id; }) || CATEGORIAS[CATEGORIAS.length - 1]; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
}
function starSvgFull(cls) {
  return '<svg class="' + cls + '" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.4 6.9.7-5.2 4.8 1.5 6.9L12 17.8 5.9 21.3l1.5-6.9L2.2 9.6l6.9-.7z"/></svg>';
}
function renderStars(container, score, size) {
  size = size || 18;
  container.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const span = document.createElement('span');
    span.className = 'star';
    span.style.setProperty('--star-size', size + 'px');
    const pct = Math.max(0, Math.min(1, score - (i - 1))) * 100;
    span.innerHTML =
      '<span class="bg">' + starSvgFull('') + '</span>' +
      '<span class="fg" style="width:' + pct + '%">' + starSvgFull('') + '</span>';
    container.appendChild(span);
  }
}

/* Total en efectivo + tarjeta, leído del último estado cargado. */
function saldoTotal() {
  if (!state.saldo) return 0;
  return (Number(state.saldo.efectivo) || 0) + (Number(state.saldo.tarjeta) || 0);
}
function metodoLabel(metodo) {
  const m = METODOS_PAGO.find(function (x) { return x.id === metodo; });
  return m ? m.label : 'Efectivo';
}

/* ---------- helpers para el asistente de compra inteligente ---------- */

/* 'necesidades' o 'deseos', según la categoría del gasto. */
function grupoDeGasto(categoria) {
  return GRUPO_NECESIDAD.indexOf(categoria) !== -1 ? 'necesidades' : 'deseos';
}

/* Cuánto llevas gastado ESTE MES en el grupo (necesidades/deseos) de
   esa categoría. */
function usadoGrupoEsteMes(categoria) {
  const grupo = grupoDeGasto(categoria);
  const hoy = new Date();
  return state.gastos
    .filter(function (g) {
      if (grupoDeGasto(g.categoria) !== grupo) return false;
      const d = new Date(g.fecha + 'T00:00:00');
      return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth();
    })
    .reduce(function (s, g) { return s + Number(g.monto || 0); }, 0);
}

/* Meta mensual (en pesos) para el grupo de esa categoría, según tu
   ingreso mensual fijo y tus porcentajes configurados. */
function targetGrupoMensual(categoria) {
  const grupo = grupoDeGasto(categoria);
  const base = Number(state.config.ingresoMensualFijo) || 0;
  const pct = grupo === 'necesidades' ? state.config.distribucion.necesidades : state.config.distribucion.deseos;
  return base * (pct / 100);
}

/* Suma de cuotas de deudas activas que vencen en los próximos `dias`
   (por defecto 7), incluyendo las ya vencidas. */
function deudasProximasTotal(dias) {
  dias = dias || 7;
  return state.deudas
    .filter(function (d) { return !d.pagada && daysUntil(d.proximoPago) <= dias; })
    .reduce(function (s, d) { return s + Number(d.montoCuota || 0); }, 0);
}

/* De tus compras evaluadas y con seguimiento ya respondido en esa
   categoría, qué fracción terminó en "arrepentido". Regresa null si
   hay muy pocos datos (menos de 3) para que el algoritmo no saque
   conclusiones prematuras. */
function tasaArrepentimiento(categoria) {
  const conSeguimiento = state.gastos.filter(function (g) {
    return g.categoria === categoria && g.seguimientoHecho && g.seguimientoRespuesta;
  });
  if (conSeguimiento.length < 3) return null;
  const arrepentidas = conSeguimiento.filter(function (g) { return g.seguimientoRespuesta === 'arrepentido'; }).length;
  return { pct: arrepentidas / conSeguimiento.length, total: conSeguimiento.length };
}

/* Gastos evaluados cuyo seguimiento (5 días después) ya toca
   preguntarse y todavía no se ha respondido. */
function gastosPendientesDeSeguimiento() {
  const hoy = todayISO();
  return state.gastos.filter(function (g) {
    return g.rating != null && g.seguimientoFecha && !g.seguimientoHecho && g.seguimientoFecha <= hoy;
  });
}

/* Frases sobre finanzas personales, en tono libre (no cita textual),
   atribuidas a quien las inspiró. Rotan solas en la pantalla de Inicio. */
const QUOTES_FINANZAS = [
  { texto: 'No ahorres lo que te sobra después de gastar; gasta lo que te sobra después de ahorrar.', autor: 'Warren Buffett' },
  { texto: 'Un peso ahorrado, bien visto, es un peso que ya ganaste dos veces.', autor: 'Benjamin Franklin' },
  { texto: 'No trabajes solo por dinero: aprende a hacer que el dinero trabaje para ti.', autor: 'Robert Kiyosaki' },
  { texto: 'Antes de comprar algo, pregúntate si ese gasto te acerca o te aleja de tus metas.', autor: 'Suze Orman' },
  { texto: 'No importa tanto cuánto ganas, sino cuánto logras conservar de lo que ganas.', autor: 'T. Harv Eker' },
  { texto: 'Vive hoy como pocos quieren vivir, para poder vivir mañana como pocos pueden.', autor: 'Dave Ramsey' },
  { texto: 'El riesgo más grande viene de no saber bien en qué estás gastando tu dinero.', autor: 'Warren Buffett' },
  { texto: 'La primera regla para acumular riqueza es simple: no gastes más de lo que necesitas.', autor: 'Charlie Munger' },
  { texto: 'Una parte de todo lo que ganas siempre debería quedarse contigo primero.', autor: 'George S. Clason' },
  { texto: 'Los ricos compran activos; el resto compra cosas que cree que son activos.', autor: 'Robert Kiyosaki' },
  { texto: 'Nunca dependas de un solo ingreso: busca cómo construir una segunda fuente.', autor: 'Warren Buffett' },
  { texto: 'Cuidado con los gastos pequeños: una fuga chiquita puede hundir un barco grande.', autor: 'Benjamin Franklin' },
  { texto: 'Antes de invertir en algo, primero entiende de verdad en qué estás invirtiendo.', autor: 'Phil Town' },
  { texto: 'El dinero es una herramienta para vivir mejor, no un fin en sí mismo.', autor: 'Ramit Sethi' },
  { texto: 'Un presupuesto te dice, con anticipación, a dónde va a ir tu dinero.', autor: 'John C. Maxwell' },
  { texto: 'La disciplina de hoy con tu dinero es la libertad de mañana.', autor: 'Napoleon Hill' }
];

/* mapea el 'tone' neutro del evaluador a un color de la paleta */
function toneColor(tone) {
  return {
    excellent: 'var(--cyan)',
    good: 'var(--cyan)',
    warn: 'var(--amber)',
    bad: 'var(--coral)',
    avoid: 'var(--coral)'
  }[tone] || 'var(--text)';
}
