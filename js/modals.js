/* ==================================================================
   BATFINANCE · MODALS
   ------------------------------------------------------------------
   Sistema de hojas modales + todos los formularios de "agregar/ver
   detalle". Cada acción llama a la API (apiFetch, de state.js) y
   termina con refresh(), que vuelve a pedir el estado completo al
   servidor y repinta — así la app siempre muestra exactamente lo que
   quedó guardado en la base de datos, sin cálculos duplicados aquí.

   El asistente de compra inteligente (startWizard) sigue siendo la
   única parte que habla con PurchaseEvaluator.
   ================================================================== */

/* En celular no se pone el cursor al abrir: eso abre el teclado solo y
   en iPhone tapa la ventana. Solo en compu (mouse) queda listo para escribir. */
function enfocarSinTeclado() {
  return window.matchMedia('(hover:hover) and (pointer:fine)').matches;
}

function openModal(innerHtml, opts) {
  opts = opts || {};
  const root = document.getElementById('modal-root');
  const overlay = document.createElement('div');
  overlay.className = 'overlay' + (opts.center ? ' center' : '');
  overlay.innerHTML =
    '<div class="sheet">' + (opts.center ? '' : '<div class="sheet-handle"></div>') +
    '<button class="sheet-close">✕</button>' + innerHtml + '</div>';
  root.appendChild(overlay);
  requestAnimationFrame(function () { overlay.classList.add('open'); });
  function close() {
    overlay.classList.remove('open');
    setTimeout(function () { overlay.remove(); }, 300);
  }
  overlay.querySelector('.sheet-close').addEventListener('click', close);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  return { overlay: overlay, close: close };
}

/* Deshabilita un botón mientras corre una petición async, y lo
   regresa a su texto original al terminar (éxito o error). Evita
   doble-clicks que dupliquen un registro. */
async function withLoading(btn, fn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    await fn();
  } catch (err) {
    if (err.data && err.data.error === 'fondos_insuficientes') {
      mostrarAlertaFondos(err.data);
    } else {
      toast(err.message || 'Algo salió mal, intenta de nuevo');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

/* Alerta clara cuando un movimiento no puede completarse por falta de
   saldo — misma vibra que la confirmación de cerrar sesión, en vez de
   un toast que se mira y se olvida. */
function mostrarAlertaFondos(data) {
  const metodoTxt = data.metodo === 'efectivo' ? 'efectivo' : 'tarjeta / electrónico';
  const m = openModal(
    '<div class="sheet-title" style="color:var(--coral);">⚠️ Fondos insuficientes</div>' +
    '<p style="font-size:13.5px; color:var(--text-dim); line-height:1.6; margin-bottom:14px;">Tu saldo en <b style="color:var(--text);">' + metodoTxt + '</b> es de <b style="color:var(--text);">' + money(data.disponible) + '</b>, y este movimiento necesita <b style="color:var(--text);">' + money(data.requerido) + '</b>.</p>' +
    '<div class="reflexion-box" style="border-left-color:var(--coral); background:linear-gradient(155deg, rgba(255,79,112,0.12), rgba(255,255,255,0.02));">' +
      'Te faltan <b>' + money(data.faltante) + '</b> para poder completarlo. Ajusta el monto, cambia el método de pago, o regresa cuando tengas el saldo.' +
    '</div>' +
    '<button class="btn-primary" id="cerrar-alerta-fondos" style="margin-top:18px;">Entendido</button>',
    { center: true }
  );
  document.getElementById('cerrar-alerta-fondos').addEventListener('click', m.close);
}

/* ================= GASTOS ================= */
function openAddGasto() {
  let selectedCat = null;
  let metodo = 'electronico';
  const m = openModal(
    '<div class="sheet-title">Nueva compra / gasto</div>' +
    '<button class="ia-cta" id="g-ia"><span class="ia-cta-ico">✦</span><span><b>Registro inteligente</b><small>Cuéntame lo que gastaste y registro cada compra solo</small></span></button>' +
    '<div class="or-sep"><span>o captura a mano</span></div>' +
    '<div class="field"><label>¿Qué compraste?</label><input type="text" id="g-desc" placeholder="Ej. Mochila para el trabajo"></div>' +
    '<div class="field"><label>Categoría</label><div class="cat-grid" id="g-cats">' +
      CATEGORIAS.map(function (c) {
        return '<button class="cat-opt" data-cat="' + c.id + '"><span class="ci">' + c.icon + '</span>' + c.label + '</button>';
      }).join('') +
    '</div></div>' +
    '<div class="field"><label>Monto (MXN)</label><input type="number" id="g-monto" placeholder="0"></div>' +
    '<div class="field"><label>¿Cómo pagaste?</label><div class="seg" id="g-metodo">' +
      '<button class="seg-opt" data-m="efectivo">Efectivo</button>' +
      '<button class="seg-opt active" data-m="electronico">Tarjeta / electrónico</button>' +
    '</div></div>' +
    '<div class="field"><label>Fecha</label><input type="date" id="g-fecha" value="' + todayISO() + '"></div>' +
    '<div class="btn-row" style="margin-top:4px; align-items:stretch;">' +
      '<button class="btn-primary" id="g-evaluar" style="flex:1; width:auto; min-height:56px; display:flex; align-items:center; justify-content:center; font-size:12.5px; line-height:1.25; padding:10px 6px; background:linear-gradient(120deg,var(--violet),#8C94A4);">Evaluar si es una compra inteligente</button>' +
      '<button class="btn-primary" id="g-directo" style="flex:1; width:auto; min-height:56px; display:flex; align-items:center; justify-content:center; font-size:12.5px; line-height:1.25; padding:10px 6px; color:var(--violet); background:linear-gradient(120deg, rgba(190,198,212,0.18), rgba(140,148,164,0.18)); border:1px solid rgba(190,198,212,0.4); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); box-shadow:none;">Guardar sin evaluar</button>' +
    '</div>'
  );
  m.overlay.querySelectorAll('.cat-opt').forEach(function (btn) {
    btn.addEventListener('click', function () {
      selectedCat = btn.dataset.cat;
      m.overlay.querySelectorAll('.cat-opt').forEach(function (b) { b.classList.toggle('active', b === btn); });
    });
  });
  m.overlay.querySelectorAll('#g-metodo .seg-opt').forEach(function (btn) {
    btn.addEventListener('click', function () {
      metodo = btn.dataset.m;
      m.overlay.querySelectorAll('#g-metodo .seg-opt').forEach(function (b) { b.classList.toggle('active', b === btn); });
    });
  });
  function collect() {
    const desc = document.getElementById('g-desc').value.trim();
    const monto = parseFloat(document.getElementById('g-monto').value);
    const fecha = document.getElementById('g-fecha').value || todayISO();
    if (!desc || !selectedCat || isNaN(monto) || monto <= 0) {
      toast('Completa descripción, categoría y monto'); return null;
    }
    return { desc: desc, monto: monto, fecha: fecha, cat: selectedCat, metodo: metodo };
  }
  document.getElementById('g-ia').addEventListener('click', function () {
    m.close();
    setTimeout(openRegistroIA, 180);
  });
  document.getElementById('g-directo').addEventListener('click', function () {
    const d = collect(); if (!d) return;
    const btn = this;
    withLoading(btn, async function () {
      await apiFetch('/gastos', {
        method: 'POST',
        body: JSON.stringify({ descripcion: d.desc, categoria: d.cat, monto: d.monto, fecha: d.fecha, metodo: d.metodo })
      });
      await refresh(); m.close(); toast('Gasto registrado');
    });
  });
  document.getElementById('g-evaluar').addEventListener('click', function () {
    const d = collect(); if (!d) return;
    m.close();
    startWizard(d);
  });
}

/* ---------------- Registro inteligente (Gemini) ----------------
   Un solo texto libre, aunque traiga varias compras. El servidor las
   separa; si a alguna le falta monto o forma de pago se pregunta solo
   eso, y luego se evalúan y registran todas (cada una por separado). */
function openRegistroIA() {
  let texto = '';
  let compras = [];
  const m = openModal('<div id="ia-body"></div>');
  const body = function () { return document.getElementById('ia-body'); };
  pintarTexto();

  function pintarTexto() {
    body().innerHTML =
      '<div class="ia-marca">✦ Registro inteligente</div>' +
      '<div class="ia-q" style="margin-top:12px;">¿Qué compraste?</div>' +
      '<div class="ia-sub">Cuéntalo como se lo contarías a alguien: qué compraste, cuánto costó y si pagaste en efectivo o con tarjeta. Pueden ser varias compras.</div>' +
      '<textarea id="ia-texto" rows="6" class="ia-input" placeholder="Ej. Me fui al trabajo en taxi, me cobró 70 en efectivo. En el Oxxo compré un Monster y galletas, 89 con tarjeta, y un chocolate para mi novia de 40 con tarjeta.">' + escapeHtml(texto) + '</textarea>' +
      '<div class="ia-saldos"><span>Efectivo <b>' + money(state.saldo.efectivo) + '</b></span><span>Tarjeta <b>' + money(state.saldo.tarjeta) + '</b></span></div>' +
      '<button class="btn-primary" id="ia-analizar" style="margin-top:16px;">✦ Registrar</button>';
    const ta = document.getElementById('ia-texto');
    if (enfocarSinTeclado()) ta.focus();
    document.getElementById('ia-analizar').addEventListener('click', analizar);
  }

  async function analizar() {
    texto = document.getElementById('ia-texto').value.trim();
    if (texto.length < 3) { toast('Cuéntame qué compraste'); return; }
    const btn = document.getElementById('ia-analizar');
    btn.disabled = true; btn.textContent = 'Leyendo tus compras…';
    try {
      const r = await apiFetch('/ia/gastos/analizar', { method: 'POST', body: JSON.stringify({ texto: texto }) });
      compras = r.compras;
      if (compras.every(completa)) registrar();
      else pintarRevision();
    } catch (err) {
      toast(err.message || 'No se pudo analizar');
      btn.disabled = false; btn.textContent = '✦ Registrar';
    }
  }
  function completa(c) { return c.monto > 0 && (c.metodo === 'efectivo' || c.metodo === 'electronico'); }

  /* Solo se pide lo que falta; lo demás se muestra ya resuelto. */
  function pintarRevision() {
    body().innerHTML =
      '<div class="ia-marca">✦ Registro inteligente</div>' +
      '<div class="ia-q" style="margin-top:12px; font-size:19px;">Encontré ' + compras.length + (compras.length === 1 ? ' compra' : ' compras') + '</div>' +
      '<div class="ia-sub">Completa lo que no mencionaste y las registro.</div>' +
      compras.map(function (c, i) {
        const cat = catInfo(c.categoria);
        const faltaMonto = !(c.monto > 0), faltaMetodo = !c.metodo;
        return '<div class="ia-item' + (completa(c) ? '' : ' falta') + '">' +
          '<div class="ia-item-top"><span class="ia-item-cat" style="color:' + cat.color + '">' + cat.icon + '</span>' +
            '<b>' + escapeHtml(c.descripcion) + '</b>' +
            (faltaMonto ? '' : '<span class="ia-item-monto">' + moneyDec(c.monto) + '</span>') + '</div>' +
          (faltaMonto ? '<div class="ia-item-ask"><label>¿Cuánto costó?</label><div class="ia-monto ia-monto-sm"><span>$</span><input type="number" inputmode="decimal" min="0" step="0.01" data-i="' + i + '" class="ia-m-in" placeholder="0"></div></div>' : '') +
          (faltaMetodo
            ? '<div class="ia-item-ask"><label>¿Cómo pagaste?</label><div class="seg" data-i="' + i + '">' +
                '<button class="seg-opt" data-m="efectivo">Efectivo</button><button class="seg-opt" data-m="electronico">Tarjeta</button></div></div>'
            : '<div class="ia-item-sub">' + cat.label + ' · ' + metodoLabel(c.metodo) + '</div>') +
        '</div>';
      }).join('') +
      '<div class="btn-row" style="margin-top:16px;">' +
        '<button class="small-btn" id="ia-editar" style="flex:1; padding:13px;">Editar texto</button>' +
        '<button class="small-btn primary" id="ia-reg" style="flex:2; padding:13px;">Registrar ' + compras.length + '</button>' +
      '</div>';
    body().querySelectorAll('.ia-m-in').forEach(function (inp) {
      inp.addEventListener('input', function () { compras[Number(inp.dataset.i)].monto = parseFloat(inp.value) || null; });
    });
    body().querySelectorAll('.ia-item .seg').forEach(function (seg) {
      seg.querySelectorAll('.seg-opt').forEach(function (b) {
        b.addEventListener('click', function () {
          compras[Number(seg.dataset.i)].metodo = b.dataset.m;
          seg.querySelectorAll('.seg-opt').forEach(function (x) { x.classList.toggle('active', x === b); });
        });
      });
    });
    document.getElementById('ia-editar').addEventListener('click', pintarTexto);
    document.getElementById('ia-reg').addEventListener('click', function () {
      if (!compras.every(completa)) { toast('Falta el monto o cómo pagaste en alguna compra'); return; }
      registrar();
    });
  }

  async function registrar() {
    body().innerHTML =
      '<div class="ia-marca">✦ Registro inteligente</div>' +
      '<div class="ia-cargando"><span class="ia-spin"></span>Evaluando ' + compras.length + (compras.length === 1 ? ' compra' : ' compras') + ' con tu saldo…</div>';
    try {
      const r = await apiFetch('/ia/gastos/registrar', { method: 'POST', body: JSON.stringify({ texto: texto, fecha: localISO(), compras: compras }) });
      await refresh();
      resultados(r.gastos, r.restante);
    } catch (err) {
      if (err.data && err.data.error === 'fondos_insuficientes') { m.close(); mostrarAlertaFondos(err.data); return; }
      toast(err.message || 'No se pudo registrar');
      pintarRevision();
    }
  }

  function resultados(gastos, restante) {
    const total = gastos.reduce(function (s, g) { return s + Number(g.monto); }, 0);
    const prom = gastos.reduce(function (s, g) { return s + Number(g.rating); }, 0) / gastos.length;
    body().innerHTML =
      '<div class="ia-marca">✦ ' + (gastos.length === 1 ? 'Compra registrada' : gastos.length + ' compras registradas') + '</div>' +
      '<div class="ia-res-head"><div><b>' + moneyDec(total) + '</b><span>gastado</span></div>' +
        '<div><b>' + prom.toFixed(1) + '★</b><span>calificación promedio</span></div></div>' +
      gastos.map(function (g, k) {
        const ev = g.evaluacion || {};
        const c = catInfo(g.categoria);
        return '<div class="ia-res">' +
          '<div class="ia-ficha" style="margin:0;">' +
            '<div class="ia-ficha-cat" style="background:' + c.color + '22; color:' + c.color + '">' + c.icon + '</div>' +
            '<div class="ia-ficha-txt"><b>' + escapeHtml(g.descripcion) + '</b><span>' + c.label + ' · ' + metodoLabel(g.metodo) + '</span></div>' +
            '<b class="ia-ficha-monto">' + moneyDec(g.monto) + '</b>' +
          '</div>' +
          '<div class="ia-res-eval"><span class="ia-stars" id="ia-st-' + k + '"></span>' +
            '<b style="color:' + toneColor(ev.tone) + '">' + escapeHtml(ev.label || '') + '</b></div>' +
          (ev.razones || []).map(function (x) { return '<div class="ia-razon">' + escapeHtml(x) + '</div>'; }).join('') +
        '</div>';
      }).join('') +
      '<div class="hint" style="margin-top:4px;">Te quedan ' + money(restante.efectivo) + ' en efectivo y ' + money(restante.tarjeta) + ' en tarjeta.</div>' +
      '<div class="btn-row" style="margin-top:16px;">' +
        '<button class="small-btn" id="ia-deshacer" style="flex:1; padding:13px;">Deshacer ' + (gastos.length === 1 ? '' : 'todo') + '</button>' +
        '<button class="small-btn primary" id="ia-listo" style="flex:2; padding:13px;">Listo</button>' +
      '</div>';
    gastos.forEach(function (g, k) { renderStars(document.getElementById('ia-st-' + k), Number(g.rating), 16); });
    document.getElementById('ia-listo').addEventListener('click', m.close);
    document.getElementById('ia-deshacer').addEventListener('click', function () {
      withLoading(this, async function () {
        for (const g of gastos) await apiFetch('/gastos/' + g.id, { method: 'DELETE' });
        await refresh(); m.close(); toast('Registro deshecho, tu saldo quedó como estaba');
      });
    });
  }
}

/* ---------------- Asistente de compra inteligente ----------------
   Usa PurchaseEvaluator.getQuestions(categoria) para armar los pasos
   y PurchaseEvaluator.evaluate(categoria, respuestas) para calificar.
   El wizard NO sabe nada de cómo se calculan los puntajes: solo
   pinta lo que el motor le da. */
function startWizard(gastoDraft) {
  // Contexto completo: se calcula una sola vez al abrir el asistente,
  // con datos 100% reales de la app (no inventa nada). Con esto el
  // cuestionario se adapta al tamaño de la compra, y el resultado
  // final toma en cuenta presupuesto del mes, deudas próximas y tu
  // historial real de arrepentimiento en esa categoría.
  const contexto = {
    descripcion: gastoDraft.desc,
    saldoActual: saldoTotal(),
    monto: gastoDraft.monto,
    presupuestoUsado: usadoGrupoEsteMes(gastoDraft.cat),
    presupuestoMeta: targetGrupoMensual(gastoDraft.cat),
    deudasProximasTotal: deudasProximasTotal(7),
    arrepentimiento: tasaArrepentimiento(gastoDraft.cat)
  };
  const questions = PurchaseEvaluator.getQuestions(gastoDraft.cat, contexto);
  const catMeta = catInfo(gastoDraft.cat);
  let step = 0;
  const answers = {};
  const m = openModal('<div id="wiz-body"></div>');
  renderStep();

  function renderStep() {
    if (step >= questions.length) return finish();
    const q = questions[step];
    const body = document.getElementById('wiz-body');
    let inner =
      '<div class="wiz-cat-tag">' + catMeta.icon + ' ' + catMeta.label + '</div>' +
      '<div class="wiz-step-label">Pregunta ' + (step + 1) + ' de ' + questions.length + '</div>' +
      '<div class="wiz-progress">' + questions.map(function (_, i) { return '<i class="' + (i <= step ? 'done' : '') + '"></i>'; }).join('') + '</div>' +
      '<div class="wiz-q">' + q.text + '</div>';

    if (q.type === 'stars') {
      inner += '<div class="star-picker" id="wiz-stars">' +
        [1, 2, 3, 4, 5].map(function (n) {
          return '<button data-n="' + n + '"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.4 6.9.7-5.2 4.8 1.5 6.9L12 17.8 5.9 21.3l1.5-6.9L2.2 9.6l6.9-.7z"/></svg></button>';
        }).join('') +
        '</div><div class="hint" style="text-align:center;">Toca una estrella para calificar tu deseo de compra</div>';
      body.innerHTML = inner;
      const stars = body.querySelectorAll('#wiz-stars svg');
      body.querySelectorAll('#wiz-stars button').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const n = parseInt(btn.dataset.n, 10);
          stars.forEach(function (s, i) { s.classList.toggle('on', i < n); });
          answers[q.id] = n;
          setTimeout(function () { step++; renderStep(); }, 260);
        });
      });
    } else {
      inner += '<div class="opt-list">' +
        q.options.map(function (o, i) { return '<button class="opt-btn" data-i="' + i + '"><span>' + o.label + '</span></button>'; }).join('') +
        '</div>';
      body.innerHTML = inner;
      body.querySelectorAll('.opt-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          body.querySelectorAll('.opt-btn').forEach(function (b) { b.classList.remove('selected'); });
          btn.classList.add('selected');
          const opt = q.options[parseInt(btn.dataset.i, 10)];
          answers[q.id] = opt.score;
          setTimeout(function () { step++; renderStep(); }, 220);
        });
      });
    }
  }

  function buildReflexion(result, restanteDespues) {
    const factores = result.factores || {};
    const impacto = factores.impactoSaldo;
    const presupuesto = factores.impactoPresupuesto;
    const deudas = factores.deudasProximas;
    const arrepentimiento = factores.arrepentimiento;
    const feo = result.tone === 'bad' || result.tone === 'avoid';
    const aprietaSaldo = impacto && (impacto.nivel === 'critico' || impacto.nivel === 'muy_bajo');
    const excedePresupuesto = presupuesto && (presupuesto.nivel === 'excedido' || presupuesto.nivel === 'muy_excedido');
    const comprometeDeudas = deudas && deudas.nivel === 'compromete_pago';

    if (comprometeDeudas) {
      return 'Tienes pagos por ' + money(deudas.deudasProximasTotal) + ' que vencen en los próximos días — si haces esta compra, no te va a alcanzar para cubrirlos. ¿Seguro que quieres arriesgarte, o mejor esperamos a que pases esos pagos?';
    }
    if (aprietaSaldo && feo) {
      return 'Con esta compra tu saldo quedaría en ' + money(Math.max(0, restanteDespues)) +
        (restanteDespues <= 0 ? ', prácticamente en ceros' : ', muy justo') +
        ' — y tú mismo la calificaste bajo. Tal vez valga más la pena esperarte tantito. ¿Le seguimos o la dejamos pendiente?';
    }
    if (aprietaSaldo) {
      return 'Ojo: después de esta compra tu saldo quedaría en ' + money(Math.max(0, restanteDespues)) +
        (restanteDespues <= 0 ? ', en números rojos.' : ', muy cerca de cero.') +
        ' ¿Estás seguro de que la quieres hacer ahora?';
    }
    if (excedePresupuesto) {
      return 'Esta compra te haría pasarte del presupuesto que tienes planeado para esta categoría este mes (' + money(presupuesto.usadoConEsta) + ' de ' + money(presupuesto.meta) + '). No es el fin del mundo una vez, pero repetirlo seguido desajusta tu plan. ¿Continuamos?';
    }
    if (arrepentimiento && arrepentimiento.nivel === 'alto') {
      return 'Dato real tuyo: de tus últimas ' + arrepentimiento.total + ' compras evaluadas en esta categoría, ' + Math.round(arrepentimiento.pct * 100) + '% terminaron en arrepentimiento según tu propio seguimiento. Nada más para que lo tengas presente. ¿Aun así la confirmamos?';
    }
    if (feo) {
      return 'Tu propia evaluación dice que esta no es de las compras más inteligentes ahorita. Tu saldo no se ve tan afectado, pero igual vale la pena pensarlo dos veces. ¿La confirmamos o mejor la dejamos pasar?';
    }
    const genericos = [
      'No hay ninguna alerta importante aquí — se ve como una decisión razonable. ¿Le damos para adelante?',
      'Todo se ve en orden con tus finanzas para esta compra. ¿Confirmas que sigues adelante?',
      'Nada aquí prende focos rojos. Al final tú decides — ¿confirmamos?',
      'Esta compra no compromete tu estabilidad financiera. ¿Confirmas que quieres seguir adelante?'
    ];
    return genericos[Math.floor(Math.random() * genericos.length)];
  }

  /* De todo lo que se evaluó (tus respuestas + los factores automáticos),
     encuentra lo que más ayudó y lo que más restó — para resaltar eso en
     vez de aventar la lista completa de todo lo que respondiste. */
  function puntosClave(breakdown) {
    if (!breakdown || !breakdown.length) return { fuerte: null, debil: null };
    const ordenado = breakdown.slice().sort(function (a, b) { return a.score - b.score; });
    return { debil: ordenado[0], fuerte: ordenado[ordenado.length - 1] };
  }

  function finish() {
    const result = PurchaseEvaluator.evaluate(gastoDraft.cat, answers, contexto);
    const restanteDespues = contexto.saldoActual - gastoDraft.monto;
    const body = document.getElementById('wiz-body');
    const color = toneColor(result.tone);
    const { fuerte, debil } = puntosClave(result.breakdown);

    function puntoHtml(icono, titulo, item) {
      if (!item) return '';
      return (
        '<div class="kv" style="border:none; padding:10px 0 2px;">' +
          '<span class="kv-label" style="font-weight:700; color:var(--text);">' + icono + ' ' + titulo + '</span>' +
        '</div>' +
        '<div class="hint" style="margin-top:0;">' + item.text + (item.respuesta ? ' — <i>"' + item.respuesta + '"</i>' : '') + '</div>'
      );
    }
    const detalleCompletoHtml = result.breakdown.map(function (b) {
      return '<div class="result-breakdown-item"><span>' + b.text + '</span><span>' + b.score.toFixed(1) + '/5</span></div>';
    }).join('');

    body.innerHTML =
      '<div class="result-badge">' +
        '<div class="wiz-step-label">Resultado de tu evaluación</div>' +
        '<div class="result-stars" id="result-stars"></div>' +
        '<div class="result-label" style="color:' + color + '">' + result.label + '</div>' +
        '<div class="result-score">Puntaje: ' + result.score.toFixed(1) + ' / 5.0</div>' +
      '</div>' +
      '<div class="reflexion-box">' + buildReflexion(result, restanteDespues) + '</div>' +
      puntoHtml('👍', 'Lo que más jugó a tu favor', fuerte) +
      puntoHtml('👎', 'Lo que más te resta', debil) +
      '<button type="button" id="wiz-toggle-detalle" style="background:none; border:none; color:var(--text-faint); font-size:11.5px; text-decoration:underline; margin-top:14px; padding:0;">Ver el detalle completo de tus respuestas</button>' +
      '<div class="result-breakdown" id="wiz-detalle-completo" hidden>' + detalleCompletoHtml + '</div>' +
      '<div class="wiz-q" style="font-size:14.5px; text-align:center; margin:20px 0 4px;">¿Estás seguro de hacer esta compra?</div>' +
      '<div class="btn-row" style="margin-top:8px;">' +
        '<button class="small-btn" id="wiz-cancelar" style="flex:1; padding:13px;">Mejor la cancelo</button>' +
        '<button class="small-btn primary" id="wiz-continuar" style="flex:1; padding:13px;">Sí, la compro</button>' +
      '</div>';
    renderStars(document.getElementById('result-stars'), result.score, 30);
    document.getElementById('wiz-toggle-detalle').addEventListener('click', function () {
      const det = document.getElementById('wiz-detalle-completo');
      det.hidden = !det.hidden;
      this.textContent = det.hidden ? 'Ver el detalle completo de tus respuestas' : 'Ocultar el detalle';
    });
    document.getElementById('wiz-cancelar').addEventListener('click', function () {
      m.close();
      toast('Buena decisión — ese dinero sigue siendo tuyo 👍');
    });
    document.getElementById('wiz-continuar').addEventListener('click', function () {
      withLoading(this, async function () {
        await apiFetch('/gastos', {
          method: 'POST',
          body: JSON.stringify({
            descripcion: gastoDraft.desc, categoria: gastoDraft.cat, monto: gastoDraft.monto,
            fecha: gastoDraft.fecha, metodo: gastoDraft.metodo, rating: result.score,
            evaluacion: { tone: result.tone, label: result.label, respuestas: answers }
          })
        });
        await refresh(); m.close();
        toast('Compra evaluada y guardada · ' + result.score.toFixed(1) + '★');
      });
    });
  }
}

function openGastoDetalle(id) {
  const g = state.gastos.find(function (x) { return x.id === id; }); if (!g) return;
  const c = catInfo(g.categoria);
  const m = openModal(
    '<div class="sheet-title">' + escapeHtml(g.descripcion) + '</div>' +
    '<div class="kv"><span class="kv-label">Categoría</span><span class="kv-value">' + c.icon + ' ' + c.label + '</span></div>' +
    '<div class="kv"><span class="kv-label">Monto</span><span class="kv-value">' + money(g.monto) + '</span></div>' +
    '<div class="kv"><span class="kv-label">Pagado con</span><span class="kv-value">' + (g.metodo === 'efectivo' ? 'Efectivo' : 'Tarjeta / electrónico') + '</span></div>' +
    '<div class="kv"><span class="kv-label">Fecha</span><span class="kv-value">' + fmtDate(g.fecha) + '</span></div>' +
    (g.rating != null ? '<div class="kv"><span class="kv-label">Evaluación</span><span class="kv-value">' + g.rating.toFixed(1) + '★ · ' + g.evaluacion.label + '</span></div>' : '') +
    (g.seguimientoHecho ? '<div class="kv"><span class="kv-label">Seguimiento</span><span class="kv-value">' + ({ contento: '😄 Contento', neutral: '😐 Neutral', arrepentido: '😔 Arrepentido' }[g.seguimientoRespuesta] || '') + '</span></div>' : '') +
    '<div class="btn-row"><button class="btn-ghost btn-danger" id="del-gasto" style="flex:1">Eliminar registro</button></div>' +
    '<div class="hint">Al eliminar, el monto se regresa a tu saldo ' + (g.metodo === 'efectivo' ? 'en efectivo' : 'de tarjeta') + '.</div>'
  );
  document.getElementById('del-gasto').addEventListener('click', function () {
    withLoading(this, async function () {
      await apiFetch('/gastos/' + id, { method: 'DELETE' });
      await refresh(); m.close(); toast('Gasto eliminado');
    });
  });
}

/* ================= INGRESOS ================= */
function openAddIngreso() {
  let freq = 'Único';
  let metodo = 'electronico';
  const m = openModal(
    '<div class="sheet-title">Registrar ingreso</div>' +
    '<div class="field"><label>Concepto</label><input type="text" id="i-nombre" placeholder="Ej. Salario quincenal"></div>' +
    '<div class="field"><label>Monto (MXN)</label><input type="number" id="i-monto" placeholder="0"></div>' +
    '<div class="field"><label>Frecuencia</label><div class="seg" id="i-freq">' +
      '<button class="seg-opt active" data-f="Único">Único</button>' +
      '<button class="seg-opt" data-f="Quincenal">Quincenal</button>' +
      '<button class="seg-opt" data-f="Mensual">Mensual</button>' +
    '</div></div>' +
    '<div class="field"><label>¿Cómo lo recibiste?</label><div class="seg" id="i-metodo">' +
      '<button class="seg-opt" data-m="efectivo">Efectivo</button>' +
      '<button class="seg-opt active" data-m="electronico">Tarjeta / electrónico</button>' +
    '</div></div>' +
    '<div class="field"><label>Fecha</label><input type="date" id="i-fecha" value="' + todayISO() + '"></div>' +
    '<button class="btn-primary" id="i-save">Guardar ingreso</button>' +
    '<div class="hint">Se sumará automáticamente a tu saldo ' + '<span id="i-metodo-hint">de tarjeta</span>.</div>'
  );
  m.overlay.querySelectorAll('#i-freq .seg-opt').forEach(function (btn) {
    btn.addEventListener('click', function () {
      freq = btn.dataset.f;
      m.overlay.querySelectorAll('#i-freq .seg-opt').forEach(function (b) { b.classList.toggle('active', b === btn); });
    });
  });
  m.overlay.querySelectorAll('#i-metodo .seg-opt').forEach(function (btn) {
    btn.addEventListener('click', function () {
      metodo = btn.dataset.m;
      m.overlay.querySelectorAll('#i-metodo .seg-opt').forEach(function (b) { b.classList.toggle('active', b === btn); });
      document.getElementById('i-metodo-hint').textContent = metodo === 'efectivo' ? 'en efectivo' : 'de tarjeta';
    });
  });
  document.getElementById('i-save').addEventListener('click', function () {
    const nombre = document.getElementById('i-nombre').value.trim();
    const monto = parseFloat(document.getElementById('i-monto').value);
    const fecha = document.getElementById('i-fecha').value || todayISO();
    if (!nombre || isNaN(monto) || monto <= 0) { toast('Completa concepto y monto'); return; }
    withLoading(this, async function () {
      await apiFetch('/ingresos', {
        method: 'POST',
        body: JSON.stringify({ nombre: nombre, monto: monto, frecuencia: freq, fecha: fecha, metodo: metodo })
      });
      await refresh(); m.close(); toast('Ingreso registrado');
    });
  });
}
function deleteIngreso(id) {
  const ing = state.ingresos.find(function (x) { return x.id === id; });
  const m = openModal(
    '<div class="sheet-title">Eliminar ingreso</div>' +
    '<p style="font-size:13px; color:var(--text-dim);">¿Quieres eliminar este registro de ingreso? Se descontará de tu saldo ' + (ing && ing.metodo === 'efectivo' ? 'en efectivo' : 'de tarjeta') + '.</p>' +
    '<div class="btn-row"><button class="btn-ghost" id="cancel-i">Cancelar</button><button class="btn-ghost btn-danger" id="confirm-i">Eliminar</button></div>',
    { center: true }
  );
  document.getElementById('cancel-i').addEventListener('click', m.close);
  document.getElementById('confirm-i').addEventListener('click', function () {
    withLoading(this, async function () {
      await apiFetch('/ingresos/' + id, { method: 'DELETE' });
      await refresh(); m.close(); toast('Ingreso eliminado');
    });
  });
}

/* ================= DEUDAS ================= */
function openAddDeuda() {
  let tipo = 'mensual';
  const m = openModal(
    '<div class="sheet-title">Nueva deuda</div>' +
    '<div class="field"><label>Nombre</label><input type="text" id="d-nombre" placeholder="Ej. Tarjeta BBVA"></div>' +
    '<div class="field"><label>Monto total de la deuda</label><input type="number" id="d-total" placeholder="0"></div>' +
    '<div class="field"><label>Tipo de pago</label><div class="seg" id="d-tipo">' +
      '<button class="seg-opt" data-t="unico">Pago único</button>' +
      '<button class="seg-opt active" data-t="mensual">Mensual</button>' +
      '<button class="seg-opt" data-t="quincenal">Quincenal</button>' +
    '</div></div>' +
    '<div class="field"><label id="d-cuota-label">Monto de cada pago</label><input type="number" id="d-cuota" placeholder="0"></div>' +
    '<div class="field" id="d-duracion-field"><label>¿En cuántos pagos la vas a liquidar?</label><input type="number" id="d-duracion" min="1" step="1" placeholder="Ej. 12"></div>' +
    '<div class="field"><label>Próxima fecha de pago</label><input type="date" id="d-fecha" value="' + todayISO() + '"></div>' +
    '<button class="btn-primary" id="d-save">Guardar deuda</button>' +
    '<div class="hint">Cuando completes el número de pagos, la deuda pasa automáticamente a "Deudas pagadas".</div>'
  );
  function syncTipoUI() {
    document.getElementById('d-cuota-label').textContent = tipo === 'unico' ? 'Monto a pagar' : 'Monto de cada pago';
    document.getElementById('d-duracion-field').hidden = tipo === 'unico';
  }
  syncTipoUI();
  // Calcula solo el número de pagos (total ÷ cuota, hacia arriba) mientras
  // no lo hayas escrito tú; si lo cambias a mano, se respeta.
  let duracionManual = false;
  function autoDuracion() {
    if (duracionManual) return;
    const total = parseFloat(document.getElementById('d-total').value);
    const cuota = parseFloat(document.getElementById('d-cuota').value);
    document.getElementById('d-duracion').value = (total > 0 && cuota > 0) ? Math.ceil(total / cuota - 0.0001) : '';
  }
  document.getElementById('d-total').addEventListener('input', autoDuracion);
  document.getElementById('d-cuota').addEventListener('input', autoDuracion);
  document.getElementById('d-duracion').addEventListener('input', function () { duracionManual = this.value !== ''; });
  m.overlay.querySelectorAll('#d-tipo .seg-opt').forEach(function (btn) {
    btn.addEventListener('click', function () {
      tipo = btn.dataset.t;
      m.overlay.querySelectorAll('#d-tipo .seg-opt').forEach(function (b) { b.classList.toggle('active', b === btn); });
      syncTipoUI();
    });
  });
  document.getElementById('d-save').addEventListener('click', function () {
    const nombre = document.getElementById('d-nombre').value.trim();
    const total = parseFloat(document.getElementById('d-total').value);
    const cuota = parseFloat(document.getElementById('d-cuota').value);
    const fecha = document.getElementById('d-fecha').value || todayISO();
    const duracionRaw = document.getElementById('d-duracion').value;
    const duracion = tipo === 'unico' ? 1 : (parseInt(duracionRaw, 10) || 0);
    if (!nombre || isNaN(total) || total <= 0 || isNaN(cuota) || cuota <= 0) { toast('Completa todos los campos'); return; }
    if (tipo !== 'unico' && duracion <= 0) { toast('Indica en cuántos pagos la vas a liquidar'); return; }
    // Aviso si los números no cuadran (ej. 1 pago de $750 para una deuda de $2,250)
    if (tipo !== 'unico' && duracion * cuota < total - 0.5) {
      const ok = confirm('Con ' + duracion + (duracion === 1 ? ' pago' : ' pagos') + ' de ' + money(cuota) + ' solo cubres ' + money(duracion * cuota) +
        ' de los ' + money(total) + '. Lo normal serían ' + Math.ceil(total / cuota - 0.0001) + ' pagos.\n\n¿Guardar así de todos modos?');
      if (!ok) return;
    }
    withLoading(this, async function () {
      await apiFetch('/deudas', {
        method: 'POST',
        body: JSON.stringify({ nombre: nombre, montoTotal: total, montoCuota: cuota, tipo: tipo, proximoPago: fecha, duracion: duracion })
      });
      await refresh(); m.close(); toast('Deuda registrada — te avisaremos antes de que venza');
    });
  });
}
function openDeudaDetalle(id) {
  const d = state.deudas.find(function (x) { return x.id === id; }); if (!d) return;
  let metodoPago = 'electronico';
  const tipoLabel = { unico: 'Pago único', mensual: 'Mensual', quincenal: 'Quincenal' }[d.tipo];
  const progresoHtml = (!d.pagada && d.tipo !== 'unico' && d.duracion)
    ? '<div class="kv"><span class="kv-label">Progreso</span><span class="kv-value">' + (d.pagosRealizados || 0) + ' de ' + d.duracion + ' pagados' + (d.pagada ? '' : ' · sigue el ' + Math.min((d.pagosRealizados || 0) + 1, d.duracion)) + '</span></div>'
    : '';
  const m = openModal(
    '<div class="sheet-title">' + escapeHtml(d.nombre) + '</div>' +
    '<div class="kv"><span class="kv-label">Monto original</span><span class="kv-value">' + money(d.montoTotal) + '</span></div>' +
    '<div class="kv"><span class="kv-label">Saldo pendiente</span><span class="kv-value" style="color:' + (d.pagada ? 'var(--cyan)' : 'var(--coral)') + '">' + money(d.montoPendiente) + '</span></div>' +
    '<div class="kv"><span class="kv-label">Pago</span><span class="kv-value">' + money(d.montoCuota) + ' · ' + tipoLabel + '</span></div>' +
    progresoHtml +
    (!d.pagada ? '<div class="kv"><span class="kv-label">Próxima fecha</span><span class="kv-value">' + fmtDate(d.proximoPago) + '</span></div>' : '') +
    '<div class="kv"><span class="kv-label">Estado</span><span class="kv-value">' + (d.pagada ? 'Liquidada ✓' : 'Activa') + '</span></div>' +
    (!d.pagada ? '<div class="field" style="margin-top:14px;"><label>¿Con qué vas a pagar esta cuota?</label><div class="seg" id="d-metodo">' +
      '<button class="seg-opt" data-m="efectivo">Efectivo</button>' +
      '<button class="seg-opt active" data-m="electronico">Tarjeta / electrónico</button>' +
    '</div></div>' : '') +
    '<div class="btn-row">' +
      (!d.pagada ? '<button class="small-btn primary" id="d-pagar" style="flex:1; padding:13px;">Marcar pago como realizado</button>' : '') +
      '<button class="btn-ghost btn-danger" id="d-del" style="flex:1">Eliminar</button>' +
    '</div>' +
    (!d.pagada ? '<div class="hint">El monto de la cuota (' + money(d.montoCuota) + ') se descontará de tu saldo al confirmar el pago.</div>' : '')
  );
  if (!d.pagada) {
    m.overlay.querySelectorAll('#d-metodo .seg-opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        metodoPago = btn.dataset.m;
        m.overlay.querySelectorAll('#d-metodo .seg-opt').forEach(function (b) { b.classList.toggle('active', b === btn); });
      });
    });
    document.getElementById('d-pagar').addEventListener('click', function () {
      withLoading(this, async function () {
        const actualizada = await apiFetch('/deudas/' + id + '/pagar', {
          method: 'POST', body: JSON.stringify({ metodo: metodoPago })
        });
        await refresh(); m.close();
        toast(actualizada.pagada ? '¡Deuda liquidada por completo! 🎉' : '¡Pago registrado! Quedan ' + money(actualizada.montoPendiente));
      });
    });
  }
  document.getElementById('d-del').addEventListener('click', function () {
    withLoading(this, async function () {
      await apiFetch('/deudas/' + id, { method: 'DELETE' });
      await refresh(); m.close(); toast('Deuda eliminada');
    });
  });
}

/* ================= APUESTAS ================= */
function openAddApuesta() {
  const m = openModal(
    '<div class="sheet-title">Nueva apuesta</div>' +
    '<div class="field"><label>¿En qué apostaste?</label><input type="text" id="ap2-desc" placeholder="Ej. Final del torneo"></div>' +
    '<div class="field"><label>Monto apostado (MXN)</label><input type="number" id="ap2-monto" placeholder="0"></div>' +
    '<div class="field" style="margin-bottom:0;"><label>Fecha</label><input type="date" id="ap2-fecha" value="' + todayISO() + '"></div>' +
    '<button class="btn-primary" id="ap2-save" style="margin-top:18px;">Guardar apuesta</button>' +
    '<div class="hint">El monto apostado se descuenta de inmediato de tu saldo de tarjeta / dinero electrónico.</div>'
  );
  document.getElementById('ap2-save').addEventListener('click', function () {
    const desc = document.getElementById('ap2-desc').value.trim();
    const monto = parseFloat(document.getElementById('ap2-monto').value);
    const fecha = document.getElementById('ap2-fecha').value || todayISO();
    if (!desc || isNaN(monto) || monto <= 0) { toast('Completa la descripción y el monto'); return; }
    withLoading(this, async function () {
      await apiFetch('/apuestas', {
        method: 'POST',
        body: JSON.stringify({ descripcion: desc, montoApostado: monto, fecha: fecha })
      });
      await refresh(); m.close(); toast('Apuesta registrada');
    });
  });
}

function openApuestaDetalle(id) {
  const a = state.apuestas.find(function (x) { return x.id === id; }); if (!a) return;
  const m = openModal(
    '<div class="sheet-title">' + escapeHtml(a.descripcion) + '</div>' +
    '<div class="kv"><span class="kv-label">Monto apostado</span><span class="kv-value">' + money(a.montoApostado) + '</span></div>' +
    '<div class="kv"><span class="kv-label">Fecha</span><span class="kv-value">' + fmtDate(a.fecha) + '</span></div>' +
    '<div class="kv"><span class="kv-label">Estado</span><span class="kv-value">' + apuestaBadge(a.estado) + '</span></div>' +
    (a.estado === 'ganada' ? '<div class="kv"><span class="kv-label">Ganancia recibida</span><span class="kv-value" style="color:var(--cyan)">+' + money(a.montoGanado) + '</span></div>' : '') +
    '<div id="apu-actions" style="margin-top:6px;"></div>'
  );
  const actions = document.getElementById('apu-actions');

  function renderDeleteOnly() {
    actions.innerHTML = '<div class="btn-row" style="margin-top:14px;"><button class="btn-ghost btn-danger" id="apu-del" style="flex:1">Eliminar registro</button></div>';
    document.getElementById('apu-del').addEventListener('click', function () {
      withLoading(this, async function () {
        await apiFetch('/apuestas/' + id, { method: 'DELETE' });
        await refresh(); m.close(); toast('Apuesta eliminada');
      });
    });
  }

  if (a.estado === 'pendiente') {
    actions.innerHTML =
      '<div class="btn-row">' +
        '<button class="small-btn primary" id="apu-ganar" style="flex:1; padding:13px;">Marcar como ganada</button>' +
        '<button class="small-btn" id="apu-perder" style="flex:1; padding:13px; background:var(--coral-dim); color:var(--coral); border-color:rgba(255,79,112,0.3);">Marcar como perdida</button>' +
      '</div>' +
      '<div class="btn-row" style="margin-top:10px;"><button class="btn-ghost btn-danger" id="apu-del" style="flex:1">Eliminar registro</button></div>';

    document.getElementById('apu-perder').addEventListener('click', function () {
      withLoading(this, async function () {
        await apiFetch('/apuestas/' + id + '/resolver', { method: 'POST', body: JSON.stringify({ estado: 'perdida' }) });
        await refresh(); m.close(); toast('Apuesta marcada como perdida');
      });
    });
    document.getElementById('apu-ganar').addEventListener('click', function () {
      actions.innerHTML =
        '<div class="field"><label>¿Cuánto dinero recibiste en total (apuesta + ganancia)?</label><input type="number" id="apu-monto-ganado" placeholder="0"></div>' +
        '<button class="btn-primary" id="apu-confirmar-ganada">Confirmar y sumar a mi saldo</button>' +
        '<div class="hint">Ese monto se sumará directo a tu saldo de tarjeta / dinero electrónico.</div>';
      document.getElementById('apu-confirmar-ganada').addEventListener('click', function () {
        const monto = parseFloat(document.getElementById('apu-monto-ganado').value);
        if (isNaN(monto) || monto < 0) { toast('Ingresa un monto válido'); return; }
        withLoading(this, async function () {
          await apiFetch('/apuestas/' + id + '/resolver', {
            method: 'POST', body: JSON.stringify({ estado: 'ganada', montoGanado: monto })
          });
          await refresh(); m.close(); toast('¡Apuesta ganada! +' + money(monto));
        });
      });
    });
    document.getElementById('apu-del').addEventListener('click', function () {
      withLoading(this, async function () {
        await apiFetch('/apuestas/' + id, { method: 'DELETE' });
        await refresh(); m.close(); toast('Apuesta eliminada');
      });
    });
  } else {
    renderDeleteOnly();
  }
}

/* ================= SEGUIMIENTO POST-COMPRA =================
   5 días después de una compra evaluada, se le pregunta al usuario si
   sigue contento con la decisión. La respuesta alimenta el factor de
   "arrepentimiento histórico" del propio evaluador. */
function openSeguimientoPrompt(gasto) {
  const c = catInfo(gasto.categoria);
  const m = openModal(
    '<div class="sheet-title">¿Sigues contento con esta compra?</div>' +
    '<div class="hint" style="margin-top:-8px; margin-bottom:16px;">Hace unos días compraste esto y la evaluaste con ' + Number(gasto.rating).toFixed(1) + '★. Cuéntanos qué tal te fue — así el asistente aprende de tus decisiones reales, no solo de tus respuestas.</div>' +
    '<div class="row" style="pointer-events:none; margin-bottom:18px;">' +
      '<div class="row-icon" style="background:' + c.color + '22; color:' + c.color + '">' + c.icon + '</div>' +
      '<div class="row-body"><div class="row-title">' + escapeHtml(gasto.descripcion) + '</div><div class="row-sub">' + c.label + ' · ' + money(gasto.monto) + '</div></div>' +
    '</div>' +
    '<div class="opt-list">' +
      '<button class="opt-btn" data-r="contento"><span>😄 Sí, fue una buena decisión</span></button>' +
      '<button class="opt-btn" data-r="neutral"><span>😐 Me da igual, ni bien ni mal</span></button>' +
      '<button class="opt-btn" data-r="arrepentido"><span>😔 La verdad me arrepentí</span></button>' +
    '</div>',
    { center: true }
  );
  m.overlay.querySelectorAll('.opt-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const respuesta = btn.dataset.r;
      withLoading(btn, async function () {
        await apiFetch('/gastos/' + gasto.id + '/seguimiento', {
          method: 'POST', body: JSON.stringify({ respuesta: respuesta })
        });
        await refresh();
        m.close();
        toast('Gracias — eso ayuda a afinar tus próximas evaluaciones');
        checkSeguimientosPendientes();
      });
    });
  });
}

/* ================= INVERSIONES ================= */
function openAddInversion() {
  const m = openModal(
    '<div class="sheet-title">Nueva inversión SOFIPO</div>' +
    '<div class="field"><label>Nombre de la SOFIPO / instrumento</label><input type="text" id="inv-nombre" placeholder="Ej. Klar, Nu, Finsus..."></div>' +
    '<div class="field"><label>Monto invertido (MXN)</label><input type="number" id="inv-monto" placeholder="0"></div>' +
    '<div class="field" style="margin-bottom:0;"><label>Tasa anual (%) — vacío usa la de Configuración (' + state.config.tasaSofipoDefault + '%)</label><input type="number" id="inv-tasa" step="0.1" placeholder="' + state.config.tasaSofipoDefault + '"></div>' +
    '<button class="btn-primary" id="inv-save" style="margin-top:18px;">Guardar inversión</button>' +
    '<div class="hint">Este monto se descuenta de tu saldo en tarjeta: sigue siendo tu dinero, pero ya no está disponible como líquido porque pasó a generar rendimiento.</div>'
  );
  document.getElementById('inv-save').addEventListener('click', function () {
    const nombre = document.getElementById('inv-nombre').value.trim();
    const monto = parseFloat(document.getElementById('inv-monto').value);
    const tasaRaw = document.getElementById('inv-tasa').value;
    const tasa = tasaRaw === '' ? null : parseFloat(tasaRaw);
    if (!nombre || isNaN(monto) || monto <= 0) { toast('Completa nombre y monto'); return; }
    withLoading(this, async function () {
      await apiFetch('/inversiones', { method: 'POST', body: JSON.stringify({ nombre: nombre, monto: monto, tasa: tasa }) });
      await refresh(); m.close(); toast('Inversión registrada — se descontó de tu saldo en tarjeta');
    });
  });
}
function openInversionDetalle(id) {
  const i = state.inversiones.find(function (x) { return x.id === id; }); if (!i) return;
  const tasa = (i.tasa != null ? i.tasa : state.config.tasaSofipoDefault);
  const anual = i.monto * (tasa / 100);
  const mensual = anual / 12;
  const diario = anual / 365;
  const m = openModal(
    '<div class="sheet-title">' + escapeHtml(i.nombre) + '</div>' +
    '<div class="kv"><span class="kv-label">Monto invertido</span><span class="kv-value">' + money(i.monto) + '</span></div>' +
    '<div class="kv"><span class="kv-label">Tasa anual</span><span class="kv-value">' + tasa + '%</span></div>' +
    '<div class="kv"><span class="kv-label">Rendimiento anual est.</span><span class="kv-value">+' + money(anual) + '</span></div>' +
    '<div class="kv"><span class="kv-label">Rendimiento mensual est.</span><span class="kv-value">+' + moneyDec(mensual) + '</span></div>' +
    '<div class="kv"><span class="kv-label">Generado hoy (aprox.)</span><span class="kv-value">+' + moneyDec(diario) + '</span></div>' +
    '<div class="btn-row"><button class="btn-ghost btn-danger" id="inv-del" style="flex:1">Eliminar inversión</button></div>' +
    '<div class="hint">Al eliminarla, el monto invertido regresa a tu saldo de tarjeta.</div>'
  );
  document.getElementById('inv-del').addEventListener('click', function () {
    withLoading(this, async function () {
      await apiFetch('/inversiones/' + id, { method: 'DELETE' });
      await refresh(); m.close(); toast('Inversión eliminada');
    });
  });
}

/* ================= METAS ================= */
function openAddMeta() {
  const m = openModal(
    '<div class="sheet-title">Nueva meta de ahorro</div>' +
    '<div class="field"><label>¿Qué quieres comprar o lograr?</label><input type="text" id="meta-nombre" placeholder="Ej. Laptop nueva"></div>' +
    '<div class="field"><label>Costo objetivo (MXN)</label><input type="number" id="meta-monto" placeholder="0"></div>' +
    '<div class="field" style="margin-bottom:0;"><label>¿Ya tienes algo ahorrado?</label><input type="number" id="meta-actual" placeholder="0"></div>' +
    '<button class="btn-primary" id="meta-save" style="margin-top:18px;">Crear meta</button>' +
    '<div class="hint">Esta meta se lleva por separado, sin tocar tus gastos ni inversiones a menos que tú decidas aportar.</div>'
  );
  document.getElementById('meta-save').addEventListener('click', function () {
    const nombre = document.getElementById('meta-nombre').value.trim();
    const objetivo = parseFloat(document.getElementById('meta-monto').value);
    const actual = parseFloat(document.getElementById('meta-actual').value) || 0;
    if (!nombre || isNaN(objetivo) || objetivo <= 0) { toast('Completa nombre y costo objetivo'); return; }
    withLoading(this, async function () {
      await apiFetch('/metas', { method: 'POST', body: JSON.stringify({ nombre: nombre, montoObjetivo: objetivo, montoActual: actual }) });
      await refresh(); m.close(); toast('Meta creada 🎯');
    });
  });
}
function openAportarMeta(id) {
  const meta = state.metas.find(function (x) { return x.id === id; }); if (!meta) return;
  let metodo = 'electronico';
  const m = openModal(
    '<div class="sheet-title">Aportar a "' + escapeHtml(meta.nombre) + '"</div>' +
    '<div class="field"><label>Monto a aportar (MXN)</label><input type="number" id="ap-monto" placeholder="0"></div>' +
    '<label style="display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--text-dim); margin-bottom:14px;">' +
      '<input type="checkbox" id="ap-descontar" checked style="width:16px;height:16px;">Descontar de mi saldo líquido</label>' +
    '<div class="field" id="ap-metodo-field"><label>¿De dónde sale el dinero?</label><div class="seg" id="ap-metodo">' +
      '<button class="seg-opt" data-m="efectivo">Efectivo</button>' +
      '<button class="seg-opt active" data-m="electronico">Tarjeta / electrónico</button>' +
    '</div></div>' +
    '<button class="btn-primary" id="ap-save">Aportar</button>'
  );
  function syncField() { document.getElementById('ap-metodo-field').hidden = !document.getElementById('ap-descontar').checked; }
  syncField();
  document.getElementById('ap-descontar').addEventListener('change', syncField);
  m.overlay.querySelectorAll('#ap-metodo .seg-opt').forEach(function (btn) {
    btn.addEventListener('click', function () {
      metodo = btn.dataset.m;
      m.overlay.querySelectorAll('#ap-metodo .seg-opt').forEach(function (b) { b.classList.toggle('active', b === btn); });
    });
  });
  document.getElementById('ap-save').addEventListener('click', function () {
    const monto = parseFloat(document.getElementById('ap-monto').value);
    if (isNaN(monto) || monto <= 0) { toast('Ingresa un monto válido'); return; }
    const descontar = document.getElementById('ap-descontar').checked;
    withLoading(this, async function () {
      const actualizada = await apiFetch('/metas/' + id + '/aportar', {
        method: 'POST', body: JSON.stringify({ monto: monto, metodo: metodo, descontar: descontar })
      });
      await refresh(); m.close();
      const completada = Number(actualizada.montoActual) >= Number(actualizada.montoObjetivo);
      toast(completada ? '¡Meta completada! 🎉 Ya no cuenta en tu total de "En metas"' : '¡Aportación guardada!');
    });
  });
}
function openMetaDetalle(id) {
  const meta = state.metas.find(function (x) { return x.id === id; }); if (!meta) return;
  const completada = Number(meta.montoActual) >= Number(meta.montoObjetivo);
  const m = openModal(
    '<div class="sheet-title">' + escapeHtml(meta.nombre) + '</div>' +
    '<div class="kv"><span class="kv-label">Objetivo</span><span class="kv-value">' + money(meta.montoObjetivo) + '</span></div>' +
    '<div class="kv"><span class="kv-label">Ahorrado</span><span class="kv-value">' + money(meta.montoActual) + '</span></div>' +
    '<div class="kv"><span class="kv-label">Falta</span><span class="kv-value">' + money(Math.max(0, meta.montoObjetivo - meta.montoActual)) + '</span></div>' +
    '<div class="kv"><span class="kv-label">Estado</span><span class="kv-value" style="color:' + (completada ? 'var(--cyan)' : 'var(--text)') + '">' + (completada ? 'Completada ✓' : 'En progreso') + '</span></div>' +
    '<div class="btn-row"><button class="btn-ghost btn-danger" id="meta-del" style="flex:1">Eliminar meta</button></div>' +
    (completada ? '<div class="hint">Como ya llegaste a tu objetivo, este monto dejó de contarse en el chip "En metas" de Inicio — se asume que ese dinero ya se va a usar en tu compra.</div>' : '')
  );
  document.getElementById('meta-del').addEventListener('click', function () {
    withLoading(this, async function () {
      await apiFetch('/metas/' + id, { method: 'DELETE' });
      await refresh(); m.close(); toast('Meta eliminada');
    });
  });
}

/* ================= SALDO (efectivo / tarjeta) =================
   El saldo se mueve solo con cada ingreso, gasto e inversión. Este
   modal es solo para la configuración inicial o una corrección manual
   puntual (ej. cuadrar la app con lo que de verdad tienes hoy). */
function openEditLiquido() {
  const m = openModal(
    '<div class="sheet-title">Ajustar saldo</div>' +
    '<div class="hint" style="margin-top:-8px; margin-bottom:16px;">Tu saldo normalmente se actualiza solo con tus ingresos, gastos e inversiones. Usa esto solo para corregirlo o para capturar tu punto de partida.</div>' +
    '<div class="field"><label>Efectivo (MXN)</label><input type="number" id="sal-efectivo" value="' + Math.round(state.saldo.efectivo) + '"></div>' +
    '<div class="field" style="margin-bottom:0;"><label>Tarjeta / electrónico (MXN)</label><input type="number" id="sal-tarjeta" value="' + Math.round(state.saldo.tarjeta) + '"></div>' +
    '<button class="btn-primary" id="sal-save" style="margin-top:18px;">Guardar saldo</button>'
  );
  document.getElementById('sal-save').addEventListener('click', function () {
    const efectivo = parseFloat(document.getElementById('sal-efectivo').value);
    const tarjeta = parseFloat(document.getElementById('sal-tarjeta').value);
    if (isNaN(efectivo) || isNaN(tarjeta) || efectivo < 0 || tarjeta < 0) { toast('Ingresa montos válidos'); return; }
    withLoading(this, async function () {
      await apiFetch('/saldo', { method: 'PUT', body: JSON.stringify({ efectivo: efectivo, tarjeta: tarjeta }) });
      await refresh(); m.close(); toast('Saldo actualizado');
    });
  });
}

function openAportarFondo() {
  const fe = state.fondoEmergencia;
  let metodo = 'electronico';
  const m = openModal(
    '<div class="sheet-title">Aportar al fondo de emergencia</div>' +
    '<div class="field"><label>Monto a aportar (MXN)</label><input type="number" id="fe-monto" placeholder="0"></div>' +
    '<label style="display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--text-dim); margin-bottom:14px;">' +
      '<input type="checkbox" id="fe-descontar" checked style="width:16px;height:16px;">Descontar de mi saldo líquido</label>' +
    '<div class="field" id="fe-metodo-field"><label>¿De dónde sale el dinero?</label><div class="seg" id="fe-metodo">' +
      '<button class="seg-opt" data-m="efectivo">Efectivo</button>' +
      '<button class="seg-opt active" data-m="electronico">Tarjeta / electrónico</button>' +
    '</div></div>' +
    '<button class="btn-primary" id="fe-save">Aportar</button>'
  );
  function syncField() { document.getElementById('fe-metodo-field').hidden = !document.getElementById('fe-descontar').checked; }
  syncField();
  document.getElementById('fe-descontar').addEventListener('change', syncField);
  m.overlay.querySelectorAll('#fe-metodo .seg-opt').forEach(function (btn) {
    btn.addEventListener('click', function () {
      metodo = btn.dataset.m;
      m.overlay.querySelectorAll('#fe-metodo .seg-opt').forEach(function (b) { b.classList.toggle('active', b === btn); });
    });
  });
  document.getElementById('fe-save').addEventListener('click', function () {
    const monto = parseFloat(document.getElementById('fe-monto').value);
    if (isNaN(monto) || monto <= 0) { toast('Ingresa un monto válido'); return; }
    const descontar = document.getElementById('fe-descontar').checked;
    withLoading(this, async function () {
      await apiFetch('/fondo-emergencia/aportar', {
        method: 'POST', body: JSON.stringify({ monto: monto, metodo: metodo, descontar: descontar, fecha: todayISO() })
      });
      await refresh(); m.close(); toast('Fondo de emergencia actualizado');
    });
  });
}

/* ---------------- SUPLEMENTOS ---------------- */
/* Suma o resta una toma de un día. Se pinta al instante (optimista) y
   luego se sincroniza con lo que regresa el servidor. */
async function setToma(supId, fecha, delta) {
  const lista = state.tomasSuplementos || (state.tomasSuplementos = []);
  const idx = lista.findIndex(function (x) { return x.suplementoId === supId && x.fecha === fecha; });
  const actual = idx < 0 ? 0 : Number(lista[idx].cantidad) || 0;
  const nueva = Math.max(0, actual + delta);
  if (nueva === actual) return;
  if (idx < 0) lista.push({ id: 'tmp', suplementoId: supId, fecha: fecha, cantidad: nueva });
  else if (nueva === 0) lista.splice(idx, 1);
  else lista[idx].cantidad = nueva;
  pintarSuple(fecha);
  try {
    const r = await apiFetch('/suplementos/' + supId + '/toma', { method: 'POST', body: JSON.stringify({ fecha: fecha, cantidad: nueva }) });
    state.tomasSuplementos = r.tomas;
    pintarSuple(fecha);
  } catch (e) {
    toast(e.message || 'No se pudo guardar');
    await refresh();
    pintarSuple(fecha);
  }
}
function pintarSuple(fecha) {
  renderSuplementos();
  const body = document.getElementById('dia-suple-body');
  if (body && body.dataset.fecha === fecha) pintarDiaSuple(body, fecha);
}
function pintarDiaSuple(body, fecha) {
  const g = gramosDelDia(fecha);
  const tomados = gymItems().filter(function (s) { return tomaDe(s.id, fecha) > 0; }).length;
  body.innerHTML =
    '<div class="dia-resumen">' +
      '<div><b>' + fmtNum(g) + ' ' + G().unidad + '</b><span>' + G().total + '</span></div>' +
      '<div><b>' + tomados + ' / ' + gymItems().length + '</b><span>' + G().varios + '</span></div>' +
    '</div>' + supleFilasDia(fecha);
}
function openDiaSuple(fecha) {
  const m = openModal(
    '<div class="sheet-title">' + fechaLarga(fecha) + '</div>' +
    '<div id="dia-suple-body" data-fecha="' + fecha + '"></div>' +
    '<button class="btn-primary" id="dia-ok" style="margin-top:18px;">Listo</button>',
    { center: true }
  );
  m.overlay.querySelector('.sheet').classList.add('sheet-dia');
  pintarDiaSuple(document.getElementById('dia-suple-body'), fecha);
  document.getElementById('dia-ok').addEventListener('click', m.close);
}

function formSuplemento(s) {
  s = s || { nombre: '', cantidadPorToma: '', unidad: G().unidades[0] };
  return '<div class="field"><label>Nombre</label><input type="text" id="sup-nombre" placeholder="' + G().ejemplo + '" value="' + escapeHtml(s.nombre) + '"></div>' +
    '<div class="field"><label>' + G().cantidad + '</label><input type="number" id="sup-cant" step="0.5" min="0" placeholder="' + G().ejemploCant + '" value="' + (s.cantidadPorToma === '' ? '' : Number(s.cantidadPorToma)) + '"></div>' +
    '<div class="field" style="margin-bottom:0;"><label>Unidad</label><div class="seg" id="sup-unidad">' +
      G().unidades.map(function (u) { return '<button class="seg-opt' + (s.unidad === u ? ' active' : '') + '" data-u="' + u + '">' + u + '</button>'; }).join('') +
    '</div></div>' +
    '<div class="hint">' + G().hint + '</div>';
}
function leerFormSuplemento(m) {
  const act = m.overlay.querySelector('#sup-unidad .seg-opt.active');
  return {
    nombre: document.getElementById('sup-nombre').value.trim(),
    cantidadPorToma: parseFloat(document.getElementById('sup-cant').value),
    unidad: act ? act.dataset.u : G().unidades[0],
    tipo: gymTipo
  };
}
function activarUnidad(m) {
  m.overlay.querySelectorAll('#sup-unidad .seg-opt').forEach(function (btn) {
    btn.addEventListener('click', function () {
      m.overlay.querySelectorAll('#sup-unidad .seg-opt').forEach(function (b) { b.classList.toggle('active', b === btn); });
    });
  });
}
function openAddSuplemento() {
  const m = openModal('<div class="sheet-title">Nuevo ' + G().uno + '</div>' + formSuplemento() +
    '<button class="btn-primary" id="sup-save" style="margin-top:18px;">Agregar</button>');
  activarUnidad(m);
  document.getElementById('sup-save').addEventListener('click', function () {
    const d = leerFormSuplemento(m);
    if (!d.nombre || !(d.cantidadPorToma > 0)) { toast('Completa nombre y ' + G().cantidad.toLowerCase()); return; }
    withLoading(this, async function () {
      await apiFetch('/suplementos', { method: 'POST', body: JSON.stringify(d) });
      await refresh(); m.close(); toast((gymTipo === 'ejercicio' ? 'Ejercicio' : 'Suplemento') + ' agregado');
    });
  });
}
function openEditSuplemento(id) {
  const s = gymItems().find(function (x) { return x.id === id; }); if (!s) return;
  const dias = (state.tomasSuplementos || []).filter(function (x) { return x.suplementoId === id; }).length;
  const m = openModal('<div class="sheet-title">Editar ' + escapeHtml(s.nombre) + '</div>' + formSuplemento(s) +
    '<button class="btn-primary" id="sup-save" style="margin-top:18px;">Guardar</button>' +
    '<button class="btn-ghost btn-danger" id="sup-del" style="width:100%; margin-top:10px;">Eliminar ' + G().uno + '</button>' +
    '<div class="hint">Tiene ' + dias + (dias === 1 ? ' día registrado' : ' días registrados') + '; al eliminarlo se borra su historial.</div>');
  activarUnidad(m);
  document.getElementById('sup-save').addEventListener('click', function () {
    const d = leerFormSuplemento(m);
    if (!d.nombre || !(d.cantidadPorToma > 0)) { toast('Completa nombre y ' + G().cantidad.toLowerCase()); return; }
    withLoading(this, async function () {
      await apiFetch('/suplementos/' + id, { method: 'PUT', body: JSON.stringify(d) });
      await refresh(); m.close(); toast('Guardado');
    });
  });
  document.getElementById('sup-del').addEventListener('click', function () {
    if (!confirm('¿Eliminar ' + s.nombre + ' y todo su historial?')) return;
    withLoading(this, async function () {
      await apiFetch('/suplementos/' + id, { method: 'DELETE' });
      await refresh(); m.close(); toast((gymTipo === 'ejercicio' ? 'Ejercicio' : 'Suplemento') + ' eliminado');
    });
  });
}

/* ---------------- ASESOR (Inicio) ---------------- */
function openAsesor() {
  const m = openModal(
    '<div class="ia-marca">✦ Asesor</div>' +
    '<div class="ia-q" style="margin-top:12px;">¿Lo compro o no?</div>' +
    '<div class="ia-sub">Dime qué quieres comprar y te respondo con tus números reales: saldo, deudas, fondo, metas y lo que ya gastas en eso.</div>' +
    '<textarea id="asesor-pregunta" rows="3" class="ia-input" placeholder="Ej. Quiero comprarme un perfume nuevo"></textarea>' +
    '<div class="asesor-fila">' +
      '<div class="ia-monto ia-monto-sm"><span>$</span><input type="number" id="asesor-precio" inputmode="decimal" min="0" placeholder="Precio" aria-label="Precio (opcional)"></div>' +
      '<button class="btn-primary" id="btn-asesor">Preguntar</button>' +
    '</div>' +
    '<div class="hint">El precio es opcional; si no lo pones, estimo uno típico.</div>'
  );
  openAsesor._modal = m;
  if (enfocarSinTeclado()) document.getElementById('asesor-pregunta').focus();
  document.getElementById('btn-asesor').addEventListener('click', preguntarAsesor);
  document.getElementById('asesor-pregunta').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); preguntarAsesor(); }
  });
}
async function preguntarAsesor() {
  const pregunta = document.getElementById('asesor-pregunta').value.trim();
  const precio = parseFloat(document.getElementById('asesor-precio').value) || null;
  if (pregunta.length < 3) { toast('Escribe qué quieres comprar'); return; }
  const btn = document.getElementById('btn-asesor');
  btn.disabled = true; btn.textContent = 'Pensando…';
  try {
    const r = await apiFetch('/asesor', { method: 'POST', body: JSON.stringify({ pregunta: pregunta, precio: precio }) });
    if (openAsesor._modal) openAsesor._modal.close();
    setTimeout(function () { mostrarAsesor(r); }, 180);
  } catch (e) {
    toast(e.message || 'El asesor no respondió');
  } finally {
    btn.disabled = false; btn.textContent = 'Preguntar';
  }
}
function mostrarAsesor(r) {
  const V = {
    comprar: { txt: 'Cómpralo', color: 'var(--cyan)' },
    esperar: { txt: 'Espera un poco', color: 'var(--amber)' },
    no_comprar: { txt: 'Mejor no', color: 'var(--coral)' }
  }[r.veredicto] || { txt: 'Espera un poco', color: 'var(--amber)' };
  const c = catInfo(r.categoria);
  const m = openModal(
    '<div class="ia-marca">✦ Asesor</div>' +
    '<div class="asesor-preg">“' + escapeHtml(r.pregunta) + '”</div>' +
    '<div class="asesor-veredicto" style="--vc:' + V.color + '">' +
      '<b>' + V.txt + '</b>' +
      '<div class="result-stars" id="asesor-stars"></div>' +
      '<div class="asesor-titulo">' + escapeHtml(r.titulo) + '</div>' +
    '</div>' +
    (r.precio ? '<div class="ia-ficha"><div class="ia-ficha-cat" style="background:' + c.color + '22; color:' + c.color + '">' + c.icon + '</div>' +
      '<div class="ia-ficha-txt"><b>' + (r.precioEstimado ? 'Precio estimado' : 'Precio') + '</b><span>' + c.label + ' · tienes ' + money(r.disponible) + ' disponibles</span></div>' +
      '<b class="ia-ficha-monto">' + money(r.precio) + '</b></div>' : '') +
    '<p class="asesor-resumen">' + escapeHtml(r.resumen) + '</p>' +
    '<div class="reflexion-box">' + r.razones.map(function (x) { return '<div class="ia-razon">' + escapeHtml(x) + '</div>'; }).join('') + '</div>' +
    (r.alternativa ? '<div class="asesor-bloque"><span>En vez de eso</span>' + escapeHtml(r.alternativa) + '</div>' : '') +
    (r.plan ? '<div class="asesor-bloque"><span>Cómo juntarlo</span>' + escapeHtml(r.plan) + '</div>' : '') +
    '<button class="btn-primary" id="asesor-ok" style="margin-top:18px;">Entendido</button>'
  );
  renderStars(document.getElementById('asesor-stars'), Number(r.score), 22);
  document.getElementById('asesor-ok').addEventListener('click', m.close);
}

/* ---------------- SUSCRIPCIONES ---------------- */
function formSuscripcion(s) {
  s = s || { nombre: '', monto: '', frecuencia: 'mensual', metodo: 'electronico', categoria: 'entretenimiento', proximoCobro: localISO() };
  return '<div class="field"><label>Nombre</label><input type="text" id="su-nombre" placeholder="Ej. Spotify, Claude, Gym" value="' + escapeHtml(s.nombre) + '"></div>' +
    '<div class="field"><label>Costo (MXN)</label><input type="number" id="su-monto" inputmode="decimal" min="0" step="0.01" placeholder="0" value="' + (s.monto === '' ? '' : Number(s.monto)) + '"></div>' +
    '<div class="field"><label>¿Cada cuándo se cobra?</label><div class="seg" id="su-freq">' +
      ['semanal', 'quincenal', 'mensual', 'anual'].map(function (f) { return '<button class="seg-opt' + (s.frecuencia === f ? ' active' : '') + '" data-v="' + f + '">' + f.charAt(0).toUpperCase() + f.slice(1) + '</button>'; }).join('') +
    '</div></div>' +
    '<div class="field"><label>Próximo cobro</label><input type="date" id="su-fecha" value="' + String(s.proximoCobro).slice(0, 10) + '"></div>' +
    '<div class="field"><label>¿Con qué se paga?</label><div class="seg" id="su-metodo">' +
      '<button class="seg-opt' + (s.metodo === 'efectivo' ? ' active' : '') + '" data-v="efectivo">Efectivo</button>' +
      '<button class="seg-opt' + (s.metodo !== 'efectivo' ? ' active' : '') + '" data-v="electronico">Tarjeta / electrónico</button>' +
    '</div></div>' +
    '<div class="field" style="margin-bottom:0;"><label>Categoría</label><div class="cat-grid" id="su-cats">' +
      CATEGORIAS.map(function (c) { return '<button class="cat-opt' + (s.categoria === c.id ? ' active' : '') + '" data-cat="' + c.id + '"><span class="ci">' + c.icon + '</span>' + c.label + '</button>'; }).join('') +
    '</div></div>';
}
function activarFormSuscripcion(m) {
  ['#su-freq', '#su-metodo'].forEach(function (sel) {
    m.overlay.querySelectorAll(sel + ' .seg-opt').forEach(function (b) {
      b.addEventListener('click', function () { m.overlay.querySelectorAll(sel + ' .seg-opt').forEach(function (x) { x.classList.toggle('active', x === b); }); });
    });
  });
  m.overlay.querySelectorAll('#su-cats .cat-opt').forEach(function (b) {
    b.addEventListener('click', function () { m.overlay.querySelectorAll('#su-cats .cat-opt').forEach(function (x) { x.classList.toggle('active', x === b); }); });
  });
}
function leerFormSuscripcion(m) {
  const val = function (sel, attr) { const a = m.overlay.querySelector(sel + ' .active'); return a ? a.dataset[attr] : null; };
  return {
    nombre: document.getElementById('su-nombre').value.trim(),
    monto: parseFloat(document.getElementById('su-monto').value),
    frecuencia: val('#su-freq', 'v'),
    proximoCobro: document.getElementById('su-fecha').value,
    metodo: val('#su-metodo', 'v'),
    categoria: val('#su-cats', 'cat') || 'entretenimiento'
  };
}
function openAddSuscripcion() {
  const m = openModal('<div class="sheet-title">Nueva suscripción</div>' + formSuscripcion() +
    '<button class="btn-primary" id="su-save" style="margin-top:18px;">Agregar</button>');
  activarFormSuscripcion(m);
  document.getElementById('su-save').addEventListener('click', function () {
    const d = leerFormSuscripcion(m);
    if (!d.nombre || !(d.monto > 0) || !d.proximoCobro) { toast('Completa nombre, costo y fecha de cobro'); return; }
    withLoading(this, async function () {
      await apiFetch('/suscripciones', { method: 'POST', body: JSON.stringify(d) });
      await refresh(); m.close(); toast('Suscripción agregada');
    });
  });
}
function openSuscripcion(id) {
  const s = (state.suscripciones || []).find(function (x) { return x.id === id; }); if (!s) return;
  const m = openModal('<div class="sheet-title">' + escapeHtml(s.nombre) + '</div>' +
    (s.activa ? '<button class="btn-primary" id="su-pagar" style="margin-bottom:10px;">Registrar pago de ' + money(s.monto) + '</button>' +
      '<div class="hint" style="margin:-2px 0 16px;">Se guarda como gasto, se descuenta de tu ' + (s.metodo === 'efectivo' ? 'efectivo' : 'tarjeta') + ' y el próximo cobro se mueve solo.</div>' : '') +
    formSuscripcion(s) +
    '<button class="btn-primary" id="su-save" style="margin-top:18px;">Guardar cambios</button>' +
    '<div class="btn-row" style="margin-top:10px;">' +
      '<button class="btn-ghost" id="su-pausa" style="flex:1;">' + (s.activa ? 'Pausar' : 'Reactivar') + '</button>' +
      '<button class="btn-ghost btn-danger" id="su-del" style="flex:1;">Eliminar</button>' +
    '</div>');
  activarFormSuscripcion(m);
  const pagar = document.getElementById('su-pagar');
  if (pagar) pagar.addEventListener('click', function () {
    withLoading(this, async function () {
      await apiFetch('/suscripciones/' + id + '/pagar', { method: 'POST', body: JSON.stringify({}) });
      await refresh(); m.close(); toast('Pago de ' + s.nombre + ' registrado');
    });
  });
  document.getElementById('su-save').addEventListener('click', function () {
    const d = leerFormSuscripcion(m);
    if (!d.nombre || !(d.monto > 0) || !d.proximoCobro) { toast('Completa nombre, costo y fecha de cobro'); return; }
    d.activa = s.activa;
    withLoading(this, async function () {
      await apiFetch('/suscripciones/' + id, { method: 'PUT', body: JSON.stringify(d) });
      await refresh(); m.close(); toast('Guardado');
    });
  });
  document.getElementById('su-pausa').addEventListener('click', function () {
    const d = Object.assign({}, s, { proximoCobro: String(s.proximoCobro).slice(0, 10), activa: !s.activa });
    withLoading(this, async function () {
      await apiFetch('/suscripciones/' + id, { method: 'PUT', body: JSON.stringify(d) });
      await refresh(); m.close(); toast(d.activa ? 'Reactivada' : 'Pausada');
    });
  });
  document.getElementById('su-del').addEventListener('click', function () {
    if (!confirm('¿Eliminar ' + s.nombre + '? Los pagos que ya registraste se quedan en tus gastos.')) return;
    withLoading(this, async function () {
      await apiFetch('/suscripciones/' + id, { method: 'DELETE' });
      await refresh(); m.close(); toast('Suscripción eliminada');
    });
  });
}
