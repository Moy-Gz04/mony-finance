/* ==================================================================
   BATFINANCE · Contexto de tarjetas de crédito para la IA
   ------------------------------------------------------------------
   Un solo lugar que arma los números reales de las tarjetas (límite,
   usado, disponible, % de uso, gastos a crédito del mes y fechas de
   corte/pago) para el asesor, el resumen semanal y el análisis.
   ================================================================== */
const pool = require('./db');

const $ = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });

/* Próxima fecha (YYYY-MM-DD) en que cae el día `dia` del mes. */
function proximoDia(dia) {
  if (!dia) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const d = new Date(hoy.getFullYear(), hoy.getMonth(), Math.min(dia, 28));
  if (d < hoy) d.setMonth(d.getMonth() + 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function contextoCredito(userId) {
  const [t, mes] = await Promise.all([
    pool.query(`SELECT id, nombre, limite::float AS limite, usado::float AS usado, dia_corte, dia_pago
                FROM tarjetas_credito WHERE user_id = $1 ORDER BY created_at`, [userId]),
    pool.query(`SELECT tarjeta_id, COALESCE(SUM(monto), 0)::float AS total, COUNT(*)::int AS n
                FROM gastos WHERE user_id = $1 AND metodo = 'credito' AND fecha >= date_trunc('month', CURRENT_DATE)
                GROUP BY tarjeta_id`, [userId])
  ]);
  const tarjetas = t.rows.map((x) => {
    const m = mes.rows.find((r) => r.tarjeta_id === x.id) || { total: 0, n: 0 };
    return {
      nombre: x.nombre, limite: x.limite, usado: x.usado, disponible: x.limite - x.usado,
      uso: x.limite > 0 ? Math.round(x.usado / x.limite * 100) : 0,
      gastadoMes: m.total, comprasMes: m.n,
      corte: proximoDia(x.dia_corte), pago: proximoDia(x.dia_pago)
    };
  });
  const limite = tarjetas.reduce((a, x) => a + x.limite, 0);
  const usado = tarjetas.reduce((a, x) => a + x.usado, 0);
  const uso = limite > 0 ? Math.round(usado / limite * 100) : 0;
  const texto = tarjetas.length
    ? 'Tarjetas de crédito (el crédito NO es dinero suyo; lo usado es deuda que hay que pagar): debe ' + $(usado) + ' de ' + $(limite) +
      ' de límite total (' + uso + '% de uso; lo sano es menos de 30%). ' +
      tarjetas.map((x) => x.nombre + ': usado ' + $(x.usado) + ' de ' + $(x.limite) + ' (' + x.uso + '%), disponible ' + $(x.disponible) +
        ', compras a crédito este mes ' + $(x.gastadoMes) + ' (' + x.comprasMes + ')' +
        (x.corte ? ', próximo corte ' + x.corte : '') + (x.pago ? ', fecha límite de pago ' + x.pago : '')).join('; ') + '.'
    : 'Tarjetas de crédito: ninguna.';
  return { tarjetas, limite, usado, uso, texto };
}

module.exports = { contextoCredito };
