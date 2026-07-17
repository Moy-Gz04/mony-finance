/* ==================================================================
   NEXUSFIN · Crear un usuario nuevo
   ------------------------------------------------------------------
   A diferencia de seed.js (que siempre usa ADMIN_USERNAME/PASSWORD
   del .env, pensado para el primer usuario), este script recibe el
   usuario y la contraseña como argumentos, para poder crear cuantos
   usuarios quieras sin editar el .env cada vez.

   Uso:
     npm run create-user -- NombreDeUsuario "su contraseña"

   La contraseña se encripta con bcrypt antes de guardarse — nunca se
   guarda en texto plano, ni aquí ni en la base de datos.
   ================================================================== */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./db');

async function createUser() {
  const username = process.argv[2];
  const password = process.argv[3];

  if (!username || !password) {
    console.error('Uso: npm run create-user -- NombreDeUsuario "su contraseña"');
    process.exit(1);
  }
  if (password.length < 4) {
    console.error('La contraseña es muy corta.');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      console.error(`Ya existe un usuario "${username}". Si quieres cambiarle la contraseña, usa npm run seed (con ADMIN_USERNAME/ADMIN_PASSWORD en tu .env) o dime y hago un script para eso.`);
      process.exit(1);
    }

    const hash = await bcrypt.hash(password, 12);
    const res = await client.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
      [username, hash]
    );
    const userId = res.rows[0].id;

    await client.query(`INSERT INTO saldo (user_id, efectivo, tarjeta) VALUES ($1, 0, 0)`, [userId]);
    await client.query(`INSERT INTO config (user_id) VALUES ($1)`, [userId]);
    await client.query(`INSERT INTO fondo_emergencia (user_id) VALUES ($1)`, [userId]);

    await client.query('COMMIT');
    console.log(`✔ Usuario "${username}" creado (id ${userId}). Ya puede iniciar sesión.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('✘ Error creando el usuario:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

createUser();
