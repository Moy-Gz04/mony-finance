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
  return state.metas.reduce(function (s, m) { return s + Number(m.montoActual || 0); }, 0);
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
  } else {
    document.getElementById('rating-big').textContent = '—.—';
    document.getElementById('rating-count').textContent = 'Sin compras evaluadas aún';
    renderStars(homeStars, 0, 21);
  }

  const list = document.getElementById('home-debts-list');
  const header = document.getElementById('home-debts-header');
  const pend = state.deudas.filter(function (d) { return !d.pagada; })
    .sort(function (a, b) { return new Date(a.proximoPago) - new Date(b.proximoPago); })
    .slice(0, 3);
  const collapsed = !!state.config.pagosPendientesColapsado;
  header.innerHTML =
    '<div class="section-title section-title-toggle" onclick="toggleHomePagos()">' +
      '<span>Próximos pagos' + (pend.length ? ' · ' + pend.length : '') + '</span>' +
      '<svg class="chev ' + (collapsed ? 'closed' : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>' +
    '</div>';
  list.hidden = collapsed;
  if (!pend.length) {
    list.innerHTML = '<div class="empty"><b>Sin pagos pendientes</b>Registra una deuda para activar los recordatorios.</div>';
  } else {
    list.innerHTML = pend.map(debtRowHtml).join('');
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
    '<div class="hint">' + money(fe.actual) + ' acumulados · ' + pct.toFixed(0) + '% de tu meta</div>' +
    '<div class="btn-row" style="margin-top:14px;">' +
      '<button class="small-btn primary" style="flex:1" onclick="openAportarFondo()">Aportar al fondo</button>' +
    '</div>';
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

/* ---------------- MOVIMIENTOS ---------------- */
function renderMovimientos() {
  renderGastosList();
  renderIngresosList();
  renderPlan();
}
function renderGastosList() {
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
function renderPlan() {
  const totalIng = state.ingresos.reduce(function (s, i) { return s + Number(i.monto || 0); }, 0);
  const d = state.config.distribucion;
  const gastosPorGrupo = { necesidades: 0, deseos: 0 };
  state.gastos.forEach(function (g) {
    if (GRUPO_NECESIDAD.indexOf(g.categoria) !== -1) gastosPorGrupo.necesidades += Number(g.monto || 0);
    else gastosPorGrupo.deseos += Number(g.monto || 0);
  });
  const targetNec = totalIng * (d.necesidades / 100);
  const targetDes = totalIng * (d.deseos / 100);
  const targetAho = totalIng * (d.ahorro / 100);
  const ahorroReal = totalMetas() + state.fondoEmergencia.actual;

  function rowPlan(label, real, target, color) {
    const pct = target > 0 ? Math.min(100, (real / target) * 100) : 0;
    return (
      '<div style="margin-bottom:16px;">' +
        '<div class="kv" style="border:none; padding:0 0 6px;">' +
          '<span class="kv-label">' + label + '</span>' +
          '<span class="kv-value" style="font-size:12px;">' + money(real) + ' / ' + money(target) + '</span>' +
        '</div>' +
        '<div class="pbar"><div class="pbar-fill" style="width:' + pct + '%; background:' + color + '"></div></div>' +
      '</div>'
    );
  }
  document.getElementById('plan-card').innerHTML = totalIng <= 0
    ? '<div class="empty"><b>Registra tus ingresos</b>Así podremos calcular tu plan de distribución 50/30/20 (o el que configures).</div>'
    : rowPlan('Necesidades (' + d.necesidades + '%)', gastosPorGrupo.necesidades, targetNec, 'linear-gradient(90deg,#5AA9FF,#00E6C3)') +
      rowPlan('Deseos (' + d.deseos + '%)', gastosPorGrupo.deseos, targetDes, 'linear-gradient(90deg,#FF9F5A,#FF4F70)') +
      rowPlan('Ahorro / inversión (' + d.ahorro + '%)', ahorroReal, targetAho, 'linear-gradient(90deg,#8B6BFF,#00E6C3)');
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
function renderMetas() {
  const list = document.getElementById('metas-list');
  if (!state.metas.length) {
    list.innerHTML = '<div class="empty"><b>Sin metas activas</b>Crea un plan de ahorro para lo que quieres comprar.</div>';
    return;
  }
  list.innerHTML = state.metas.map(function (m) {
    const pct = Math.min(100, (m.montoActual / Math.max(1, m.montoObjetivo)) * 100);
    return (
      '<div class="card" style="padding:16px 18px;">' +
        '<div class="kv" style="border:none; padding:0 0 8px;">' +
          '<span style="font-weight:700; font-size:14px;">' + escapeHtml(m.nombre) + '</span>' +
          '<span class="kv-value" style="font-size:12.5px;">' + money(m.montoActual) + ' / ' + money(m.montoObjetivo) + '</span>' +
        '</div>' +
        '<div class="pbar"><div class="pbar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="btn-row" style="margin-top:12px;">' +
          '<button class="small-btn primary" style="flex:1" onclick="openAportarMeta(\'' + m.id + '\')">Aportar</button>' +
          '<button class="small-btn" onclick="openMetaDetalle(\'' + m.id + '\')">Detalles</button>' +
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
function renderAll() {
  renderInicio();
  renderMovimientos();
  renderDeudas();
  renderInversion();
  renderMetas();
  renderApuestas();
}
