# Tienda — App E-Commerce Flutter + API REST (Node.js)

Proyecto final · Aplicaciones Móviles · Uniminuto

```
tienda/
├── app/        → Flutter (Android emulator + Web)
├── backend/    → API REST (Node.js + Express + JWT, PostgreSQL/SQLite)
├── Dockerfile  → compila Flutter web y lo sirve junto con la API
└── render.yaml → despliegue en Render (API + web + base de datos)
```

**Todo pasa por la API REST**: registro, login (JWT), productos, banners, categorías,
búsqueda, carrito, pedidos y perfil. La app no guarda datos locales, salvo el JWT.

---

## 1. Ejecutar la API en local

```bash
cd backend
npm install
npm start            # http://localhost:3000  (SQLite local, se crea data.db con productos de ejemplo)
```
Prueba: http://localhost:3000/api/health y http://localhost:3000/api/products

## 2. Ejecutar la app en el emulador de Android

```bash
cd app
flutter create --platforms=android,web --project-name tienda_app --org co.edu.uniminuto .
flutter pub get
```

(`flutter create .` solo genera las carpetas `android/` y `web/`; no toca tu carpeta `lib/`.)

**Opción A – usando la API de Render (producto final):**
1. Edita `app/lib/config.dart` y cambia `kRenderUrl` por la URL de tu servicio (ej. `https://tienda-app.onrender.com`).
2. `flutter run`

**Opción B – usando la API local:**
```bash
flutter run --dart-define=API_URL=http://10.0.2.2:3000
```
(`10.0.2.2` es el "localhost" de tu PC visto desde el emulador). Como es `http` y no `https`, agrega en
`android/app/src/main/AndroidManifest.xml`, dentro de la etiqueta `<application ...>`:
```xml
android:usesCleartextTraffic="true"
```

**Para el APK de release**, agrega el permiso de internet en el mismo `AndroidManifest.xml`
(encima de `<application>`):
```xml
<uses-permission android:name="android.permission.INTERNET"/>
```
y compila con `flutter build apk --release`.

## 3. Desplegar en Render (API + app web idéntica al emulador)

1. Sube la carpeta `tienda/` a un repositorio de GitHub.
2. En Render: **New → Blueprint** → selecciona el repo. Lee `render.yaml` y crea:
   - la base de datos PostgreSQL `tienda-db`,
   - el servicio web `tienda-app` (Docker): compila Flutter web y lo sirve junto con la API.
3. Al terminar, abre `https://TU-SERVICIO.onrender.com` → verás la app funcionando como en el emulador.
   La API queda en `https://TU-SERVICIO.onrender.com/api/...`
4. Pon esa URL en `kRenderUrl` (`app/lib/config.dart`) para que la app del emulador use la misma API real.

Notas del plan gratuito:
- El servicio "se duerme" tras ~15 min sin uso: la primera petición puede tardar ~50 s (la app espera hasta 60 s).
- La base de datos PostgreSQL gratuita de Render **caduca a los 30 días**; ve renovando o migra a otra (Neon, Supabase)
  cambiando solo la variable `DATABASE_URL`.
- El primer build en Render (Flutter) puede tardar varios minutos.

## 4. Recuperación de contraseña por correo

1. En Login → "¿Olvidaste tu contraseña?" → ingresas tu correo.
2. El backend genera un código (vence en 30 min) y envía un correo con un enlace
   `https://TU-SERVICIO.onrender.com/#/reset-password?token=CODIGO`. En web, el enlace abre directamente la pantalla
   de nueva contraseña; en móvil, ingresas el código manualmente.
3. Para enviar correos reales crea una cuenta en [Resend](https://resend.com) y define en Render las variables
   `RESEND_API_KEY` y `EMAIL_FROM` (con la cuenta de prueba solo puede enviar a tu propio correo; para otros
   destinatarios verifica un dominio).
4. **Modo demostración**: si no hay `RESEND_API_KEY`, la API devuelve el código en la respuesta y la app lo muestra en
   pantalla (útil para el video demo). En producción real configura el correo.

## 5. Endpoints de la API

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/auth/register` | – | Registro (`firstName,lastName,username,email,password`) |
| GET | `/api/auth/check-username?username=` | – | Username disponible |
| POST | `/api/auth/login` | – | Login con username o correo → `{token,user}` (JWT 7 días) |
| GET | `/api/auth/me` | JWT | Usuario actual |
| POST | `/api/auth/logout` | JWT | Revoca el token (lista de revocados) |
| POST | `/api/auth/forgot` | – | Envía enlace/código de recuperación |
| POST | `/api/auth/reset` | – | Nueva contraseña con el código |
| PUT | `/api/users/me` | JWT | Actualiza nombre, apellidos y username |
| PUT | `/api/users/me/password` | JWT | Cambia contraseña |
| GET | `/api/banners` · `/api/categories` | – | Banner y categorías |
| GET | `/api/products?search=&category=` | – | Listado con filtros |
| GET | `/api/products/:id` | – | Detalle |
| GET/POST/DELETE | `/api/cart` | JWT | Ver / agregar / vaciar carrito |
| PUT/DELETE | `/api/cart/:productId` | JWT | Cambiar cantidad / eliminar ítem |
| POST | `/api/orders` | JWT | "Proceder al pago" (compra simulada) |
| GET | `/api/orders` | JWT | Mis pedidos |
| GET | `/api/images/:seed` | – | Imágenes servidas por la API (proxy con caché) |

El carrito calcula en el servidor: subtotal, IVA 19 %, envío ($ 12.000, gratis desde $ 300.000) y total.

## 6. Cumplimiento del enunciado

- **Login**: username o correo, contraseña con mostrar/ocultar, validaciones inline (vacío, formato email, mín. 6),
  JWT guardado, "¿Olvidaste tu contraseña?" y "Crear cuenta".
- **Registro**: 6 campos, username único verificado en el backend, contraseña mín. 8 y coincidencia, errores por campo.
- **Home**: Drawer (Inicio, Mis pedidos, Perfil, Cerrar sesión) + BottomNavigationBar (Home, Carrito, Perfil),
  banner con auto-scroll y puntos, buscador en tiempo real, chips de categorías, grid de 2 columnas.
- **Detalle**: imagen, categoría, descripción, precio, selector de cantidad, agregar al carrito, regresar.
- **Carrito**: miniatura, +/−, eliminar, vacío amigable, subtotal / IVA / envío / total, "Proceder al pago".
- **Perfil**: datos, edición de nombre/apellidos/username, cambio de contraseña, validaciones, guardar en backend.

Las imágenes de ejemplo son de [picsum.photos](https://picsum.photos) (fotos genéricas). Para usar las tuyas, cambia
la columna `image` de `products`/`banners` (o el seed en `backend/db.js`).
