/* ==================================================================
   BATFINANCE · Extras
   ------------------------------------------------------------------
   - App instalable (service worker) y notificaciones push
   - Inicio: avisos de lo que la app hizo sola, alertas de presupuesto,
     resumen semanal y gráfica de patrimonio
   - Ingresos automáticos (recurrentes)
   - Buscador y filtros de gastos
   - Presupuesto por categoría
   - Gym: metas del día, rachas y progreso
   Se carga después de app.js y se engancha a renderAll().
   ================================================================== */
(function () {
  const esLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const $m = function (n) { return money(n); };
  const hoy = function () { return localISO(); };
  function masDias(fecha, n) { const d = new Date(fecha + 'T12:00:00'); d.setDate(d.getDate() + n); return localISO(d); }
  function mesDe(fecha) { return String(fecha).slice(0, 7); }
  const CHEV = '<svg class="fold-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>';
  const abiertos = {}; // qué plegables están abiertos (sobrevive a los repintados)
  window.guardarFold = function (id, abierto) { abiertos[id] = abierto; };
  function fold(id, resumenHtml, cuerpoHtml) {
    return '<details class="fold"' + (abiertos[id] ? ' open' : '') + ' ontoggle="guardarFold(\'' + id + '\', this.open)">' +
      '<summary>' + resumenHtml + CHEV + '</summary><div class="fold-body" style="padding-top:14px;">' + cuerpoHtml + '</div></details>';
  }

  /* =============== App instalable + notificaciones =============== */
  if ('serviceWorker' in navigator && !esLocal) {
    navigator.serviceWorker.register('/sw.js').catch(function () { /* sin SW la app funciona igual */ });
  }
  function b64aBytes(b64) {
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, function (c) { return c.charCodeAt(0); });
  }
  const soportaPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const instalada = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  window.activarNotificaciones = async function (btn) {
    try {
      if (esLocal) { toast('Las notificaciones se activan en la app publicada'); return; }
      if (!soportaPush) { toast(esIOS && !instalada ? 'Primero instala la app en tu pantalla de inicio' : 'Tu navegador no admite notificaciones'); return; }
      btn.disabled = true; btn.textContent = 'Activando…';
      const permiso = await Notification.requestPermission();
      if (permiso !== 'granted') { toast('No diste permiso para notificaciones'); return; }
      const reg = await navigator.serviceWorker.ready;
      const { clave } = await apiFetch('/push/clave');
      const sub = (await reg.pushManager.getSubscription()) ||
        await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aBytes(clave) });
      await apiFetch('/push/suscribir', { method: 'POST', body: JSON.stringify({ suscripcion: sub.toJSON() }) });
      await apiFetch('/push/probar', { method: 'POST', body: '{}' });
      toast('Notificaciones activadas 🦇');
    } catch (e) {
      toast(e.message || 'No se pudieron activar');
    } finally {
      renderCfgNotif();
    }
  };
  window.probarNotificacion = async function () {
    try { const r = await apiFetch('/push/probar', { method: 'POST', body: '{}' }); toast(r.enviados ? 'Te mandé una notificación de prueba' : 'Este dispositivo aún no está suscrito'); }
    catch (e) { toast(e.message || 'No se pudo enviar'); }
  };
  function renderCfgNotif() {
    const el = document.getElementById('cfg-notif');
    if (!el) return;
    const permiso = 'Notification' in window ? Notification.permission : 'no';
    let estado, boton;
    if (esIOS && !instalada) {
      estado = 'En iPhone primero instala la app: en Safari toca <b>Compartir</b> → <b>Agregar a pantalla de inicio</b>, ábrela desde el ícono y vuelve aquí.';
      boton = '';
    } else if (permiso === 'granted') {
      estado = 'Activas en este dispositivo. Te aviso de cobros, pagos por vencer, presupuestos al 80%, tus metas del gym y el resumen de cada domingo.';
      boton = '<button class="small-btn" style="width:100%; padding:12px;" onclick="probarNotificacion()">Enviar notificación de prueba</button>';
    } else if (permiso === 'denied') {
      estado = 'Bloqueadas. Actívalas desde los ajustes del navegador o del teléfono para BATFINANCE.';
      boton = '';
    } else {
      estado = 'Recibe avisos aunque la app esté cerrada: cobros de suscripciones, pagos por vencer, presupuestos y tus metas del gym.';
      boton = '<button class="btn-primary" onclick="activarNotificaciones(this)">Activar notificaciones</button>';
    }
    el.innerHTML = '<div class="hint" style="margin:0 0 14px; line-height:1.5;">' + estado + '</div>' + boton;
  }

  /* =============== Inicio: lo que la app hizo sola =============== */
  window.deshacerAuto = function (id, btn) {
    withLoading(btn, async function () {
      await apiFetch('/automaticos/' + id + '/deshacer', { method: 'POST', body: '{}' });
      await refresh(); toast('Listo, se deshizo');
    });
  };
  window.vistoAuto = async function (id) {
    state.automaticos = (state.automaticos || []).filter(function (a) { return a.id !== id; });
    renderAutos();
    try { await apiFetch('/automaticos/' + id + '/visto', { method: 'POST', body: '{}' }); } catch (e) { /* no pasa nada */ }
  };
  function renderAutos() {
    const el = document.getElementById('home-auto');
    if (!el) return;
    const autos = state.automaticos || [];
    el.innerHTML = autos.map(function (a) {
      const ingreso = a.tipo === 'ingreso';
      const sinSaldo = a.estado === 'sin_saldo';
      const texto = ingreso ? 'Llegó <b>' + escapeHtml(a.nombre) + '</b>: +' + $m(a.monto)
        : sinSaldo ? 'No alcanzó para cobrar <b>' + escapeHtml(a.nombre) + '</b> (' + $m(a.monto) + '). Quedó pendiente.'
        : 'Se cobró <b>' + escapeHtml(a.nombre) + '</b>: −' + $m(a.monto);
      return '<div class="aviso-auto' + (ingreso ? ' ok' : sinSaldo ? ' mal' : '') + '">' +
        '<span class="aviso-ico">' + (ingreso ? '↓' : sinSaldo ? '!' : '↻') + '</span>' +
        '<div class="aviso-txt">' + texto + '<small>' + fmtDate(a.fecha) + ' · registrado automáticamente</small></div>' +
        (a.estado === 'aplicado' ? '<button class="small-btn" onclick="deshacerAuto(\'' + a.id + '\', this)">Deshacer</button>' : '') +
        '<button class="aviso-x" aria-label="Ocultar aviso" onclick="vistoAuto(\'' + a.id + '\')">✕</button>' +
      '</div>';
    }).join('');
  }

  /* =============== Presupuestos: datos y alertas =============== */
  function usoPresupuestos() {
    const mes = mesDe(hoy());
    return (state.presupuestos || []).map(function (p) {
      const usado = state.gastos.filter(function (g) { return g.categoria === p.categoria && mesDe(g.fecha) === mes; })
        .reduce(function (s, g) { return s + Number(g.monto); }, 0);
      return { categoria: p.categoria, limite: Number(p.monto), usado: usado, pct: usado / Number(p.monto) };
    });
  }
  function renderAlertas() {
    const el = document.getElementById('home-alertas');
    if (!el) return;
    el.innerHTML = usoPresupuestos().filter(function (p) { return p.pct >= 0.8; }).map(function (p) {
      const c = catInfo(p.categoria);
      const pasado = p.pct >= 1;
      return '<div class="aviso-auto ' + (pasado ? 'mal' : 'warn') + '">' +
        '<span class="aviso-ico">' + (pasado ? '!' : '%') + '</span>' +
        '<div class="aviso-txt">' + (pasado ? 'Te pasaste del presupuesto de <b>' : 'Llevas el <b>' + Math.round(p.pct * 100) + '%</b> de tu presupuesto de <b>') + c.label + '</b>' +
        '<small>' + $m(p.usado) + ' de ' + $m(p.limite) + ' este mes</small></div></div>';
    }).join('');
  }
  window.guardarPresupuesto = async function (cat, input) {
    const monto = parseFloat(input.value) || 0;
    try {
      await apiFetch('/presupuestos', { method: 'PUT', body: JSON.stringify({ categoria: cat, monto: monto }) });
      state.presupuestos = (state.presupuestos || []).filter(function (p) { return p.categoria !== cat; });
      if (monto > 0) state.presupuestos.push({ categoria: cat, monto: monto });
      renderPresupuestos(); renderAlertas();
      toast(monto > 0 ? 'Presupuesto guardado' : 'Presupuesto quitado');
    } catch (e) { toast(e.message || 'No se pudo guardar'); }
  };
  function renderPresupuestos() {
    const el = document.getElementById('presupuestos-card');
    if (!el) return;
    const uso = {}; usoPresupuestos().forEach(function (u) { uso[u.categoria] = u; });
    const mes = mesDe(hoy());
    el.innerHTML = '<div class="hint" style="margin:0 0 12px;">Pon cuánto quieres gastar al mes en cada categoría. Te aviso al llegar al 80%.</div>' +
      CATEGORIAS.map(function (c) {
        const u = uso[c.id];
        const gastado = u ? u.usado : state.gastos.filter(function (g) { return g.categoria === c.id && mesDe(g.fecha) === mes; }).reduce(function (s, g) { return s + Number(g.monto); }, 0);
        const pct = u ? Math.min(1, u.pct) : 0;
        const color = !u ? 'var(--text-faint)' : u.pct >= 1 ? 'var(--coral)' : u.pct >= 0.8 ? 'var(--amber)' : 'var(--cyan)';
        return '<div class="ppto-row">' +
          '<span class="ppto-ico" style="color:' + c.color + '">' + c.icon + '</span>' +
          '<div class="ppto-body"><div class="ppto-top"><b>' + c.label + '</b><span>' + $m(gastado) + (u ? ' / ' + $m(u.limite) : '') + '</span></div>' +
            '<div class="pbar"><div class="pbar-fill" style="width:' + (pct * 100) + '%; background:' + color + '"></div></div></div>' +
          '<input class="ppto-in" type="number" inputmode="decimal" min="0" placeholder="$ límite" value="' + (u ? u.limite : '') + '" aria-label="Presupuesto mensual de ' + c.label + '" onchange="guardarPresupuesto(\'' + c.id + '\', this)">' +
        '</div>';
      }).join('');
  }

  /* =============== Resumen semanal (Inicio) =============== */
  let resumen = null, pidiendoResumen = false;
  async function cargarResumen() {
    if (resumen || pidiendoResumen) return;
    pidiendoResumen = true;
    try { resumen = await apiFetch('/resumen-semanal'); } catch (e) { resumen = { error: true }; }
    pidiendoResumen = false;
    renderSemana();
  }
  function renderSemana() {
    const el = document.getElementById('home-semana');
    if (!el) return;
    if (!resumen) {
      el.innerHTML = fold('semana', '<div class="fold-txt"><b>Tu semana</b><span class="fold-sub">Preparando tu resumen…</span></div>', '<div class="hint">Cargando…</div>');
      cargarResumen();
      return;
    }
    if (resumen.error) { el.innerHTML = fold('semana', '<div class="fold-txt"><b>Tu semana</b><span class="fold-sub">No se pudo cargar</span></div>', ''); return; }
    const r = resumen;
    const dif = r.gastado - r.gastadoSemanaAnterior;
    el.innerHTML = fold('semana',
      '<div class="fold-txt"><b>Tu semana</b><span class="fold-sub">Gastaste <b class="' + (dif > 0 ? 'neg' : 'pos') + '">' + $m(r.gastado) + '</b> · ' + fmtDate(r.desde) + ' al ' + fmtDate(r.hasta) + '</span></div>',
      (r.titular ? '<div class="semana-titular">' + escapeHtml(r.titular) + '</div>' : '') +
      '<div class="res-grid">' +
        '<div class="res-tile"><span>Gastado</span><b>' + $m(r.gastado) + '</b><em>' + (r.gastadoSemanaAnterior ? (dif > 0 ? '+' : '') + $m(dif) + ' vs semana pasada' : r.compras + ' compras') + '</em></div>' +
        '<div class="res-tile"><span>Ingresos</span><b>' + $m(r.ingresos) + '</b><em>en la semana</em></div>' +
      '</div>' +
      (r.porCategoria && r.porCategoria.length ? '<div class="semana-cats">' + r.porCategoria.slice(0, 4).map(function (c) { const ci = catInfo(c.categoria); return '<span><i style="background:' + ci.color + '"></i>' + ci.label + ' ' + $m(c.t) + '</span>'; }).join('') + '</div>' : '') +
      (r.resumen ? '<p class="asesor-resumen" style="margin-top:12px;">' + escapeHtml(r.resumen) + '</p>' : '') +
      (r.recomendacion ? '<div class="asesor-bloque"><span>Para la próxima semana</span>' + escapeHtml(r.recomendacion) + '</div>' : ''));
  }

  /* =============== Patrimonio en el tiempo (Inicio) =============== */
  function renderPatrimonio() {
    const el = document.getElementById('home-patrimonio');
    if (!el) return;
    const pts = (state.patrimonio || []).map(function (p) {
      return { fecha: p.fecha, neto: Number(p.liquido) + Number(p.ahorro) - Number(p.deudas) };
    });
    const actual = pts.length ? pts[pts.length - 1].neto : 0;
    const primero = pts.length ? pts[0].neto : 0;
    const cambio = actual - primero;
    let cuerpo;
    if (pts.length < 2) {
      cuerpo = '<div class="hint" style="margin:0;">Patrimonio neto de hoy: <b>' + (actual < 0 ? '−' : '') + $m(Math.abs(actual)) + '</b> (lo que tienes y ahorras menos lo que debes). ' +
        'Guardo una foto cada día; la gráfica se irá dibujando desde hoy.</div>';
    } else {
      const W = 340, H = 150, L = 44, R = 8, T = 12, B = 22;
      const vals = pts.map(function (p) { return p.neto; });
      let min = Math.min.apply(null, vals.concat(0)), max = Math.max.apply(null, vals.concat(0));
      if (max === min) max = min + 1;
      const pad = (max - min) * 0.1; min -= pad; max += pad;
      const x = function (i) { return L + (i / (pts.length - 1)) * (W - L - R); };
      const y = function (v) { return T + (1 - (v - min) / (max - min)) * (H - T - B); };
      const linea = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(p.neto).toFixed(1); }).join('');
      const area = linea + 'L' + x(pts.length - 1).toFixed(1) + ',' + y(Math.max(min, 0)).toFixed(1) + 'L' + x(0).toFixed(1) + ',' + y(Math.max(min, 0)).toFixed(1) + 'Z';
      const ticks = [min, (min + max) / 2, max].map(function (v) {
        return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="ch-grid"/>' +
          '<text x="' + (L - 6) + '" y="' + (y(v) + 3.5) + '" class="ch-ax" text-anchor="end">' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v)) + '</text>';
      }).join('');
      const cero = min < 0 && max > 0 ? '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="rgba(255,255,255,0.25)" stroke-dasharray="3 3"/>' : '';
      const ult = pts.length - 1;
      cuerpo = '<div class="ch-wrap"><svg viewBox="0 0 ' + W + ' ' + H + '" class="ch-svg" role="img" aria-label="Patrimonio neto por día">' +
        '<defs><linearGradient id="patGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#E8B04B" stop-opacity="0.35"/><stop offset="100%" stop-color="#E8B04B" stop-opacity="0"/></linearGradient></defs>' +
        ticks + cero +
        '<path d="' + area + '" fill="url(#patGrad)"/>' +
        '<path d="' + linea + '" fill="none" stroke="#E8B04B" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<circle cx="' + x(ult) + '" cy="' + y(pts[ult].neto) + '" r="4" fill="#E8B04B" stroke="#050608" stroke-width="2"/>' +
        '<text x="' + L + '" y="' + (H - 6) + '" class="ch-ax">' + fmtDate(pts[0].fecha) + '</text>' +
        '<text x="' + (W - R) + '" y="' + (H - 6) + '" class="ch-ax" text-anchor="end">' + fmtDate(pts[ult].fecha) + '</text>' +
        '</svg></div>' +
        '<div class="hint">Patrimonio neto = efectivo + tarjeta + fondo + metas + inversiones − deudas.</div>';
    }
    el.innerHTML = fold('patrimonio',
      '<div class="fold-txt"><b>Patrimonio</b><span class="fold-sub">Neto <b class="' + (actual < 0 ? 'neg' : 'pos') + '">' + (actual < 0 ? '−' : '') + $m(Math.abs(actual)) + '</b>' +
        (pts.length >= 2 ? ' · ' + (cambio >= 0 ? '+' : '−') + $m(Math.abs(cambio)) + ' desde ' + fmtDate(pts[0].fecha) : '') + '</span></div>',
      cuerpo);
  }

  /* =============== Ingresos automáticos =============== */
  function formRecurrente(r) {
    r = r || { nombre: '', monto: '', frecuencia: 'quincenal', metodo: 'electronico', proximo: hoy() };
    return '<div class="field"><label>¿De dónde viene?</label><input type="text" id="re-nombre" placeholder="Ej. Quincena, Sueldo" value="' + escapeHtml(r.nombre) + '"></div>' +
      '<div class="field"><label>Monto (MXN)</label><input type="number" id="re-monto" inputmode="decimal" min="0" placeholder="0" value="' + (r.monto === '' ? '' : Number(r.monto)) + '"></div>' +
      '<div class="field"><label>¿Cada cuándo?</label><div class="seg" id="re-freq">' +
        ['semanal', 'quincenal', 'mensual'].map(function (f) { return '<button class="seg-opt' + (r.frecuencia === f ? ' active' : '') + '" data-v="' + f + '">' + f.charAt(0).toUpperCase() + f.slice(1) + '</button>'; }).join('') +
      '</div></div>' +
      '<div class="field"><label>Próximo depósito</label><input type="date" id="re-fecha" value="' + String(r.proximo).slice(0, 10) + '"></div>' +
      '<div class="field" style="margin-bottom:0;"><label>¿A dónde llega?</label><div class="seg" id="re-metodo">' +
        '<button class="seg-opt' + (r.metodo === 'efectivo' ? ' active' : '') + '" data-v="efectivo">Efectivo</button>' +
        '<button class="seg-opt' + (r.metodo !== 'efectivo' ? ' active' : '') + '" data-v="electronico">Tarjeta / cuenta</button>' +
      '</div></div>' +
      '<div class="hint">El día del depósito se registra solo y se suma a tu saldo. Si algo no llegó, lo puedes deshacer desde el aviso en Inicio.</div>';
  }
  function activarSeg(m, sel) {
    m.overlay.querySelectorAll(sel + ' .seg-opt').forEach(function (b) {
      b.addEventListener('click', function () { m.overlay.querySelectorAll(sel + ' .seg-opt').forEach(function (x) { x.classList.toggle('active', x === b); }); });
    });
  }
  function leerRecurrente(m) {
    const v = function (sel) { const a = m.overlay.querySelector(sel + ' .active'); return a ? a.dataset.v : null; };
    return { nombre: document.getElementById('re-nombre').value.trim(), monto: parseFloat(document.getElementById('re-monto').value),
      frecuencia: v('#re-freq'), proximo: document.getElementById('re-fecha').value, metodo: v('#re-metodo') };
  }
  window.openAddRecurrente = function () {
    const m = openModal('<div class="sheet-title">Ingreso automático</div>' + formRecurrente() + '<button class="btn-primary" id="re-save" style="margin-top:18px;">Guardar</button>');
    activarSeg(m, '#re-freq'); activarSeg(m, '#re-metodo');
    document.getElementById('re-save').addEventListener('click', function () {
      const d = leerRecurrente(m);
      if (!d.nombre || !(d.monto > 0) || !d.proximo) { toast('Completa nombre, monto y fecha'); return; }
      withLoading(this, async function () {
        await apiFetch('/recurrentes', { method: 'POST', body: JSON.stringify(d) });
        await refresh(); m.close(); toast('Ingreso automático guardado');
      });
    });
  };
  window.openRecurrente = function (id) {
    const r = (state.recurrentes || []).find(function (x) { return x.id === id; }); if (!r) return;
    const m = openModal('<div class="sheet-title">' + escapeHtml(r.nombre) + '</div>' + formRecurrente(r) +
      '<button class="btn-primary" id="re-save" style="margin-top:18px;">Guardar cambios</button>' +
      '<div class="btn-row" style="margin-top:10px;">' +
        '<button class="btn-ghost" id="re-pausa" style="flex:1;">' + (r.activo ? 'Pausar' : 'Reactivar') + '</button>' +
        '<button class="btn-ghost btn-danger" id="re-del" style="flex:1;">Eliminar</button></div>');
    activarSeg(m, '#re-freq'); activarSeg(m, '#re-metodo');
    document.getElementById('re-save').addEventListener('click', function () {
      const d = leerRecurrente(m); d.activo = r.activo;
      if (!d.nombre || !(d.monto > 0) || !d.proximo) { toast('Completa nombre, monto y fecha'); return; }
      withLoading(this, async function () { await apiFetch('/recurrentes/' + id, { method: 'PUT', body: JSON.stringify(d) }); await refresh(); m.close(); toast('Guardado'); });
    });
    document.getElementById('re-pausa').addEventListener('click', function () {
      const d = Object.assign({}, r, { proximo: String(r.proximo).slice(0, 10), activo: !r.activo });
      withLoading(this, async function () { await apiFetch('/recurrentes/' + id, { method: 'PUT', body: JSON.stringify(d) }); await refresh(); m.close(); toast(d.activo ? 'Reactivado' : 'Pausado'); });
    });
    document.getElementById('re-del').addEventListener('click', function () {
      if (!confirm('¿Eliminar ' + r.nombre + '? Los ingresos que ya se registraron se quedan.')) return;
      withLoading(this, async function () { await apiFetch('/recurrentes/' + id, { method: 'DELETE' }); await refresh(); m.close(); toast('Eliminado'); });
    });
  };
  function renderRecurrentes() {
    const el = document.getElementById('recurrentes-list');
    if (!el) return;
    const recs = state.recurrentes || [];
    const porMes = { semanal: 52 / 12, quincenal: 2, mensual: 1 };
    const mensual = recs.filter(function (r) { return r.activo; }).reduce(function (s, r) { return s + Number(r.monto) * (porMes[r.frecuencia] || 1); }, 0);
    el.innerHTML = (recs.length ? recs.map(function (r) {
      const dias = daysUntil(String(r.proximo).slice(0, 10));
      return '<div class="row' + (r.activo ? '' : ' row-off') + '" onclick="openRecurrente(\'' + r.id + '\')">' +
        '<div class="row-icon" style="background:var(--cyan-dim); color:var(--cyan);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg></div>' +
        '<div class="row-body"><div class="row-title">' + escapeHtml(r.nombre) + '</div>' +
          '<div class="row-sub">' + r.frecuencia.charAt(0).toUpperCase() + r.frecuencia.slice(1) + ' · ' + (r.metodo === 'efectivo' ? 'Efectivo' : 'Tarjeta') + ' · ' + fmtDate(String(r.proximo).slice(0, 10)) + '</div>' +
          (r.activo ? '<span class="row-badge badge-ok">' + (dias <= 0 ? 'Llega hoy' : 'Llega en ' + dias + (dias === 1 ? ' día' : ' días')) + '</span>' : '<span class="row-badge">Pausado</span>') + '</div>' +
        '<div class="row-value" style="color:var(--cyan)">+' + $m(r.monto) + '</div></div>';
    }).join('') + '<div class="hint" style="margin:-2px 0 12px;">≈ ' + $m(mensual) + ' al mes que llegan solos.</div>'
      : '<div class="empty" style="padding:14px 0;"><b>Sin ingresos automáticos</b>Agrega tu quincena o sueldo y se registrará solo cada vez que llegue.</div>') +
      '<button class="small-btn primary" style="width:100%; margin-bottom:6px; padding:12px;" onclick="openAddRecurrente()">+ Agregar ingreso automático</button>';
  }

  /* =============== Buscador y filtros de gastos =============== */
  const filtro = { texto: '', categoria: '', desde: '', hasta: '' };
  window.gastosFiltrados = function () {
    const q = filtro.texto.trim().toLowerCase();
    return state.gastos.filter(function (g) {
      if (q && String(g.descripcion).toLowerCase().indexOf(q) < 0) return false;
      if (filtro.categoria && g.categoria !== filtro.categoria) return false;
      if (filtro.desde && String(g.fecha).slice(0, 10) < filtro.desde) return false;
      if (filtro.hasta && String(g.fecha).slice(0, 10) > filtro.hasta) return false;
      return true;
    });
  };
  window.hayFiltroGastos = function () { return !!(filtro.texto || filtro.categoria || filtro.desde || filtro.hasta); };
  window.cambiarFiltro = function (campo, valor) {
    filtro[campo] = valor;
    renderGastosList();
    renderResumenFiltro();
  };
  window.limpiarFiltros = function () {
    filtro.texto = ''; filtro.categoria = ''; filtro.desde = ''; filtro.hasta = '';
    pintarFiltros(); renderGastosList(); renderResumenFiltro();
  };
  function renderResumenFiltro() {
    const r = document.getElementById('filtro-resumen');
    if (!r) return;
    if (!hayFiltroGastos()) { r.textContent = ''; return; }
    const lista = gastosFiltrados();
    r.innerHTML = lista.length + (lista.length === 1 ? ' gasto' : ' gastos') + ' · <b>' + $m(lista.reduce(function (s, g) { return s + Number(g.monto); }, 0)) + '</b> · <button class="link-btn" onclick="limpiarFiltros()">Quitar filtros</button>';
  }
  function pintarFiltros() {
    const el = document.getElementById('gastos-filtros');
    if (!el) return;
    el.innerHTML =
      '<div class="filtros">' +
        '<div class="filtro-buscar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
          '<input type="search" id="f-texto" placeholder="Buscar gasto…" value="' + escapeHtml(filtro.texto) + '" oninput="cambiarFiltro(\'texto\', this.value)" aria-label="Buscar gasto"></div>' +
        '<div class="filtro-fila">' +
          '<select id="f-cat" onchange="cambiarFiltro(\'categoria\', this.value)" aria-label="Categoría"><option value="">Todas las categorías</option>' +
            CATEGORIAS.map(function (c) { return '<option value="' + c.id + '"' + (filtro.categoria === c.id ? ' selected' : '') + '>' + c.label + '</option>'; }).join('') + '</select>' +
        '</div>' +
        '<div class="filtro-fila">' +
          '<label>Desde<input type="date" id="f-desde" value="' + filtro.desde + '" onchange="cambiarFiltro(\'desde\', this.value)"></label>' +
          '<label>Hasta<input type="date" id="f-hasta" value="' + filtro.hasta + '" onchange="cambiarFiltro(\'hasta\', this.value)"></label>' +
        '</div>' +
        '<div class="filtro-resumen" id="filtro-resumen"></div>' +
      '</div>';
    renderResumenFiltro();
  }

  /* =============== Gym: metas del día, rachas y progreso =============== */
  function totalDia(items, fecha) {
    return items.reduce(function (s, it) { return s + tomaDe(it.id, fecha) * Number(it.cantidadPorToma); }, 0);
  }
  function racha(cumple) {
    const d = new Date(); d.setHours(12, 0, 0, 0);
    if (!cumple(localISO(d))) d.setDate(d.getDate() - 1); // si hoy aún no, cuenta desde ayer
    let n = 0;
    while (cumple(localISO(d)) && n < 999) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function renderGymProgreso() {
    const el = document.getElementById('gym-progreso');
    if (!el) return;
    const items = gymItems();
    if (!items.length) { el.innerHTML = ''; return; }
    const u = G().unidad;
    const medibles = items.filter(function (it) { return it.unidad === u; });
    const hoyF = hoy();
    const mes = mesDe(hoyF);
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); const mesAnt = localISO(d).slice(0, 7);
    const porDia = {};
    (state.tomasSuplementos || []).forEach(function (t) {
      const it = medibles.find(function (x) { return x.id === t.suplementoId; });
      if (!it) return;
      porDia[t.fecha] = (porDia[t.fecha] || 0) + Number(t.cantidad) * Number(it.cantidadPorToma);
    });
    const totalMes = function (m) { return Object.keys(porDia).filter(function (f) { return f.slice(0, 7) === m; }).reduce(function (s, f) { return s + porDia[f]; }, 0); };
    const esteMes = totalMes(mes), anterior = totalMes(mesAnt);
    let mejor = null; Object.keys(porDia).forEach(function (f) { if (!mejor || porDia[f] > porDia[mejor]) mejor = f; });
    const rachaGeneral = racha(function (f) { return items.some(function (it) { return tomaDe(it.id, f) > 0; }); });
    const conMeta = items.filter(function (it) { return Number(it.metaDiaria) > 0; });
    const cambioPct = anterior > 0 ? Math.round((esteMes - anterior) / anterior * 100) : null;

    const metasHtml = conMeta.map(function (it) {
      const hecho = tomaDe(it.id, hoyF) * Number(it.cantidadPorToma);
      const meta = Number(it.metaDiaria);
      const pct = Math.min(1, hecho / meta);
      const rachaMeta = racha(function (f) { return tomaDe(it.id, f) * Number(it.cantidadPorToma) >= meta; });
      return '<div class="meta-gym" style="--sc:' + it.color + '">' +
        '<div class="meta-gym-top"><b>' + escapeHtml(it.nombre) + '</b><span>' + unidadTxt(hecho, it.unidad) + ' / ' + unidadTxt(meta, it.unidad) + (pct >= 1 ? ' ✓' : '') + '</span></div>' +
        '<div class="pbar"><div class="pbar-fill" style="width:' + (pct * 100) + '%; background:' + it.color + '"></div></div>' +
        (rachaMeta ? '<small>🔥 ' + rachaMeta + (rachaMeta === 1 ? ' día' : ' días') + ' seguidos cumpliendo</small>' : '') +
      '</div>';
    }).join('');

    el.innerHTML = '<div class="section-title">Progreso</div><div class="card">' +
      '<div class="res-grid res-grid-3">' +
        '<div class="res-tile"><span>Racha</span><b>' + rachaGeneral + '</b><em>' + (rachaGeneral === 1 ? 'día seguido' : 'días seguidos') + '</em></div>' +
        '<div class="res-tile"><span>Este mes</span><b>' + fmtNum(esteMes) + '</b><em>' + (cambioPct === null ? u + ' en total' : (cambioPct >= 0 ? '+' : '') + cambioPct + '% vs mes pasado') + '</em></div>' +
        '<div class="res-tile"><span>Mejor día</span><b>' + (mejor ? fmtNum(porDia[mejor]) : '—') + '</b><em>' + (mejor ? fmtDate(mejor) : 'aún sin registros') + '</em></div>' +
      '</div>' +
      (conMeta.length ? '<div class="metas-gym">' + metasHtml + '</div>'
        : '<div class="hint" style="margin-top:12px;">Ponle una meta diaria a tus ' + G().varios + ' (por ejemplo 100 abdominales) desde "Editar" y verás aquí tu avance y tus rachas.</div>') +
      '</div>';
  }

  /* =============== Enganche con el render general =============== */
  const renderAllOriginal = window.renderAll;
  window.renderAll = function () {
    renderAllOriginal();
    renderAutos(); renderAlertas(); renderSemana(); renderPatrimonio();
    renderRecurrentes(); pintarFiltros(); renderPresupuestos(); renderGymProgreso(); renderCfgNotif();
  };
  const renderSupleOriginal = window.renderSuplementos;
  window.renderSuplementos = function () { renderSupleOriginal(); renderGymProgreso(); };
  window.renderGymProgreso = renderGymProgreso;
  renderCfgNotif();
})();
