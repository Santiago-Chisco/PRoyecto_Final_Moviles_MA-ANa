// Capa de datos: PostgreSQL en producción (DATABASE_URL, p. ej. Render)
// y SQLite local cuando no hay DATABASE_URL (desarrollo).
const path = require('path');

const isPg = !!process.env.DATABASE_URL;
let pool = null;
let sqlite = null;

if (isPg) {
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  const local = /localhost|127\.0\.0\.1/.test(url);
  pool = new Pool({
    connectionString: url,
    ssl: local || process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
  });
} else {
  const Database = require('better-sqlite3');
  sqlite = new Database(process.env.SQLITE_PATH || path.join(__dirname, 'data.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
}

const toSqlite = (sql) => sql.replace(/\$\d+/g, '?');

async function all(sql, params = []) {
  if (isPg) return (await pool.query(sql, params)).rows;
  return sqlite.prepare(toSqlite(sql)).all(...params);
}

async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0] || null;
}

// INSERT/UPDATE/DELETE (con o sin RETURNING)
async function run(sql, params = []) {
  if (isPg) {
    const r = await pool.query(sql, params);
    return { rowCount: r.rowCount, rows: r.rows };
  }
  const stmt = sqlite.prepare(toSqlite(sql));
  if (stmt.reader) {
    const rows = stmt.all(...params);
    return { rowCount: rows.length, rows };
  }
  const info = stmt.run(...params);
  return { rowCount: info.changes, rows: [] };
}

async function exec(sql) {
  if (isPg) return pool.query(sql);
  return sqlite.exec(sql);
}

const PK = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id ${PK},
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id ${PK},
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS products (
  id ${PK},
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price INTEGER NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  image TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 100
);
CREATE TABLE IF NOT EXISTS banners (
  id ${PK},
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  image TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cart_items (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  PRIMARY KEY (user_id, product_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id ${PK},
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subtotal INTEGER NOT NULL,
  tax INTEGER NOT NULL,
  shipping INTEGER NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  id ${PK},
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  image TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);
`;

const CATEGORIES = ['Ropa', 'Electrónica', 'Hogar', 'Deportes'];

// [nombre, descripción, precio COP, categoría, semilla de imagen]
const PRODUCTS = [
  ['Camiseta básica de algodón', 'Camiseta 100 % algodón peinado, cuello redondo y corte regular. Suave, fresca y perfecta para el día a día.', 39900, 'Ropa', 'camiseta'],
  ['Chaqueta de jean clásica', 'Chaqueta de denim resistente con botones metálicos y bolsillos frontales. Un básico que combina con todo.', 189900, 'Ropa', 'chaqueta-jean'],
  ['Zapatillas urbanas', 'Zapatillas livianas con suela antideslizante y plantilla acolchada para máxima comodidad.', 259900, 'Ropa', 'zapatillas'],
  ['Buso con capota', 'Buso de felpa suave con capota ajustable y bolsillo canguro. Ideal para clima frío.', 149900, 'Ropa', 'buso-capota'],
  ['Audífonos Bluetooth', 'Audífonos inalámbricos con cancelación de ruido, 30 horas de batería y micrófono integrado.', 129900, 'Electrónica', 'audifonos'],
  ['Smartwatch deportivo', 'Reloj inteligente con monitor de ritmo cardíaco, GPS y resistencia al agua 5 ATM.', 219900, 'Electrónica', 'smartwatch'],
  ['Parlante portátil', 'Parlante Bluetooth resistente a salpicaduras, sonido 360° y 12 horas de reproducción.', 99900, 'Electrónica', 'parlante'],
  ['Cargador rápido USB-C 45W', 'Cargador de pared de carga rápida compatible con celulares, tabletas y portátiles.', 49900, 'Electrónica', 'cargador'],
  ['Teclado mecánico', 'Teclado mecánico con switches rojos, retroiluminación y diseño compacto para escritorio.', 199900, 'Electrónica', 'teclado'],
  ['Lámpara LED de escritorio', 'Lámpara con brazo flexible, tres tonos de luz y control de intensidad táctil.', 59900, 'Hogar', 'lampara'],
  ['Juego de sábanas queen', 'Sábanas de microfibra suave, 4 piezas, ajustables y antiarrugas.', 119900, 'Hogar', 'sabanas'],
  ['Cafetera de goteo', 'Cafetera programable de 12 tazas con filtro permanente y función mantener caliente.', 139900, 'Hogar', 'cafetera'],
  ['Balón de fútbol N.º 5', 'Balón de fútbol cosido a máquina, tamaño oficial, ideal para cancha y entrenamiento.', 79900, 'Deportes', 'balon'],
  ['Mat de yoga antideslizante', 'Mat de 6 mm de espesor con superficie antideslizante y correa de transporte.', 69900, 'Deportes', 'mat-yoga'],
  ['Botella térmica 750 ml', 'Botella de acero inoxidable que mantiene el frío 24 h y el calor 12 h.', 44900, 'Deportes', 'botella'],
  ['Mancuernas 5 kg (par)', 'Par de mancuernas recubiertas en neopreno con agarre antideslizante.', 89900, 'Deportes', 'mancuernas'],
];

const BANNERS = [
  ['Ofertas de temporada', 'Hasta 30 % de descuento en productos seleccionados', 'banner-ofertas'],
  ['Lo último en tecnología', 'Audífonos, relojes y mucho más', 'banner-tecnologia'],
  ['Envío gratis', 'En compras superiores a $ 300.000', 'banner-envio'],
];

async function init() {
  const statements = SCHEMA.split(';').map((s) => s.trim()).filter(Boolean);
  for (const s of statements) await exec(s);

  const cat = await get('SELECT id FROM categories LIMIT 1');
  if (!cat) {
    for (const name of CATEGORIES) await run('INSERT INTO categories (name) VALUES ($1)', [name]);
    const cats = await all('SELECT id, name FROM categories');
    const byName = Object.fromEntries(cats.map((c) => [c.name, c.id]));
    for (const [name, desc, price, category, image] of PRODUCTS) {
      await run(
        'INSERT INTO products (name, description, price, category_id, image, stock) VALUES ($1,$2,$3,$4,$5,$6)',
        [name, desc, price, byName[category], image, 100]
      );
    }
    let i = 0;
    for (const [title, subtitle, image] of BANNERS) {
      await run('INSERT INTO banners (title, subtitle, image, sort) VALUES ($1,$2,$3,$4)', [title, subtitle, image, i++]);
    }
    console.log('Base de datos inicializada con productos de ejemplo.');
  }
}

module.exports = { all, get, run, exec, init, isPg };
