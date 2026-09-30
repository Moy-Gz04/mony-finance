/* ==================================================================
   BATFINANCE · Tarjetas de crédito (Operación → Tarjetas)
   ------------------------------------------------------------------
   Cada tarjeta guarda límite y lo usado; disponible = límite − usado.
   - Compra: sube lo usado (no toca tu saldo, es crédito).
   - Pago: baja lo usado y sale de tu efectivo o tarjeta de débito.
   ================================================================== */
(function () {
  function porId(id) { return (state.tarjetas || []).find(function (t) { return t.id === id; }); }

  function renderTarjetas() {
    const el = document.getElementById('tarjetas-list'); if (!el) return;
    const ts = state.tarjetas || [];
    const lim = ts.reduce(function (s, t) { return s + t.limite; }, 0);
    const usado = ts.reduce(function (s, t) { return s + t.usado; }, 0);
    const resumen = ts.length > 1 ? '<div class="card tc-total"><span>Crédito total disponible</span><b>' + moneyDec(lim - usado) + '</b><small>de ' + money(lim) + ' · debes ' + moneyDec(usado) + '</small></div>' : '';
    el.innerHTML = resumen + (ts.length ? ts.map(function (t) {
      const pct = t.limite ? Math.min(100, t.usado / t.limite * 100) : 0;
      const nivel = pct >= 80 ? 'alto' : pct >= 30 ? 'medio' : 'bajo';
      const dias = [t.diaCorte ? 'Corte día ' + t.diaCorte : '', t.diaPago ? 'Pago día ' + t.diaPago : ''].filter(Boolean).join(' · ');
      return '<div class="tc-card">' +
        '<div class="tc-top"><span class="tc-chip"></span><span class="tc-nombre">' + escapeHtml(t.nombre) + '</span></div>' +
        '<div class="tc-disp"><small>Disponible</small><b>' + moneyDec(t.disponible) + '</b></div>' +
        '<div class="tc-bar ' + nivel + '"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
        '<div class="tc-datos"><span>Usado <b>' + moneyDec(t.usado) + '</b> (' + Math.round(pct) + '%)</span><span>Límite <b>' + money(t.limite) + '</b></span></div>' +
        (dias ? '<div class="tc-dias">' + dias + '</div>' : '') +
        '<div class="tc-acciones">' +
          '<button class="small-btn" data-tc="compra" data-id="' + t.id + '">Compra</button>' +
          '<button class="small-btn primary" data-tc="pago" data-id="' + t.id + '"' + (t.usado > 0 ? '' : ' disabled') + '>Pagar</button>' +
          '<button class="small-btn" data-tc="editar" data-id="' + t.id + '">Editar</button>' +
        '</div></div>';
    }).join('') : '<div class="empty"><b>Sin tarjetas de crédito</b>Agrega una para seguir tu límite y lo disponible.</div>') +
      (ts.length ? '<button class="btn-primary tc-analizar" style="margin-top:14px;" data-tc="analisis">✦ Analizar mis créditos</button>' : '') +
      '<button class="btn-ghost" style="margin-top:10px; width:100%;" data-tc="nueva">Agregar tarjeta</button>';
  }

  document.addEventListener('click', function (e) {
    const b = e.target.closest('[data-tc]'); if (!b) return;
    const acc = { nueva: nueva, editar: editar, compra: compra, pago: pago, analisis: analisis }[b.dataset.tc];
    if (acc) acc(b.dataset.id);
  });

  function form(t) {
    t = t || { nombre: '', limite: '', disponible: '', diaCorte: '', diaPago: '' };
    return '<div class="field"><label>Nombre</label><input type="text" id="tc-nombre" placeholder="Ej. Plata Card" value="' + escapeHtml(t.nombre) + '"></div>' +
      '<div class="field"><label>Límite de crédito (MXN)</label><input type="number" id="tc-limite" inputmode="decimal" min="0" step="0.01" value="' + t.limite + '"></div>' +
      '<div class="field"><label>Disponible hoy (MXN)</label><input type="number" id="tc-disp" inputmode="decimal" min="0" step="0.01" placeholder="Igual al límite si no debes nada" value="' + t.disponible + '"></div>' +
      '<div class="tc-dos"><div class="field"><label>Día de corte</label><input type="number" id="tc-corte" min="1" max="31" placeholder="Opcional" value="' + (t.diaCorte || '') + '"></div>' +
      '<div class="field"><label>Día de pago</label><input type="number" id="tc-pago" min="1" max="31" placeholder="Opcional" value="' + (t.diaPago || '') + '"></div></div>';
  }
  function leer() {
    return {
      nombre: document.getElementById('tc-nombre').value.trim(),
      limite: Number(document.getElementById('tc-limite').value),
      disponible: document.getElementById('tc-disp').value,
      diaCorte: document.getElementById('tc-corte').value,
      diaPago: document.getElementById('tc-pago').value
    };
  }

  function nueva() {
    const mo = openModal('<div class="sheet-title">Nueva tarjeta de crédito</div>' + form() + '<button class="btn-primary" id="tc-save" style="margin-top:18px;">Agregar</button>');
    document.getElementById('tc-save').addEventListener('click', function () {
      const d = leer(); if (!d.nombre || !(d.limite > 0)) { toast('Completa nombre y límite'); return; }
      withLoading(this, async function () {
        await apiFetch('/tarjetas', { method: 'POST', body: JSON.stringify(d) });
        await refresh(); mo.close(); toast('Tarjeta agregada');
      });
    });
  }

  function editar(id) {
    const t = porId(id); if (!t) return;
    const mo = openModal('<div class="sheet-title">Editar ' + escapeHtml(t.nombre) + '</div>' + form(t) +
      '<button class="btn-primary" id="tc-save" style="margin-top:18px;">Guardar</button>' +
      '<button class="btn-ghost" id="tc-del" style="margin-top:10px; width:100%;">Eliminar tarjeta</button>');
    document.getElementById('tc-save').addEventListener('click', function () {
      const d = leer(); if (!d.nombre || !(d.limite > 0) || d.disponible === '') { toast('Completa nombre, límite y disponible'); return; }
      withLoading(this, async function () {
        await apiFetch('/tarjetas/' + id, { method: 'PUT', body: JSON.stringify(d) });
        await refresh(); mo.close(); toast('Tarjeta actualizada');
      });
    });
    document.getElementById('tc-del').addEventListener('click', function () {
      if (!confirm('¿Eliminar ' + t.nombre + '?')) return;
      withLoading(this, async function () {
        await apiFetch('/tarjetas/' + id, { method: 'DELETE' });
        await refresh(); mo.close(); toast('Tarjeta eliminada');
      });
    });
  }

  function compra(id) {
    const t = porId(id); if (!t) return;
    const mo = openModal('<div class="sheet-title">Compra con ' + escapeHtml(t.nombre) + '</div>' +
      '<div class="hint" style="margin-bottom:12px;">Disponible: <b>' + moneyDec(t.disponible) + '</b>. No sale de tu saldo: se suma a lo que debes en la tarjeta.</div>' +
      '<div class="field"><label>Monto (MXN)</label><input type="number" id="tc-monto" inputmode="decimal" min="0" step="0.01"></div>' +
      '<button class="btn-primary" id="tc-ok" style="margin-top:12px;">Registrar compra</button>');
    document.getElementById('tc-ok').addEventListener('click', function () {
      const monto = Number(document.getElementById('tc-monto').value);
      if (!(monto > 0)) { toast('Escribe el monto'); return; }
      if (monto > t.disponible) { toast('Rebasa lo disponible'); return; }
      withLoading(this, async function () {
        await apiFetch('/tarjetas/' + id + '/compra', { method: 'POST', body: JSON.stringify({ monto: monto }) });
        await refresh(); mo.close(); toast('Compra registrada');
      });
    });
  }

  function pago(id) {
    const t = porId(id); if (!t) return;
    let metodo = 'electronico';
    const mo = openModal('<div class="sheet-title">Pagar ' + escapeHtml(t.nombre) + '</div>' +
      '<div class="hint" style="margin-bottom:12px;">Debes <b>' + moneyDec(t.usado) + '</b>. El pago sale de tu saldo.</div>' +
      '<div class="field"><label>Monto (MXN)</label><input type="number" id="tc-monto" inputmode="decimal" min="0" step="0.01" value="' + t.usado.toFixed(2) + '"></div>' +
      '<div class="field"><label>¿De dónde sale?</label><div class="seg" id="tc-metodo">' +
        '<button class="seg-opt" data-m="efectivo">Efectivo</button>' +
        '<button class="seg-opt active" data-m="electronico">Tarjeta / electrónico</button></div></div>' +
      '<button class="btn-primary" id="tc-ok" style="margin-top:12px;">Registrar pago</button>');
    mo.overlay.querySelectorAll('#tc-metodo .seg-opt').forEach(function (b) {
      b.addEventListener('click', function () {
        metodo = b.dataset.m;
        mo.overlay.querySelectorAll('#tc-metodo .seg-opt').forEach(function (x) { x.classList.toggle('active', x === b); });
      });
    });
    document.getElementById('tc-ok').addEventListener('click', function () {
      const monto = Number(document.getElementById('tc-monto').value);
      if (!(monto > 0)) { toast('Escribe el monto'); return; }
      withLoading(this, async function () {
        await apiFetch('/tarjetas/' + id + '/pago', { method: 'POST', body: JSON.stringify({ monto: monto, metodo: metodo }) });
        await refresh(); mo.close(); toast('Pago registrado');
      });
    });
  }

  /* Análisis con IA: uso de crédito, cuánto pagar ya y qué hacer */
  async function analisis() {
    const mo = openModal('<div class="sheet-title">Análisis de tus créditos</div><div id="tc-an" class="hint">Analizando tus tarjetas con tus números reales…</div>');
    try {
      const r = await apiFetch('/tarjetas/analisis', { method: 'POST' });
      const etiqueta = { sano: 'Sano', cuidado: 'Cuidado', riesgo: 'En riesgo' }[r.estado] || r.estado;
      document.getElementById('tc-an').outerHTML =
        '<div class="tc-an-estado ' + r.estado + '">' + etiqueta + ' · ' + r.uso + '% de uso</div>' +
        '<div class="tc-an-titulo">' + escapeHtml(r.titulo) + '</div>' +
        '<p class="tc-an-diag">' + escapeHtml(r.diagnostico) + '</p>' +
        '<div class="kv"><span class="kv-label">Debes en crédito</span><span class="kv-value">' + moneyDec(r.usado) + ' de ' + money(r.limite) + '</span></div>' +
        '<div class="kv"><span class="kv-label">Tu dinero real</span><span class="kv-value">' + moneyDec(r.dinero) + '</span></div>' +
        '<div class="kv"><span class="kv-label">Pago sugerido hoy</span><span class="kv-value">' + moneyDec(r.pagoSugerido) + '</span></div>' +
        '<ul class="tc-an-acc">' + (r.acciones || []).map(function (a) { return '<li>' + escapeHtml(a) + '</li>'; }).join('') + '</ul>' +
        ((state.tarjetas || []).length === 1 && r.pagoSugerido > 0 ? '<button class="btn-primary" id="tc-an-pagar" style="margin-top:12px;">Pagar ' + moneyDec(r.pagoSugerido) + ' ahora</button>' : '');
      const b = document.getElementById('tc-an-pagar');
      if (b) b.addEventListener('click', function () {
        mo.close(); pago(state.tarjetas[0].id);
        setTimeout(function () { const i = document.getElementById('tc-monto'); if (i) i.value = r.pagoSugerido.toFixed(2); }, 50);
      });
    } catch (err) {
      const el = document.getElementById('tc-an'); if (el) el.textContent = err.message || 'No se pudo analizar';
    }
  }

  /* En Pagos: cada tarjeta con saldo por pagar, con su fecha límite */
  function renderPagosTarjetas() {
    const wrap = document.getElementById('pagos-tarjetas-wrap'); if (!wrap) return;
    const ts = (state.tarjetas || []).filter(function (t) { return t.usado > 0; });
    wrap.hidden = !ts.length;
    document.getElementById('pagos-tarjetas-list').innerHTML = ts.map(function (t) {
      let sub = 'Usado ' + Math.round(t.usado / t.limite * 100) + '% de ' + money(t.limite), badge = '';
      if (t.diaPago) {
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        const f = new Date(hoy.getFullYear(), hoy.getMonth(), Math.min(t.diaPago, 28));
        if (f < hoy) f.setMonth(f.getMonth() + 1);
        const dias = Math.round((f - hoy) / 86400000);
        sub += ' · pago límite: ' + fmtDate(localISO(f));
        badge = '<span class="row-badge ' + (dias <= 2 ? 'badge-urgent' : dias <= 7 ? 'badge-soon' : 'badge-ok') + '">' + (dias === 0 ? 'Vence hoy' : 'Vence en ' + dias + (dias <= 2 ? 'd' : ' días')) + '</span>';
      }
      return '<div class="row" data-tc="pago" data-id="' + t.id + '">' +
        '<div class="row-icon" style="background:var(--cyan-dim); color:var(--cyan);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><line x1="2.5" y1="9.5" x2="21.5" y2="9.5"/><line x1="6" y1="15" x2="10" y2="15"/></svg></div>' +
        '<div class="row-body"><div class="row-title">' + escapeHtml(t.nombre) + '</div><div class="row-sub">' + sub + '</div>' + badge + '</div>' +
        '<div class="row-value">' + moneyDec(t.usado) + '</div></div>';
    }).join('');
  }
  const renderDeudasPrevio = window.renderDeudas;
  window.renderDeudas = function () { renderDeudasPrevio(); renderPagosTarjetas(); };

  window.renderTarjetas = renderTarjetas;
  const renderMovPrevio = window.renderMovimientos;
  window.renderMovimientos = function () { renderMovPrevio(); renderTarjetas(); };
  const renderAllPrevio = window.renderAll;
  window.renderAll = function () { renderAllPrevio(); renderTarjetas(); renderPagosTarjetas(); };
})();
