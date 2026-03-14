const pool = require('../config/db');
const { uploadBuffer } = require('../config/cloudinary');

const slugify = (t) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// GET /api/categories
exports.list = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, COUNT(p.id)::int as product_count
       FROM categories c
       LEFT JOIN products p ON c.id=p.category_id AND p.is_active=true
       WHERE c.is_active=true
       GROUP BY c.id ORDER BY c.sort_order, c.name`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/admin/categories
exports.create = async (req, res) => {
  const { name, description, parent_id, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  try {
    let image_url = null;
    if (req.file) {
      const result = await uploadBuffer(req.file.buffer, req.file.mimetype, 'ecommerce/categories');
      image_url = result.secure_url;
    }

    const slug = slugify(name) + '-' + Date.now();
    const { rows } = await pool.query(
      `INSERT INTO categories (name,slug,description,image_url,parent_id,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, slug, description || null, image_url, parent_id || null, sort_order || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// PUT /api/admin/categories/:id
exports.update = async (req, res) => {
  const { name, description, is_active, sort_order } = req.body;
  try {
    const cur = await pool.query('SELECT * FROM categories WHERE id=$1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Category not found' });
    const c = cur.rows[0];

    let image_url = c.image_url;
    if (req.file) {
      const result = await uploadBuffer(req.file.buffer, req.file.mimetype, 'ecommerce/categories');
      image_url = result.secure_url;
    }

    const { rows } = await pool.query(
      `UPDATE categories SET name=$1,description=$2,image_url=$3,is_active=$4,sort_order=$5
       WHERE id=$6 RETURNING *`,
      [
        name || c.name, description ?? c.description,
        image_url,
        is_active !== undefined ? is_active : c.is_active,
        sort_order ?? c.sort_order,
        req.params.id
      ]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// DELETE /api/admin/categories/:id
exports.remove = async (req, res) => {
  try {
    await pool.query('UPDATE categories SET is_active=false WHERE id=$1', [req.params.id]);
    res.json({ message: 'Category removed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};
