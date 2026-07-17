/* ==================================================================
   NEXUSFIN · MODALS
   ------------------------------------------------------------------
   Sistema de hojas modales + todos los formularios de "agregar/ver
   detalle". Cada acción llama a la API (apiFetch, de state.js) y
   termina con refresh(), que vuelve a pedir el estado completo al
   servidor y repinta — así la app siempre muestra exactamente lo que
   quedó guardado en la base de datos, sin cálculos duplicados aquí.

   El asistente de compra inteligente (startWizard) sigue siendo la
   única parte que habla con PurchaseEvaluator.
   ================================================================== */

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
    toast(err.message || 'Algo salió mal, intenta de nuevo');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

/* ================= GASTOS ================= */
function openAddGasto() {
  let selectedCat = null;
  let metodo = 'electronico';
  const m = openModal(
    '<div class="sheet-title">Nueva compra / gasto</div>' +
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
      '<button class="btn-primary" id="g-evaluar" style="flex:1; width:auto; min-height:56px; display:flex; align-items:center; justify-content:center; font-size:12.5px; line-height:1.25; padding:10px 6px; background:linear-gradient(120deg,var(--violet),#6a4fe0);">Evaluar si es una compra inteligente</button>' +
      '<button class="btn-primary" id="g-directo" style="flex:1; width:auto; min-height:56px; display:flex; align-items:center; justify-content:center; font-size:12.5px; line-height:1.25; padding:10px 6px; color:var(--violet); background:linear-gradient(120deg, rgba(139,107,255,0.18), rgba(106,79,224,0.18)); border:1px solid rgba(139,107,255,0.4); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); box-shadow:none;">Guardar sin evaluar</button>' +
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
    return 'Esta compra no compromete tu estabilidad financiera. ¿Confirmas que quieres seguir adelante?';
  }

  function finish() {
    const result = PurchaseEvaluator.evaluate(gastoDraft.cat, answers, contexto);
    const restanteDespues = contexto.saldoActual - gastoDraft.monto;
    const body = document.getElementById('wiz-body');
    const color = toneColor(result.tone);
    const breakdownHtml = result.breakdown.map(function (b) {
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
      '<div class="result-breakdown">' + breakdownHtml + '</div>' +
      '<div class="wiz-q" style="font-size:14.5px; text-align:center; margin:20px 0 4px;">¿Estás seguro de hacer esta compra?</div>' +
      '<div class="btn-row" style="margin-top:8px;">' +
        '<button class="small-btn" id="wiz-cancelar" style="flex:1; padding:13px;">Mejor la cancelo</button>' +
        '<button class="small-btn primary" id="wiz-continuar" style="flex:1; padding:13px;">Sí, la compro</button>' +
      '</div>';
    renderStars(document.getElementById('result-stars'), result.score, 30);
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
    ? '<div class="kv"><span class="kv-label">Progreso</span><span class="kv-value">' + (d.pagosRealizados || 0) + ' de ' + d.duracion + ' pagos</span></div>'
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
