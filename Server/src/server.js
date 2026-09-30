require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const estadoRoutes = require('./routes/estado');
const saldoRoutes = require('./routes/saldo');
const configRoutes = require('./routes/config');
const fondoEmergenciaRoutes = require('./routes/fondoEmergencia');
const ingresosRoutes = require('./routes/ingresos');
const gastosRoutes = require('./routes/gastos');
const deudasRoutes = require('./routes/deudas');
const inversionesRoutes = require('./routes/inversiones');
const metasRoutes = require('./routes/metas');
const apuestasRoutes = require('./routes/apuestas');
const suplementosRoutes = require('./routes/suplementos');
const iaRoutes = require('./routes/ia');
const suscripcionesRoutes = require('./routes/suscripciones');
const asesorRoutes = require('./routes/asesor');
const { recurrentes: recurrentesRoutes, automaticos: automaticosRoutes } = require('./routes/recurrentes');
const presupuestosRoutes = require('./routes/presupuestos');
const { router: resumenRoutes } = require('./routes/resumen');
const { push: pushRoutes, cron: cronRoutes } = require('./routes/push');

const app = express();

/* CORS: solo el/los dominios listados en FRONTEND_URL (separados por
   coma) pueden llamar a esta API — normalmente tu URL de Netlify. */
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Permite llamadas sin "origin" (como curl/Postman) y las de la whitelist.
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('No permitido por CORS'));
  }
}));
app.use(express.json());

app.get('/', (req, res) => res.json({ ok: true, service: 'batfinance-server' }));
app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/estado', estadoRoutes);
app.use('/api/saldo', saldoRoutes);
app.use('/api/config', configRoutes);
app.use('/api/fondo-emergencia', fondoEmergenciaRoutes);
app.use('/api/ingresos', ingresosRoutes);
app.use('/api/gastos', gastosRoutes);
app.use('/api/deudas', deudasRoutes);
app.use('/api/inversiones', inversionesRoutes);
app.use('/api/metas', metasRoutes);
app.use('/api/apuestas', apuestasRoutes);
app.use('/api/suplementos', suplementosRoutes);
app.use('/api/ia', iaRoutes);
app.use('/api/suscripciones', suscripcionesRoutes);
app.use('/api/tarjetas', require('./routes/tarjetas'));
app.use('/api/asesor', asesorRoutes);
app.use('/api/recurrentes', recurrentesRoutes);
app.use('/api/automaticos', automaticosRoutes);
app.use('/api/presupuestos', presupuestosRoutes);
app.use('/api/resumen-semanal', resumenRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/cron', cronRoutes);

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error del servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BATFINANCE server escuchando en el puerto ${PORT}`);
});
