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
    '<div class="hint">' + money(fe.actual) + ' acumulados · ' + pct.toFixed(0) + '% de tu meta' +
      (fe.actual < target ? ' · faltan ' + money(target - fe.actual) : ' · ¡meta cumplida! 🎉') +
    '</div>' +
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

  const ingresoMes = state.ingresos
    .filter(function (i) { return mismoMes(i.fecha, refDate); })
    .reduce(function (s, i) { return s + Number(i.monto || 0); }, 0);

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

  const targetNec = ingresoMes * (d.necesidades / 100);
  const targetDes = ingresoMes * (d.deseos / 100);
  const targetInv = ingresoMes * (d.inversion / 100);
  const targetFondo = ingresoMes * (d.ahorro / 100);

  function rowPlan(label, usado, target, color) {
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

  const chev = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;">';
  const puedeAvanzar = planMesOffset < 0;
  const header =
    '<div class="kv" style="border:none; padding:0 0 18px;">' +
      '<button class="icon-btn" style="width:30px;height:30px;" onclick="cambiarMesPlan(-1)">' + chev + '<path d="m15 6-6 6 6 6"/></svg></button>' +
      '<span style="font-weight:800; font-size:14px;">' + nombreMes(refDate) + '</span>' +
      '<button class="icon-btn" style="width:30px;height:30px;' + (puedeAvanzar ? '' : ' opacity:.3; pointer-events:none;') + '" onclick="cambiarMesPlan(1)">' + chev + '<path d="m9 6 6 6-6 6"/></svg></button>' +
    '</div>';

  document.getElementById('plan-card').innerHTML = header + (ingresoMes <= 0
    ? '<div class="empty"><b>Sin ingresos registrados este mes</b>Registra tu ingreso del mes para calcular tu plan de distribución.</div>'
    : rowPlan('Necesidades (' + d.necesidades + '%)', usadoNecesidades, targetNec, 'linear-gradient(90deg,#5AA9FF,#00E6C3)') +
      rowPlan('Deseos (' + d.deseos + '%)', usadoDeseos, targetDes, 'linear-gradient(90deg,#FF9F5A,#FF4F70)') +
      rowPlan('Inversión (' + d.inversion + '%)', usadoInversion, targetInv, 'linear-gradient(90deg,#8B6BFF,#6a4fe0)') +
      rowPlan('Fondo de emergencia (' + d.ahorro + '%)', usadoFondo, targetFondo, 'linear-gradient(90deg,#00E6C3,#00b89a)'));
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
function renderAll() {
  renderInicio();
  renderMovimientos();
  renderDeudas();
  renderInversion();
  renderMetas();
  renderApuestas();
}
