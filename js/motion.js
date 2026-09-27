/* ==================================================================
   NEXUSFIN · Movimiento (Liquid Glass)
   ------------------------------------------------------------------
   Se carga al final. No cambia datos ni lógica: solo envuelve
   showView / renderInicio para agregar movimiento.
   - Entrada escalonada al cambiar de apartado (las tarjetas se
     "materializan", ver liquid.css).
   - Píldora de vidrio que se desliza bajo la pestaña activa.
   - Reflejo que sigue al puntero sobre tarjetas (solo compu).
   - El saldo grande cuenta hacia su nuevo valor.
   Todo se apaga con "reducir movimiento".
   ================================================================== */
(function () {
  const reducir = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- Entrada escalonada ---------- */
  function animarEntrada(nombre) {
    const view = document.getElementById('view-' + nombre);
    if (!view) return;
    const hijos = Array.prototype.slice.call(view.children).filter(function (el) { return !el.hidden; });
    hijos.forEach(function (el, i) { el.style.setProperty('--i', Math.min(i, 10)); });
    view.classList.remove('entrando');
    void view.offsetWidth; // reinicia la animación si ya estaba
    view.classList.add('entrando');
    clearTimeout(view._t);
    // Se quita al terminar para que la animación no "congele" el transform
    // (si no, el efecto de presionar dejaría de funcionar).
    view._t = setTimeout(function () { view.classList.remove('entrando'); }, 520 + Math.min(hijos.length, 10) * 45 + 80);
  }

  /* ---------- Píldora del menú ---------- */
  const tabbar = document.querySelector('.tabbar');
  const pill = document.createElement('span');
  pill.className = 'tab-pill';
  pill.setAttribute('aria-hidden', 'true');
  if (tabbar) tabbar.insertBefore(pill, tabbar.firstChild);

  function moverPill() {
    const activa = tabbar && tabbar.querySelector('.tab-btn.active');
    if (!activa) { pill.style.opacity = '0'; return; }
    pill.style.opacity = '1';
    pill.style.width = activa.offsetWidth + 'px';
    pill.style.transform = 'translateX(' + activa.offsetLeft + 'px)';
  }
  window.addEventListener('resize', moverPill);

  /* ---------- Envolver showView ---------- */
  if (typeof window.showView === 'function') {
    const original = window.showView;
    window.showView = function (nombre) {
      original(nombre);
      animarEntrada(nombre);
      moverPill();
    };
  }
  // Configuración (engrane) no pasa por showView: se anima igual.
  const btnConfig = document.getElementById('btn-settings');
  if (btnConfig) btnConfig.addEventListener('click', function () {
    setTimeout(function () { animarEntrada('config'); }, 0);
  });

  /* ---------- Reflejo que sigue al puntero (solo mouse) ---------- */
  if (window.matchMedia('(hover:hover) and (pointer:fine)').matches) {
    let pendiente = null, ultimo = null;
    document.addEventListener('pointermove', function (e) {
      ultimo = e;
      if (pendiente) return;
      pendiente = requestAnimationFrame(function () {
        pendiente = null;
        const el = ultimo.target.closest && ultimo.target.closest('.card, .row');
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', ((ultimo.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        el.style.setProperty('--my', ((ultimo.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      });
    }, { passive: true });
  }

  /* ---------- El saldo cuenta hacia su valor ---------- */
  let valorMostrado = null;
  if (typeof window.renderInicio === 'function') {
    const originalInicio = window.renderInicio;
    window.renderInicio = function () {
      originalInicio();
      const el = document.getElementById('hero-amount');
      if (!el || typeof state === 'undefined' || !state.saldo) return;
      const destino = Math.max(0, Number(state.saldo.efectivo) || 0) + Math.max(0, Number(state.saldo.tarjeta) || 0);
      const desde = valorMostrado === null ? 0 : valorMostrado;
      valorMostrado = destino;
      if (reducir.matches || desde === destino) return;
      const inicio = performance.now(), dur = 750;
      cancelAnimationFrame(el._raf);
      (function paso(t) {
        const p = Math.min(1, (t - inicio) / dur);
        const k = 1 - Math.pow(1 - p, 3); // desacelera al llegar
        el.innerHTML = money(desde + (destino - desde) * k) + '<span>MXN</span>';
        if (p < 1) el._raf = requestAnimationFrame(paso);
      })(inicio);
    };
  }

  /* ---------- Arranque ---------- */
  moverPill();
  animarEntrada('inicio');
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moverPill);
})();
