const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-cambia-esto';
if (!process.env.JWT_SECRET) console.warn('⚠️  JWT_SECRET no definido: usando secreto de desarrollo.');

const IVA = 0.19;
const FREE_SHIPPING_FROM = 300000;
const SHIPPING_COST = 12000;
const MAX_QTY = 20;

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '100kb' }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, status, error, fields) => res.status(status).json(fields ? { error, fields } : { error });

// ---------- helpers ----------
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const imageUrl = (seed, w = 600, h = 600) => `/api/images/${seed}?w=${w}&h=${h}`;

const publicUser = (u) => ({
  id: u.id,
  firstName: u.first_name,
  lastName: u.last_name,
  username: u.username,
  email: u.email,
});

const publicProduct = (p) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  price: p.price,
  category: p.category,
  stock: p.stock,
  imageUrl: imageUrl(p.image),
});

function signToken(user) {
  return jwt.sign({}, JWT_SECRET, {
    subject: String(user.id),
    jwtid: crypto.randomUUID(),
    expiresIn: '7d',
  });
}

const auth = wrap(async (req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return fail(res, 401, 'Token requerido');
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return fail(res, 401, 'Sesión inválida o expirada');
  }
  const revoked = await db.get('SELECT jti FROM revoked_tokens WHERE jti = $1', [payload.jti]);
  if (revoked) return fail(res, 401, 'Sesión cerrada');
  const user = await db.get('SELECT * FROM users WHERE id = $1', [Number(payload.sub)]);
  if (!user) return fail(res, 401, 'Usuario no encontrado');
  req.user = user;
  req.tokenPayload = payload;
  next();
});

function validateProfile({ firstName, lastName, username }) {
  const fields = {};
  if (!firstName) fields.firstName = 'El nombre es obligatorio';
  if (!lastName) fields.lastName = 'Los apellidos son obligatorios';
  if (!username) fields.username = 'El username es obligatorio';
  else if (!USERNAME_RE.test(username)) fields.username = 'Usa 3-20 caracteres: letras, números, "_" o "."';
  return fields;
}

// ---------- salud ----------
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ---------- imágenes (proxy con caché para que todo salga por la API) ----------
const imgCache = new Map();
// Fotografías reales por producto (Unsplash). Los banners conservan imágenes aleatorias.
const PRODUCT_PHOTOS = {
  camiseta: 'photo-1521572163474-6864f9cf17ab',
  'chaqueta-jean': 'photo-1543076447-215ad9ba6923',
  zapatillas: 'photo-1542291026-7eec264c27ff',
  'buso-capota': 'photo-1556821840-3a63f95609a7',
  audifonos: 'photo-1505740420928-5e560c06d30e',
  smartwatch: 'photo-1523275335684-37898b6baf30',
  parlante: 'photo-1608043152269-423dbba4e7e1',
  cargador: 'photo-1583863788434-e58a36330cf0',
  teclado: 'photo-1587829741301-dc798b83add3',
  lampara: 'photo-1507473885765-e6ed057f782c',
  sabanas: 'photo-1631049307264-da0ec9d70304',
  cafetera: 'photo-1495474472287-4d71bcdd2085',
  balon: 'photo-1579952363873-27f3bade9f55',
  'mat-yoga': 'photo-1544367567-0f2fcb009e0b',
  botella: 'photo-1602143407151-7111542de6e8',
  mancuernas: 'photo-1583454110551-21f2fa2afe61',
};
app.get('/api/images/:seed', wrap(async (req, res) => {
  const seed = String(req.params.seed).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'x';
  const clamp = (n, d) => Math.min(Math.max(parseInt(n, 10) || d, 50), 1600);
  const w = clamp(req.query.w, 600);
  const h = clamp(req.query.h, 600);
  const key = `${seed}-${w}-${h}`;
  let entry = imgCache.get(key);
  if (!entry) {
    try {
      const photo = PRODUCT_PHOTOS[seed];
      const imageUrl = photo
        ? `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=${w}&h=${h}&q=85`
        : `https://picsum.photos/seed/${seed}/${w}/${h}.jpg`;
      const r = await fetch(imageUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error(`status ${r.status}`);
      entry = { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || 'image/jpeg' };
      if (imgCache.size > 300) imgCache.delete(imgCache.keys().next().value);
      imgCache.set(key, entry);
    } catch (e) {
      return fail(res, 502, 'No se pudo obtener la imagen');
    }
  }
  res.set('Content-Type', entry.type);
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(entry.buf);
}));

// ---------- autenticación ----------
app.get('/api/auth/check-username', wrap(async (req, res) => {
  const username = str(req.query.username).toLowerCase();
  if (!USERNAME_RE.test(username)) return res.json({ available: false, reason: 'Formato inválido' });
  const u = await db.get('SELECT id FROM users WHERE username = $1', [username]);
  res.json({ available: !u });
}));

app.post('/api/auth/register', wrap(async (req, res) => {
  const firstName = str(req.body.firstName);
  const lastName = str(req.body.lastName);
  const username = str(req.body.username).toLowerCase();
  const email = str(req.body.email).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  const fields = validateProfile({ firstName, lastName, username });
  if (!email) fields.email = 'El correo es obligatorio';
  else if (!EMAIL_RE.test(email)) fields.email = 'Correo electrónico inválido';
  if (password.length < 8) fields.password = 'La contraseña debe tener mínimo 8 caracteres';
  if (Object.keys(fields).length) return fail(res, 400, 'Revisa los campos del formulario', fields);

  const dupU = await db.get('SELECT id FROM users WHERE username = $1', [username]);
  const dupE = await db.get('SELECT id FROM users WHERE email = $1', [email]);
  if (dupU || dupE) {
    const f = {};
    if (dupU) f.username = 'Este username ya está en uso';
    if (dupE) f.email = 'Este correo ya está registrado';
    return fail(res, 409, 'Usuario o correo ya existentes', f);
  }

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await db.run(
    'INSERT INTO users (first_name, last_name, username, email, password_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [firstName, lastName, username, email, hash, new Date().toISOString()]
  );
  res.status(201).json({ user: publicUser(rows[0]) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const identifier = str(req.body.identifier).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!identifier || !password) return fail(res, 400, 'Ingresa tus credenciales');
  const user = await db.get('SELECT * FROM users WHERE username = $1 OR email = $2', [identifier, identifier]);
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  if (!ok) return fail(res, 401, 'Usuario o contraseña incorrectos');
  res.json({ token: signToken(user), user: publicUser(user) });
}));

app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/auth/logout', auth, wrap(async (req, res) => {
  const exp = new Date(req.tokenPayload.exp * 1000).toISOString();
  await db.run('INSERT INTO revoked_tokens (jti, expires_at) VALUES ($1,$2)', [req.tokenPayload.jti, exp]);
  await db.run('DELETE FROM revoked_tokens WHERE expires_at < $1', [new Date().toISOString()]);
  res.json({ message: 'Sesión cerrada' });
}));

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from(crypto.randomBytes(8), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

async function sendResetEmail(to, code, link) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'Tienda <onboarding@resend.dev>',
        to: [to],
        subject: 'Restablece tu contraseña',
        html: `<p>Recibimos una solicitud para restablecer tu contraseña.</p>
               <p><a href="${link}">Haz clic aquí para crear una nueva contraseña</a></p>
               <p>O ingresa este código en la app: <b>${code}</b></p>
               <p>El código vence en 30 minutos. Si no fuiste tú, ignora este correo.</p>`,
      }),
    });
    if (!r.ok) console.error('Resend error', r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error('Error enviando correo', e.message);
    return false;
  }
}

app.post('/api/auth/forgot', wrap(async (req, res) => {
  const email = str(req.body.email).toLowerCase();
  if (!EMAIL_RE.test(email)) return fail(res, 400, 'Correo electrónico inválido', { email: 'Correo electrónico inválido' });
  const message = 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.';
  const user = await db.get('SELECT * FROM users WHERE email = $1', [email]);
  if (!user) return res.json({ message });

  const code = makeCode();
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await db.run('INSERT INTO reset_tokens (token_hash, user_id, expires_at, used) VALUES ($1,$2,$3,0)', [sha256(code), user.id, expires]);

  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const link = `${base}/#/reset-password?token=${code}`;
  const sent = await sendResetEmail(user.email, code, link);
  // Modo demostración: si no hay servicio de correo configurado, se devuelve el código en la respuesta.
  const exposeToken = !sent && (!process.env.RESEND_API_KEY || process.env.EXPOSE_RESET_TOKEN === 'true');
  res.json(exposeToken ? { message, devToken: code, devLink: link } : { message });
}));

app.post('/api/auth/reset', wrap(async (req, res) => {
  const token = str(req.body.token).toUpperCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!token) return fail(res, 400, 'El código es obligatorio', { token: 'El código es obligatorio' });
  if (password.length < 8) return fail(res, 400, 'La contraseña debe tener mínimo 8 caracteres', { password: 'La contraseña debe tener mínimo 8 caracteres' });
  const row = await db.get('SELECT * FROM reset_tokens WHERE token_hash = $1', [sha256(token)]);
  if (!row || row.used || new Date(row.expires_at) < new Date()) {
    return fail(res, 400, 'El código es inválido o ya venció', { token: 'Código inválido o vencido' });
  }
  const hash = await bcrypt.hash(password, 10);
  await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, row.user_id]);
  await db.run('UPDATE reset_tokens SET used = 1 WHERE token_hash = $1', [row.token_hash]);
  res.json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
}));

// ---------- perfil ----------
app.put('/api/users/me', auth, wrap(async (req, res) => {
  const firstName = str(req.body.firstName);
  const lastName = str(req.body.lastName);
  const username = str(req.body.username).toLowerCase();
  const fields = validateProfile({ firstName, lastName, username });
  if (Object.keys(fields).length) return fail(res, 400, 'Revisa los campos del formulario', fields);
  const dup = await db.get('SELECT id FROM users WHERE username = $1 AND id <> $2', [username, req.user.id]);
  if (dup) return fail(res, 409, 'Username ya en uso', { username: 'Este username ya está en uso' });
  const { rows } = await db.run(
    'UPDATE users SET first_name = $1, last_name = $2, username = $3 WHERE id = $4 RETURNING *',
    [firstName, lastName, username, req.user.id]
  );
  res.json({ user: publicUser(rows[0]) });
}));

app.put('/api/users/me/password', auth, wrap(async (req, res) => {
  const current = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
  const next = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
  if (!(await bcrypt.compare(current, req.user.password_hash))) {
    return fail(res, 400, 'La contraseña actual es incorrecta', { currentPassword: 'Contraseña actual incorrecta' });
  }
  if (next.length < 8) return fail(res, 400, 'La nueva contraseña debe tener mínimo 8 caracteres', { newPassword: 'Mínimo 8 caracteres' });
  await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(next, 10), req.user.id]);
  res.json({ message: 'Contraseña actualizada' });
}));

// ---------- catálogo ----------
app.get('/api/banners', wrap(async (req, res) => {
  const rows = await db.all('SELECT * FROM banners ORDER BY sort, id');
  res.json(rows.map((b) => ({ id: b.id, title: b.title, subtitle: b.subtitle, imageUrl: imageUrl(b.image, 1200, 500) })));
}));

app.get('/api/categories', wrap(async (req, res) => {
  res.json(await db.all('SELECT id, name FROM categories ORDER BY id'));
}));

const PRODUCT_SELECT = `SELECT p.id, p.name, p.description, p.price, p.image, p.stock, c.name AS category
                        FROM products p JOIN categories c ON c.id = p.category_id`;

app.get('/api/products', wrap(async (req, res) => {
  const where = [];
  const params = [];
  const search = str(req.query.search).toLowerCase();
  const category = str(req.query.category);
  if (search) {
    params.push(`%${search}%`);
    where.push(`LOWER(p.name) LIKE $${params.length}`);
  }
  if (category && category.toLowerCase() !== 'todos') {
    params.push(category);
    where.push(`c.name = $${params.length}`);
  }
  const sql = `${PRODUCT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id`;
  res.json((await db.all(sql, params)).map(publicProduct));
}));

app.get('/api/products/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const p = Number.isInteger(id) ? await db.get(`${PRODUCT_SELECT} WHERE p.id = $1`, [id]) : null;
  if (!p) return fail(res, 404, 'Producto no encontrado');
  res.json(publicProduct(p));
}));

// ---------- carrito ----------
async function buildCart(userId) {
  const rows = await db.all(
    `SELECT ci.product_id, ci.quantity, p.name, p.price, p.image
     FROM cart_items ci JOIN products p ON p.id = ci.product_id
     WHERE ci.user_id = $1 ORDER BY p.id`,
    [userId]
  );
  const items = rows.map((r) => ({
    productId: r.product_id,
    name: r.name,
    price: r.price,
    quantity: r.quantity,
    lineTotal: r.price * r.quantity,
    imageUrl: imageUrl(r.image),
  }));
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const tax = Math.round(subtotal * IVA);
  const shipping = subtotal === 0 || subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING_COST;
  return {
    items,
    itemCount: items.reduce((s, i) => s + i.quantity, 0),
    subtotal,
    taxRate: IVA,
    tax,
    shipping,
    freeShippingFrom: FREE_SHIPPING_FROM,
    total: subtotal + tax + shipping,
  };
}

app.get('/api/cart', auth, wrap(async (req, res) => res.json(await buildCart(req.user.id))));

app.post('/api/cart', auth, wrap(async (req, res) => {
  const productId = parseInt(req.body.productId, 10);
  const qty = Math.min(Math.max(parseInt(req.body.quantity, 10) || 1, 1), MAX_QTY);
  const product = await db.get('SELECT id FROM products WHERE id = $1', [productId]);
  if (!product) return fail(res, 404, 'Producto no encontrado');
  const existing = await db.get('SELECT quantity FROM cart_items WHERE user_id = $1 AND product_id = $2', [req.user.id, productId]);
  if (existing) {
    await db.run('UPDATE cart_items SET quantity = $1 WHERE user_id = $2 AND product_id = $3', [
      Math.min(existing.quantity + qty, MAX_QTY), req.user.id, productId,
    ]);
  } else {
    await db.run('INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1,$2,$3)', [req.user.id, productId, qty]);
  }
  res.status(201).json(await buildCart(req.user.id));
}));

app.put('/api/cart/:productId', auth, wrap(async (req, res) => {
  const productId = parseInt(req.params.productId, 10);
  const qty = parseInt(req.body.quantity, 10);
  if (!Number.isInteger(qty)) return fail(res, 400, 'Cantidad inválida');
  if (qty <= 0) {
    await db.run('DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2', [req.user.id, productId]);
  } else {
    const r = await db.run('UPDATE cart_items SET quantity = $1 WHERE user_id = $2 AND product_id = $3', [
      Math.min(qty, MAX_QTY), req.user.id, productId,
    ]);
    if (!r.rowCount) return fail(res, 404, 'El producto no está en el carrito');
  }
  res.json(await buildCart(req.user.id));
}));

app.delete('/api/cart/:productId', auth, wrap(async (req, res) => {
  await db.run('DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2', [req.user.id, parseInt(req.params.productId, 10)]);
  res.json(await buildCart(req.user.id));
}));

app.delete('/api/cart', auth, wrap(async (req, res) => {
  await db.run('DELETE FROM cart_items WHERE user_id = $1', [req.user.id]);
  res.json(await buildCart(req.user.id));
}));

// ---------- pedidos (compra simulada) ----------
app.post('/api/orders', auth, wrap(async (req, res) => {
  const allowedPaymentMethods = ['Contra entrega', 'Transferencia bancaria', 'Tarjeta débito/crédito'];
  const paymentMethod = str(req.body.paymentMethod);
  if (!allowedPaymentMethods.includes(paymentMethod)) return fail(res, 400, 'Selecciona un método de pago válido');
  const cart = await buildCart(req.user.id);
  if (!cart.items.length) return fail(res, 400, 'El carrito está vacío');
  const now = new Date().toISOString();
  const { rows } = await db.run(
    'INSERT INTO orders (user_id, subtotal, tax, shipping, total, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [req.user.id, cart.subtotal, cart.tax, cart.shipping, cart.total, `Pago seleccionado: ${paymentMethod} (simulado)`, now]
  );
  const orderId = rows[0].id;
  for (const it of cart.items) {
    const prod = await db.get('SELECT image FROM products WHERE id = $1', [it.productId]);
    await db.run(
      'INSERT INTO order_items (order_id, product_id, name, price, quantity, image) VALUES ($1,$2,$3,$4,$5,$6)',
      [orderId, it.productId, it.name, it.price, it.quantity, prod ? prod.image : 'x']
    );
  }
  await db.run('DELETE FROM cart_items WHERE user_id = $1', [req.user.id]);
  res.status(201).json({
    id: orderId, subtotal: cart.subtotal, tax: cart.tax, shipping: cart.shipping, total: cart.total,
    status: `Pago seleccionado: ${paymentMethod} (simulado)`, createdAt: now,
    items: cart.items.map((i) => ({ name: i.name, price: i.price, quantity: i.quantity, imageUrl: i.imageUrl })),
  });
}));

app.get('/api/orders', auth, wrap(async (req, res) => {
  const orders = await db.all('SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC', [req.user.id]);
  const items = await db.all(
    'SELECT oi.* FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.user_id = $1 ORDER BY oi.id',
    [req.user.id]
  );
  res.json(orders.map((o) => ({
    id: o.id, subtotal: o.subtotal, tax: o.tax, shipping: o.shipping, total: o.total,
    status: o.status, createdAt: o.created_at,
    items: items.filter((i) => i.order_id === o.id).map((i) => ({
      name: i.name, price: i.price, quantity: i.quantity, imageUrl: imageUrl(i.image),
    })),
  })));
}));

// ---------- API desconocida / web de Flutter ----------
app.use('/api', (req, res) => fail(res, 404, 'Ruta no encontrada'));

const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(path.join(publicDir, 'index.html'))) {
  app.use(express.static(publicDir));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
} else {
  app.get('/', (req, res) => res.json({ name: 'Tienda API', docs: 'Ver /api/health, /api/products ...' }));
}

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  fail(res, 500, 'Error interno del servidor');
});

db.init()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`API lista en el puerto ${PORT}`)))
  .catch((e) => {
    console.error('No se pudo inicializar la base de datos', e);
    process.exit(1);
  });
