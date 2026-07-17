/* ==================================================================
   NEXUSFIN · APP
   ------------------------------------------------------------------
   Punto de entrada: login (contra la API real), navegación entre
   vistas, botón flotante, configuración y arranque de la app.
   ================================================================== */

/* ---------------- SEGUIMIENTO POST-COMPRA ---------------- */
function checkSeguimientosPendientes() {
  const pendientes = gastosPendientesDeSeguimiento();
  if (pendientes.length) {
    // Uno a la vez, para no saturar con varios modales seguidos.
    openSeguimientoPrompt(pendientes[0]);
  }
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

/* ---------------- CERRAR SESIÓN (con confirmación) ---------------- */
function doLogout() {
  setToken(null);
  state = defaultState();
  document.getElementById('screen-main').hidden = true;
  document.getElementById('screen-login').hidden = false;
  document.getElementById('input-user').value = '';
  document.getElementById('input-pass').value = '';
}
function initLogoutButton() {
  document.getElementById('btn-logout-top').addEventListener('click', function () {
    const m = openModal(
      '<div class="sheet-title">¿Cerrar sesión?</div>' +
      '<p style="font-size:13px; color:var(--text-dim); line-height:1.5;">Vas a salir de tu cuenta. Puedes volver a entrar cuando quieras con tu usuario y contraseña.</p>' +
      '<div class="btn-row" style="margin-top:20px;">' +
        '<button class="btn-ghost" id="cancel-logout" style="flex:1;">Cancelar</button>' +
        '<button class="btn-ghost btn-danger" id="confirm-logout" style="flex:1;">Cerrar sesión</button>' +
      '</div>',
      { center: true }
    );
    document.getElementById('cancel-logout').addEventListener('click', m.close);
    document.getElementById('confirm-logout').addEventListener('click', function () {
      doLogout();
      m.close();
    });
  });
}

/* ---------------- SALDO / PAGOS PENDIENTES ---------------- */
function initSaldo() {
  document.getElementById('btn-edit-liquido').addEventListener('click', openEditLiquido);
}
async function toggleHomePagos() {
  const nuevoValor = !state.config.pagosPendientesColapsado;
  state.config.pagosPendientesColapsado = nuevoValor; // optimista, se ve al instante
  renderInicio();
  try {
    await apiFetch('/config', { method: 'PUT', body: JSON.stringify({ pagosPendientesColapsado: nuevoValor }) });
  } catch (err) {
    // Falló guardar la preferencia, pero no es grave — no interrumpimos con un toast.
    console.warn('No se pudo guardar la preferencia de pagos pendientes', err);
  }
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
  document.getElementById('cfg-ingreso-fijo').value = state.config.ingresoMensualFijo;
  document.getElementById('cfg-nec').value = state.config.distribucion.necesidades;
  document.getElementById('cfg-des').value = state.config.distribucion.deseos;
  document.getElementById('cfg-inv').value = state.config.distribucion.inversion;
  document.getElementById('cfg-aho').value = state.config.distribucion.ahorro;
  updateSumHint();
}
function updateSumHint() {
  const n = parseFloat(document.getElementById('cfg-nec').value) || 0;
  const d = parseFloat(document.getElementById('cfg-des').value) || 0;
  const i = parseFloat(document.getElementById('cfg-inv').value) || 0;
  const a = parseFloat(document.getElementById('cfg-aho').value) || 0;
  const sum = n + d + i + a;
  const hint = document.getElementById('cfg-sum-hint');
  hint.textContent = 'Suma actual: ' + sum + '%' + (sum !== 100 ? ' — lo ideal es que sume 100%' : ' ✓');
  hint.style.color = sum === 100 ? 'var(--cyan)' : 'var(--amber)';
}
function initConfig() {
  ['cfg-nec', 'cfg-des', 'cfg-inv', 'cfg-aho'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', updateSumHint);
  });
  document.getElementById('btn-save-config').addEventListener('click', async function () {
    const btn = document.getElementById('btn-save-config');
    const tasaSofipoDefault = parseFloat(document.getElementById('cfg-tasa').value) || state.config.tasaSofipoDefault;
    const mesesObjetivo = parseFloat(document.getElementById('cfg-meses').value) || state.fondoEmergencia.mesesObjetivo;
    const gastoMensual = parseFloat(document.getElementById('cfg-gasto').value) || state.fondoEmergencia.gastoMensual;
    const necesidades = parseFloat(document.getElementById('cfg-nec').value) || 0;
    const deseos = parseFloat(document.getElementById('cfg-des').value) || 0;
    const inversion = parseFloat(document.getElementById('cfg-inv').value) || 0;
    const ahorro = parseFloat(document.getElementById('cfg-aho').value) || 0;
    const ingresoMensualFijo = parseFloat(document.getElementById('cfg-ingreso-fijo').value) || 0;

    btn.disabled = true;
    try {
      await Promise.all([
        apiFetch('/config', {
          method: 'PUT',
          body: JSON.stringify({ tasaSofipoDefault: tasaSofipoDefault, distribucion: { necesidades: necesidades, deseos: deseos, ahorro: ahorro, inversion: inversion }, ingresoMensualFijo: ingresoMensualFijo })
        }),
        apiFetch('/fondo-emergencia', {
          method: 'PUT',
          body: JSON.stringify({ mesesObjetivo: mesesObjetivo, gastoMensual: gastoMensual })
        })
      ]);
      await refresh();
      toast('Configuración guardada');
    } catch (err) {
      toast(err.message || 'No se pudo guardar la configuración');
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------------- LOGIN ---------------- */
async function doLogin() {
  const u = document.getElementById('input-user').value.trim();
  const p = document.getElementById('input-pass').value;
  const err = document.getElementById('login-error');
  const btn = document.getElementById('btn-login');
  if (!u || !p) {
    err.textContent = 'Escribe tu usuario y contraseña';
    return;
  }
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: u, password: p })
    });
    setToken(data.token);
    await loadState();
    document.getElementById('screen-login').hidden = true;
    document.getElementById('screen-main').hidden = false;
    showView('inicio');
    checkSeguimientosPendientes();
  } catch (e) {
    err.textContent = e.message || 'Usuario o contraseña incorrectos';
    const card = document.getElementById('login-card');
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar al sistema';
  }
}
function initLogin() {
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('input-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
}

/* ---------------- INIT ---------------- */
(async function init() {
  initLogin();
  initNavigation();
  initFab();
  initConfig();
  initSaldo();
  initLogoutButton();
  startQuoteTicker();

  // Si ya había una sesión (token guardado), intenta entrar directo sin
  // pedir login otra vez. Si el token ya venció o es inválido, regresa
  // a la pantalla de login normalmente.
  if (getToken()) {
    try {
      await loadState();
      document.getElementById('screen-login').hidden = true;
      document.getElementById('screen-main').hidden = false;
      showView('inicio');
      checkSeguimientosPendientes();
    } catch (e) {
      setToken(null);
    }
  }
})();
