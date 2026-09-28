/* ==================================================================
   BATFINANCE · Apuestas: balance real, límites y pronosticador
   ------------------------------------------------------------------
   - Resultado neto (mes / total), % recuperado de lo apostado, racha.
   - Tope mensual: barra, aviso al 80 % y confirmación si lo pasas.
   - Lo que te está costando: equivalencias con tus suscripciones y metas.
   - Qué te funciona: resultado por deporte, tipo y rango de momio.
   - Pronosticador: partidos reales de hoy (ESPN) analizados con IA.
   Recibido (montoGanado) = lo que te pagaron en total (apuesta + ganancia).
   ================================================================== */
(function () {
  const DEPORTES = ['Fútbol', 'Fútbol americano', 'Básquetbol', 'Béisbol', 'Box / MMA', 'Otro'];
  const mesDe = function (f) { return String(f).slice(0, 7); };
  const signo = function (n) { return (n >= 0 ? '+' : '−') + money(Math.abs(n)); };

  function neto(lista) {
    return lista.reduce(function (s, a) {
      if (a.estado === 'ganada') return s + Number(a.montoGanado || 0) - Number(a.montoApostado);
      if (a.estado === 'perdida') return s - Number(a.montoApostado);
      return s;
    }, 0);
  }
  function resumen() {
    const todas = state.apuestas || [];
    const resueltas = todas.filter(function (a) { return a.estado !== 'pendiente'; });
    const mes = mesDe(localISO());
    const delMes = todas.filter(function (a) { return mesDe(a.fecha) === mes; });
    const apostadoRes = resueltas.reduce(function (s, a) { return s + Number(a.montoApostado); }, 0);
    const recibido = resueltas.reduce(function (s, a) { return s + (a.estado === 'ganada' ? Number(a.montoGanado || 0) : 0); }, 0);
    // Racha: resultados iguales seguidos, del más reciente hacia atrás
    const orden = resueltas.slice().sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
    let racha = 0;
    for (let i = 0; i < orden.length && orden[i].estado === orden[0].estado; i++) racha++;
    return {
      todas: todas, resueltas: resueltas,
      netoTotal: neto(todas), netoMes: neto(delMes),
      apostadoMes: delMes.reduce(function (s, a) { return s + Number(a.montoApostado); }, 0),
      recuperado: apostadoRes ? recibido / apostadoRes : null,
      racha: racha, rachaTipo: orden.length ? orden[0].estado : null,
      ganadas: resueltas.filter(function (a) { return a.estado === 'ganada'; }).length,
      pendientes: todas.filter(function (a) { return a.estado === 'pendiente'; })
    };
  }

  /* ---------------- Resumen ---------------- */
  function htmlResumen(R) {
    const pct = R.recuperado == null ? null : Math.round(R.recuperado * 100);
    return '<div class="apu-top">' +
        '<div><span class="metas-eti">Resultado este mes</span><b class="apu-neto ' + (R.netoMes < 0 ? 'neg' : 'pos') + '">' + signo(R.netoMes) + '</b></div>' +
        '<div class="apu-total"><span class="metas-eti">Desde que registras</span><b class="' + (R.netoTotal < 0 ? 'neg' : 'pos') + '">' + signo(R.netoTotal) + '</b></div>' +
      '</div>' +
      '<div class="res-grid res-grid-3" style="margin-top:14px;">' +
        '<div class="res-tile"><span>Te regresan</span><b>' + (pct == null ? '—' : '$' + pct) + '</b><em>de cada $100</em></div>' +
        '<div class="res-tile"><span>Aciertos</span><b>' + R.ganadas + '/' + R.resueltas.length + '</b><em>' + (R.resueltas.length ? Math.round(R.ganadas / R.resueltas.length * 100) + '% ganadas' : 'sin resultados') + '</em></div>' +
        '<div class="res-tile"><span>Racha</span><b>' + (R.racha || '—') + '</b><em>' + (R.rachaTipo ? (R.rachaTipo === 'ganada' ? (R.racha === 1 ? 'ganada' : 'ganadas') : (R.racha === 1 ? 'perdida' : 'perdidas')) + ' seguidas' : 'sin resultados') + '</em></div>' +
      '</div>' +
      (R.pendientes.length ? '<div class="hint" style="margin-top:10px;">' + R.pendientes.length + ' en juego · ' + money(R.pendientes.reduce(function (s, a) { return s + Number(a.montoApostado); }, 0)) + ' sin resolver</div>' : '');
  }

  /* ---------------- Tope mensual ---------------- */
  function htmlLimite(R) {
    const tope = Number(state.config.presupuestoApuestas || 0);
    if (!tope) {
      return '<div class="card apu-limite"><div class="apu-lim-top"><div><b>Sin tope mensual</b><span class="row-sub">Ponte un límite y te aviso antes de pasarte.</span></div>' +
        '<button class="small-btn primary" onclick="editarTopeApuestas()">Poner tope</button></div></div>';
    }
    const uso = R.apostadoMes / tope;
    const cls = uso >= 1 ? 'mal' : uso >= 0.8 ? 'warn' : 'ok';
    const msg = uso >= 1 ? 'Ya pasaste tu tope por ' + money(R.apostadoMes - tope) + '.'
      : uso >= 0.8 ? 'Cuidado: llevas el ' + Math.round(uso * 100) + '% de tu tope. Te quedan ' + money(tope - R.apostadoMes) + '.'
      : 'Te quedan ' + money(tope - R.apostadoMes) + ' este mes.';
    return '<div class="card apu-limite ' + cls + '"><div class="apu-lim-top"><div><b>Tope del mes</b><span class="row-sub">' + money(R.apostadoMes) + ' de ' + money(tope) + ' apostados</span></div>' +
      '<button class="small-btn" onclick="editarTopeApuestas()">Cambiar</button></div>' +
      '<div class="metas-barra apu-barra"><i style="width:' + Math.min(100, uso * 100) + '%"></i></div>' +
      '<div class="apu-lim-msg">' + msg + '</div></div>';
  }
  window.editarTopeApuestas = function () {
    const actual = Number(state.config.presupuestoApuestas || 0);
    const R = resumen();
    const promedio = promedioMensual();
    const mo = openModal('<div class="sheet-title">Tope mensual para apuestas</div>' +
      '<div class="field"><label>Máximo que apuestas al mes (MXN)</label><input type="number" id="apu-tope" inputmode="decimal" min="0" value="' + (actual || '') + '" placeholder="0 = sin tope"></div>' +
      '<div class="hint" style="margin-top:0;">' + (promedio ? 'Hasta ahora apuestas en promedio ' + money(promedio) + ' al mes. ' : '') + 'Este mes llevas ' + money(R.apostadoMes) + '. Al llegar al 80 % te aviso, y si lo pasas te pido confirmar cada apuesta.</div>' +
      '<button class="btn-primary" id="apu-tope-save" style="margin-top:14px;">Guardar tope</button>');
    document.getElementById('apu-tope-save').addEventListener('click', function () {
      const monto = parseFloat(document.getElementById('apu-tope').value) || 0;
      withLoading(this, async function () {
        await apiFetch('/apuestas/presupuesto', { method: 'PUT', body: JSON.stringify({ monto: monto }) });
        await refresh(); mo.close(); toast(monto ? 'Tope guardado' : 'Tope quitado');
      });
    });
  };
  function promedioMensual() {
    const t = state.apuestas || [];
    if (!t.length) return 0;
    const meses = {};
    t.forEach(function (a) { meses[mesDe(a.fecha)] = (meses[mesDe(a.fecha)] || 0) + Number(a.montoApostado); });
    const k = Object.keys(meses);
    return k.reduce(function (s, m) { return s + meses[m]; }, 0) / k.length;
  }

  /* ---------------- Lo que te está costando ---------------- */
  function htmlCosto() {
    const anio = localISO().slice(0, 4);
    const perdidaAnio = -neto((state.apuestas || []).filter(function (a) { return String(a.fecha).slice(0, 4) === anio; }));
    if (perdidaAnio <= 0) return '';
    const porMes = { semanal: 52 / 12, quincenal: 2, mensual: 1, anual: 1 / 12 };
    const eq = [];
    (state.suscripciones || []).filter(function (s) { return s.activa; }).slice(0, 3).forEach(function (s) {
      const mensual = Number(s.monto) * (porMes[s.frecuencia] || 1);
      if (mensual > 0) eq.push((perdidaAnio / mensual).toFixed(1).replace('.0', '') + ' meses de ' + escapeHtml(s.nombre));
    });
    const meta = (state.metas || []).find(function (m) { return Number(m.montoActual) < Number(m.montoObjetivo); });
    if (meta) {
      const pct = Math.min(100, Math.round(perdidaAnio / Number(meta.montoObjetivo) * 100));
      eq.unshift(pct >= 100 ? 'tu meta <b>' + escapeHtml(meta.nombre) + '</b> completa' : 'el <b>' + pct + '%</b> de tu meta ' + escapeHtml(meta.nombre));
    }
    return '<div class="section-title">Lo que te está costando</div><div class="card apu-costo">' +
      '<div>En ' + anio + ' llevas <b class="neg">' + money(perdidaAnio) + '</b> perdidos en apuestas. Eso equivale a:</div>' +
      '<ul>' + eq.map(function (e) { return '<li>' + e + '</li>'; }).join('') + '</ul></div>';
  }

  /* ---------------- Qué te funciona ---------------- */
  function htmlAnalisis(R) {
    const res = R.resueltas;
    if (res.length < 2) return '';
    function grupo(nombre, clave) {
      const g = {};
      res.forEach(function (a) { const k = clave(a); if (!k) return; (g[k] = g[k] || []).push(a); });
      const filas = Object.keys(g).map(function (k) { return { k: k, n: g[k].length, neto: neto(g[k]), gan: g[k].filter(function (a) { return a.estado === 'ganada'; }).length }; })
        .sort(function (a, b) { return b.neto - a.neto; });
      if (!filas.length) return '';
      return '<div class="apu-grupo"><span class="metas-eti">' + nombre + '</span>' + filas.map(function (f) {
        return '<div class="apu-fila"><span>' + escapeHtml(f.k) + ' <em>' + f.gan + '/' + f.n + '</em></span><b class="' + (f.neto < 0 ? 'neg' : 'pos') + '">' + signo(f.neto) + '</b></div>';
      }).join('') + '</div>';
    }
    const cuerpo =
      grupo('Por deporte', function (a) { return a.deporte || 'Sin deporte'; }) +
      grupo('Por tipo', function (a) { return a.tipo === 'parlay' ? 'Parlay' : 'Sencilla'; }) +
      grupo('Por momio', function (a) { const c = Number(a.cuota); if (!c) return null; return c < 1.8 ? 'Favorito (menos de 1.80)' : c <= 2.5 ? 'Parejo (1.80 a 2.50)' : 'Sorpresa (más de 2.50)'; });
    return '<div class="section-title">Qué te funciona</div><div class="card">' + cuerpo +
      '<div class="hint" style="margin-bottom:0;">Registra deporte, tipo y momio en cada apuesta para que este análisis sea más preciso.</div></div>';
  }

  /* ---------------- Pronosticador ---------------- */
  let pronos = null, cargando = false, errorPronos = '';
  function cargarPronos(forzar) {
    if (cargando) return;
    cargando = true; errorPronos = ''; pintarPronos();
    apiFetch('/apuestas/pronosticos' + (forzar ? '?forzar=1' : ''))
      .then(function (d) { pronos = d; })
      .catch(function (e) { errorPronos = e.message || 'No pude traer los partidos.'; })
      .then(function () { cargando = false; pintarPronos(); });
  }
  window.actualizarPronosticos = function () { cargarPronos(true); };

  function horaMX(iso) { return new Date(iso).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' }); }
  function nombreDia(f) {
    const d = daysUntil(f);
    if (d === 0) return 'Hoy';
    if (d === 1) return 'Mañana';
    return new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' });
  }
  function pintarPronos() {
    const el = document.getElementById('apuestas-pronos'); if (!el) return;
    let cuerpo;
    if (cargando && !pronos) cuerpo = '<div class="ia-cargando" style="padding:18px 0;"><span class="ia-spin"></span>Buscando partidos y analizando…</div>';
    else if (errorPronos && !pronos) cuerpo = '<div class="hint" style="color:var(--coral);">' + escapeHtml(errorPronos) + '</div>';
    else if (!pronos) cuerpo = '';
    else if (!pronos.partidos.length) cuerpo = '<div class="empty" style="padding:16px 0;"><b>Sin partidos cercanos</b>No hay partidos de fútbol hoy ni en los próximos 3 días en las ligas que sigo.</div>';
    else {
      let dia = '';
      cuerpo = pronos.partidos.map(function (p) {
        const pr = p.pronostico;
        const cab = p.dia !== dia ? '<div class="pr-dia">' + nombreDia(p.dia) + '</div>' : '';
        dia = p.dia;
        const pickEsLocal = pr && pr.pick === p.local, pickEsVisita = pr && pr.pick === p.visita;
        return cab + '<div class="pr-partido">' +
          '<div class="pr-meta"><span>' + escapeHtml(p.liga) + '</span><span>' + (p.estado === 'in' ? '<b class="pr-vivo">En vivo</b>' : horaMX(p.fecha)) + '</span></div>' +
          '<div class="pr-equipos">' +
            '<div class="' + (pickEsVisita ? 'pick' : '') + '">' + escapeHtml(p.visita) + (p.recVisita ? ' <em>' + escapeHtml(p.recVisita) + '</em>' : '') + '</div>' +
            '<div class="pr-vs">en</div>' +
            '<div class="' + (pickEsLocal ? 'pick' : '') + '">' + escapeHtml(p.local) + (p.recLocal ? ' <em>' + escapeHtml(p.recLocal) + '</em>' : '') + '</div>' +
          '</div>' +
          (pr ? '<div class="pr-pick"><span>Pronóstico: <b>' + escapeHtml(pr.pick) + '</b>' + (pr.marcador ? ' · ' + escapeHtml(pr.marcador) : '') + '</span>' +
              '<span class="pr-conf" title="Confianza"><i style="width:' + pr.confianza + '%"></i></span><small>' + pr.confianza + '%</small></div>' +
              '<div class="pr-razon">' + escapeHtml(pr.razon) + (p.momio ? ' <span class="pr-momio">Momio: ' + escapeHtml(p.momio) + '</span>' : '') + '</div>'
            : '<div class="pr-razon">Sin análisis por ahora' + (p.momio ? ' · Momio: ' + escapeHtml(p.momio) : '') + '</div>') +
        '</div>';
      }).join('');
    }
    el.innerHTML = '<div class="section-title pr-titulo"><span>Partidos de fútbol</span>' +
        (pronos ? '<button class="link-btn" onclick="actualizarPronosticos()">' + (cargando ? 'Actualizando…' : 'Actualizar') + '</button>' : '') + '</div>' +
      '<div class="card pr-card">' + cuerpo +
        '<div class="hint pr-aviso">Pronósticos hechos con IA a partir de récords y momios reales. Son solo informativos y no se mezclan con tus apuestas ni tu dinero. Ningún resultado es seguro.</div>' +
      '</div>';
  }
  window.apostarEn = function (id) {
    const p = pronos && pronos.partidos.find(function (x) { return x.id === id; }); if (!p) return;
    openAddApuesta({
      descripcion: p.visita + ' vs ' + p.local + (p.pronostico ? ' · ' + p.pronostico.pick : ''),
      deporte: p.deporte, fecha: p.dia
    });
  };

  /* ---------------- Nueva apuesta (con deporte, tipo, momio y tope) ---------------- */
  window.openAddApuesta = function (pre) {
    pre = pre || {};
    const m = openModal(
      '<div class="sheet-title">Nueva apuesta</div>' +
      '<div class="field"><label>¿En qué apostaste?</label><input type="text" id="ap2-desc" placeholder="Ej. América gana" value="' + escapeHtml(pre.descripcion || '') + '"></div>' +
      '<div class="field-row">' +
        '<div class="field"><label>Monto (MXN)</label><input type="number" id="ap2-monto" inputmode="decimal" placeholder="0"></div>' +
        '<div class="field"><label>Momio decimal</label><input type="number" id="ap2-cuota" inputmode="decimal" step="0.01" min="1" placeholder="Ej. 1.85"></div>' +
      '</div>' +
      '<div class="field"><label>Deporte</label><select id="ap2-deporte">' + DEPORTES.map(function (d) { return '<option' + (pre.deporte === d ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>Tipo</label><div class="seg" id="ap2-tipo"><button class="seg-opt active" data-v="sencilla">Sencilla</button><button class="seg-opt" data-v="parlay">Parlay</button></div></div>' +
      '<div class="field" style="margin-bottom:0;"><label>Fecha</label><input type="date" id="ap2-fecha" value="' + (pre.fecha || todayISO()) + '"></div>' +
      '<div id="ap2-aviso" class="apu-lim-msg"></div>' +
      '<button class="btn-primary" id="ap2-save" style="margin-top:14px;">Guardar apuesta</button>' +
      '<div class="hint">Se descuenta de inmediato de tu saldo de tarjeta / dinero electrónico.</div>'
    );
    m.overlay.querySelectorAll('#ap2-tipo .seg-opt').forEach(function (b) {
      b.addEventListener('click', function () { m.overlay.querySelectorAll('#ap2-tipo .seg-opt').forEach(function (x) { x.classList.toggle('active', x === b); }); });
    });
    const tope = Number(state.config.presupuestoApuestas || 0);
    const llevas = resumen().apostadoMes;
    function aviso() {
      const monto = parseFloat(document.getElementById('ap2-monto').value) || 0;
      const cuota = parseFloat(document.getElementById('ap2-cuota').value) || 0;
      const el = document.getElementById('ap2-aviso');
      let t = cuota > 1 && monto ? 'Si ganas te pagan ' + money(monto * cuota) + ' (ganancia ' + money(monto * (cuota - 1)) + ').' : '';
      if (tope && monto) {
        const despues = llevas + monto;
        if (despues > tope) t += (t ? ' ' : '') + '<b class="neg">Con esta apuesta te pasas de tu tope por ' + money(despues - tope) + '.</b>';
        else if (despues >= tope * 0.8) t += (t ? ' ' : '') + '<span style="color:var(--amber)">Llegarías al ' + Math.round(despues / tope * 100) + '% de tu tope.</span>';
      }
      el.innerHTML = t;
    }
    ['ap2-monto', 'ap2-cuota'].forEach(function (id) { document.getElementById(id).addEventListener('input', aviso); });
    document.getElementById('ap2-save').addEventListener('click', function () {
      const desc = document.getElementById('ap2-desc').value.trim();
      const monto = parseFloat(document.getElementById('ap2-monto').value);
      const cuota = parseFloat(document.getElementById('ap2-cuota').value) || null;
      if (!desc || isNaN(monto) || monto <= 0) { toast('Completa la descripción y el monto'); return; }
      if (tope && llevas + monto > tope &&
          !confirm('Con esta apuesta te pasas de tu tope del mes (' + money(tope) + ') por ' + money(llevas + monto - tope) + '. ¿Seguro que quieres registrarla?')) return;
      const act = m.overlay.querySelector('#ap2-tipo .active');
      withLoading(this, async function () {
        await apiFetch('/apuestas', { method: 'POST', body: JSON.stringify({
          descripcion: desc, montoApostado: monto, fecha: document.getElementById('ap2-fecha').value || todayISO(),
          cuota: cuota, tipo: act ? act.dataset.v : 'sencilla', deporte: document.getElementById('ap2-deporte').value
        }) });
        await refresh(); m.close(); toast('Apuesta registrada');
      });
    });
  };

  /* ---------------- Enganche ---------------- */
  const renderPrevio = window.renderApuestas;
  window.renderApuestas = function () {
    renderPrevio(); // conserva el historial
    const R = resumen();
    document.getElementById('apuestas-chart').innerHTML = htmlResumen(R);
    document.getElementById('apuestas-limite').innerHTML = htmlLimite(R);
    document.getElementById('apuestas-costo').innerHTML = htmlCosto();
    document.getElementById('apuestas-analisis').innerHTML = htmlAnalisis(R);
    // Detalle en cada fila del historial: deporte · tipo · momio
    (state.apuestas || []).forEach(function (a) {
      const fila = document.querySelector('#apuestas-list .row[onclick*="' + a.id + '"] .row-sub');
      if (fila && (a.deporte || a.cuota)) fila.textContent += ' · ' + [a.deporte, a.tipo === 'parlay' ? 'Parlay' : null, a.cuota ? '@' + a.cuota : null].filter(Boolean).join(' · ');
    });
    if (pestana === 'pronos') abrirPronos();
  };

  /* ---------------- Pestañas: Mis apuestas / Pronósticos ---------------- */
  let pestana = 'mis';
  try { pestana = localStorage.getItem('apu-tab') || 'mis'; } catch (e) {}
  function abrirPronos() { if (!pronos && !cargando && !errorPronos) cargarPronos(false); else pintarPronos(); }
  function cambiarPestana(v) {
    pestana = v;
    try { localStorage.setItem('apu-tab', v); } catch (e) {}
    document.querySelectorAll('#apu-tabs .seg-opt').forEach(function (b) { b.classList.toggle('active', b.dataset.v === v); b.setAttribute('aria-selected', b.dataset.v === v); });
    document.getElementById('apu-panel-mis').hidden = v !== 'mis';
    document.getElementById('apu-panel-pronos').hidden = v !== 'pronos';
    if (v === 'pronos') abrirPronos();
  }
  document.querySelectorAll('#apu-tabs .seg-opt').forEach(function (b) { b.addEventListener('click', function () { cambiarPestana(b.dataset.v); }); });
  cambiarPestana(pestana);
  window.renderApuestas.resumen = resumen;
})();
