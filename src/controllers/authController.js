const pool    = require('../config/db');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { sendOTPEmail } = require('../config/email');

const makeOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const sign = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

exports.register = async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows[0]) return res.status(409).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (name,email,password,phone) VALUES ($1,$2,$3,$4) RETURNING id,name,email,role',
      [name, email.toLowerCase(), hash, phone || null]
    );
    res.status(201).json({ user: rows[0], token: sign(rows[0]) });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email=$1 AND is_active=true', [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Invalid email or password' });
    const { password: _, ...safe } = user;
    res.json({ user: safe, token: sign(user) });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getMe = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,name,email,role,phone,avatar_url,created_at FROM users WHERE id=$1', [req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.updateProfile = async (req, res) => {
  const { name, phone } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE users SET name=$1,phone=$2,updated_at=NOW() WHERE id=$3 RETURNING id,name,email,phone,role',
      [name, phone, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Both passwords are required' });
  try {
    const { rows } = await pool.query('SELECT password FROM users WHERE id=$1', [req.user.id]);
    const ok = await bcrypt.compare(currentPassword, rows[0].password);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password=$1,updated_at=NOW() WHERE id=$2', [hash, req.user.id]);
    res.json({ message: 'Password updated successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/auth/forgot-password
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  try {
    const { rows } = await pool.query(
      'SELECT id,name,email FROM users WHERE email=$1 AND is_active=true',
      [email.toLowerCase()]
    );
    // Always respond OK to prevent email enumeration attacks
    if (!rows[0]) return res.json({ message: 'If this email is registered, you will receive an OTP shortly.' });

    const user = rows[0];
    const otp  = makeOTP();

    // Delete old OTPs for this email
    await pool.query('DELETE FROM password_resets WHERE email=$1', [email.toLowerCase()]);

    // Save new OTP — valid 10 minutes
    await pool.query(
      "INSERT INTO password_resets (email, otp, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')",
      [email.toLowerCase(), otp]
    );

    // Try sending email; fall back to console log if not configured
    try {
      await sendOTPEmail(user.email, otp, user.name);
      console.log('📧 OTP sent to', user.email);
    } catch (emailErr) {
      console.warn('⚠️  Email failed — OTP for testing:', otp);
      console.warn('Email error:', emailErr.message);
    }

    res.json({ message: 'OTP sent to your email. Valid for 10 minutes.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/auth/verify-otp
exports.verifyOTP = async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM password_resets WHERE email=$1 AND otp=$2 AND used=false AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1',
      [email.toLowerCase(), otp]
    );
    if (!rows[0]) return res.status(400).json({ error: 'Invalid or expired OTP. Please request a new one.' });
    res.json({ message: 'OTP verified successfully', valid: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/auth/reset-password
exports.resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword)
    return res.status(400).json({ error: 'Email, OTP and new password are required' });
  if (newPassword.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM password_resets WHERE email=$1 AND otp=$2 AND used=false AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1',
      [email.toLowerCase(), otp]
    );
    if (!rows[0]) return res.status(400).json({ error: 'Invalid or expired OTP. Please start again.' });

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password=$1,updated_at=NOW() WHERE email=$2', [hash, email.toLowerCase()]);
    await pool.query('UPDATE password_resets SET used=true WHERE id=$1', [rows[0].id]);

    res.json({ message: 'Password reset successfully! You can now login.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};