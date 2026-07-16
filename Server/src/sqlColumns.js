/* ==================================================================
   NEXUSFIN · Columnas SQL en camelCase
   ------------------------------------------------------------------
   Postgres guarda las columnas en snake_case (monto_total,
   proximo_pago...) pero todo el front (render.js, modals.js) espera
   camelCase (montoTotal, proximoPago...). En vez de traducir cada
   fila en JS después de cada consulta, se pide directo en el formato
   correcto con "AS "camelCase"" (las comillas dobles son necesarias:
   sin ellas Postgres pone el alias en minúsculas).
   Se usan tanto en SELECT como en RETURNING.
   ================================================================== */

const INGRESOS_COLS = `id, nombre, monto, frecuencia, fecha, metodo`;

const GASTOS_COLS = `id, descripcion, categoria, monto, fecha, metodo, rating, evaluacion`;

const DEUDAS_COLS = `
  id, nombre,
  monto_total AS "montoTotal",
  monto_pendiente AS "montoPendiente",
  monto_cuota AS "montoCuota",
  tipo,
  proximo_pago AS "proximoPago",
  pagada,
  duracion,
  pagos_realizados AS "pagosRealizados"
`;

const INVERSIONES_COLS = `id, nombre, monto, tasa`;

const METAS_COLS = `
  id, nombre,
  monto_objetivo AS "montoObjetivo",
  monto_actual AS "montoActual"
`;

const APUESTAS_COLS = `
  id, descripcion,
  monto_apostado AS "montoApostado",
  fecha, estado,
  monto_ganado AS "montoGanado"
`;

module.exports = {
  INGRESOS_COLS,
  GASTOS_COLS,
  DEUDAS_COLS,
  INVERSIONES_COLS,
  METAS_COLS,
  APUESTAS_COLS
};
