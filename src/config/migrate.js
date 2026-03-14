require('dotenv').config();
const pool = require('./db');
const bcrypt = require('bcryptjs');

async function migrate() {
  const client = await pool.connect();
  console.log('\n🚀 Running migrations...\n');

  try {
    await client.query('BEGIN');

    // USERS
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        email       VARCHAR(255) UNIQUE NOT NULL,
        password    VARCHAR(255) NOT NULL,
        role        VARCHAR(20)  DEFAULT 'customer' CHECK (role IN ('customer','admin')),
        phone       VARCHAR(20),
        avatar_url  TEXT,
        is_active   BOOLEAN DEFAULT true,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ users');

    // CATEGORIES
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        slug        VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        image_url   TEXT,
        parent_id   INTEGER REFERENCES categories(id),
        is_active   BOOLEAN DEFAULT true,
        sort_order  INTEGER DEFAULT 0,
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ categories');

    // PRODUCTS
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id                  SERIAL PRIMARY KEY,
        name                VARCHAR(500) NOT NULL,
        slug                VARCHAR(500) UNIQUE NOT NULL,
        description         TEXT,
        short_description   TEXT,
        price               DECIMAL(10,2) NOT NULL,
        compare_price       DECIMAL(10,2),
        cost_price          DECIMAL(10,2),
        sku                 VARCHAR(100) UNIQUE,
        product_type        VARCHAR(20) DEFAULT 'physical' CHECK (product_type IN ('physical','digital')),
        stock_quantity      INTEGER DEFAULT 0,
        low_stock_threshold INTEGER DEFAULT 5,
        category_id         INTEGER REFERENCES categories(id),
        brand               VARCHAR(255),
        weight              DECIMAL(8,2),
        images              JSONB DEFAULT '[]',
        digital_file_url    TEXT,
        tags                TEXT[],
        is_active           BOOLEAN DEFAULT true,
        is_featured         BOOLEAN DEFAULT false,
        rating_avg          DECIMAL(3,2) DEFAULT 0,
        rating_count        INTEGER DEFAULT 0,
        created_at          TIMESTAMP DEFAULT NOW(),
        updated_at          TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ products');

    // ADDRESSES
    await client.query(`
      CREATE TABLE IF NOT EXISTS addresses (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
        full_name     VARCHAR(255) NOT NULL,
        phone         VARCHAR(20)  NOT NULL,
        address_line1 VARCHAR(500) NOT NULL,
        address_line2 VARCHAR(500),
        city          VARCHAR(255) NOT NULL,
        state         VARCHAR(255) NOT NULL,
        pincode       VARCHAR(10)  NOT NULL,
        country       VARCHAR(100) DEFAULT 'India',
        is_default    BOOLEAN DEFAULT false,
        created_at    TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ addresses');

    // ORDERS
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id                  SERIAL PRIMARY KEY,
        order_number        VARCHAR(50) UNIQUE NOT NULL,
        user_id             INTEGER REFERENCES users(id),
        status              VARCHAR(50) DEFAULT 'pending'
          CHECK (status IN ('pending','confirmed','processing','shipped','delivered','cancelled','refunded')),
        payment_status      VARCHAR(50) DEFAULT 'unpaid'
          CHECK (payment_status IN ('unpaid','paid','failed','refunded')),
        payment_method      VARCHAR(50),
        phonepe_txn_id      VARCHAR(255),
        phonepe_merchant_txn_id VARCHAR(255),
        subtotal            DECIMAL(10,2) NOT NULL,
        shipping_charge     DECIMAL(10,2) DEFAULT 0,
        discount            DECIMAL(10,2) DEFAULT 0,
        tax                 DECIMAL(10,2) DEFAULT 0,
        total               DECIMAL(10,2) NOT NULL,
        shipping_address    JSONB,
        notes               TEXT,
        created_at          TIMESTAMP DEFAULT NOW(),
        updated_at          TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ orders');

    // ORDER ITEMS
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id              SERIAL PRIMARY KEY,
        order_id        INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        product_id      INTEGER REFERENCES products(id),
        product_name    VARCHAR(500) NOT NULL,
        product_image   TEXT,
        product_type    VARCHAR(20) DEFAULT 'physical',
        quantity        INTEGER NOT NULL,
        price           DECIMAL(10,2) NOT NULL,
        total           DECIMAL(10,2) NOT NULL,
        created_at      TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ order_items');

    // CART ITEMS
    await client.query(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
        product_id  INTEGER REFERENCES products(id) ON DELETE CASCADE,
        quantity    INTEGER DEFAULT 1,
        created_at  TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, product_id)
      );
    `);
    console.log('✅ cart_items');

    // REVIEWS
    await client.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id          SERIAL PRIMARY KEY,
        product_id  INTEGER REFERENCES products(id) ON DELETE CASCADE,
        user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
        rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        title       VARCHAR(255),
        comment     TEXT,
        created_at  TIMESTAMP DEFAULT NOW(),
        UNIQUE(product_id, user_id)
      );
    `);
    console.log('✅ reviews');

    // COUPONS
    await client.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id                SERIAL PRIMARY KEY,
        code              VARCHAR(50) UNIQUE NOT NULL,
        type              VARCHAR(20) CHECK (type IN ('percentage','fixed')),
        value             DECIMAL(10,2) NOT NULL,
        min_order_amount  DECIMAL(10,2) DEFAULT 0,
        max_discount      DECIMAL(10,2),
        usage_limit       INTEGER,
        used_count        INTEGER DEFAULT 0,
        expires_at        TIMESTAMP,
        is_active         BOOLEAN DEFAULT true,
        created_at        TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ coupons');

    // WISHLISTS
    await client.query(`
      CREATE TABLE IF NOT EXISTS wishlists (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
        product_id  INTEGER REFERENCES products(id) ON DELETE CASCADE,
        created_at  TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, product_id)
      );
    `);
    console.log('✅ wishlists');

    // INDEXES
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_category   ON products(category_id);
      CREATE INDEX IF NOT EXISTS idx_products_active     ON products(is_active);
      CREATE INDEX IF NOT EXISTS idx_products_featured   ON products(is_featured);
      CREATE INDEX IF NOT EXISTS idx_orders_user         ON orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_cart_user           ON cart_items(user_id);
      CREATE INDEX IF NOT EXISTS idx_reviews_product     ON reviews(product_id);
    `);
    console.log('✅ indexes');

    // SEED: Admin user
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@12345', 10);
    await client.query(`
      INSERT INTO users (name, email, password, role)
      VALUES ($1, $2, $3, 'admin')
      ON CONFLICT (email) DO NOTHING
    `, [process.env.ADMIN_NAME || 'Admin', process.env.ADMIN_EMAIL || 'admin@mystore.com', hash]);
    console.log('✅ admin user seeded');

    // SEED: Categories
    await client.query(`
      INSERT INTO categories (name, slug, description, sort_order) VALUES
        ('Electronics',    'electronics',    'Phones, laptops, gadgets',       1),
        ('Clothing',       'clothing',       'Men, women and kids fashion',     2),
        ('Home & Kitchen', 'home-kitchen',   'Furniture and kitchen essentials',3),
        ('Books',          'books',          'Physical and digital books',      4),
        ('Sports',         'sports',         'Sports and fitness equipment',    5),
        ('Digital Goods',  'digital-goods',  'Software, courses, e-books',      6)
      ON CONFLICT (slug) DO NOTHING
    `);
    console.log('✅ categories seeded');

    // SEED: Sample coupon
    await client.query(`
      INSERT INTO coupons (code, type, value, min_order_amount, max_discount)
      VALUES ('WELCOME10', 'percentage', 10, 199, 100)
      ON CONFLICT (code) DO NOTHING
    `);
    console.log('✅ sample coupon: WELCOME10 (10% off, max ₹100)');

    await client.query('COMMIT');

    console.log('\n🎉 Migration complete!\n');
    console.log('──────────────────────────────────────');
    console.log('📧 Admin Email    :', process.env.ADMIN_EMAIL || 'admin@mystore.com');
    console.log('🔑 Admin Password :', process.env.ADMIN_PASSWORD || 'Admin@12345');
    console.log('🎟️  Sample Coupon  : WELCOME10');
    console.log('──────────────────────────────────────\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));
