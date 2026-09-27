/* ==================================================================
   BATFINANCE · Movimientos automáticos
   ------------------------------------------------------------------
   Se ejecuta al abrir la app (GET /api/estado) y con la tarea diaria
   (/api/cron/diario). Es idempotente: correrlo varias veces el mismo
   día no duplica nada.
   - Ingresos recurrentes: registra los que ya tocaron (se pone al
     corriente si pasaron varios) y suma al saldo.
   - Suscripciones con cobro automático: registra el gasto y descuenta
     del saldo; si no alcanza, lo deja pendiente y lo anota.
   - Guarda la foto del patrimonio de hoy (para la gráfica).
   Todo lo que hace queda en movimientos_auto para avisar y deshacer.
   ================================================================== */
const pool = require('./db');

/* Fecha de hoy en México (no UTC): después de las 6 pm UTC ya es "mañana". */
function hoyMX() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function sumar(fecha, frecuencia) {
  const [y, m, d] = String(fecha).slice(0, 10).split('-').map(Number);
  if (frecuencia === 'semanal' || frecuencia === 'quincenal') {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + (frecuencia === 'semanal' ? 7 : 15));
    return dt.toISOString().slice(0, 10);
  }
  if (frecuencia === 'anual') {
    const ultimo = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
    return new Date(Date.UTC(y + 1, m - 1, Math.min(d, ultimo))).toISOString().slice(0, 10);
  }
  // mensual: mismo día del mes siguiente (o el último si no existe)
  const ultimo = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

const fecha10 = (f) => String(f).slice(0, 10);

async function procesarAutomaticos(userId) {
  const hoy = hoyMX();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Un solo proceso a la vez por usuario (evita dobles cobros si se abre en dos lados).
    await client.query('SELECT pg_advisory_xact_lock($1)', [userId]);

    /* ---- Ingresos recurrentes ---- */
    const ings = await client.query(
      'SELECT * FROM ingresos_recurrentes WHERE user_id = $1 AND activo AND proximo <= $2 FOR UPDATE', [userId, hoy]);
    for (const r of ings.rows) {
      let proximo = fecha10(r.proximo);
      for (let n = 0; proximo <= hoy && n < 30; n++) {
        const ya = await client.query(
          "SELECT 1 FROM movimientos_auto WHERE ref_id = $1 AND fecha = $2 AND tipo = 'ingreso'", [r.id, proximo]);
        if (!ya.rows.length) {
          const ins = await client.query(
            `INSERT INTO ingresos (user_id, nombre, monto, frecuencia, fecha, metodo)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [userId, r.nombre, r.monto, r.frecuencia.charAt(0).toUpperCase() + r.frecuencia.slice(1), proximo, r.metodo]);
          const key = r.metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
          await client.query(`UPDATE saldo SET ${key} = ${key} + $1, updated_at = now() WHERE user_id = $2`, [r.monto, userId]);
          await client.query(
            `INSERT INTO movimientos_auto (user_id, tipo, ref_id, registro_id, nombre, monto, fecha)
             VALUES ($1,'ingreso',$2,$3,$4,$5,$6)`,
            [userId, r.id, ins.rows[0].id, r.nombre, r.monto, proximo]);
        }
        proximo = sumar(proximo, r.frecuencia);
      }
      await client.query('UPDATE ingresos_recurrentes SET proximo = $1 WHERE id = $2', [proximo, r.id]);
    }

    /* ---- Suscripciones con cobro automático ---- */
    const subs = await client.query(
      'SELECT * FROM suscripciones WHERE user_id = $1 AND activa AND auto_cobro AND proximo_cobro <= $2 FOR UPDATE', [userId, hoy]);
    for (const s of subs.rows) {
      let proximo = fecha10(s.proximo_cobro);
      for (let n = 0; proximo <= hoy && n < 30; n++) {
        const key = s.metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
        const saldo = (await client.query(`SELECT ${key}::float AS v FROM saldo WHERE user_id = $1`, [userId])).rows[0];
        if (!saldo || saldo.v < Number(s.monto)) {
          // No alcanza: queda pendiente (se ve como "Cobro pendiente") y se avisa una vez.
          await client.query(
            `INSERT INTO movimientos_auto (user_id, tipo, ref_id, nombre, monto, fecha, estado)
             VALUES ($1,'suscripcion',$2,$3,$4,$5,'sin_saldo') ON CONFLICT (ref_id, fecha, tipo) DO NOTHING`,
            [userId, s.id, s.nombre, s.monto, proximo]);
          break;
        }
        const ya = await client.query(
          "SELECT estado FROM movimientos_auto WHERE ref_id = $1 AND fecha = $2 AND tipo = 'suscripcion'", [s.id, proximo]);
        if (ya.rows.length && ya.rows[0].estado !== 'sin_saldo') { proximo = sumar(proximo, s.frecuencia); continue; }
        const g = await client.query(
          `INSERT INTO gastos (user_id, descripcion, categoria, monto, fecha, metodo)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [userId, 'Suscripción: ' + s.nombre, s.categoria, s.monto, proximo, s.metodo]);
        await client.query(`UPDATE saldo SET ${key} = ${key} - $1, updated_at = now() WHERE user_id = $2`, [s.monto, userId]);
        await client.query(
          `INSERT INTO movimientos_auto (user_id, tipo, ref_id, registro_id, nombre, monto, fecha, estado, visto)
           VALUES ($1,'suscripcion',$2,$3,$4,$5,$6,'aplicado',false)
           ON CONFLICT (ref_id, fecha, tipo) DO UPDATE SET registro_id = EXCLUDED.registro_id, estado = 'aplicado', visto = false`,
          [userId, s.id, g.rows[0].id, s.nombre, s.monto, proximo]);
        proximo = sumar(proximo, s.frecuencia);
      }
      await client.query('UPDATE suscripciones SET proximo_cobro = $1 WHERE id = $2', [proximo, s.id]);
    }

    /* ---- Foto del patrimonio de hoy ---- */
    await client.query(
      `INSERT INTO patrimonio_diario (user_id, fecha, liquido, ahorro, deudas)
       SELECT $1, $2::date,
         COALESCE((SELECT efectivo + tarjeta FROM saldo WHERE user_id = $1), 0),
         COALESCE((SELECT actual FROM fondo_emergencia WHERE user_id = $1), 0)
           + COALESCE((SELECT SUM(monto_actual) FROM metas WHERE user_id = $1), 0)
           + COALESCE((SELECT SUM(monto) FROM inversiones WHERE user_id = $1), 0),
         COALESCE((SELECT SUM(monto_pendiente) FROM deudas WHERE user_id = $1 AND NOT pagada), 0)
       ON CONFLICT (user_id, fecha) DO UPDATE SET liquido = EXCLUDED.liquido, ahorro = EXCLUDED.ahorro, deudas = EXCLUDED.deudas`,
      [userId, hoy]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Automáticos:', err.message);
  } finally {
    client.release();
  }
}

module.exports = { procesarAutomaticos, hoyMX, sumar };
