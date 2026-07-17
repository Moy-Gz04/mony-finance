/* ==================================================================
   NEXUSFIN · Validación de fondos
   ------------------------------------------------------------------
   Antes de restar dinero de efectivo/tarjeta por cualquier motivo
   (gasto, inversión, pago de deuda, apuesta, aportación con
   descuento), se verifica que de verdad alcance. Si no alcanza, se
   lanza un error con forma reconocible que el front convierte en una
   alerta clara ("Fondos insuficientes"), en vez de dejar pasar el
   movimiento y solo topar el saldo en $0 como se hacía antes.
   ================================================================== */

class FondosInsuficientesError extends Error {
  constructor(metodo, disponible, requerido) {
    super('Fondos insuficientes');
    this.tipo = 'fondos_insuficientes';
    this.metodo = metodo;
    this.disponible = disponible;
    this.requerido = requerido;
    this.faltante = Math.round((requerido - disponible) * 100) / 100;
  }
}

/* client: conexión ya dentro de una transacción (BEGIN ya corrido).
   userId: dueño del saldo. metodo: 'efectivo' | 'electronico'.
   monto: lo que se va a restar. Lanza FondosInsuficientesError si no
   alcanza; si alcanza, no regresa nada (solo no truena). */
async function verificarFondos(client, userId, metodo, monto) {
  const key = metodo === 'efectivo' ? 'efectivo' : 'tarjeta';
  const result = await client.query(
    'SELECT efectivo, tarjeta FROM saldo WHERE user_id = $1 FOR UPDATE',
    [userId]
  );
  const disponible = Number(result.rows[0] ? result.rows[0][key] : 0);
  if (disponible < monto) {
    throw new FondosInsuficientesError(key, disponible, monto);
  }
}

module.exports = { verificarFondos, FondosInsuficientesError };
