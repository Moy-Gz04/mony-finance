/* ==================================================================
   NEXUSFIN · RENDER
   ------------------------------------------------------------------
   Todas las funciones que pintan datos en pantalla (lectura de
   `state` -> HTML). No agregan/editan datos — eso vive en modals.js.
   ================================================================== */

function totalDeudas() {
  return state.deudas.filter(function (d) { return !d.pagada; })
    .reduce(function (s, d) { return s + Number(d.montoPendiente != null ? d.montoPendiente : d.montoTotal || 0); }, 0);
}
function totalInvertido() {
  return state.inversiones.reduce(function (s, i) { return s + Number(i.monto || 0); }, 0);
}
function totalMetas() {
  return state.metas
    .filter(function (m) { return Number(m.montoActual || 0) < Number(m.montoObjetivo || 0); })
    .reduce(function (s, m) { return s + Number(m.montoActual || 0); }, 0);
}
function avgRating() {
  const rated = state.gastos.filter(function (g) { return g.rating != null; });
  if (!rated.length) return null;
  const sum = rated.reduce(function (s, g) { return s + g.rating; }, 0);
  return { avg: sum / rated.length, count: rated.length };
}

/* ---------------- INICIO ---------------- */
function renderInicio() {
  const efectivo = Math.max(0, Number(state.saldo.efectivo) || 0);
  const tarjeta = Math.max(0, Number(state.saldo.tarjeta) || 0);
  const patrimonio = efectivo + tarjeta;
  document.getElementById('hero-amount').innerHTML = money(patrimonio) + '<span>MXN</span>';
  document.getElementById('saldo-breakdown').innerHTML =
    '<span class="saldo-pill"><span class="dot" style="background:var(--cyan)"></span>Efectivo · ' + money(efectivo) + '</span>' +
    '<span class="saldo-pill"><span class="dot" style="background:var(--violet)"></span>Tarjeta · ' + money(tarjeta) + '</span>';
  const ring = document.getElementById('ring-fill');
  const circumference = 238.76;
  const refCap = Math.max(patrimonio, totalDeudas(), 20000);
  const frac = refCap > 0 ? Math.min(1, patrimonio / refCap) : 0;
  requestAnimationFrame(function () { ring.style.strokeDashoffset = circumference * (1 - frac); });

  document.getElementById('chip-deudas').textContent = money(totalDeudas());
  document.getElementById('chip-inversion').textContent = money(totalInvertido());
  document.getElementById('chip-metas').textContent = money(totalMetas());

  const rating = avgRating();
  const homeStars = document.getElementById('rating-stars-home');
  if (rating) {
    document.getElementById('rating-big').textContent = rating.avg.toFixed(1) + '★';
    document.getElementById('rating-count').textContent = rating.count + ' compra' + (rating.count === 1 ? '' : 's') + ' evaluada' + (rating.count === 1 ? '' : 's');
    renderStars(homeStars, rating.avg, 21);
    renderStars(document.getElementById('rating-stars-mini'), rating.avg, 12);
    document.getElementById('rating-mini').innerHTML = '<b class="pos">' + rating.avg.toFixed(1) + '★</b> · ' + rating.count + ' compra' + (rating.count === 1 ? '' : 's') + ' evaluada' + (rating.count === 1 ? '' : 's');
  } else {
    document.getElementById('rating-big').textContent = '—.—';
    document.getElementById('rating-count').textContent = 'Sin compras evaluadas aún';
    renderStars(homeStars, 0, 21);
    renderStars(document.getElementById('rating-stars-mini'), 0, 12);
    document.getElementById('rating-mini').textContent = 'Sin compras evaluadas aún';
  }

  const list = document.getElementById('home-debts-list');
  const header = document.getElementById('home-debts-header');
  const pend = state.deudas.filter(function (d) { return !d.pagada; })
    .sort(function (a, b) { return new Date(a.proximoPago) - new Date(b.proximoPago); })
    .slice(0, 3);
  const subsProximas = (state.suscripciones || []).filter(function (s) { return s.activa && daysUntil(s.proximoCobro) <= 3; })
    .sort(function (a, b) { return a.proximoCobro < b.proximoCobro ? -1 : 1; });
  const totalPendientes = pend.length + subsProximas.length;
  const collapsed = !!state.config.pagosPendientesColapsado;
  header.innerHTML =
    '<div class="section-title section-title-toggle" onclick="toggleHomePagos()">' +
      '<span>Próximos pagos' + (totalPendientes ? ' · ' + totalPendientes : '') + '</span>' +
      '<svg class="chev ' + (collapsed ? 'closed' : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>' +
    '</div>';
  list.hidden = collapsed;
  if (!totalPendientes) {
    list.innerHTML = '<div class="empty"><b>Sin pagos pendientes</b>Aquí verás tus deudas y las suscripciones que cobran en los próximos 3 días.</div>';
  } else {
    list.innerHTML = subsProximas.map(suscRowHtml).join('') + pend.map(debtRowHtml).join('');
  }

  const fe = state.fondoEmergencia;
  const target = Math.max(1, fe.gastoMensual * fe.mesesObjetivo);
  const pct = Math.min(100, (fe.actual / target) * 100);
  document.getElementById('home-emergency-card').innerHTML =
    '<div class="kv" style="border:none; padding-top:0;">' +
      '<span class="kv-label">Meta: ' + fe.mesesObjetivo + ' meses de gasto</span>' +
      '<span class="kv-value">' + money(target) + '</span>' +
    '</div>' +
    '<div class="pbar"><div class="pbar-fill" style="width:' + pct + '%"></div></div>' +
    '<div class="hint">' + money(fe.actual) + ' acumulados · ' + pct.toFixed(0) + '% de tu meta' +
      (fe.actual < target ? ' · faltan ' + money(target - fe.actual) : ' · ¡meta cumplida! 🎉') +
    '</div>' +
    '<div class="btn-row" style="margin-top:14px;">' +
      '<button class="small-btn primary" style="flex:1" onclick="openAportarFondo()">Aportar al fondo</button>' +
    '</div>';
}

/* ---------------- RESUMEN DEL MES (Inicio) ---------------- */
const SUSC_POR_MES = { semanal: 52 / 12, quincenal: 2, mensual: 1, anual: 1 / 12 };
function suscripcionesMensual() {
  return (state.suscripciones || []).filter(function (s) { return s.activa; })
    .reduce(function (a, s) { return a + Number(s.monto) * (SUSC_POR_MES[s.frecuencia] || 1); }, 0);
}
let resumenAbierto = false; // "Tu mes" empieza plegado
function renderResumenMes() {
  const el = document.getElementById('home-resumen');
  if (!el) return;
  const mes = localISO().slice(0, 7);
  const ingresos = state.ingresos.filter(function (x) { return String(x.fecha).slice(0, 7) === mes; }).reduce(function (a, x) { return a + Number(x.monto); }, 0);
  const gastos = state.gastos.filter(function (x) { return String(x.fecha).slice(0, 7) === mes; }).reduce(function (a, x) { return a + Number(x.monto); }, 0);
  const balance = ingresos - gastos;
  const ahorro = Number(state.fondoEmergencia.actual || 0) + totalMetas() + totalInvertido();
  const subs = suscripcionesMensual();
  const proxSub = (state.suscripciones || []).filter(function (s) { return s.activa; })
    .sort(function (a, b) { return a.proximoCobro < b.proximoCobro ? -1 : 1; })[0];
  function tile(label, valor, nota, clase) {
    return '<div class="res-tile"><span>' + label + '</span><b class="' + (clase || '') + '">' + valor + '</b>' + (nota ? '<em>' + nota + '</em>' : '') + '</div>';
  }
  el.innerHTML =
    '<details class="fold"' + (resumenAbierto ? ' open' : '') + ' ontoggle="resumenAbierto = this.open">' +
      '<summary><div class="fold-txt"><b>Tu mes</b>' +
        '<span class="fold-sub">Balance <b class="' + (balance < 0 ? 'neg' : 'pos') + '">' + (balance < 0 ? '−' : '') + money(Math.abs(balance)) + '</b> · gastos ' + money(gastos) + '</span></div>' +
        '<svg class="fold-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>' +
      '</summary><div class="fold-body" style="padding-top:14px;">' +
    '<div class="res-grid">' +
      tile('Ingresos', money(ingresos), 'este mes') +
      tile('Gastos', money(gastos), 'este mes') +
      tile('Balance', (balance < 0 ? '−' : '') + money(Math.abs(balance)), balance < 0 ? 'gastas más de lo que entra' : 'a tu favor', balance < 0 ? 'neg' : 'pos') +
      tile('Suscripciones', money(subs), proxSub ? 'próximo: ' + escapeHtml(proxSub.nombre) + ' ' + fmtDate(proxSub.proximoCobro) : 'al mes') +
      tile('Deudas', money(totalDeudas()), 'por pagar') +
      tile('Ahorrado', money(ahorro), 'fondo + metas + inversión') +
    '</div></div></details>';
}

/* ---------------- SUSCRIPCIONES ---------------- */
function renderSuscripciones() {
  const res = document.getElementById('susc-resumen');
  const list = document.getElementById('susc-list');
  if (!res || !list) return;
  const subs = state.suscripciones || [];
  const activas = subs.filter(function (s) { return s.activa; });
  const mensual = suscripcionesMensual();
  res.innerHTML =
    '<div class="res-grid res-grid-3">' +
      '<div class="res-tile"><span>Al mes</span><b>' + money(mensual) + '</b></div>' +
      '<div class="res-tile"><span>Al año</span><b>' + money(mensual * 12) + '</b></div>' +
      '<div class="res-tile"><span>Activas</span><b>' + activas.length + '</b></div>' +
    '</div>' +
    (Number(state.config.ingresoMensualFijo) > 0 && mensual > 0
      ? '<div class="hint" style="margin-top:10px;">Tus suscripciones son el ' + Math.round(mensual / Number(state.config.ingresoMensualFijo) * 100) + '% de tu ingreso fijo.</div>' : '');
  if (!subs.length) {
    list.innerHTML = '<div class="empty"><b>Sin suscripciones</b>Agrega Spotify, Claude, el gym… con el botón +.</div>';
    return;
  }
  const orden = subs.slice().sort(function (a, b) {
    if (a.activa !== b.activa) return a.activa ? -1 : 1;
    return a.proximoCobro < b.proximoCobro ? -1 : 1;
  });
  list.innerHTML = orden.map(suscRowHtml).join('');
}
function suscRowHtml(s) {
    const c = catInfo(s.categoria);
    const dias = daysUntil(s.proximoCobro);
    let badge = '<span class="row-badge badge-ok">Cobra en ' + dias + ' días</span>';
    if (!s.activa) badge = '<span class="row-badge">Pausada</span>';
    else if (dias < 0) badge = '<span class="row-badge badge-urgent">Cobro pendiente</span>';
    else if (dias === 0) badge = '<span class="row-badge badge-urgent">Cobra hoy</span>';
    else if (dias <= 3) badge = '<span class="row-badge badge-soon">Cobra en ' + dias + (dias === 1 ? ' día' : ' días') + '</span>';
    const freq = { semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual', anual: 'Anual' }[s.frecuencia];
    return '<div class="row' + (s.activa ? '' : ' row-off') + '" onclick="openSuscripcion(\'' + s.id + '\')">' +
      '<div class="row-icon" style="background:' + c.color + '22; color:' + c.color + ';">' + c.icon + '</div>' +
      '<div class="row-body"><div class="row-title">' + escapeHtml(s.nombre) + '</div>' +
        '<div class="row-sub">' + freq + ' · ' + metodoLabel(s.metodo) + ' · ' + fmtDate(s.proximoCobro) + '</div>' + badge + '</div>' +
      '<div class="row-value">' + money(s.monto) + '</div></div>';
}

function debtRowHtml(d) {
  const days = daysUntil(d.proximoPago);
  let badge = 'badge-ok', label = 'Vence en ' + days + ' días', pulse = '';
  if (days <= 2) {
    badge = 'badge-urgent'; pulse = 'pulse';
    label = days < 0 ? ('Vencido hace ' + (-days) + 'd') : (days === 0 ? 'Vence hoy' : ('Vence en ' + days + 'd'));
  } else if (days <= 7) {
    badge = 'badge-soon';
  }
  const tipoLabel = { unico: 'Pago único', mensual: 'Mensual', quincenal: 'Quincenal' }[d.tipo];
  const progreso = (d.tipo !== 'unico' && d.duracion) ? ' · pago ' + Math.min(d.pagosRealizados || 0, d.duracion) + ' de ' + d.duracion : '';
  return (
    '<div class="row ' + pulse + '" onclick="openDeudaDetalle(\'' + d.id + '\')">' +
      '<div class="row-icon" style="background:var(--coral-dim); color:var(--coral);">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><line x1="2.5" y1="9.5" x2="21.5" y2="9.5"/></svg>' +
      '</div>' +
      '<div class="row-body">' +
        '<div class="row-title">' + escapeHtml(d.nombre) + '</div>' +
        '<div class="row-sub">' + tipoLabel + progreso + ' · próximo: ' + fmtDate(d.proximoPago) + '</div>' +
        '<span class="row-badge ' + badge + '">' + label + '</span>' +
      '</div>' +
      '<div class="row-value">' + money(d.montoCuota) + '</div>' +
    '</div>'
  );
}

/* ---------------- RESUMEN MENSUAL DE GASTOS ---------------- */
let gastosMesOffset = 0; // 0 = mes actual, -1 = mes anterior, etc. Nunca > 0 (no hay futuro).

function mesOffsetToDate(offset) {
  const d = new Date();
  d.setDate(1); // evita saltos raros al cambiar de mes (ej. 31 de enero -1 mes)
  d.setMonth(d.getMonth() + offset);
  return d;
}
function mismoMes(fechaStr, refDate) {
  const d = new Date(fechaStr + 'T00:00:00');
  return d.getFullYear() === refDate.getFullYear() && d.getMonth() === refDate.getMonth();
}
function nombreMes(d) {
  const s = d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function cambiarMesGastos(delta) {
  const nuevo = gastosMesOffset + delta;
  if (nuevo > 0) return; // no dejar navegar a meses futuros
  gastosMesOffset = nuevo;
  renderGastosResumenMes();
}

function renderGastosResumenMes() {
  const el = document.getElementById('gastos-resumen-mes');
  if (!el) return;
  const refDate = mesOffsetToDate(gastosMesOffset);
  const gastosMes = state.gastos.filter(function (g) { return mismoMes(g.fecha, refDate); });
  const total = gastosMes.reduce(function (s, g) { return s + Number(g.monto || 0); }, 0);

  const porCategoria = {};
  gastosMes.forEach(function (g) {
    porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + Number(g.monto || 0);
  });
  const filas = Object.keys(porCategoria)
    .map(function (catId) { return { cat: catInfo(catId), monto: porCategoria[catId] }; })
    .sort(function (a, b) { return b.monto - a.monto; });

  const catHtml = filas.length
    ? filas.map(function (f) {
        const pct = total > 0 ? (f.monto / total * 100) : 0;
        return (
          '<div style="margin-bottom:11px;">' +
            '<div class="kv" style="border:none; padding:0 0 4px;">' +
              '<span class="kv-label" style="display:flex; align-items:center; gap:7px; color:var(--text);">' +
                '<span style="width:16px;height:16px; color:' + f.cat.color + '; display:inline-flex; flex-shrink:0;">' + f.cat.icon + '</span>' + f.cat.label +
              '</span>' +
              '<span class="kv-value" style="font-size:12.5px;">' + money(f.monto) + '</span>' +
            '</div>' +
            '<div class="pbar" style="height:5px; margin-top:0;"><div class="pbar-fill" style="width:' + pct + '%; background:' + f.cat.color + '"></div></div>' +
          '</div>'
        );
      }).join('')
    : '<div class="hint" style="text-align:center; padding:8px 0 4px;">Sin gastos registrados este mes.</div>';

  // Comparativa de los últimos 6 meses (fija a partir de hoy, sin importar qué mes estés viendo arriba)
  const meses = [];
  for (let i = 5; i >= 0; i--) {
    const d = mesOffsetToDate(-i);
    const t = state.gastos.filter(function (g) { return mismoMes(g.fecha, d); })
      .reduce(function (s, g) { return s + Number(g.monto || 0); }, 0);
    meses.push({ label: d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', ''), total: t });
  }
  const maxMonto = Math.max.apply(null, meses.map(function (m) { return m.total; }).concat([1]));
  const chartHtml = '<div style="display:flex; align-items:flex-end; gap:7px; height:64px;">' +
    meses.map(function (m) {
      const h = m.total > 0 ? Math.max(6, (m.total / maxMonto) * 100) : 2;
      const esMax = m.total === maxMonto && m.total > 0;
      return (
        '<div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:5px; height:100%;">' +
          '<div style="width:100%; max-width:24px; height:' + h + '%; border-radius:6px 6px 3px 3px; background:' + (esMax ? 'linear-gradient(180deg,var(--coral),#c73a56)' : 'linear-gradient(180deg,var(--cyan),var(--violet))') + ';"></div>' +
          '<span style="font-size:9px; color:' + (esMax ? 'var(--coral)' : 'var(--text-faint)') + '; font-weight:' + (esMax ? '800' : '600') + '; text-transform:capitalize;">' + m.label + '</span>' +
        '</div>'
      );
    }).join('') +
  '</div>';

  const chev = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;">';
  const puedeAvanzar = gastosMesOffset < 0;

  el.innerHTML =
    '<div class="card" style="padding:20px;">' +
      '<div class="kv" style="border:none; padding:0 0 14px;">' +
        '<button class="icon-btn" style="width:30px;height:30px;" onclick="cambiarMesGastos(-1)">' + chev + '<path d="m15 6-6 6 6 6"/></svg></button>' +
        '<span style="font-weight:800; font-size:14px;">' + nombreMes(refDate) + '</span>' +
        '<button class="icon-btn" style="width:30px;height:30px;' + (puedeAvanzar ? '' : ' opacity:.3; pointer-events:none;') + '" onclick="cambiarMesGastos(1)">' + chev + '<path d="m9 6 6 6-6 6"/></svg></button>' +
      '</div>' +
      catHtml +
      '<div class="kv" style="border-top:1px solid var(--border); border-bottom:none; margin-top:2px; padding-top:12px;">' +
        '<span class="kv-label" style="font-weight:700; color:var(--text);">Total del mes</span>' +
        '<span class="kv-value" style="font-size:16.5px;">' + money(total) + '</span>' +
      '</div>' +
      '<div class="divider"></div>' +
      '<div class="hero-label" style="margin-bottom:10px;">Comparativa · últimos 6 meses</div>' +
      chartHtml +
    '</div>';
}

/* ---------------- MOVIMIENTOS ---------------- */
function renderMovimientos() {
  renderGastosList();
  renderIngresosList();
  renderPlan();
}
function renderGastosList() {
  renderGastosResumenMes();
  const list = document.getElementById('gastos-list');
  if (!state.gastos.length) {
    list.innerHTML = '<div class="empty"><b>Aún no registras gastos</b>Toca el botón + para agregar tu primera compra.</div>';
    return;
  }
  const sorted = state.gastos.slice().sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
  list.innerHTML = sorted.map(function (g) {
    const c = catInfo(g.categoria);
    const starsHtml = g.rating != null
      ? '<span style="color:var(--amber); font-size:11px; font-weight:700;">' + g.rating.toFixed(1) + '★</span>'
      : '<span style="color:var(--text-faint); font-size:10.5px;">sin evaluar</span>';
    const metodoHtml = '<span class="row-tag">' + (g.metodo === 'efectivo' ? 'Efectivo' : 'Tarjeta') + '</span>';
    return (
      '<div class="row" onclick="openGastoDetalle(\'' + g.id + '\')">' +
        '<div class="row-icon" style="background:' + c.color + '22; color:' + c.color + '">' + c.icon + '</div>' +
        '<div class="row-body">' +
          '<div class="row-title">' + escapeHtml(g.descripcion) + '</div>' +
          '<div class="row-sub">' + c.label + ' · ' + fmtDate(g.fecha) + ' · ' + starsHtml + ' · ' + metodoHtml + '</div>' +
        '</div>' +
        '<div class="row-value">' + money(g.monto) + '</div>' +
      '</div>'
    );
  }).join('');
}
function renderIngresosList() {
  const list = document.getElementById('ingresos-list');
  if (!state.ingresos.length) {
    list.innerHTML = '<div class="empty"><b>Sin ingresos registrados</b>Agrega tu salario u otras entradas de dinero.</div>';
    return;
  }
  const sorted = state.ingresos.slice().sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
  list.innerHTML = sorted.map(function (i) {
    const metodoHtml = '<span class="row-tag">' + (i.metodo === 'efectivo' ? 'Efectivo' : 'Tarjeta') + '</span>';
    return (
      '<div class="row" onclick="deleteIngreso(\'' + i.id + '\')">' +
        '<div class="row-icon" style="background:var(--cyan-dim); color:var(--cyan);">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 15.5c.5 1 1.5 1.5 3 1.5s2.5-.7 2.5-2c0-1.4-1.3-1.8-3-2.2-1.6-.4-2.7-.9-2.7-2.2 0-1.2 1-1.9 2.5-1.9s2.3.5 2.8 1.4M12 7.5v9"/></svg>' +
        '</div>' +
        '<div class="row-body">' +
          '<div class="row-title">' + escapeHtml(i.nombre) + '</div>' +
          '<div class="row-sub">' + i.frecuencia + ' · ' + fmtDate(i.fecha) + ' · ' + metodoHtml + '</div>' +
        '</div>' +
        '<div class="row-value" style="color:var(--cyan)">+' + money(i.monto) + '</div>' +
      '</div>'
    );
  }).join('');
}
let planMesOffset = 0; // mismo patrón que gastosMesOffset: 0 = mes actual

function cambiarMesPlan(delta) {
  const nuevo = planMesOffset + delta;
  if (nuevo > 0) return;
  planMesOffset = nuevo;
  renderPlan();
}

function renderPlan() {
  const refDate = mesOffsetToDate(planMesOffset);
  const d = state.config.distribucion;
  const ingresoBase = Number(state.config.ingresoMensualFijo) || 0;

  const gastosMes = state.gastos.filter(function (g) { return mismoMes(g.fecha, refDate); });
  const usadoNecesidades = gastosMes
    .filter(function (g) { return GRUPO_NECESIDAD.indexOf(g.categoria) !== -1; })
    .reduce(function (s, g) { return s + Number(g.monto || 0); }, 0);
  const usadoDeseos = gastosMes
    .filter(function (g) { return GRUPO_NECESIDAD.indexOf(g.categoria) === -1; })
    .reduce(function (s, g) { return s + Number(g.monto || 0); }, 0);

  const usadoInversion = state.inversiones
    .filter(function (i) { return i.creadaEn && mismoMes(i.creadaEn.slice(0, 10), refDate); })
    .reduce(function (s, i) { return s + Number(i.monto || 0); }, 0);

  const usadoFondo = (state.aportesFondo || [])
    .filter(function (a) { return mismoMes(a.fecha, refDate); })
    .reduce(function (s, a) { return s + Number(a.monto || 0); }, 0);

  const targetNec = ingresoBase * (d.necesidades / 100);
  const targetDes = ingresoBase * (d.deseos / 100);
  const targetInv = ingresoBase * (d.inversion / 100);
  const targetFondo = ingresoBase * (d.ahorro / 100);

  /* Categorías de GASTO (Necesidades/Deseos): lo ideal es no pasarte
     del tope. "Verde/neutral" mientras te alcance, rojo si te pasas. */
  function rowGasto(label, usado, target, color) {
    const pct = target > 0 ? Math.min(100, (usado / target) * 100) : 0;
    const restante = target - usado;
    return (
      '<div style="margin-bottom:18px;">' +
        '<div class="kv" style="border:none; padding:0 0 6px;">' +
          '<span class="kv-label">' + label + '</span>' +
          '<span class="kv-value" style="font-size:12px;">' + money(usado) + ' / ' + money(target) + '</span>' +
        '</div>' +
        '<div class="pbar"><div class="pbar-fill" style="width:' + pct + '%; background:' + color + '"></div></div>' +
        '<div class="hint" style="margin-top:5px;">' +
          (restante >= 0
            ? 'Te quedan ' + money(restante) + ' disponibles en esta categoría'
            : '<span style="color:var(--coral); font-weight:700;">Te pasaste por ' + money(-restante) + '</span>') +
        '</div>' +
      '</div>'
    );
  }

  /* Categorías de META (Inversión/Fondo de emergencia): es al revés,
     lo ideal es llegar o pasarte del monto. En rojo mientras no se
     cumple, en verde/cian en cuanto se completa o se supera. */
  function rowMeta(label, usado, target, color, verbo) {
    const pct = target > 0 ? Math.min(100, (usado / target) * 100) : 0;
    const diff = target - usado;
    const cumplida = diff <= 0 && target > 0;
    return (
      '<div style="margin-bottom:18px;">' +
        '<div class="kv" style="border:none; padding:0 0 6px;">' +
          '<span class="kv-label">' + label + '</span>' +
          '<span class="kv-value" style="font-size:12px;">' + money(usado) + ' / ' + money(target) + '</span>' +
        '</div>' +
        '<div class="pbar"><div class="pbar-fill" style="width:' + pct + '%; background:' + (cumplida ? 'linear-gradient(90deg,var(--cyan),#00b89a)' : color) + '"></div></div>' +
        '<div class="hint" style="margin-top:5px; font-weight:700;">' +
          (cumplida
            ? '<span style="color:var(--cyan);">¡Superaste tu meta mensual' + (diff < 0 ? ' por ' + money(-diff) : '') + '! 🎉 Felicidades</span>'
            : '<span style="color:var(--coral);">Te faltan ' + money(diff) + ' por ' + verbo + ' este mes</span>') +
        '</div>' +
      '</div>'
    );
  }

  const chev = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;">';
  const puedeAvanzar = planMesOffset < 0;
  const header =
    '<div class="kv" style="border:none; padding:0 0 18px;">' +
      '<button class="icon-btn" style="width:30px;height:30px;" onclick="cambiarMesPlan(-1)">' + chev + '<path d="m15 6-6 6 6 6"/></svg></button>' +
      '<span style="font-weight:800; font-size:14px;">' + nombreMes(refDate) + '</span>' +
      '<button class="icon-btn" style="width:30px;height:30px;' + (puedeAvanzar ? '' : ' opacity:.3; pointer-events:none;') + '" onclick="cambiarMesPlan(1)">' + chev + '<path d="m9 6 6 6-6 6"/></svg></button>' +
    '</div>';

  document.getElementById('plan-card').innerHTML = header + (ingresoBase <= 0
    ? '<div class="empty"><b>Configura tu ingreso mensual</b>Ve a Configuración → "Tu ingreso mensual fijo" para activar tu plan de distribución.</div>'
    : rowGasto('Necesidades (' + d.necesidades + '%)', usadoNecesidades, targetNec, 'linear-gradient(90deg,#5AA9FF,#00E6C3)') +
      rowGasto('Deseos (' + d.deseos + '%)', usadoDeseos, targetDes, 'linear-gradient(90deg,#FF9F5A,#FF4F70)') +
      rowMeta('Inversión (' + d.inversion + '%)', usadoInversion, targetInv, 'linear-gradient(90deg,#8B6BFF,#6a4fe0)', 'invertir') +
      rowMeta('Fondo de emergencia (' + d.ahorro + '%)', usadoFondo, targetFondo, 'linear-gradient(90deg,#8B6BFF,#6a4fe0)', 'ahorrar'));
}

/* ---------------- DEUDAS ---------------- */
function paidDebtRowHtml(d) {
  return (
    '<div class="row" style="opacity:.6" onclick="openDeudaDetalle(\'' + d.id + '\')">' +
      '<div class="row-icon" style="background:var(--cyan-dim); color:var(--cyan);">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' +
      '</div>' +
      '<div class="row-body"><div class="row-title">' + escapeHtml(d.nombre) + '</div><div class="row-sub">Liquidada</div></div>' +
      '<div class="row-value">' + money(d.montoTotal) + '</div>' +
    '</div>'
  );
}
function renderDeudas() {
  const activasList = document.getElementById('deudas-list');
  const pagadasWrap = document.getElementById('deudas-pagadas-wrap');
  const pagadasList = document.getElementById('deudas-pagadas-list');

  const activas = state.deudas.filter(function (d) { return !d.pagada; })
    .sort(function (a, b) { return new Date(a.proximoPago) - new Date(b.proximoPago); });
  const pagadas = state.deudas.filter(function (d) { return d.pagada; });

  if (!activas.length) {
    activasList.innerHTML = '<div class="empty"><b>Sin deudas activas</b>Agrega una deuda para llevar el control y recibir recordatorios.</div>';
  } else {
    activasList.innerHTML = activas.map(debtRowHtml).join('');
  }

  if (!pagadas.length) {
    pagadasWrap.hidden = true;
  } else {
    pagadasWrap.hidden = false;
    pagadasList.innerHTML = pagadas.map(paidDebtRowHtml).join('');
  }
}

/* ---------------- INVERSIÓN ---------------- */
function renderInversion() {
  const total = totalInvertido();
  let anual = 0, mensual = 0;
  state.inversiones.forEach(function (i) {
    const tasa = (i.tasa != null ? i.tasa : state.config.tasaSofipoDefault) / 100;
    anual += i.monto * tasa;
    mensual += (i.monto * tasa) / 12;
  });
  document.getElementById('inversion-summary').innerHTML =
    '<div class="hero-label" style="margin-bottom:10px;">Total invertido en SOFIPOS</div>' +
    '<div class="hero-amount">' + money(total) + '<span>MXN</span></div>' +
    '<div class="chip-row">' +
      '<div class="chip"><div class="chip-label">Rend. mensual est.</div><div class="chip-value" style="color:var(--cyan)">+' + moneyDec(mensual) + '</div></div>' +
      '<div class="chip"><div class="chip-label">Rend. anual est.</div><div class="chip-value" style="color:var(--violet)">+' + money(anual) + '</div></div>' +
    '</div>';
  const list = document.getElementById('inversion-list');
  if (!state.inversiones.length) {
    list.innerHTML = '<div class="empty"><b>Sin SOFIPOS registradas</b>Agrega tu primera inversión a la vista.</div>';
    return;
  }
  list.innerHTML = state.inversiones.map(function (i) {
    const tasa = (i.tasa != null ? i.tasa : state.config.tasaSofipoDefault);
    const rendAnual = i.monto * (tasa / 100);
    const rendMensual = rendAnual / 12;
    return (
      '<div class="row" onclick="openInversionDetalle(\'' + i.id + '\')" style="align-items:flex-start;">' +
        '<div class="row-icon" style="background:var(--violet-dim); color:var(--violet);">📈</div>' +
        '<div class="row-body">' +
          '<div class="row-title">' + escapeHtml(i.nombre) + '</div>' +
          '<div class="row-sub">Tasa anual: ' + tasa + '% · Mensual: +' + moneyDec(rendMensual) + '</div>' +
        '</div>' +
        '<div class="row-value">' + money(i.monto) + '</div>' +
      '</div>'
    );
  }).join('');
}

/* ---------------- METAS ---------------- */
function renderMetasResumen() {
  const el = document.getElementById('metas-resumen');
  if (!el) return;
  const completadas = state.metas.filter(function (m) { return Number(m.montoActual) >= Number(m.montoObjetivo); });
  const pendientes = state.metas.filter(function (m) { return Number(m.montoActual) < Number(m.montoObjetivo); });
  const ahorradoCompletadas = completadas.reduce(function (s, m) { return s + Number(m.montoActual || 0); }, 0);
  const ahorradoPendientes = pendientes.reduce(function (s, m) { return s + Number(m.montoActual || 0); }, 0);

  el.innerHTML =
    '<div class="card" style="padding:18px 20px;">' +
      '<div style="display:flex; gap:12px;">' +
        '<div style="flex:1; text-align:center; padding:14px 8px; border-radius:14px; background:rgba(0,230,195,0.08); border:1px solid rgba(0,230,195,0.22);">' +
          '<div style="font-size:26px; font-weight:800; color:var(--cyan); font-family:var(--mono);">' + completadas.length + '</div>' +
          '<div style="font-size:11px; color:var(--text-dim); font-weight:700; margin-top:2px;">Completadas</div>' +
          '<div style="font-size:10.5px; color:var(--text-faint); margin-top:4px;">' + money(ahorradoCompletadas) + ' en total</div>' +
        '</div>' +
        '<div style="flex:1; text-align:center; padding:14px 8px; border-radius:14px; background:rgba(139,107,255,0.08); border:1px solid rgba(139,107,255,0.22);">' +
          '<div style="font-size:26px; font-weight:800; color:var(--violet); font-family:var(--mono);">' + pendientes.length + '</div>' +
          '<div style="font-size:11px; color:var(--text-dim); font-weight:700; margin-top:2px;">Pendientes</div>' +
          '<div style="font-size:10.5px; color:var(--text-faint); margin-top:4px;">' + money(ahorradoPendientes) + ' ahorrado</div>' +
        '</div>' +
      '</div>' +
    '</div>';
}

function renderMetas() {
  renderMetasResumen();
  const list = document.getElementById('metas-list');
  if (!state.metas.length) {
    list.innerHTML = '<div class="empty"><b>Sin metas activas</b>Crea un plan de ahorro para lo que quieres comprar.</div>';
    return;
  }
  const sorted = state.metas.slice().sort(function (a, b) {
    const ca = Number(a.montoActual) >= Number(a.montoObjetivo) ? 1 : 0;
    const cb = Number(b.montoActual) >= Number(b.montoObjetivo) ? 1 : 0;
    return ca - cb;
  });
  list.innerHTML = sorted.map(function (m) {
    const completada = Number(m.montoActual) >= Number(m.montoObjetivo);
    const pct = Math.min(100, (m.montoActual / Math.max(1, m.montoObjetivo)) * 100);
    return (
      '<div class="card" style="padding:16px 18px;' + (completada ? ' opacity:.75;' : '') + '">' +
        '<div class="kv" style="border:none; padding:0 0 8px;">' +
          '<span style="font-weight:700; font-size:14px;">' + escapeHtml(m.nombre) + '</span>' +
          (completada
            ? '<span class="row-badge badge-ok">Completada ✓</span>'
            : '<span class="kv-value" style="font-size:12.5px;">' + money(m.montoActual) + ' / ' + money(m.montoObjetivo) + '</span>') +
        '</div>' +
        '<div class="pbar"><div class="pbar-fill" style="width:' + pct + '%; background:' + (completada ? 'var(--cyan)' : 'linear-gradient(90deg, var(--cyan), var(--violet))') + '"></div></div>' +
        '<div class="btn-row" style="margin-top:12px;">' +
          (completada ? '' : '<button class="small-btn primary" style="flex:1" onclick="openAportarMeta(\'' + m.id + '\')">Aportar</button>') +
          '<button class="small-btn" style="' + (completada ? 'flex:1' : '') + '" onclick="openMetaDetalle(\'' + m.id + '\')">Detalles</button>' +
        '</div>' +
      '</div>'
    );
  }).join('');
}

/* ---------------- APUESTAS ---------------- */
function apuestaBadge(estado) {
  if (estado === 'ganada') return '<span class="row-badge badge-ok">Ganada</span>';
  if (estado === 'perdida') return '<span class="row-badge badge-urgent">Perdida</span>';
  return '<span class="row-badge badge-soon">En juego</span>';
}
function renderApuestas() {
  const list = document.getElementById('apuestas-list');
  const chart = document.getElementById('apuestas-chart');
  const apuestas = state.apuestas || [];

  const apostado = apuestas.reduce(function (s, a) { return s + Number(a.montoApostado || 0); }, 0);
  const ganadas = apuestas.filter(function (a) { return a.estado === 'ganada'; });
  const perdidas = apuestas.filter(function (a) { return a.estado === 'perdida'; });
  const pendientes = apuestas.filter(function (a) { return a.estado === 'pendiente'; });
  const ganadoBruto = ganadas.reduce(function (s, a) { return s + Number(a.montoGanado || 0); }, 0);
  const apostadoEnGanadas = ganadas.reduce(function (s, a) { return s + Number(a.montoApostado || 0); }, 0);
  const ganadoNeto = ganadoBruto - apostadoEnGanadas;
  const perdido = perdidas.reduce(function (s, a) { return s + Number(a.montoApostado || 0); }, 0);
  const pendienteMonto = pendientes.reduce(function (s, a) { return s + Number(a.montoApostado || 0); }, 0);

  const maxBar = Math.max(apostado, Math.abs(ganadoNeto), perdido, 1);
  function bar(label, valor, color, valorTexto) {
    const pct = Math.min(100, (Math.abs(valor) / maxBar) * 100);
    return (
      '<div style="margin-bottom:14px;">' +
        '<div class="kv" style="border:none; padding:0 0 6px;">' +
          '<span class="kv-label">' + label + '</span>' +
          '<span class="kv-value" style="font-size:12.5px; color:' + color + '">' + valorTexto + '</span>' +
        '</div>' +
        '<div class="pbar"><div class="pbar-fill" style="width:' + pct + '%; background:' + color + '"></div></div>' +
      '</div>'
    );
  }

  chart.innerHTML =
    '<div class="hero-label" style="margin-bottom:14px;">Resumen de apuestas</div>' +
    bar('Dinero apostado', apostado, 'var(--violet)', money(apostado)) +
    bar('Dinero ganado (neto)', ganadoNeto, ganadoNeto >= 0 ? 'var(--cyan)' : 'var(--coral)', (ganadoNeto >= 0 ? '+' : '') + money(ganadoNeto)) +
    bar('Dinero perdido', perdido, 'var(--coral)', money(perdido)) +
    (pendientes.length
      ? '<div class="hint" style="margin-top:2px;">' + pendientes.length + ' apuesta' + (pendientes.length === 1 ? '' : 's') + ' en juego · ' + money(pendienteMonto) + ' aún sin resolver</div>'
      : '<div class="hint" style="margin-top:2px;">Sin apuestas en juego por el momento.</div>');

  if (!apuestas.length) {
    list.innerHTML = '<div class="empty"><b>Sin apuestas registradas</b>Toca el botón + para registrar tu primera apuesta.</div>';
    return;
  }
  const sorted = apuestas.slice().sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
  list.innerHTML = sorted.map(function (a) {
    let valorHtml, valorColor;
    if (a.estado === 'ganada') { valorColor = 'var(--cyan)'; valorHtml = '+' + money(a.montoGanado); }
    else if (a.estado === 'perdida') { valorColor = 'var(--coral)'; valorHtml = '-' + money(a.montoApostado); }
    else { valorColor = 'var(--text)'; valorHtml = money(a.montoApostado); }
    return (
      '<div class="row" onclick="openApuestaDetalle(\'' + a.id + '\')">' +
        '<div class="row-icon" style="background:var(--violet-dim); color:var(--violet);">' + ICON_SVG.apuestas + '</div>' +
        '<div class="row-body">' +
          '<div class="row-title">' + escapeHtml(a.descripcion) + '</div>' +
          '<div class="row-sub">Apostado: ' + money(a.montoApostado) + ' · ' + fmtDate(a.fecha) + '</div>' +
          apuestaBadge(a.estado) +
        '</div>' +
        '<div class="row-value" style="color:' + valorColor + '">' + valorHtml + '</div>' +
      '</div>'
    );
  }).join('');
}

/* ---------------- RENDER ALL ---------------- */
/* ---------------- SUPLEMENTOS ---------------- */
let supleMes = null;        // 'YYYY-MM' que muestra el calendario
let supleRango = 14;        // días de la gráfica (14 o 30)
let supleHoyAbierto = false;   // el registrador de hoy empieza plegado
let supleListaAbierta = false; // igual la lista de suplementos

function tomaDe(supId, fecha) {
  const x = (state.tomasSuplementos || []).find(function (t) { return t.suplementoId === supId && t.fecha === fecha; });
  return x ? Number(x.cantidad) || 0 : 0;
}
function unidadTxt(n, unidad) {
  if (unidad === 'g' || unidad === 'ml') return fmtNum(n) + ' ' + unidad;
  return fmtNum(n) + ' ' + unidad + (n === 1 ? '' : (unidad === 'cápsula' ? 's' : 's'));
}
function fmtNum(n) { return Number(n).toLocaleString('es-MX', { maximumFractionDigits: 1 }); }
function gramosDelDia(fecha) {
  return (state.suplementos || []).reduce(function (s, sup) {
    return sup.unidad === 'g' ? s + tomaDe(sup.id, fecha) * Number(sup.cantidadPorToma) : s;
  }, 0);
}
function fechaLarga(fecha) {
  const t = new Date(fecha + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* Filas con + / − para un día. Se usan en "Hoy" y en la ventana de un día. */
function supleFilasDia(fecha) {
  return (state.suplementos || []).map(function (s) {
    const n = tomaDe(s.id, fecha);
    const total = n * Number(s.cantidadPorToma);
    return '<div class="suple-row' + (n ? ' on' : '') + '" style="--sc:' + s.color + '">' +
      '<span class="suple-sw"></span>' +
      '<div class="suple-row-txt"><b>' + escapeHtml(s.nombre) + '</b>' +
        '<span>' + (n ? n + (n === 1 ? ' toma' : ' tomas') + ' · ' + unidadTxt(total, s.unidad) : unidadTxt(Number(s.cantidadPorToma), s.unidad) + ' por toma') + '</span></div>' +
      '<div class="stepper">' +
        '<button aria-label="Quitar una toma de ' + escapeHtml(s.nombre) + '"' + (n ? '' : ' disabled') + ' onclick="setToma(\'' + s.id + '\', \'' + fecha + '\', -1)">−</button>' +
        '<span>' + n + '</span>' +
        '<button aria-label="Agregar una toma de ' + escapeHtml(s.nombre) + '" onclick="setToma(\'' + s.id + '\', \'' + fecha + '\', 1)">+</button>' +
      '</div></div>';
  }).join('');
}

function renderSuplementos() {
  const hoyEl = document.getElementById('suple-hoy');
  if (!hoyEl) return;
  const sups = state.suplementos || [];
  const hoy = localISO();

  if (!sups.length) {
    hoyEl.innerHTML = '<div class="empty" style="padding:8px 0;"><b>Sin suplementos</b>Agrega uno con el botón +.</div>';
    ['suple-cal', 'suple-chart', 'suple-list'].forEach(function (id) { document.getElementById(id).innerHTML = ''; });
    return;
  }

  /* ---- Hoy ---- */
  const g = gramosDelDia(hoy);
  const tomadosHoy = sups.filter(function (s) { return tomaDe(s.id, hoy) > 0; }).length;
  hoyEl.innerHTML =
    '<details class="fold"' + (supleHoyAbierto ? ' open' : '') + ' ontoggle="supleHoyAbierto = this.open">' +
      '<summary>' +
        '<div class="fold-txt"><b>' + fechaLarga(hoy) + '</b>' +
          '<span class="fold-dots">' + sups.map(function (s) {
            return '<i' + (tomaDe(s.id, hoy) > 0 ? ' style="background:' + s.color + '"' : '') + ' title="' + escapeHtml(s.nombre) + '"></i>';
          }).join('') + '<em>' + tomadosHoy + ' de ' + sups.length + '</em></span></div>' +
        '<b class="fold-num">' + fmtNum(g) + ' g</b>' +
        '<svg class="fold-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>' +
      '</summary>' +
      '<div class="fold-body">' + supleFilasDia(hoy) + '</div>' +
    '</details>';

  /* ---- Calendario del mes ---- */
  if (!supleMes) supleMes = hoy.slice(0, 7);
  const y = Number(supleMes.slice(0, 4)), mo = Number(supleMes.slice(5, 7));
  const primero = new Date(y, mo - 1, 1, 12);
  const diasMes = new Date(y, mo, 0).getDate();
  const offset = (primero.getDay() + 6) % 7; // lunes = 0
  const titulo = primero.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  let celdas = '';
  for (let i = 0; i < offset; i++) celdas += '<span></span>';
  for (let d = 1; d <= diasMes; d++) {
    const f = supleMes + '-' + String(d).padStart(2, '0');
    const futuro = f > hoy;
    const tomados = sups.filter(function (s) { return tomaDe(s.id, f) > 0; });
    const etiqueta = fechaLarga(f) + ': ' + (tomados.length ? tomados.map(function (s) { return s.nombre; }).join(', ') : 'nada registrado');
    celdas += '<button class="cal-day' + (f === hoy ? ' hoy' : '') + (futuro ? ' futuro' : '') + '"' +
      (futuro ? ' disabled' : ' onclick="openDiaSuple(\'' + f + '\')"') + ' aria-label="' + escapeHtml(etiqueta) + '">' +
      '<span class="cal-num">' + d + '</span>' +
      '<span class="cal-bits">' + sups.map(function (s) {
        return '<i' + (tomaDe(s.id, f) > 0 ? ' class="on" style="background:' + s.color + '"' : '') + '></i>';
      }).join('') + '</span></button>';
  }
  const esMesActual = supleMes === hoy.slice(0, 7);
  document.getElementById('suple-cal').innerHTML =
    '<div class="cal-nav">' +
      '<button class="icon-btn" aria-label="Mes anterior" onclick="moverMesSuple(-1)">‹</button>' +
      '<b>' + titulo.charAt(0).toUpperCase() + titulo.slice(1) + '</b>' +
      '<button class="icon-btn" aria-label="Mes siguiente"' + (esMesActual ? ' disabled' : '') + ' onclick="moverMesSuple(1)">›</button>' +
    '</div>' +
    '<div class="cal-grid">' + ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(function (x) { return '<span class="cal-h">' + x + '</span>'; }).join('') + celdas + '</div>' +
    '<div class="suple-legend">' + sups.map(function (s) {
      return '<span><i style="background:' + s.color + '"></i>' + escapeHtml(s.nombre) + '</span>';
    }).join('') + '</div>' +
    '<div class="hint" style="margin-top:8px;">Toca un día para ver y editar lo que tomaste.</div>';

  renderSupleChart();

  /* ---- Lista para administrar ---- */
  document.getElementById('suple-list').innerHTML =
    '<details class="fold"' + (supleListaAbierta ? ' open' : '') + ' ontoggle="supleListaAbierta = this.open">' +
      '<summary><div class="fold-txt"><b>' + sups.length + (sups.length === 1 ? ' suplemento' : ' suplementos') + '</b>' +
        '<span class="fold-dots">' + sups.map(function (s) { return '<i style="background:' + s.color + '"></i>'; }).join('') + '<em>Editar o agregar</em></span></div>' +
        '<svg class="fold-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>' +
      '</summary><div class="fold-body">' + sups.map(function (s) {
    return '<div class="suple-row" style="--sc:' + s.color + '">' +
      '<span class="suple-sw on"></span>' +
      '<div class="suple-row-txt"><b>' + escapeHtml(s.nombre) + '</b><span>' + unidadTxt(Number(s.cantidadPorToma), s.unidad) + ' por toma</span></div>' +
      '<button class="small-btn" onclick="openEditSuplemento(\'' + s.id + '\')">Editar</button></div>';
  }).join('') +
  '<button class="small-btn primary" style="width:100%; margin-top:12px;" onclick="openAddSuplemento()">+ Agregar suplemento</button>' +
    '</div></details>';
}

/* Barras apiladas de gramos por día (solo suplementos medidos en g). */
function renderSupleChart() {
  const el = document.getElementById('suple-chart');
  const sups = (state.suplementos || []).filter(function (s) { return s.unidad === 'g'; });
  const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
  const dias = [];
  for (let i = supleRango - 1; i >= 0; i--) { const d = new Date(hoy); d.setDate(hoy.getDate() - i); dias.push(localISO(d)); }

  const datos = dias.map(function (f) {
    return { fecha: f, partes: sups.map(function (s) { return { s: s, g: tomaDe(s.id, f) * Number(s.cantidadPorToma) }; }) };
  });
  const maxG = Math.max.apply(null, datos.map(function (d) { return d.partes.reduce(function (a, p) { return a + p.g; }, 0); }));
  const totalRango = datos.reduce(function (a, d) { return a + d.partes.reduce(function (b, p) { return b + p.g; }, 0); }, 0);

  const filtros = '<div class="seg" style="margin-bottom:14px;">' + [14, 30].map(function (n) {
    return '<button class="seg-opt' + (supleRango === n ? ' active' : '') + '" onclick="rangoSuple(' + n + ')">' + n + ' días</button>';
  }).join('') + '</div>';

  if (!sups.length || maxG === 0) {
    el.innerHTML = filtros + '<div class="empty" style="padding:10px 0;"><b>Sin consumo registrado</b>Cuando marques tomas aparecerán aquí los gramos por día.</div>';
    return;
  }

  // Escala "bonita" para el eje Y.
  const paso = [5, 10, 20, 25, 50, 100, 200, 250, 500].find(function (p) { return maxG / p <= 4; }) || 1000;
  const top = Math.ceil(maxG / paso) * paso;
  const W = 340, H = 190, L = 34, R = 6, T = 10, B = 24;
  const pw = W - L - R, ph = H - T - B;
  const bw = pw / dias.length;
  const barW = Math.max(4, Math.min(18, bw * 0.62));
  const yOf = function (g) { return T + ph - (g / top) * ph; };

  let svg = '';
  for (let v = 0; v <= top; v += paso) {
    svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yOf(v) + '" y2="' + yOf(v) + '" class="ch-grid"/>' +
      '<text x="' + (L - 6) + '" y="' + (yOf(v) + 3.5) + '" class="ch-ax" text-anchor="end">' + v + '</text>';
  }
  datos.forEach(function (d, i) {
    const cx = L + bw * i + bw / 2;
    let acc = 0;
    const partes = d.partes.filter(function (p) { return p.g > 0; });
    partes.forEach(function (p, k) {
      const y1 = yOf(acc), y2 = yOf(acc + p.g);
      const h = Math.max(1, y1 - y2 - (k < partes.length - 1 ? 2 : 0)); // 2px de separación entre segmentos
      const esTope = k === partes.length - 1;
      svg += esTope
        ? '<path d="' + barraRedondeada(cx - barW / 2, y2, barW, h, Math.min(4, barW / 2)) + '" fill="' + p.s.color + '"/>'
        : '<rect x="' + (cx - barW / 2) + '" y="' + y2 + '" width="' + barW + '" height="' + h + '" fill="' + p.s.color + '"/>';
      acc += p.g;
    });
    const mostrarEtiqueta = supleRango === 14 ? (i % 2 === (dias.length - 1) % 2) : (i % 5 === (dias.length - 1) % 5);
    if (mostrarEtiqueta) svg += '<text x="' + cx + '" y="' + (H - 8) + '" class="ch-ax" text-anchor="middle">' + Number(d.fecha.slice(8, 10)) + '</text>';
    svg += '<rect x="' + (L + bw * i) + '" y="' + T + '" width="' + bw + '" height="' + ph + '" class="ch-hit" data-i="' + i + '"/>';
  });

  el.innerHTML = filtros +
    '<div class="suple-head" style="margin-bottom:6px;"><span>Total en ' + supleRango + ' días</span><b>' + fmtNum(totalRango) + ' g</b></div>' +
    '<div class="ch-wrap"><svg viewBox="0 0 ' + W + ' ' + H + '" class="ch-svg" role="img" aria-label="Gramos de suplementos por día, últimos ' + supleRango + ' días">' + svg + '</svg>' +
    '<div class="ch-tip" id="suple-tip" hidden></div></div>' +
    '<div class="suple-legend">' + sups.map(function (s) { return '<span><i style="background:' + s.color + '"></i>' + escapeHtml(s.nombre) + '</span>'; }).join('') + '</div>' +
    '<details class="ch-table"><summary>Ver como tabla</summary><table><thead><tr><th>Día</th>' +
      sups.map(function (s) { return '<th>' + escapeHtml(s.nombre) + '</th>'; }).join('') + '<th>Total</th></tr></thead><tbody>' +
      datos.slice().reverse().map(function (d) {
        const tot = d.partes.reduce(function (a, p) { return a + p.g; }, 0);
        return '<tr><td>' + fmtDate(d.fecha) + '</td>' + d.partes.map(function (p) { return '<td>' + (p.g ? fmtNum(p.g) : '—') + '</td>'; }).join('') + '<td><b>' + fmtNum(tot) + '</b></td></tr>';
      }).join('') + '</tbody></table></details>';

  // Tooltip por barra (hover en compu, toque en celular).
  const tip = document.getElementById('suple-tip');
  const wrap = el.querySelector('.ch-wrap');
  el.querySelectorAll('.ch-hit').forEach(function (r) {
    function mostrar() {
      const d = datos[Number(r.dataset.i)];
      const tot = d.partes.reduce(function (a, p) { return a + p.g; }, 0);
      tip.innerHTML = '<b>' + fechaLarga(d.fecha) + '</b>' +
        d.partes.filter(function (p) { return p.g > 0; }).map(function (p) {
          return '<div><i style="background:' + p.s.color + '"></i>' + escapeHtml(p.s.nombre) + '<span>' + fmtNum(p.g) + ' g</span></div>';
        }).join('') + '<div class="ch-tip-tot">Total<span>' + fmtNum(tot) + ' g</span></div>';
      tip.hidden = false;
      const rb = r.getBoundingClientRect(), wb = wrap.getBoundingClientRect();
      const x = rb.left + rb.width / 2 - wb.left;
      tip.style.left = Math.max(4, Math.min(wb.width - tip.offsetWidth - 4, x - tip.offsetWidth / 2)) + 'px';
      el.querySelectorAll('.ch-hit').forEach(function (o) { o.classList.toggle('sel', o === r); });
    }
    r.addEventListener('mouseenter', mostrar);
    r.addEventListener('click', mostrar);
  });
  wrap.addEventListener('mouseleave', function () { tip.hidden = true; el.querySelectorAll('.ch-hit').forEach(function (o) { o.classList.remove('sel'); }); });
}
function barraRedondeada(x, y, w, h, r) {
  r = Math.min(r, h);
  return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
    'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
}
function moverMesSuple(delta) {
  const y = Number(supleMes.slice(0, 4)), m = Number(supleMes.slice(5, 7));
  const d = new Date(y, m - 1 + delta, 1, 12);
  supleMes = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  renderSuplementos();
}
function rangoSuple(n) { supleRango = n; renderSupleChart(); }

function renderAll() {
  renderInicio();
  renderResumenMes();
  renderSuscripciones();
  renderMovimientos();
  renderDeudas();
  renderInversion();
  renderMetas();
  renderApuestas();
  renderSuplementos();
}
