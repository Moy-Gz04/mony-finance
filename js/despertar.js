/* ==================================================================
   BATFINANCE · Despertar del servidor
   ------------------------------------------------------------------
   El servidor gratuito de Render se duerme si nadie lo usa y tarda
   ~30-50 s en despertar. Al abrir la app se prueba /health: si no
   contesta rápido, se muestra la pantalla "Descifrando datos, Sr. Wayne"
   con el murciélago, chispas y una cuenta regresiva de 40 s, y se
   sigue preguntando hasta que responde. Luego se desvanece sola.
   ================================================================== */
(function () {
  const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SEGUNDOS = 40;
  const MENSAJES = [
    'Conectando con la Baticomputadora',
    'Desencriptando registros financieros',
    'Verificando saldos y deudas',
    'Sincronizando suscripciones',
    'Preparando tu tablero'
  ];

  function urlSalud() { return API_BASE.replace(/\/api\/?$/, '') + '/health'; }

  async function responde(msTimeout) {
    const ctrl = new AbortController();
    const t = setTimeout(function () { ctrl.abort(); }, msTimeout);
    try { const r = await fetch(urlSalud(), { cache: 'no-store', signal: ctrl.signal }); return r.ok; }
    catch (e) { return false; }
    finally { clearTimeout(t); }
  }

  function crearPantalla() {
    const el = document.createElement('div');
    el.className = 'despertar';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML =
      '<canvas class="despertar-chispas" aria-hidden="true"></canvas>' +
      '<div class="despertar-centro">' +
        '<div class="despertar-señal" aria-hidden="true"></div>' +
        '<img src="img/bat-marca.png" alt="" class="despertar-bat">' +
        '<div class="despertar-titulo">Preparando…</div>' +
        '<div class="despertar-texto">Descifrando datos, Sr. Wayne.<br>Un momento.</div>' +
        '<div class="despertar-reloj">' +
          '<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="aro-fondo"/><circle cx="60" cy="60" r="52" class="aro"/></svg>' +
          '<b class="despertar-num">' + SEGUNDOS + '</b><span>seg</span>' +
        '</div>' +
        '<div class="despertar-sub"><span class="despertar-msg">' + MENSAJES[0] + '</span><i class="puntos"><i></i><i></i><i></i></i></div>' +
      '</div>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('ver'); });
    return el;
  }

  /* Chispas: salen del murciélago hacia arriba y a los lados, caen con gravedad */
  function iniciarChispas(canvas) {
    if (reducir) return function () {};
    const ctx = canvas.getContext('2d');
    let w, h, dpr, chispas = [], vivo = true;
    function medir() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    medir(); window.addEventListener('resize', medir);
    function nueva() {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
      const vel = 1.5 + Math.random() * 4;
      return {
        x: w / 2 + (Math.random() - 0.5) * 60, y: h * 0.36 + (Math.random() - 0.5) * 20,
        vx: Math.cos(ang) * vel, vy: Math.sin(ang) * vel,
        vida: 1, dec: 0.008 + Math.random() * 0.018, r: 0.8 + Math.random() * 1.8,
        blanca: Math.random() < 0.3
      };
    }
    (function cuadro() {
      if (!vivo) return;
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < 4; i++) chispas.push(nueva());
      chispas = chispas.filter(function (c) { return c.vida > 0; });
      ctx.globalCompositeOperation = 'lighter';
      chispas.forEach(function (c) {
        c.x += c.vx; c.y += c.vy; c.vy += 0.07; c.vx *= 0.99; c.vida -= c.dec;
        const a = Math.max(0, c.vida);
        ctx.beginPath();
        ctx.fillStyle = c.blanca ? 'rgba(255,255,255,' + a + ')' : 'rgba(255,' + Math.round(170 + 60 * a) + ',70,' + a + ')';
        ctx.shadowColor = 'rgba(255,190,80,' + a + ')'; ctx.shadowBlur = 8;
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill();
        // estela
        ctx.strokeStyle = 'rgba(255,200,110,' + a * 0.45 + ')'; ctx.lineWidth = c.r * 0.8;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x - c.vx * 3, c.y - c.vy * 3); ctx.stroke();
      });
      requestAnimationFrame(cuadro);
    })();
    return function () { vivo = false; window.removeEventListener('resize', medir); };
  }

  window.despertarServidor = async function () {
    if (!navigator.onLine) return;            // sin internet: se usa la copia guardada
    if (await responde(1800)) return;         // despierto: no se muestra nada

    const el = crearPantalla();
    const parar = iniciarChispas(el.querySelector('canvas'));
    const num = el.querySelector('.despertar-num');
    const aro = el.querySelector('.aro');
    const msg = el.querySelector('.despertar-msg');
    const circ = 2 * Math.PI * 52;
    aro.style.strokeDasharray = circ;
    const inicio = Date.now();

    const reloj = setInterval(function () {
      const pasados = (Date.now() - inicio) / 1000;
      const quedan = Math.max(0, Math.ceil(SEGUNDOS - pasados));
      num.textContent = quedan;
      aro.style.strokeDashoffset = circ * Math.min(1, pasados / SEGUNDOS);
      msg.textContent = quedan === 0 ? 'Casi listo, Sr. Wayne' : MENSAJES[Math.min(MENSAJES.length - 1, Math.floor(pasados / (SEGUNDOS / MENSAJES.length)))];
    }, 250);

    // Preguntar cada 2 s hasta que conteste (sin límite: si tarda más de 40 s, sigue esperando).
    while (!(await responde(8000))) {
      await new Promise(function (r) { setTimeout(r, 2000); });
    }

    clearInterval(reloj);
    num.textContent = '✓';
    msg.textContent = 'Acceso concedido';
    el.classList.add('listo');
    setTimeout(function () {
      el.classList.remove('ver');
      setTimeout(function () { parar(); el.remove(); }, 700);
    }, reducir ? 200 : 900);
  };
})();
