const pool = require('../db');

/* Sin login: la app la usa una sola persona, así que ya no se pide
   token. Todas las rutas trabajan con el usuario de ADMIN_USERNAME
   (o, si no está definido, el primer usuario de la tabla). El id se
   busca una vez y se guarda en memoria. */
let userIdCache = null;

async function requireAuth(req, res, next) {
  try {
    if (userIdCache === null) {
      const username = process.env.ADMIN_USERNAME;
      const { rows } = username
        ? await pool.query('SELECT id FROM users WHERE username = $1', [username])
        : await pool.query('SELECT id FROM users ORDER BY id LIMIT 1');
      if (!rows.length) {
        return res.status(500).json({ error: 'No hay usuario en la base de datos. Corre npm run seed.' });
      }
      userIdCache = rows[0].id;
    }
    req.userId = userIdCache;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
