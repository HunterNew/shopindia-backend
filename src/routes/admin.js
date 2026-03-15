const express      = require('express');
const router       = express.Router();
const pCtrl        = require('../controllers/productController');
const cCtrl        = require('../controllers/categoryController');
const oCtrl        = require('../controllers/orderController');
const { auth, adminOnly } = require('../middleware/auth');
const upload       = require('../middleware/upload');
const pool         = require('../config/db');

router.use(auth, adminOnly);

// Dashboard
router.get('/dashboard', oCtrl.dashboard);

// Products
router.get   ('/products',     pCtrl.adminList);
router.post  ('/products',     upload.array('images', 6), pCtrl.create);
router.put   ('/products/:id', upload.array('images', 6), pCtrl.update);
router.delete('/products/:id', pCtrl.remove);

// Categories
// router.get   ('/categories',     cCtrl.list);
router.get('/categories', cCtrl.adminList);
router.post  ('/categories',     upload.single('image'), cCtrl.create);
router.put   ('/categories/:id', upload.single('image'), cCtrl.update);
router.delete('/categories/:id', cCtrl.remove);

// Orders
router.get('/orders',              oCtrl.adminList);
router.put('/orders/:id/status',   oCtrl.updateStatus);

// Users
router.get('/users', async (req, res) => {
  const { page = 1, limit = 20, search } = req.query;
  const offset = (page - 1) * limit;
  try {
    const conds = ["role='customer'"];
    const params = [];
    let n = 1;
    if (search) {
      conds.push(`(name ILIKE $${n} OR email ILIKE $${n})`);
      params.push(`%${search}%`); n++;
    }
    const where = 'WHERE ' + conds.join(' AND ');
    const total = await pool.query(`SELECT COUNT(*) FROM users ${where}`, params);
    const { rows } = await pool.query(
      `SELECT id,name,email,phone,is_active,created_at FROM users ${where}
       ORDER BY created_at DESC LIMIT $${n} OFFSET $${n + 1}`,
      [...params, Number(limit), offset]
    );
    res.json({ users: rows, total: Number(total.rows[0].count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Coupons
router.get('/coupons', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM coupons ORDER BY created_at DESC');
  res.json(rows);
});
router.post('/coupons', async (req, res) => {
  const { code, type, value, min_order_amount, max_discount, usage_limit, expires_at } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO coupons (code,type,value,min_order_amount,max_discount,usage_limit,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [code.toUpperCase(), type, value, min_order_amount || 0, max_discount || null, usage_limit || null, expires_at || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/coupons/:id', async (req, res) => {
  const { is_active } = req.body;
  const { rows } = await pool.query(
    'UPDATE coupons SET is_active=$1 WHERE id=$2 RETURNING *', [is_active, req.params.id]
  );
  res.json(rows[0]);
});

module.exports = router;
