/* ==================================================================
   NEXUSFIN · APP
   ------------------------------------------------------------------
   Punto de entrada: login, navegación entre vistas, botón flotante,
   configuración y arranque de la app.
   ================================================================== */

/* ---------------- SESIÓN ---------------- */
/* Una vez autenticado, la sesión se guarda en localStorage para que el
   login no vuelva a aparecer al recargar la página o reabrir la app.
   Desaparece solo si el usuario cierra sesión manualmente. */
const SESSION_KEY = 'nexusfin-session-v1';

function hasActiveSession() {
  try { return localStorage.getItem(SESSION_KEY) === '1'; }
  catch (e) { return false; }
}
function setSession(active) {
  try {
    if (active) localStorage.setItem(SESSION_KEY, '1');
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) { /* localStorage no disponible, la app sigue funcionando sin persistencia */ }
}

/* ---------------- BARRA DE FRASES DE FINANZAS ---------------- */
let quoteIndex = Math.floor(Math.random() * QUOTES_FINANZAS.length);
let quoteTimer = null;
function renderQuote() {
  const wrap = document.getElementById('quote-ticker');
  if (!wrap) return;
  const q = QUOTES_FINANZAS[quoteIndex % QUOTES_FINANZAS.length];
  wrap.innerHTML =
    '<svg class="qt-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M7.2 6C4.9 6 3 7.9 3 10.2c0 2.3 1.9 4.2 4.2 4.2.33 0 .65-.04.96-.12C7.6 16.4 5.85 17.9 3.5 18.3v2.2c4.2-.4 7.5-3.9 7.5-8.1v-2.2C11 7.9 9.1 6 7.2 6Z"/><path d="M17.2 6c-2.3 0-4.2 1.9-4.2 4.2 0 2.3 1.9 4.2 4.2 4.2.33 0 .65-.04.96-.12-.55 2.3-2.3 3.8-4.66 4.2v2.2c4.2-.4 7.5-3.9 7.5-8.1v-2.2C21 7.9 19.1 6 17.2 6Z"/></svg>' +
    '<div class="qt-body" id="qt-body"><div class="qt-text">' + escapeHtml(q.texto) + '</div><span class="qt-author">— ' + escapeHtml(q.autor) + '</span></div>';
  requestAnimationFrame(function () {
    const body = document.getElementById('qt-body');
    if (body) body.classList.add('show');
  });
}
function startQuoteTicker() {
  renderQuote();
  clearInterval(quoteTimer);
  quoteTimer = setInterval(function () {
    quoteIndex++;
    renderQuote();
  }, 6000);
}

/* ---------------- SALDO / PAGOS PENDIENTES ---------------- */
function initSaldo() {
  document.getElementById('btn-edit-liquido').addEventListener('click', openEditLiquido);
}
function toggleHomePagos() {
  state.config.pagosPendientesColapsado = !state.config.pagosPendientesColapsado;
  saveState();
  renderInicio();
}

/* ---------------- NAVEGACIÓN ---------------- */
function showView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach(function (v) { v.hidden = true; });
  document.getElementById('view-' + name).hidden = false;
  document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.view === name); });
  document.getElementById('content').scrollTop = 0;
  window.scrollTo(0, 0);
  renderAll();
}

function initNavigation() {
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { showView(btn.dataset.view); });
  });

  document.getElementById('btn-settings').addEventListener('click', function () {
    document.querySelectorAll('.view').forEach(function (v) { v.hidden = true; });
    document.getElementById('view-config').hidden = false;
    fillConfigForm();
  });

  document.getElementById('btn-back-config').addEventListener('click', function () {
    showView(currentView === 'config' ? 'inicio' : currentView);
  });

  document.querySelectorAll('.subtab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      currentSub = btn.dataset.sub;
      document.querySelectorAll('.subtab').forEach(function (b) { b.classList.toggle('active', b === btn); });
      document.getElementById('sub-gastos').hidden = currentSub !== 'gastos';
      document.getElementById('sub-ingresos').hidden = currentSub !== 'ingresos';
      document.getElementById('sub-plan').hidden = currentSub !== 'plan';
      renderMovimientos();
    });
  });
}

/* ---------------- FAB (agregar según vista actual) ---------------- */
function initFab() {
  document.getElementById('fab-add').addEventListener('click', function () {
    if (currentView === 'inicio' || (currentView === 'mov' && currentSub === 'gastos')) openAddGasto();
    else if (currentView === 'mov' && currentSub === 'ingresos') openAddIngreso();
    else if (currentView === 'mov' && currentSub === 'plan') showView('config');
    else if (currentView === 'deudas') openAddDeuda();
    else if (currentView === 'inversion') openAddInversion();
    else if (currentView === 'metas') openAddMeta();
    else if (currentView === 'apuestas') openAddApuesta();
    else openAddGasto();
  });
}

/* ---------------- CONFIGURACIÓN ---------------- */
function fillConfigForm() {
  document.getElementById('cfg-tasa').value = state.config.tasaSofipoDefault;
  document.getElementById('cfg-meses').value = state.fondoEmergencia.mesesObjetivo;
  document.getElementById('cfg-gasto').value = state.fondoEmergencia.gastoMensual;
  document.getElementById('cfg-nec').value = state.config.distribucion.necesidades;
  document.getElementById('cfg-des').value = state.config.distribucion.deseos;
  document.getElementById('cfg-aho').value = state.config.distribucion.ahorro;
  updateSumHint();
}
function updateSumHint() {
  const n = parseFloat(document.getElementById('cfg-nec').value) || 0;
  const d = parseFloat(document.getElementById('cfg-des').value) || 0;
  const a = parseFloat(document.getElementById('cfg-aho').value) || 0;
  const sum = n + d + a;
  const hint = document.getElementById('cfg-sum-hint');
  hint.textContent = 'Suma actual: ' + sum + '%' + (sum !== 100 ? ' — lo ideal es que sume 100%' : ' ✓');
  hint.style.color = sum === 100 ? 'var(--cyan)' : 'var(--amber)';
}
function initConfig() {
  ['cfg-nec', 'cfg-des', 'cfg-aho'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', updateSumHint);
  });
  document.getElementById('btn-save-config').addEventListener('click', function () {
    state.config.tasaSofipoDefault = parseFloat(document.getElementById('cfg-tasa').value) || state.config.tasaSofipoDefault;
    state.fondoEmergencia.mesesObjetivo = parseFloat(document.getElementById('cfg-meses').value) || state.fondoEmergencia.mesesObjetivo;
    state.fondoEmergencia.gastoMensual = parseFloat(document.getElementById('cfg-gasto').value) || state.fondoEmergencia.gastoMensual;
    state.config.distribucion.necesidades = parseFloat(document.getElementById('cfg-nec').value) || 0;
    state.config.distribucion.deseos = parseFloat(document.getElementById('cfg-des').value) || 0;
    state.config.distribucion.ahorro = parseFloat(document.getElementById('cfg-aho').value) || 0;
    saveState(); renderAll(); toast('Configuración guardada');
  });
  document.getElementById('btn-logout').addEventListener('click', function () {
    setSession(false);
    document.getElementById('screen-main').hidden = true;
    document.getElementById('screen-login').hidden = false;
    document.getElementById('input-user').value = '';
    document.getElementById('input-pass').value = '';
  });
}

/* ---------------- LOGIN ---------------- */
function doLogin() {
  const u = document.getElementById('input-user').value.trim();
  const p = document.getElementById('input-pass').value;
  const err = document.getElementById('login-error');
  if (u === CREDENTIALS.user && p === CREDENTIALS.pass) {
    setSession(true);
    document.getElementById('screen-login').hidden = true;
    document.getElementById('screen-main').hidden = false;
    err.textContent = '';
    showView('inicio');
  } else {
    err.textContent = 'Usuario o contraseña incorrectos';
    const card = document.getElementById('login-card');
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
  }
}
function initLogin() {
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('input-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
}

/* ---------------- INIT ---------------- */
(async function init() {
  await loadState();
  initLogin();
  initNavigation();
  initFab();
  initConfig();
  initSaldo();
  startQuoteTicker();
  renderAll();

  if (hasActiveSession()) {
    document.getElementById('screen-login').hidden = true;
    document.getElementById('screen-main').hidden = false;
    showView('inicio');
  }
})();