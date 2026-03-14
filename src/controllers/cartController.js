const pool = require('../config/db');

// GET /api/cart
exports.get = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ci.id, ci.quantity,
              p.id as product_id, p.name, p.slug, p.price, p.compare_price,
              p.images, p.stock_quantity, p.product_type
       FROM cart_items ci
       JOIN products p ON ci.product_id=p.id
       WHERE ci.user_id=$1 AND p.is_active=true`,
      [req.user.id]
    );
    const subtotal = rows.reduce((s, i) => s + i.price * i.quantity, 0);
    res.json({ items: rows, subtotal: +subtotal.toFixed(2), count: rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/cart
exports.add = async (req, res) => {
  const { product_id, quantity = 1 } = req.body;
  if (!product_id) return res.status(400).json({ error: 'product_id required' });

  try {
    const { rows } = await pool.query(
      'SELECT stock_quantity, product_type FROM products WHERE id=$1 AND is_active=true',
      [product_id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    if (rows[0].product_type === 'physical' && rows[0].stock_quantity < 1)
      return res.status(400).json({ error: 'Out of stock' });

    await pool.query(
      `INSERT INTO cart_items (user_id,product_id,quantity) VALUES ($1,$2,$3)
       ON CONFLICT (user_id,product_id) DO UPDATE SET quantity=cart_items.quantity+$3`,
      [req.user.id, product_id, quantity]
    );
    res.json({ message: 'Added to cart' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// PUT /api/cart/:id
exports.update = async (req, res) => {
  const { quantity } = req.body;
  if (!quantity || quantity < 1) return res.status(400).json({ error: 'Valid quantity required' });

  try {
    const { rows } = await pool.query(
      'UPDATE cart_items SET quantity=$1 WHERE id=$2 AND user_id=$3 RETURNING *',
      [quantity, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Item not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// DELETE /api/cart/:id
exports.remove = async (req, res) => {
  try {
    await pool.query('DELETE FROM cart_items WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ message: 'Removed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// DELETE /api/cart  (clear all)
exports.clear = async (req, res) => {
  try {
    await pool.query('DELETE FROM cart_items WHERE user_id=$1', [req.user.id]);
    res.json({ message: 'Cart cleared' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};
