const pool = require('../config/db');
const { uploadBuffer } = require('../config/cloudinary');

const slugify = (t) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// ─── PUBLIC ─────────────────────────────────────────────────────────────────

// GET /api/products
exports.list = async (req, res) => {
  const {
    page = 1, limit = 12,
    category, search,
    minPrice, maxPrice,
    sort = 'created_at', order = 'DESC',
    featured, type
  } = req.query;

  const offset = (page - 1) * limit;
  const conds = ['p.is_active = true'];
  const params = [];
  let n = 1;

  if (category) { conds.push(`c.slug = $${n++}`); params.push(category); }
  if (type)     { conds.push(`p.product_type = $${n++}`); params.push(type); }
  if (search)   {
    conds.push(`(p.name ILIKE $${n} OR p.description ILIKE $${n})`);
    params.push(`%${search}%`); n++;
  }
  if (minPrice) { conds.push(`p.price >= $${n++}`); params.push(Number(minPrice)); }
  if (maxPrice) { conds.push(`p.price <= $${n++}`); params.push(Number(maxPrice)); }
  if (featured === 'true') conds.push(`p.is_featured = true`);

  const where = 'WHERE ' + conds.join(' AND ');
  const sortMap = { price: 'p.price', name: 'p.name', rating: 'p.rating_avg', created_at: 'p.created_at' };
  const col = sortMap[sort] || 'p.created_at';
  const dir = order === 'ASC' ? 'ASC' : 'DESC';

  try {
    const total = await pool.query(
      `SELECT COUNT(*) FROM products p LEFT JOIN categories c ON p.category_id=c.id ${where}`,
      params
    );
    const rows = await pool.query(
      `SELECT p.id,p.name,p.slug,p.price,p.compare_price,p.images,p.product_type,
              p.stock_quantity,p.is_featured,p.rating_avg,p.rating_count,
              c.name as category_name, c.slug as category_slug
       FROM products p LEFT JOIN categories c ON p.category_id=c.id
       ${where} ORDER BY ${col} ${dir}
       LIMIT $${n} OFFSET $${n + 1}`,
      [...params, Number(limit), offset]
    );

    res.json({
      products: rows.rows,
      pagination: {
        page: Number(page), limit: Number(limit),
        total: Number(total.rows[0].count),
        pages: Math.ceil(total.rows[0].count / limit)
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// GET /api/products/:slug
exports.get = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, c.name as category_name, c.slug as category_slug
       FROM products p LEFT JOIN categories c ON p.category_id=c.id
       WHERE p.slug=$1 AND p.is_active=true`,
      [req.params.slug]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ─── ADMIN ───────────────────────────────────────────────────────────────────

// GET /api/admin/products
exports.adminList = async (req, res) => {
  const { page = 1, limit = 20, search } = req.query;
  const offset = (page - 1) * limit;
  const conds = [];
  const params = [];
  let n = 1;

  if (search) {
    conds.push(`(p.name ILIKE $${n} OR p.sku ILIKE $${n})`);
    params.push(`%${search}%`); n++;
  }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  try {
    const total = await pool.query(`SELECT COUNT(*) FROM products p ${where}`, params);
    const { rows } = await pool.query(
      `SELECT p.*,c.name as category_name FROM products p
       LEFT JOIN categories c ON p.category_id=c.id
       ${where} ORDER BY p.created_at DESC LIMIT $${n} OFFSET $${n + 1}`,
      [...params, Number(limit), offset]
    );
    res.json({ products: rows, total: Number(total.rows[0].count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/admin/products
exports.create = async (req, res) => {
  const {
    name, description, short_description,
    price, compare_price, cost_price,
    sku, product_type = 'physical',
    stock_quantity = 0, category_id,
    brand, weight, tags, is_featured,
    digital_file_url
  } = req.body;

  if (!name || !price) return res.status(400).json({ error: 'Name and price are required' });

  try {
    // Upload images to Cloudinary
    const images = [];
    if (req.files?.length) {
      for (const file of req.files) {
        const result = await uploadBuffer(file.buffer, file.mimetype, 'ecommerce/products');
        images.push({ url: result.secure_url, public_id: result.public_id });
      }
    }

    // Unique slug
    let slug = slugify(name);
    const dupe = await pool.query(`SELECT id FROM products WHERE slug LIKE $1`, [`${slug}%`]);
    if (dupe.rows.length) slug += '-' + Date.now();

    const { rows } = await pool.query(
      `INSERT INTO products
         (name,slug,description,short_description,price,compare_price,cost_price,
          sku,product_type,stock_quantity,category_id,brand,weight,
          images,digital_file_url,tags,is_featured)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        name, slug, description, short_description,
        price, compare_price || null, cost_price || null,
        sku || null, product_type,
        product_type === 'digital' ? 999 : Number(stock_quantity),
        category_id || null, brand || null, weight || null,
        JSON.stringify(images),
        product_type === 'digital' ? (digital_file_url || null) : null,
        tags ? tags.split(',').map(t => t.trim()) : [],
        is_featured === 'true'
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// PUT /api/admin/products/:id
exports.update = async (req, res) => {
  const {
    name, description, short_description,
    price, compare_price, sku,
    stock_quantity, category_id, brand,
    is_active, is_featured, tags, digital_file_url
  } = req.body;

  try {
    const current = await pool.query('SELECT * FROM products WHERE id=$1', [req.params.id]);
    if (!current.rows[0]) return res.status(404).json({ error: 'Product not found' });
    const p = current.rows[0];

    let images = p.images;
    if (req.files?.length) {
      images = [];
      for (const file of req.files) {
        const result = await uploadBuffer(file.buffer, file.mimetype, 'ecommerce/products');
        images.push({ url: result.secure_url, public_id: result.public_id });
      }
    }

    const { rows } = await pool.query(
      `UPDATE products SET
         name=$1, description=$2, short_description=$3,
         price=$4, compare_price=$5, sku=$6,
         stock_quantity=$7, category_id=$8, brand=$9,
         is_active=$10, is_featured=$11,
         tags=$12, images=$13, digital_file_url=$14,
         updated_at=NOW()
       WHERE id=$15 RETURNING *`,
      [
        name || p.name,
        description ?? p.description,
        short_description ?? p.short_description,
        price || p.price,
        compare_price ?? p.compare_price,
        sku ?? p.sku,
        stock_quantity ?? p.stock_quantity,
        category_id || p.category_id,
        brand ?? p.brand,
        is_active !== undefined ? is_active : p.is_active,
        is_featured !== undefined ? is_featured : p.is_featured,
        tags ? tags.split(',').map(t => t.trim()) : p.tags,
        JSON.stringify(images),
        digital_file_url ?? p.digital_file_url,
        req.params.id
      ]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// DELETE /api/admin/products/:id  (soft delete)
exports.remove = async (req, res) => {
  try {
    await pool.query('UPDATE products SET is_active=false,updated_at=NOW() WHERE id=$1', [req.params.id]);
    res.json({ message: 'Product removed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};
