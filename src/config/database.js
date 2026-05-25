const { Pool } = require('pg');

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'lexora_db',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
      }
);

pool.on('connect', () => console.log('✅ Database PostgreSQL terhubung'));
pool.on('error', (err) => console.error('❌ Database error:', err.message));

const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    if (process.env.NODE_ENV === 'development') {
      console.log(`🗃️  Query [${Date.now()-start}ms]:`, text.substring(0, 80));
    }
    return res;
  } catch (error) {
    console.error('Query error:', error.message);
    throw error;
  }
};

module.exports = { pool, query };