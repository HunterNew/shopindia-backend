const pool = require('../config/db');
const crypto = require('crypto');
const axios = require('axios');

const makeOrderNumber = () =>
  'ORD' + Date.now() + Math.random().toString(36).slice(2, 5).toUpperCase();

// ─── PhonePe helpers ──────────────────────────────────────────────────────────

const PHONEPE_BASE = process.env.PHONEPE_BASE_URL || 'https://api-preprod.phonepe.com/apis/pg-sandbox';
const MERCHANT_ID  = process.env.PHONEPE_MERCHANT_ID;
const SALT_KEY     = process.env.PHONEPE_SALT_KEY;
const SALT_INDEX   = process.env.PHONEPE_SALT_INDEX || '1';

function phonePeChecksum(payload) {
  const base64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const hash = crypto
    .createHash('sha256')
    .update(base64 + '/pg/v1/pay' + SALT_KEY)
    .digest('hex');
  return { base64, checksum: `${hash}###${SALT_INDEX}` };
}

function verifyCallback(body, xVerify) {
  const [receivedHash] = xVerify.split('###');
  const expected = crypto
    .createHash('sha256')
    .update(body + SALT_KEY)
    .digest('hex');
  return receivedHash === expected;
}

// POST /api/orders/initiate-phonepe
exports.initiatePhonePe = async (req, res) => {
  const { amount, merchantTransactionId } = req.body; // amount in rupees
  const amountPaise = Math.round(amount * 100);

  const payload = {
    merchantId: MERCHANT_ID,
    merchantTransactionId,
    merchantUserId: `USER_${req.user.id}`,
    amount: amountPaise,
    redirectUrl: `${process.env.FRONTEND_URL}/order-status?txn=${merchantTransactionId}`,
    redirectMode: 'REDIRECT',
    callbackUrl: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/orders/phonepe-callback`,
    paymentInstrument: { type: 'PAY_PAGE' }
  };

  const { base64, checksum } = phonePeChecksum(payload);

  try {
    const response = await axios.post(
      `${PHONEPE_BASE}/pg/v1/pay`,
      { request: base64 },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': checksum
        }
      }
    );
    // Returns a payment page URL to redirect the user
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
};

// POST /api/orders/phonepe-callback  (called by PhonePe server)
exports.phonePeCallback = async (req, res) => {
  const xVerify = req.headers['x-verify'];
  const rawBody = JSON.stringify(req.body);

  if (!verifyCallback(rawBody, xVerify)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const decoded = JSON.parse(Buffer.from(req.body.response, 'base64').toString());
  const { merchantTransactionId, transactionId, code } = decoded.data || decoded;
  const success = code === 'PAYMENT_SUCCESS';

  try {
    await pool.query(
      `UPDATE orders SET
         payment_status=$1, phonepe_txn_id=$2, status=$3, updated_at=NOW()
       WHERE phonepe_merchant_txn_id=$4`,
      [
        success ? 'paid' : 'failed',
        transactionId,
        success ? 'confirmed' : 'pending',
        merchantTransactionId
      ]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/orders
exports.place = async (req, res) => {
  const {
    shipping_address, payment_method, // 'cod' or 'phonepe'
    phonepe_merchant_txn_id, coupon_code, notes
  } = req.body;

  if (!payment_method) return res.status(400).json({ error: 'Payment method required' });
  // For physical products, address is required
  if (payment_method === 'cod' && !shipping_address)
    return res.status(400).json({ error: 'Shipping address required for COD' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch cart
    const { rows: cartItems } = await client.query(
      `SELECT ci.*, p.price, p.name, p.images, p.stock_quantity, p.product_type
       FROM cart_items ci JOIN products p ON ci.product_id=p.id
       WHERE ci.user_id=$1`,
      [req.user.id]
    );
    if (!cartItems.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Stock check for physical products
    for (const item of cartItems) {
      if (item.product_type === 'physical' && item.stock_quantity < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Not enough stock for "${item.name}"` });
      }
    }

    // Financials
    const subtotal = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
    const hasPhysical = cartItems.some(i => i.product_type === 'physical');
    const shipping_charge = hasPhysical ? (subtotal >= 500 ? 0 : 49) : 0;
    const gst = +(subtotal * 0.18).toFixed(2);
    let discount = 0;

    // Coupon
    if (coupon_code) {
      const { rows: cRows } = await client.query(
        `SELECT * FROM coupons
         WHERE code=$1 AND is_active=true
           AND (expires_at IS NULL OR expires_at>NOW())
           AND (usage_limit IS NULL OR used_count<usage_limit)`,
        [coupon_code.toUpperCase()]
      );
      if (cRows[0] && subtotal >= cRows[0].min_order_amount) {
        const c = cRows[0];
        discount = c.type === 'percentage' ? subtotal * c.value / 100 : c.value;
        if (c.max_discount) discount = Math.min(discount, c.max_discount);
        discount = +discount.toFixed(2);
        await client.query('UPDATE coupons SET used_count=used_count+1 WHERE id=$1', [c.id]);
      }
    }

    const total = +(subtotal + shipping_charge + gst - discount).toFixed(2);
    const order_number = makeOrderNumber();

    const isCod = payment_method === 'cod';

    // Insert order
    const { rows: oRows } = await client.query(
      `INSERT INTO orders
         (order_number,user_id,status,payment_status,payment_method,
          phonepe_merchant_txn_id,subtotal,shipping_charge,discount,tax,total,
          shipping_address,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        order_number, req.user.id,
        isCod ? 'confirmed' : 'pending',
        isCod ? 'unpaid' : 'unpaid',
        payment_method,
        phonepe_merchant_txn_id || null,
        subtotal.toFixed(2),
        shipping_charge,
        discount,
        gst,
        total,
        shipping_address ? JSON.stringify(shipping_address) : null,
        notes || null
      ]
    );
    const order = oRows[0];

    // Insert order items + reduce stock
    for (const item of cartItems) {
      const img = item.images?.[0]?.url || null;
      await client.query(
        `INSERT INTO order_items
           (order_id,product_id,product_name,product_image,product_type,quantity,price,total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [order.id, item.product_id, item.name, img, item.product_type, item.quantity, item.price, +(item.price * item.quantity).toFixed(2)]
      );
      if (item.product_type === 'physical') {
        await client.query(
          'UPDATE products SET stock_quantity=stock_quantity-$1,updated_at=NOW() WHERE id=$2',
          [item.quantity, item.product_id]
        );
      }
    }

    // Clear cart
    await client.query('DELETE FROM cart_items WHERE user_id=$1', [req.user.id]);
    await client.query('COMMIT');

    res.status(201).json({ order, message: 'Order placed successfully!' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// GET /api/orders  (my orders)
exports.myOrders = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*, json_agg(oi.* ORDER BY oi.id) as items
       FROM orders o
       LEFT JOIN order_items oi ON o.id=oi.order_id
       WHERE o.user_id=$1
       GROUP BY o.id ORDER BY o.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// GET /api/orders/:id
exports.getOne = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*, json_agg(oi.* ORDER BY oi.id) as items
       FROM orders o LEFT JOIN order_items oi ON o.id=oi.order_id
       WHERE o.id=$1 AND o.user_id=$2 GROUP BY o.id`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ─── ADMIN ─────────────────────────────────────────────────────────────────

// GET /api/admin/orders
exports.adminList = async (req, res) => {
  const { page = 1, limit = 20, status, search } = req.query;
  const offset = (page - 1) * limit;
  const conds = [];
  const params = [];
  let n = 1;

  if (status) { conds.push(`o.status=$${n++}`); params.push(status); }
  if (search) {
    conds.push(`(o.order_number ILIKE $${n} OR u.email ILIKE $${n} OR u.name ILIKE $${n})`);
    params.push(`%${search}%`); n++;
  }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  try {
    const total = await pool.query(
      `SELECT COUNT(*) FROM orders o LEFT JOIN users u ON o.user_id=u.id ${where}`, params
    );
    const { rows } = await pool.query(
      `SELECT o.*, u.name as customer_name, u.email as customer_email
       FROM orders o LEFT JOIN users u ON o.user_id=u.id
       ${where} ORDER BY o.created_at DESC LIMIT $${n} OFFSET $${n + 1}`,
      [...params, Number(limit), offset]
    );
    res.json({ orders: rows, total: Number(total.rows[0].count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// PUT /api/admin/orders/:id/status
exports.updateStatus = async (req, res) => {
  const valid = ['pending','confirmed','processing','shipped','delivered','cancelled','refunded'];
  const { status } = req.body;
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  try {
    const { rows } = await pool.query(
      'UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// GET /api/admin/dashboard
exports.dashboard = async (req, res) => {
  try {
    const [rev, orderStats, customers, products, recent, topProducts, monthlySales] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(total),0) as total_revenue, COUNT(*) as total_orders
                  FROM orders WHERE payment_status='paid'`),
      pool.query(`SELECT status, COUNT(*) as count FROM orders GROUP BY status ORDER BY count DESC`),
      pool.query(`SELECT COUNT(*) FROM users WHERE role='customer'`),
      pool.query(`SELECT COUNT(*) as total,
                  SUM(CASE WHEN stock_quantity<=low_stock_threshold THEN 1 ELSE 0 END) as low_stock
                  FROM products WHERE is_active=true`),
      pool.query(`SELECT o.*,u.name as customer_name FROM orders o
                  LEFT JOIN users u ON o.user_id=u.id
                  ORDER BY o.created_at DESC LIMIT 5`),
      pool.query(`SELECT p.name, SUM(oi.quantity)::int as units_sold, SUM(oi.total)::numeric as revenue
                  FROM order_items oi JOIN products p ON oi.product_id=p.id
                  GROUP BY p.id,p.name ORDER BY units_sold DESC LIMIT 5`),
      pool.query(`SELECT TO_CHAR(created_at,'Mon') as month,
                         DATE_TRUNC('month',created_at) as month_date,
                         SUM(total)::numeric as revenue,
                         COUNT(*) as orders
                  FROM orders WHERE payment_status='paid'
                    AND created_at >= NOW() - INTERVAL '6 months'
                  GROUP BY month, month_date ORDER BY month_date`)
    ]);

    res.json({
      revenue: rev.rows[0],
      orderStats: orderStats.rows,
      totalCustomers: Number(customers.rows[0].count),
      productStats: products.rows[0],
      recentOrders: recent.rows,
      topProducts: topProducts.rows,
      monthlySales: monthlySales.rows
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
};
