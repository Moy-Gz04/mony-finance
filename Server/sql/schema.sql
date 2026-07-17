-- ============================================================
-- NEXUSFIN · Esquema de base de datos (PostgreSQL / Neon)
-- ------------------------------------------------------------
-- Mapea 1 a 1 el modelo de datos que ya tenía state.js en el
-- front-end, pero ahora en tablas reales, una fila por usuario
-- donde aplica, para poder crecer a multi-usuario sin rediseñar.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- para gen_random_uuid()

-- ---------- Usuarios ----------
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Saldo (efectivo + tarjeta) — 1 fila por usuario ----------
CREATE TABLE IF NOT EXISTS saldo (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  efectivo NUMERIC(14,2) NOT NULL DEFAULT 0,
  tarjeta NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Configuración — 1 fila por usuario ----------
CREATE TABLE IF NOT EXISTS config (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tasa_sofipo_default NUMERIC(6,2) NOT NULL DEFAULT 12,
  distribucion_necesidades NUMERIC(5,2) NOT NULL DEFAULT 50,
  distribucion_deseos NUMERIC(5,2) NOT NULL DEFAULT 20,
  distribucion_ahorro NUMERIC(5,2) NOT NULL DEFAULT 10,
  pagos_pendientes_colapsado BOOLEAN NOT NULL DEFAULT false
);
-- "distribucion_ahorro" ahora representa el % destinado al Fondo de
-- Emergencia (se queda con este nombre de columna para no romper lo
-- que ya existe; el front lo etiqueta como "Fondo de emergencia").
-- Se agrega el % de Inversión como categoría propia del plan mensual.
ALTER TABLE config ADD COLUMN IF NOT EXISTS distribucion_inversion NUMERIC(5,2) NOT NULL DEFAULT 20;

-- Ingreso mensual fijo usado como base del plan de distribución (en
-- vez de sumar los ingresos que hayas registrado ese mes — así el
-- plan no depende de que captures cada pago como "ingreso").
ALTER TABLE config ADD COLUMN IF NOT EXISTS ingreso_mensual_fijo NUMERIC(14,2) NOT NULL DEFAULT 0;

-- ---------- Fondo de emergencia — 1 fila por usuario ----------
CREATE TABLE IF NOT EXISTS fondo_emergencia (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  actual NUMERIC(14,2) NOT NULL DEFAULT 0,
  meses_objetivo NUMERIC(4,1) NOT NULL DEFAULT 6,
  gasto_mensual NUMERIC(14,2) NOT NULL DEFAULT 6000
);

-- ---------- Historial de aportaciones al fondo de emergencia ----------
-- Antes solo se guardaba el total acumulado (fondo_emergencia.actual).
-- Esta tabla registra cada aportación con su fecha, para poder saber
-- cuánto se aportó en un mes específico (plan de distribución mensual).
CREATE TABLE IF NOT EXISTS aportes_fondo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  monto NUMERIC(14,2) NOT NULL,
  fecha DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aportes_fondo_user ON aportes_fondo(user_id);

-- ---------- Ingresos ----------
CREATE TABLE IF NOT EXISTS ingresos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  monto NUMERIC(14,2) NOT NULL,
  frecuencia TEXT NOT NULL DEFAULT 'Único',
  fecha DATE NOT NULL,
  metodo TEXT NOT NULL CHECK (metodo IN ('efectivo','electronico')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ingresos_user ON ingresos(user_id);

-- ---------- Gastos ----------
CREATE TABLE IF NOT EXISTS gastos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  categoria TEXT NOT NULL,
  monto NUMERIC(14,2) NOT NULL,
  fecha DATE NOT NULL,
  metodo TEXT NOT NULL CHECK (metodo IN ('efectivo','electronico')),
  rating NUMERIC(3,1),
  evaluacion JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gastos_user ON gastos(user_id);

-- ---------- Deudas ----------
CREATE TABLE IF NOT EXISTS deudas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  monto_total NUMERIC(14,2) NOT NULL,
  monto_pendiente NUMERIC(14,2) NOT NULL,
  monto_cuota NUMERIC(14,2) NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('unico','mensual','quincenal')),
  proximo_pago DATE,
  pagada BOOLEAN NOT NULL DEFAULT false,
  duracion INTEGER,
  pagos_realizados INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deudas_user ON deudas(user_id);

-- ---------- Inversiones ----------
CREATE TABLE IF NOT EXISTS inversiones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  monto NUMERIC(14,2) NOT NULL,
  tasa NUMERIC(6,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inversiones_user ON inversiones(user_id);

-- ---------- Metas de ahorro ----------
CREATE TABLE IF NOT EXISTS metas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  monto_objetivo NUMERIC(14,2) NOT NULL,
  monto_actual NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_metas_user ON metas(user_id);

-- ---------- Apuestas ----------
CREATE TABLE IF NOT EXISTS apuestas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  monto_apostado NUMERIC(14,2) NOT NULL,
  fecha DATE NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','ganada','perdida')),
  monto_ganado NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apuestas_user ON apuestas(user_id);
