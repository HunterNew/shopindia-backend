const pool = require('../config/db');
const { sendContactEmail } = require('../config/email');

// POST /api/contact
exports.submit = async (req, res) => {
  const { name, email, phone, subject, message } = req.body;

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'Name, email, subject and message are required' });
  }

  if (message.length < 10) {
    return res.status(400).json({ error: 'Message must be at least 10 characters' });
  }

  try {
    // Save to database
    await pool.query(
      `INSERT INTO contact_messages (name, email, phone, subject, message)
       VALUES ($1, $2, $3, $4, $5)`,
      [name, email, phone || null, subject, message]
    );

    // Send email to admin
    try {
      await sendContactEmail(name, email, phone, subject, message);
      console.log(`📧 Contact form email sent from ${email}`);
    } catch (emailErr) {
      console.warn('⚠️  Contact email failed:', emailErr.message);
      // Don't fail the request if email fails
    }

    res.json({ message: 'Message sent successfully! We will get back to you within 24 hours.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/admin/contacts - admin view all messages
exports.adminList = async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const offset = (page - 1) * limit;

  let where = '';
  const params = [];
  if (status) {
    where = 'WHERE status = $1';
    params.push(status);
  }

  try {
    const total = await pool.query(`SELECT COUNT(*) FROM contact_messages ${where}`, params);
    const { rows } = await pool.query(
      `SELECT * FROM contact_messages ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, Number(limit), offset]
    );
    res.json({ messages: rows, total: Number(total.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/admin/contacts/:id - mark as read/replied
exports.updateStatus = async (req, res) => {
  const { status } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE contact_messages SET status=$1 WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
