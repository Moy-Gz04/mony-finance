/* ==================================================================
   BATFINANCE · Metas con plan y fecha
   ------------------------------------------------------------------
   Todo se calcula con los datos reales del sistema:
   - Capacidad de ahorro mensual = ingresos − gastos − suscripciones −
     cuotas de deuda (promedios de tu historial real).
   - Plan por meta: cuánto apartar por quincena para llegar a la fecha;
     si no tiene fecha, se reparte tu capacidad por prioridad y se
     propone una fecha realista.
   - Estado: En camino / Atrasada / Adelantada contra dónde deberías ir.
   - Proyección: a tu ritmo real de aportes, cuándo llegarías.
   - Coach con IA: diagnóstico y ajustes a tus gastos reales.
   Reemplaza renderMetas / openAddMeta / openMetaDetalle de antes.
   ================================================================== */
(function () {
  const PESO = { alta: 3, media: 2, baja: 1 };
  const NOMBRE_PRIO = { alta: 'Alta', media: 'Media', baja: 'Baja' };
  const $m = function (n) { return money(n); };
  const hoy = function () { return localISO(); };
  function diasEntre(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); }
  function masDias(fecha, n) { const d = new Date(fecha + 'T12:00:00'); d.setDate(d.getDate() + Math.round(n)); return localISO(d); }
  function fechaLarga(f) { return new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }); }

  /* ---------------- Capacidad de ahorro real ---------------- */
  function capacidad() {
    const h = hoy();
    // Días de historial disponibles (mín. 30, máx. 90) para promediar sin sesgo
    const fechas = state.ingresos.concat(state.gastos).map(function (x) { return String(x.fecha).slice(0, 10); }).sort();
    const dias = fechas.length ? Math.min(90, Math.max(30, diasEntre(fechas[0], h) + 1)) : 30;
    const desde = masDias(h, -dias);
    const enRango = function (x) { const f = String(x.fecha).slice(0, 10); return f > desde && f <= h; };

    const ingresosReal = state.ingresos.filter(function (x) { return enRango(x) && !/registro de saldo/i.test(x.nombre); }).reduce(function (s, x) { return s + Number(x.monto); }, 0) * 30 / dias;
    const porMes = { semanal: 52 / 12, quincenal: 2, mensual: 1, anual: 1 / 12 };
    const recurrentes = (state.recurrentes || []).filter(function (r) { return r.activo; })
      .reduce(function (s, r) { return s + Number(r.monto) * (porMes[r.frecuencia] || 1); }, 0);
    // Base declarada: ingresos automáticos o, si no hay, el ingreso fijo de Ajustes.
    // Con poco historial el promedio real sale bajo, así que la base manda.
    const fijo = Number(state.config.ingresoMensualFijo) || 0;
    const base = recurrentes || fijo;
    let ingreso = Math.max(ingresosReal, base);

    // Gastos sin suscripciones (esas se cuentan aparte, completas)
    const gastos = state.gastos.filter(function (g) { return enRango(g) && String(g.descripcion).indexOf('Suscripción:') !== 0; })
      .reduce(function (s, g) { return s + Number(g.monto); }, 0) * 30 / dias;
    const subs = (state.suscripciones || []).filter(function (s) { return s.activa; })
      .reduce(function (s, x) { return s + Number(x.monto) * (porMes[x.frecuencia] || 1); }, 0);
    const deudas = state.deudas.filter(function (d) { return !d.pagada; }).reduce(function (s, d) {
      if (d.tipo === 'mensual') return s + Number(d.montoCuota);
      if (d.tipo === 'quincenal') return s + Number(d.montoCuota) * 2;
      return s + (daysUntil(d.proximoPago) <= 30 ? Number(d.montoCuota) : 0);
    }, 0);
    return { ingreso: ingreso, gastos: gastos, subs: subs, deudas: deudas, total: ingreso - gastos - subs - deudas, dias: dias, origen: ingreso === ingresosReal ? '' : recurrentes ? ' (automáticos)' : ' (ingreso fijo de Ajustes)' };
  }

  /* ---------------- Plan de cada meta ---------------- */
  function planes() {
    const cap = capacidad();
    const activas = state.metas.filter(function (m) { return Number(m.montoActual) < Number(m.montoObjetivo); });
    const conFecha = activas.filter(function (m) { return m.fechaObjetivo; });
    const sinFecha = activas.filter(function (m) { return !m.fechaObjetivo; });
    const h = hoy();
    const res = {};
    let comprometido = 0;

    conFecha.forEach(function (m) {
      const falta = Number(m.montoObjetivo) - Number(m.montoActual);
      const diasRest = Math.max(1, diasEntre(h, m.fechaObjetivo));
      const quincenas = Math.max(1, Math.ceil(diasRest / 15));
      const cuotaQ = falta / quincenas;
      comprometido += cuotaQ * 2;
      res[m.id] = { cuotaQuincena: cuotaQ, cuotaMensual: cuotaQ * 2, quincenas: quincenas, fecha: m.fechaObjetivo, vencida: diasEntre(h, m.fechaObjetivo) < 0 };
    });
    // Lo que sobra de la capacidad se reparte entre las metas sin fecha, por prioridad
    const libre = Math.max(0, cap.total - comprometido);
    const pesos = sinFecha.reduce(function (s, m) { return s + (PESO[m.prioridad] || 2); }, 0);
    sinFecha.forEach(function (m) {
      const falta = Number(m.montoObjetivo) - Number(m.montoActual);
      // Solo la mitad de lo libre (lo demás queda de colchón) y nunca más de lo que falta
      const mensual = pesos ? Math.min(falta, libre * 0.5 * (PESO[m.prioridad] || 2) / pesos) : 0;
      res[m.id] = mensual > 0
        ? { cuotaQuincena: Math.min(falta, mensual / 2), cuotaMensual: mensual, sugerida: masDias(h, Math.max(15, falta / mensual * 30)), sinFecha: true }
        : { cuotaQuincena: 0, cuotaMensual: 0, sinFecha: true, sinCapacidad: true };
      comprometido += mensual;
    });

    // Estado y proyección con los aportes reales
    state.metas.forEach(function (m) {
      const p = res[m.id] || (res[m.id] = {});
      const objetivo = Number(m.montoObjetivo), actual = Number(m.montoActual);
      p.falta = Math.max(0, objetivo - actual);
      p.pct = Math.min(1, actual / Math.max(1, objetivo));
      if (actual >= objetivo) { p.estado = 'completada'; return; }
      // Ritmo real: aportes de los últimos 60 días
      const inicio = m.creadaEn || h;
      const ventana = Math.max(7, Math.min(60, diasEntre(inicio, h) + 1));
      const desde = masDias(h, -ventana);
      const aportado = (state.aportesMetas || []).filter(function (a) { return a.metaId === m.id && a.fecha > desde; })
        .reduce(function (s, a) { return s + Number(a.monto); }, 0);
      p.ritmoMensual = aportado * 30 / ventana;
      p.proyeccion = p.ritmoMensual > 0 ? masDias(h, p.falta / (p.ritmoMensual / 30)) : null;
      if (m.fechaObjetivo) {
        const total = Math.max(1, diasEntre(inicio, m.fechaObjetivo));
        const pasado = Math.min(total, Math.max(0, diasEntre(inicio, h)));
        p.esperado = objetivo * pasado / total;
        p.pctEsperado = Math.min(1, pasado / total);
        if (p.vencida) p.estado = 'vencida';
        else if (pasado < 3 || actual >= p.esperado * 0.9 - 1) p.estado = actual > p.esperado * 1.1 + 1 && pasado >= 3 ? 'adelantada' : 'encamino';
        else p.estado = 'atrasada';
        // ¿Cabe en tu capacidad?
        p.viabilidad = cap.total <= 0 ? 'nocabe' : p.cuotaMensual > cap.total ? 'nocabe' : p.cuotaMensual > cap.total * 0.6 ? 'justo' : 'comodo';
      } else {
        p.estado = 'sinfecha';
      }
    });
    return { cap: cap, planes: res, comprometido: comprometido };
  }
  window.planesMetas = planes;

  const ESTADO = {
    encamino: { txt: 'En camino', cls: 'ok' }, adelantada: { txt: 'Adelantada', cls: 'ok' },
    atrasada: { txt: 'Atrasada', cls: 'mal' }, vencida: { txt: 'Fecha vencida', cls: 'mal' },
    sinfecha: { txt: 'Sin fecha', cls: '' }, completada: { txt: 'Completada ✓', cls: 'ok' }
  };
  const VIABLE = { comodo: 'Cómodo para tu capacidad', justo: 'Justo: usa buena parte de tu capacidad', nocabe: 'No alcanza con tu capacidad actual' };

  /* ---------------- Vista Metas ---------------- */
  function renderMetasNueva() {
    const cont = document.getElementById('metas-list');
    const res = document.getElementById('metas-resumen');
    if (!cont || !res) return;
    const P = planes(), cap = P.cap;
    const libre = cap.total - P.comprometido;
    const pctComp = cap.total > 0 ? Math.min(1, P.comprometido / cap.total) : 1;

    res.innerHTML = '<div class="card metas-cap">' +
      '<div class="metas-cap-top"><div><span class="metas-eti">Tu capacidad de ahorro</span>' +
        '<b class="metas-cap-num ' + (cap.total < 0 ? 'neg' : '') + '">' + (cap.total < 0 ? '−' : '') + $m(Math.abs(cap.total)) + '<small>/mes</small></b></div>' +
        '<button class="small-btn" onclick="explicarCapacidad()">¿De dónde sale?</button></div>' +
      '<div class="metas-barra"><i style="width:' + (pctComp * 100) + '%"></i></div>' +
      '<div class="metas-cap-pie"><span>Comprometido en metas <b>' + $m(P.comprometido) + '</b></span><span>Libre <b class="' + (libre < 0 ? 'neg' : 'pos') + '">' + (libre < 0 ? '−' : '') + $m(Math.abs(libre)) + '</b></span></div>' +
      (cap.total <= 0 ? '<div class="hint" style="margin-top:10px; color:var(--amber);">Con tus números actuales no te sobra dinero al mes. Revisa gastos o suscripciones, o pídele consejo al coach en cualquier meta.</div>' : '') +
    '</div>' + quincenaHtml(P);

    if (!state.metas.length) {
      cont.innerHTML = '<div class="empty"><b>Sin metas todavía</b>Crea tu primera meta con el botón + y te armo el plan para lograrla.</div>';
      return;
    }
    const orden = state.metas.slice().sort(function (a, b) {
      const ca = P.planes[a.id].estado === 'completada', cb = P.planes[b.id].estado === 'completada';
      if (ca !== cb) return ca ? 1 : -1;
      return (PESO[b.prioridad] || 2) - (PESO[a.prioridad] || 2);
    });
    cont.innerHTML = orden.map(function (m) { return tarjetaMeta(m, P.planes[m.id]); }).join('');
  }

  function quincenaHtml(P) {
    const pend = state.metas.filter(function (m) { const p = P.planes[m.id]; return p && p.estado !== 'completada' && p.cuotaQuincena > 0; });
    if (!pend.length) return '';
    const total = pend.reduce(function (s, m) { return s + P.planes[m.id].cuotaQuincena; }, 0);
    return '<div class="section-title">Esta quincena te toca apartar</div><div class="card metas-quincena">' +
      pend.map(function (m) {
        const q = Math.ceil(P.planes[m.id].cuotaQuincena);
        return '<div class="mq-fila"><span>' + escapeHtml(m.nombre) + '</span><b>' + $m(q) + '</b>' +
          '<button class="small-btn primary" onclick="aportarMetaCon(\'' + m.id + '\', ' + q + ')">Apartar</button></div>';
      }).join('') +
      '<div class="mq-total"><span>Total</span><b>' + $m(Math.ceil(total)) + '</b></div></div>';
  }

  function tarjetaMeta(m, p) {
    const e = ESTADO[p.estado] || ESTADO.sinfecha;
    const completada = p.estado === 'completada';
    let plan = '';
    if (completada) plan = '¡Lo lograste! Ya puedes usar este dinero para ' + escapeHtml(m.nombre) + '.';
    else if (m.fechaObjetivo) plan = p.vencida ? 'La fecha ya pasó. Faltan ' + $m(p.falta) + '; ponle una fecha nueva.'
      : 'Para el <b>' + fechaLarga(m.fechaObjetivo) + '</b>: aparta <b>' + $m(Math.ceil(p.cuotaQuincena)) + ' por quincena</b>.';
    else if (p.sinCapacidad) plan = 'Hoy no te sobra dinero para esta meta. Ponle fecha o pide consejo.';
    else plan = 'Apartando <b>' + $m(Math.ceil(p.cuotaQuincena)) + ' por quincena</b> llegas el <b>' + fechaLarga(p.sugerida) + '</b>.';
    const ritmo = completada ? '' : p.proyeccion
      ? 'A tu ritmo real (' + $m(p.ritmoMensual) + '/mes) llegas el ' + fechaLarga(p.proyeccion) + '.'
      : 'Aún no hay aportes recientes para medir tu ritmo.';
    return '<div class="card meta-card' + (completada ? ' completa' : '') + '">' +
      '<div class="meta-top"><b>' + escapeHtml(m.nombre) + '</b>' +
        '<span class="chip-prio p-' + (m.prioridad || 'media') + '">' + NOMBRE_PRIO[m.prioridad || 'media'] + '</span>' +
        '<span class="chip-estado ' + e.cls + '">' + e.txt + '</span></div>' +
      '<div class="meta-nums"><span>' + $m(m.montoActual) + ' <em>de ' + $m(m.montoObjetivo) + '</em></span><span>' + Math.round(p.pct * 100) + '%</span></div>' +
      '<div class="meta-barra"><i style="width:' + (p.pct * 100) + '%"></i>' +
        (p.pctEsperado != null && !completada ? '<u style="left:' + (p.pctEsperado * 100) + '%" title="Donde deberías ir"></u>' : '') + '</div>' +
      '<div class="meta-plan">' + plan + '</div>' +
      (ritmo ? '<div class="meta-ritmo">' + ritmo + (p.viabilidad ? ' · <span class="v-' + p.viabilidad + '">' + VIABLE[p.viabilidad] + '</span>' : '') + '</div>' : '') +
      '<div class="btn-row" style="margin-top:12px;">' +
        (completada ? '' : '<button class="small-btn primary" style="flex:1" onclick="aportarMetaCon(\'' + m.id + '\', ' + (Math.ceil(p.cuotaQuincena) || 0) + ')">Aportar</button>') +
        '<button class="small-btn" style="flex:1" onclick="openMetaDetalle(\'' + m.id + '\')">Plan y consejo</button>' +
      '</div></div>';
  }

  window.explicarCapacidad = function () {
    const c = capacidad();
    openModal('<div class="sheet-title">Tu capacidad de ahorro</div>' +
      '<div class="hint" style="margin:0 0 12px;">Promedio mensual con tus datos reales de los últimos ' + c.dias + ' días.</div>' +
      '<div class="kv"><span class="kv-label">Ingresos' + c.origen + '</span><span class="kv-value" style="color:var(--cyan)">+' + $m(c.ingreso) + '</span></div>' +
      '<div class="kv"><span class="kv-label">Gastos</span><span class="kv-value">−' + $m(c.gastos) + '</span></div>' +
      '<div class="kv"><span class="kv-label">Suscripciones</span><span class="kv-value">−' + $m(c.subs) + '</span></div>' +
      '<div class="kv"><span class="kv-label">Cuotas de deuda</span><span class="kv-value">−' + $m(c.deudas) + '</span></div>' +
      '<div class="kv"><span class="kv-label"><b>Te sobra al mes</b></span><span class="kv-value" style="color:' + (c.total < 0 ? 'var(--coral)' : 'var(--cyan)') + '"><b>' + (c.total < 0 ? '−' : '') + $m(Math.abs(c.total)) + '</b></span></div>' +
      '<div class="hint">Mientras más movimientos registres, más preciso es el plan. Si registras tus ingresos automáticos (quincena), se usan como base.</div>');
  };

  window.aportarMetaCon = function (id, monto) {
    openAportarMeta(id);
    setTimeout(function () { const i = document.getElementById('ap-monto'); if (i && monto) i.value = monto; }, 50);
  };

  /* ---------------- Crear / editar ---------------- */
  function formMeta(m) {
    m = m || { nombre: '', montoObjetivo: '', montoActual: '', fechaObjetivo: '', prioridad: 'media' };
    return '<div class="field"><label>¿Qué quieres lograr?</label><input type="text" id="mt-nombre" placeholder="Ej. Laptop nueva" value="' + escapeHtml(m.nombre) + '"></div>' +
      '<div class="field"><label>¿Cuánto cuesta? (MXN)</label><input type="number" id="mt-monto" inputmode="decimal" min="0" placeholder="0" value="' + (m.montoObjetivo === '' ? '' : Number(m.montoObjetivo)) + '"></div>' +
      (m.id ? '' : '<div class="field"><label>¿Ya tienes algo ahorrado?</label><input type="number" id="mt-actual" inputmode="decimal" min="0" placeholder="0"></div>') +
      '<div class="field"><label>¿Para cuándo? (opcional)</label><input type="date" id="mt-fecha" value="' + (m.fechaObjetivo || '') + '"></div>' +
      '<div class="field" style="margin-bottom:0;"><label>Prioridad</label><div class="seg" id="mt-prio">' +
        ['alta', 'media', 'baja'].map(function (p) { return '<button class="seg-opt' + ((m.prioridad || 'media') === p ? ' active' : '') + '" data-v="' + p + '">' + NOMBRE_PRIO[p] + '</button>'; }).join('') +
      '</div></div>' +
      '<div class="mt-preview" id="mt-preview"></div>';
  }
  function leerMeta(mo) {
    const act = mo.overlay.querySelector('#mt-prio .active');
    const a = document.getElementById('mt-actual');
    return { nombre: document.getElementById('mt-nombre').value.trim(), montoObjetivo: parseFloat(document.getElementById('mt-monto').value),
      montoActual: a ? (parseFloat(a.value) || 0) : 0, fechaObjetivo: document.getElementById('mt-fecha').value || null, prioridad: act ? act.dataset.v : 'media' };
  }
  function vistaPrevia(mo, idActual) {
    const d = leerMeta(mo), el = document.getElementById('mt-preview');
    if (!(d.montoObjetivo > 0)) { el.innerHTML = ''; return; }
    const existente = idActual ? state.metas.find(function (x) { return x.id === idActual; }) : null;
    const actual = existente ? Number(existente.montoActual) : d.montoActual;
    const falta = Math.max(0, d.montoObjetivo - actual);
    const P = planes();
    const libre = P.cap.total - P.comprometido + (idActual && P.planes[idActual] ? (P.planes[idActual].cuotaMensual || 0) : 0);
    let html;
    if (d.fechaObjetivo) {
      const q = Math.max(1, Math.ceil(Math.max(1, diasEntre(hoy(), d.fechaObjetivo)) / 15));
      const cuota = falta / q;
      const v = libre <= 0 || cuota * 2 > libre ? 'nocabe' : cuota * 2 > libre * 0.6 ? 'justo' : 'comodo';
      html = 'Necesitas apartar <b>' + $m(Math.ceil(cuota)) + ' por quincena</b> (' + q + (q === 1 ? ' quincena' : ' quincenas') + '). ' +
        '<span class="v-' + v + '">' + VIABLE[v] + '</span> (te quedan libres ' + $m(Math.max(0, libre)) + '/mes).';
    } else {
      html = 'Sin fecha: la app reparte lo que te sobra entre tus metas según prioridad.';
    }
    // Fecha realista sugerida con la mitad de lo libre
    if (libre > 0 && falta > 0) {
      const sug = masDias(hoy(), falta / (libre * 0.5) * 30);
      html += '<button class="link-btn" style="display:block; margin-top:8px;" onclick="document.getElementById(\'mt-fecha\').value=\'' + sug + '\'; document.getElementById(\'mt-fecha\').dispatchEvent(new Event(\'input\'))">Usar fecha realista: ' + fechaLarga(sug) + '</button>';
    }
    el.innerHTML = html;
  }
  function activarForm(mo, idActual) {
    mo.overlay.querySelectorAll('#mt-prio .seg-opt').forEach(function (b) {
      b.addEventListener('click', function () { mo.overlay.querySelectorAll('#mt-prio .seg-opt').forEach(function (x) { x.classList.toggle('active', x === b); }); vistaPrevia(mo, idActual); });
    });
    ['mt-monto', 'mt-actual', 'mt-fecha'].forEach(function (id) {
      const i = document.getElementById(id); if (i) { i.addEventListener('input', function () { vistaPrevia(mo, idActual); }); i.addEventListener('change', function () { vistaPrevia(mo, idActual); }); }
    });
    vistaPrevia(mo, idActual);
  }

  window.openAddMeta = function () {
    const mo = openModal('<div class="sheet-title">Nueva meta</div>' + formMeta() + '<button class="btn-primary" id="mt-save" style="margin-top:18px;">Crear meta</button>');
    activarForm(mo);
    document.getElementById('mt-save').addEventListener('click', function () {
      const d = leerMeta(mo);
      if (!d.nombre || !(d.montoObjetivo > 0)) { toast('Completa nombre y costo'); return; }
      withLoading(this, async function () {
        await apiFetch('/metas', { method: 'POST', body: JSON.stringify(d) });
        await refresh(); mo.close(); toast('Meta creada 🎯');
      });
    });
  };

  function editarMeta(id) {
    const meta = state.metas.find(function (x) { return x.id === id; }); if (!meta) return;
    const mo = openModal('<div class="sheet-title">Editar meta</div>' + formMeta(meta) + '<button class="btn-primary" id="mt-save" style="margin-top:18px;">Guardar</button>');
    activarForm(mo, id);
    document.getElementById('mt-save').addEventListener('click', function () {
      const d = leerMeta(mo);
      if (!d.nombre || !(d.montoObjetivo > 0)) { toast('Completa nombre y costo'); return; }
      withLoading(this, async function () {
        await apiFetch('/metas/' + id, { method: 'PUT', body: JSON.stringify(d) });
        await refresh(); mo.close(); toast('Meta actualizada');
      });
    });
  }
  window.editarMeta = editarMeta;

  /* ---------------- Detalle: plan, gráfica y coach ---------------- */
  function graficaMeta(m, p) {
    const aportes = (state.aportesMetas || []).filter(function (a) { return a.metaId === m.id; });
    const inicio = m.creadaEn || hoy();
    const fin = m.fechaObjetivo || p.sugerida || p.proyeccion || masDias(hoy(), 30);
    const total = Math.max(1, diasEntre(inicio, fin));
    const W = 340, H = 150, L = 40, R = 8, T = 10, B = 22;
    const obj = Number(m.montoObjetivo);
    const x = function (f) { return L + Math.min(1, Math.max(0, diasEntre(inicio, f) / total)) * (W - L - R); };
    const y = function (v) { return T + (1 - Math.min(1, v / obj)) * (H - T - B); };
    // Real acumulado: lo que ya había al crear + aportes
    const aportado = aportes.reduce(function (s, a) { return s + Number(a.monto); }, 0);
    let acc = Math.max(0, Number(m.montoActual) - aportado);
    let real = 'M' + x(inicio) + ',' + y(acc);
    aportes.forEach(function (a) { real += 'L' + x(a.fecha) + ',' + y(acc); acc += Number(a.monto); real += 'L' + x(a.fecha) + ',' + y(acc); });
    real += 'L' + x(hoy()) + ',' + y(acc);
    const ideal = 'M' + x(inicio) + ',' + y(Math.max(0, Number(m.montoActual) - aportado)) + 'L' + x(fin) + ',' + y(obj);
    return '<div class="ch-wrap"><svg viewBox="0 0 ' + W + ' ' + H + '" class="ch-svg" role="img" aria-label="Avance real contra el plan">' +
      [0, 0.5, 1].map(function (k) { return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(obj * k) + '" y2="' + y(obj * k) + '" class="ch-grid"/><text x="' + (L - 6) + '" y="' + (y(obj * k) + 3.5) + '" class="ch-ax" text-anchor="end">' + (obj * k >= 1000 ? (obj * k / 1000).toFixed(1) + 'k' : Math.round(obj * k)) + '</text>'; }).join('') +
      '<path d="' + ideal + '" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" stroke-dasharray="4 4"/>' +
      '<path d="' + real + '" fill="none" stroke="#E8B04B" stroke-width="2.2" stroke-linejoin="round"/>' +
      '<circle cx="' + x(hoy()) + '" cy="' + y(acc) + '" r="4" fill="#E8B04B" stroke="#050608" stroke-width="2"/>' +
      '<text x="' + L + '" y="' + (H - 6) + '" class="ch-ax">' + fmtDate(inicio) + '</text><text x="' + (W - R) + '" y="' + (H - 6) + '" class="ch-ax" text-anchor="end">' + fmtDate(fin) + '</text>' +
      '</svg></div><div class="meta-leyenda"><span><i style="background:#E8B04B"></i>Lo que llevas</span><span><i class="punteado"></i>El plan</span></div>';
  }

  window.openMetaDetalle = function (id) {
    const meta = state.metas.find(function (x) { return x.id === id; }); if (!meta) return;
    const P = planes(), p = P.planes[id];
    const e = ESTADO[p.estado] || ESTADO.sinfecha;
    const mo = openModal(
      '<div class="sheet-title">' + escapeHtml(meta.nombre) + ' <span class="chip-estado ' + e.cls + '">' + e.txt + '</span></div>' +
      '<div class="res-grid res-grid-3" style="margin-bottom:12px;">' +
        '<div class="res-tile"><span>Llevas</span><b>' + $m(meta.montoActual) + '</b><em>' + Math.round(p.pct * 100) + '%</em></div>' +
        '<div class="res-tile"><span>Falta</span><b>' + $m(p.falta) + '</b><em>de ' + $m(meta.montoObjetivo) + '</em></div>' +
        '<div class="res-tile"><span>Por quincena</span><b>' + (p.cuotaQuincena ? $m(Math.ceil(p.cuotaQuincena)) : '—') + '</b><em>' + (meta.fechaObjetivo ? 'para el ' + fmtDate(meta.fechaObjetivo) : p.sugerida ? 'llegas ' + fmtDate(p.sugerida) : 'sin plan') + '</em></div>' +
      '</div>' +
      (p.estado === 'completada' ? '' : graficaMeta(meta, p)) +
      (p.proyeccion ? '<div class="hint">A tu ritmo real de ' + $m(p.ritmoMensual) + '/mes llegarías el <b>' + fechaLarga(p.proyeccion) + '</b>.</div>' : '') +
      (p.estado === 'completada' ? '' : '<div class="section-title" style="margin:20px 0 10px;">Coach</div><div id="mt-consejo" class="mt-consejo"></div>') +
      '<div class="btn-row" style="margin-top:16px;">' +
        '<button class="btn-ghost" id="mt-editar" style="flex:1;">Editar</button>' +
        '<button class="btn-ghost btn-danger" id="mt-del" style="flex:1;">Eliminar</button></div>'
    );
    document.getElementById('mt-editar').addEventListener('click', function () { mo.close(); setTimeout(function () { editarMeta(id); }, 200); });
    document.getElementById('mt-del').addEventListener('click', function () {
      if (!confirm('¿Eliminar la meta ' + meta.nombre + '?')) return;
      withLoading(this, async function () { await apiFetch('/metas/' + id, { method: 'DELETE' }); await refresh(); mo.close(); toast('Meta eliminada'); });
    });
    if (p.estado !== 'completada') pintarConsejo(meta, p, P);
  };

  function pintarConsejo(meta, p, P, forzar) {
    const el = document.getElementById('mt-consejo'); if (!el) return;
    const guardado = meta.consejo && meta.consejoFecha === hoy() && !forzar ? meta.consejo : null;
    // Se pide solo si está atrasada/vencida (o si lo pides tú)
    if (!guardado && !forzar && !['atrasada', 'vencida'].includes(p.estado)) {
      el.innerHTML = '<div class="hint" style="margin:0 0 10px;">Te analizo tus gastos reales y te digo cómo llegar más rápido.</div>' +
        '<button class="small-btn primary" style="width:100%; padding:12px;" id="mt-pedir">✦ Pedir consejo al coach</button>';
      document.getElementById('mt-pedir').addEventListener('click', function () { pintarConsejo(meta, p, P, true); });
      return;
    }
    if (guardado) { el.innerHTML = consejoHtml(guardado); return; }
    el.innerHTML = '<div class="ia-cargando" style="padding:18px 0;"><span class="ia-spin"></span>Revisando tus números…</div>';
    const e = ESTADO[p.estado] || ESTADO.sinfecha;
    const resumenPlan = meta.fechaObjetivo
      ? 'apartar ' + $m(Math.ceil(p.cuotaQuincena)) + ' por quincena durante ' + p.quincenas + ' quincenas para llegar el ' + meta.fechaObjetivo
      : (p.sugerida ? 'sin fecha; con lo que le sobra llegaría el ' + p.sugerida : 'sin fecha y sin capacidad de ahorro');
    apiFetch('/metas/' + meta.id + '/consejo', { method: 'POST', body: JSON.stringify({
      forzar: !!forzar, resumenPlan: resumenPlan,
      estado: e.txt + (p.esperado != null ? ' (debería llevar ' + $m(p.esperado) + ')' : '') + (p.ritmoMensual ? '; ritmo real ' + $m(p.ritmoMensual) + '/mes' : '; sin aportes recientes'),
      capacidad: P.cap.total, comprometido: P.comprometido
    }) }).then(function (c) {
      meta.consejo = c; meta.consejoFecha = hoy();
      el.innerHTML = consejoHtml(c);
    }).catch(function (err) {
      el.innerHTML = '<div class="hint" style="color:var(--coral);">' + escapeHtml(err.message || 'No respondió el coach') + '</div>';
    });
  }
  function consejoHtml(c) {
    return '<p class="asesor-resumen" style="margin:0 0 10px;">' + escapeHtml(c.diagnostico) + '</p>' +
      (c.ajustes && c.ajustes.length ? '<div class="mt-ajustes">' + c.ajustes.map(function (a) {
        return '<div class="mt-ajuste"><span>' + escapeHtml(a.accion) + '</span>' + (a.ahorroMensual ? '<b>+' + money(a.ahorroMensual) + '/mes</b>' : '') + '</div>';
      }).join('') + '</div>' : '') +
      (c.reto ? '<div class="asesor-bloque"><span>Reto de la semana</span>' + escapeHtml(c.reto) + '</div>' : '') +
      (c.fechaConAjustes && c.fechaConAjustes > hoy() ? '<div class="hint">Con estos ajustes llegarías el <b>' + fechaLarga(c.fechaConAjustes) + '</b>.</div>' : '');
  }

  /* ---------------- Aviso en Inicio al llegar un ingreso ---------------- */
  function renderAvisoQuincena() {
    const el = document.getElementById('home-metas-aviso'); if (!el) return;
    const reciente = state.ingresos.filter(function (i) { return daysUntil(String(i.fecha).slice(0, 10)) >= -2 && daysUntil(String(i.fecha).slice(0, 10)) <= 0; })
      .sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; })[0];
    let visto = null; try { visto = localStorage.getItem('aviso-metas'); } catch (e) {}
    if (!reciente || visto === reciente.id) { el.innerHTML = ''; return; }
    const P = planes();
    const pend = state.metas.filter(function (m) { const p = P.planes[m.id]; return p && p.estado !== 'completada' && p.cuotaQuincena > 0; });
    if (!pend.length) { el.innerHTML = ''; return; }
    const total = Math.ceil(pend.reduce(function (s, m) { return s + P.planes[m.id].cuotaQuincena; }, 0));
    el.innerHTML = '<div class="aviso-auto ok"><span class="aviso-ico">🎯</span>' +
      '<div class="aviso-txt">Llegó <b>' + escapeHtml(reciente.nombre) + '</b>. Toca apartar <b>' + $m(total) + '</b> para tus metas.' +
      '<small>' + pend.map(function (m) { return escapeHtml(m.nombre) + ' ' + $m(Math.ceil(P.planes[m.id].cuotaQuincena)); }).join(' · ') + '</small></div>' +
      '<button class="small-btn primary" onclick="irAMetas(\'' + reciente.id + '\')">Apartar</button>' +
      '<button class="aviso-x" aria-label="Ocultar" onclick="ocultarAvisoMetas(\'' + reciente.id + '\')">✕</button></div>';
  }
  window.irAMetas = function (id) { window.ocultarAvisoMetas(id); showView('metas'); };
  window.ocultarAvisoMetas = function (id) { try { localStorage.setItem('aviso-metas', id); } catch (e) {} const el = document.getElementById('home-metas-aviso'); if (el) el.innerHTML = ''; };

  /* ---------------- Enganche ---------------- */
  window.renderMetas = function () { renderMetasNueva(); };
  window.renderMetasResumen = function () {};
  const renderAllPrevio = window.renderAll;
  window.renderAll = function () { renderAllPrevio(); renderAvisoQuincena(); };
})();
