const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production' || 
                     process.env.DATABASE_URL?.includes('supabase') ||
                     process.env.DATABASE_URL?.includes('render') ||
                     process.env.DATABASE_URL?.includes('railway');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('connect', () => {
  console.log('📦 DB connected');
});

pool.on('error', (err) => {
  console.error('❌ DB error:', err.message);
});

module.exports = pool;