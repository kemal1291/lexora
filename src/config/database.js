const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'lexora_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  console.log('✅ Database PostgreSQL terhubung');
});

pool.on('error', (err) => {
  console.error('❌ Database error:', err.message);
});

// Helper query dengan logging
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log(`🗃️  Query [${duration}ms]:`, text.substring(0, 80));
    }
    return res;
  } catch (error) {
    console.error('Query error:', error.message, '\nQuery:', text);
    throw error;
  }
};

module.exports = { pool, query };
