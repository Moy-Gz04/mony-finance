/* ==================================================================
   NEXUSFIN · Conexión a PostgreSQL (Neon)
   ------------------------------------------------------------------
   Usa exclusivamente process.env.DATABASE_URL — nunca escribas la
   cadena de conexión aquí. En local va en tu archivo .env (que está
   en .gitignore); en Render se configura en Settings → Environment.
   ================================================================== */
const { Pool, types } = require('pg');

// Por defecto, node-postgres regresa las columnas NUMERIC como texto
// (para no perder precisión con números gigantes). En esta app son
// siempre montos en pesos, así que conviene recibirlos ya como
// number — evita bugs silenciosos si algún cálculo en el front se le
// olvida envolver el valor en Number(...).
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

// Por defecto, node-postgres convierte las columnas DATE en un objeto
// Date de JS con hora y zona horaria (ej. "2026-07-30T00:00:00.000Z").
// Todo el front trabaja con fechas como texto plano "YYYY-MM-DD"
// (fmtDate, addDays, addMonths, todayISO...), así que dejamos la
// fecha tal cual la manda Postgres, sin convertirla — si no, queda
// una fecha inválida al concatenarle la hora otra vez en el front.
types.setTypeParser(1082, (val) => val);

if (!process.env.DATABASE_URL) {
  console.error('Falta la variable de entorno DATABASE_URL. Revisa tu archivo .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Neon requiere SSL
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL', err);
});

module.exports = pool;
