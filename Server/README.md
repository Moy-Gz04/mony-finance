# NEXUSFIN Server

API backend de NEXUSFIN — Node.js + Express + PostgreSQL (Neon).

## 0. Antes que nada: resetea tu contraseña de Neon

Si compartiste tu cadena de conexión en algún lado (captura, chat, etc.),
entra a Neon → tu proyecto → **Database → Role → Reset password**, copia
la nueva cadena de conexión y úsala en el paso 2. La que ya compartiste
debe darse por comprometida aunque "parezca" que nadie la vio.

## 1. Instalar dependencias

```bash
cd nexusfin-server
npm install
```

## 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Abre `.env` y llena:
- `DATABASE_URL`: tu cadena de conexión de Neon (la nueva, con pooling activado — la misma pantalla de tu captura, botón "Connection string").
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`: el usuario y contraseña con los que vas a entrar a la app.
- `JWT_SECRET`: cualquier cadena larga aleatoria. Puedes generarla con `openssl rand -hex 32`.
- `FRONTEND_URL`: de momento déjalo en blanco o pon `http://localhost:8000` mientras pruebas local; luego lo cambias por tu URL de Netlify.

## 3. Crear las tablas

```bash
npm run migrate
```

Esto corre `sql/schema.sql` contra tu base de Neon y crea todas las tablas (users, saldo, config, fondo_emergencia, ingresos, gastos, deudas, inversiones, metas, apuestas).

## 4. Crear tu usuario

```bash
npm run seed
```

Crea el usuario de `ADMIN_USERNAME`/`ADMIN_PASSWORD` con la contraseña ya encriptada (bcrypt) y sus filas iniciales de saldo/config/fondo de emergencia.

## 5. Probar en local

```bash
npm start
```

Debe decir `NEXUSFIN server escuchando en el puerto 3000`. Prueba:

```bash
curl http://localhost:3000/health
# {"ok":true}

curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Moy","password":"tu-password"}'
# {"token":"..."}
```

## 6. Desplegar en Render

1. Sube esta carpeta a un repositorio de GitHub (asegúrate de que `.env` **no** se suba — ya está en `.gitignore`).
2. En Render: **New → Web Service** → conecta el repo.
3. Configuración:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Root Directory:** la carpeta `nexusfin-server` (si el repo tiene más cosas)
4. En **Environment**, agrega las mismas variables de tu `.env` (`DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, etc.) — Render las inyecta en producción, nunca van en el código.
5. Al desplegar, corre una sola vez la migración y el seed desde la pestaña **Shell** de Render:
   ```bash
   npm run migrate
   npm run seed
   ```
6. Render te da una URL tipo `https://nexusfin-server.onrender.com`. Esa es tu `API_URL` para el front.

> Nota: el plan gratuito de Render "duerme" el servicio tras un rato sin uso — la primera petición después de inactividad puede tardar unos segundos en responder mientras arranca.

## 7. Desplegar el front en Netlify

Tu front (`index.html`, `css/`, `js/`) es 100% estático, así que Netlify lo sirve directo:

1. Sube la carpeta del front a otro repo (o a una subcarpeta del mismo).
2. En Netlify: **Add new site → Import an existing project** → conecta el repo.
3. **Build command:** vacío (no hay build). **Publish directory:** la carpeta donde está `index.html`.
4. Deploy. Netlify te da una URL tipo `https://tu-app.netlify.app`.
5. Regresa a Render y actualiza `FRONTEND_URL` con esa URL exacta (para que el CORS la deje pasar).

## Endpoints disponibles

| Método | Ruta                              | Qué hace |
|---|---|---|
| POST | `/api/auth/login`                 | Login, regresa `{ token }` |
| GET  | `/api/estado`                     | Todo el estado del usuario en un solo objeto |
| PUT  | `/api/saldo`                      | Reemplaza saldo (efectivo/tarjeta) a mano |
| PUT  | `/api/config`                     | Actualiza configuración |
| PUT  | `/api/fondo-emergencia`           | Actualiza metas del fondo |
| POST | `/api/fondo-emergencia/aportar`   | Aporta al fondo |
| POST / DELETE | `/api/ingresos[/:id]`   | Crear / eliminar ingreso |
| POST / DELETE | `/api/gastos[/:id]`     | Crear / eliminar gasto |
| POST / DELETE | `/api/deudas[/:id]`     | Crear / eliminar deuda |
| POST | `/api/deudas/:id/pagar`           | Registrar pago de una cuota |
| POST / DELETE | `/api/inversiones[/:id]`| Crear / eliminar inversión |
| POST / DELETE | `/api/metas[/:id]`      | Crear / eliminar meta |
| POST | `/api/metas/:id/aportar`          | Aportar a una meta |
| POST / DELETE | `/api/apuestas[/:id]`   | Crear / eliminar apuesta |
| POST | `/api/apuestas/:id/resolver`      | Marcar ganada/perdida |

Todas las rutas (excepto `/api/auth/login` y `/health`) requieren el header:
```
Authorization: Bearer <token>
```

## Siguiente paso

Este backend ya funciona solo (puedes probarlo con curl/Postman), pero el
front (`state.js`) todavía guarda todo en `localStorage`. El siguiente paso
es conectar `state.js` para que llame a esta API en vez de `localStorage`
— dile a Claude "conecta el front a la API" y lo hacemos.
