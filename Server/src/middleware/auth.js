const jwt = require('jsonwebtoken');

/* Espera el header: Authorization: Bearer <token>
   Si es válido, agrega req.userId con el id del usuario dueño del token. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o vencido' });
  }
}

module.exports = { requireAuth };
