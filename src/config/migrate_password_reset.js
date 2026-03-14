require('dotenv').config();
const pool = require('./db');

async function addPasswordResets() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id          SERIAL PRIMARY KEY,
        email       VARCHAR(255) NOT NULL,
        otp         VARCHAR(6)   NOT NULL,
        expires_at  TIMESTAMP    NOT NULL,
        used        BOOLEAN      DEFAULT false,
        created_at  TIMESTAMP    DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email);
    `);
    console.log('✅ password_resets table created');
  } catch (err) {
    console.error('❌ Failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

addPasswordResets();
