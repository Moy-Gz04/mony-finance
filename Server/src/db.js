/* ==================================================================
   NEXUSFIN · Conexión a PostgreSQL (Neon)
   ------------------------------------------------------------------
   Usa exclusivamente process.env.DATABASE_URL — nunca escribas la
   cadena de conexión aquí. En local va en tu archivo .env (que está
   en .gitignore); en Render se configura en Settings → Environment.
   ================================================================== */
const { Pool } = require('pg');

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
