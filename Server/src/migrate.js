/* ==================================================================
   NEXUSFIN · Migración
   ------------------------------------------------------------------
   Ejecuta sql/schema.sql contra la base de datos de DATABASE_URL.
   Uso:  npm run migrate
   ================================================================== */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function migrate() {
  const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  console.log('Aplicando sql/schema.sql ...');
  try {
    await pool.query(sql);
    console.log('✔ Esquema aplicado correctamente. Todas las tablas están listas.');
  } catch (err) {
    console.error('✘ Error aplicando el esquema:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
