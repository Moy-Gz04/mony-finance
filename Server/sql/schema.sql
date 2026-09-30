-- ============================================================
-- BATFINANCE · Esquema de base de datos (PostgreSQL / Neon)
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

-- ---------- Seguimiento post-compra ----------
-- Para las compras que pasaron por el asistente de evaluación (tienen
-- rating), unos días después la app pregunta si la persona sigue
-- contenta con la decisión. Esto alimenta al propio evaluador: si una
-- categoría acumula arrepentimiento, el algoritmo lo advierte.
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS seguimiento_fecha DATE;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS seguimiento_respuesta TEXT
  CHECK (seguimiento_respuesta IN ('contento','neutral','arrepentido'));
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS seguimiento_hecho BOOLEAN NOT NULL DEFAULT false;

-- ---------- Suplementos ----------
-- Catálogo de suplementos que la persona toma (Proteína, Creatina...)
-- y un registro por cada día en que tomó cada uno.
CREATE TABLE IF NOT EXISTS suplementos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  dosis TEXT,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suplementos_user ON suplementos(user_id);

CREATE TABLE IF NOT EXISTS tomas_suplemento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  suplemento_id UUID NOT NULL REFERENCES suplementos(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (suplemento_id, fecha)
);
CREATE INDEX IF NOT EXISTS idx_tomas_suplemento_user ON tomas_suplemento(user_id);

-- Tamaño de cada toma (ej. 1 scoop de creatina = 5 g), su unidad y el
-- color con el que se pinta en el calendario y la gráfica.
ALTER TABLE suplementos ADD COLUMN IF NOT EXISTS cantidad_por_toma NUMERIC(8,2) NOT NULL DEFAULT 1;
ALTER TABLE suplementos ADD COLUMN IF NOT EXISTS unidad TEXT NOT NULL DEFAULT 'g';
ALTER TABLE suplementos ADD COLUMN IF NOT EXISTS color TEXT;

-- Cuántas tomas de ese suplemento hubo ese día (puede ser más de una).
ALTER TABLE tomas_suplemento ADD COLUMN IF NOT EXISTS cantidad INTEGER NOT NULL DEFAULT 1;

-- Suplementos iniciales para cada usuario que todavía no tenga ninguno.
INSERT INTO suplementos (user_id, nombre, orden, cantidad_por_toma, unidad, color)
SELECT u.id, s.nombre, s.orden, s.cant, s.unidad, s.color
FROM users u
CROSS JOIN (VALUES
  ('Proteína Whey', 1, 20, 'g', '#009E86'),
  ('Mass Gainer',   2, 20, 'g', '#8B6BFF'),
  ('Creatina',      3,  5, 'g', '#C97C22'),
  ('Vitamina E',    4,  1, 'cápsula', '#3D8FE8'),
  ('Pre-entreno',   5,  1, 'scoop', '#E8456A')
) AS s(nombre, orden, cant, unidad, color)
WHERE NOT EXISTS (SELECT 1 FROM suplementos x WHERE x.user_id = u.id);

-- ---------- Suscripciones ----------
-- Pagos recurrentes (Spotify, Claude, gym...). "Registrar pago" crea el
-- gasto, descuenta del saldo y mueve proximo_cobro según la frecuencia.
CREATE TABLE IF NOT EXISTS suscripciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  monto NUMERIC(14,2) NOT NULL,
  frecuencia TEXT NOT NULL DEFAULT 'mensual' CHECK (frecuencia IN ('semanal','mensual','anual')),
  metodo TEXT NOT NULL DEFAULT 'electronico' CHECK (metodo IN ('efectivo','electronico')),
  categoria TEXT NOT NULL DEFAULT 'entretenimiento',
  proximo_cobro DATE NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suscripciones_user ON suscripciones(user_id);

-- Frecuencia quincenal (cada 15 días) para suscripciones.
ALTER TABLE suscripciones DROP CONSTRAINT IF EXISTS suscripciones_frecuencia_check;
ALTER TABLE suscripciones ADD CONSTRAINT suscripciones_frecuencia_check
  CHECK (frecuencia IN ('semanal','quincenal','mensual','anual'));

-- ---------- Gym: ejercicios en la misma tabla que suplementos ----------
-- tipo = 'suplemento' | 'ejercicio'. En ejercicios, cantidad_por_toma son
-- las repeticiones por serie (unidad 'reps') y cada "toma" es una serie.
ALTER TABLE suplementos ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'suplemento';

INSERT INTO suplementos (user_id, nombre, orden, cantidad_por_toma, unidad, color, tipo)
SELECT u.id, e.nombre, e.orden, e.reps, 'reps', e.color, 'ejercicio'
FROM users u
CROSS JOIN (VALUES
  ('Abdominales', 1, 20, '#009E86'),
  ('Flexiones',   2, 15, '#8B6BFF'),
  ('Lagartijas',  3, 15, '#C97C22')
) AS e(nombre, orden, reps, color)
WHERE NOT EXISTS (SELECT 1 FROM suplementos x WHERE x.user_id = u.id AND x.tipo = 'ejercicio');

-- ==================================================================
-- Automatización, asesor, presupuestos, patrimonio y notificaciones
-- ==================================================================

-- Ingresos que llegan solos (quincena, sueldo...). Al abrir la app o
-- con la tarea diaria se registran los que ya tocaron.
CREATE TABLE IF NOT EXISTS ingresos_recurrentes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  monto NUMERIC(14,2) NOT NULL,
  frecuencia TEXT NOT NULL DEFAULT 'quincenal' CHECK (frecuencia IN ('semanal','quincenal','mensual')),
  metodo TEXT NOT NULL DEFAULT 'electronico' CHECK (metodo IN ('efectivo','electronico')),
  proximo DATE NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ing_rec_user ON ingresos_recurrentes(user_id);

-- Suscripciones que se cobran solas el día del cobro.
ALTER TABLE suscripciones ADD COLUMN IF NOT EXISTS auto_cobro BOOLEAN NOT NULL DEFAULT true;

-- Bitácora de lo que la app hizo sola (para avisar y poder deshacer).
CREATE TABLE IF NOT EXISTS movimientos_auto (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('ingreso','suscripcion')),
  ref_id UUID NOT NULL,              -- ingreso recurrente o suscripción de origen
  registro_id UUID,                  -- ingreso o gasto creado
  nombre TEXT NOT NULL,
  monto NUMERIC(14,2) NOT NULL,
  fecha DATE NOT NULL,               -- fecha que se aplicó (la programada)
  estado TEXT NOT NULL DEFAULT 'aplicado' CHECK (estado IN ('aplicado','deshecho','sin_saldo')),
  visto BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ref_id, fecha, tipo)
);
CREATE INDEX IF NOT EXISTS idx_mov_auto_user ON movimientos_auto(user_id);

-- Historial del asesor de compras.
CREATE TABLE IF NOT EXISTS asesor_historial (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pregunta TEXT NOT NULL,
  precio NUMERIC(14,2),
  respuesta JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asesor_user ON asesor_historial(user_id);

-- Resumen semanal (uno por semana que termina en domingo).
CREATE TABLE IF NOT EXISTS resumenes_semanales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  semana DATE NOT NULL,
  contenido JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, semana)
);

-- Gym: meta diaria por suplemento/ejercicio (en su unidad: g, reps...).
ALTER TABLE suplementos ADD COLUMN IF NOT EXISTS meta_diaria NUMERIC(10,2);

-- Presupuesto mensual por categoría de gasto.
CREATE TABLE IF NOT EXISTS presupuestos (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL,
  monto NUMERIC(14,2) NOT NULL,
  PRIMARY KEY (user_id, categoria)
);

-- Foto diaria del patrimonio para graficarlo en el tiempo.
CREATE TABLE IF NOT EXISTS patrimonio_diario (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  liquido NUMERIC(14,2) NOT NULL,
  ahorro NUMERIC(14,2) NOT NULL,     -- fondo + metas + inversiones
  deudas NUMERIC(14,2) NOT NULL,
  PRIMARY KEY (user_id, fecha)
);

-- Notificaciones push: dispositivos suscritos, avisos ya enviados y llaves.
CREATE TABLE IF NOT EXISTS push_suscripciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  claves JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notificaciones_enviadas (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clave TEXT NOT NULL,
  fecha DATE NOT NULL,
  PRIMARY KEY (user_id, clave, fecha)
);
CREATE TABLE IF NOT EXISTS app_config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- ---------- Metas con plan y fecha ----------
ALTER TABLE metas ADD COLUMN IF NOT EXISTS fecha_objetivo DATE;
ALTER TABLE metas ADD COLUMN IF NOT EXISTS prioridad TEXT NOT NULL DEFAULT 'media';
ALTER TABLE metas ADD COLUMN IF NOT EXISTS consejo JSONB;
ALTER TABLE metas ADD COLUMN IF NOT EXISTS consejo_fecha DATE;

-- Cada aporte a una meta, para medir el ritmo real de ahorro.
CREATE TABLE IF NOT EXISTS aportes_meta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meta_id UUID NOT NULL REFERENCES metas(id) ON DELETE CASCADE,
  monto NUMERIC(14,2) NOT NULL,
  fecha DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aportes_meta_user ON aportes_meta(user_id);

-- ---------- Apuestas: balance real, límites y pronósticos ----------
ALTER TABLE apuestas ADD COLUMN IF NOT EXISTS cuota NUMERIC(8,2);
ALTER TABLE apuestas ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'sencilla';
ALTER TABLE apuestas ADD COLUMN IF NOT EXISTS deporte TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS presupuesto_apuestas NUMERIC(10,2) NOT NULL DEFAULT 0;
-- Caché global del pronosticador (mismos partidos para todos; se renueva cada pocas horas)
CREATE TABLE IF NOT EXISTS pronosticos (
  fecha DATE PRIMARY KEY,
  datos JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Tarjetas de crédito: límite, lo usado y lo disponible ----------
CREATE TABLE IF NOT EXISTS tarjetas_credito (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  limite NUMERIC(12,2) NOT NULL CHECK (limite > 0),
  usado NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (usado >= 0),
  dia_corte SMALLINT,
  dia_pago SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tarjetas_credito_user ON tarjetas_credito(user_id);

-- Gastos pagados con tarjeta de crédito: no salen del saldo, suben lo usado de la tarjeta.
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS tarjeta_id UUID REFERENCES tarjetas_credito(id) ON DELETE SET NULL;
ALTER TABLE gastos DROP CONSTRAINT IF EXISTS gastos_metodo_check;
ALTER TABLE gastos ADD CONSTRAINT gastos_metodo_check CHECK (metodo IN ('efectivo','electronico','credito'));

-- Suscripciones pagadas con tarjeta de crédito
ALTER TABLE suscripciones ADD COLUMN IF NOT EXISTS tarjeta_id UUID REFERENCES tarjetas_credito(id) ON DELETE SET NULL;
ALTER TABLE suscripciones DROP CONSTRAINT IF EXISTS suscripciones_metodo_check;
ALTER TABLE suscripciones ADD CONSTRAINT suscripciones_metodo_check CHECK (metodo IN ('efectivo','electronico','credito'));
