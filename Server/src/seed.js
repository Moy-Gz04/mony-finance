/* ==================================================================
   NEXUSFIN · Seed — crea el usuario inicial
   ------------------------------------------------------------------
   Lee ADMIN_USERNAME y ADMIN_PASSWORD de tus variables de entorno
   (.env en local, "Environment" en Render), genera el hash con
   bcrypt y crea también sus filas iniciales de saldo/config/fondo.
   La contraseña NUNCA se guarda en texto plano, ni aquí ni en la DB.
   Uso:  npm run seed
   ================================================================== */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./db');

async function seed() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.error('Define ADMIN_USERNAME y ADMIN_PASSWORD en tu .env antes de correr el seed.');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const hash = await bcrypt.hash(password, 12);
    const existing = await client.query('SELECT id FROM users WHERE username = $1', [username]);

    let userId;
    if (existing.rows.length) {
      userId = existing.rows[0].id;
      await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
      console.log(`Usuario "${username}" ya existía — contraseña actualizada.`);
    } else {
      const res = await client.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
        [username, hash]
      );
      userId = res.rows[0].id;
      console.log(`Usuario "${username}" creado (id ${userId}).`);
    }

    await client.query(
      `INSERT INTO saldo (user_id, efectivo, tarjeta) VALUES ($1, 0, 15000)
       ON CONFLICT (user_id) DO NOTHING`, [userId]
    );
    await client.query(
      `INSERT INTO config (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]
    );
    await client.query(
      `INSERT INTO fondo_emergencia (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]
    );

    await client.query('COMMIT');
    console.log('✔ Listo. Ya puedes iniciar sesión con ese usuario y contraseña.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('✘ Error en el seed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
