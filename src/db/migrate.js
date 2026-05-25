require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function migrate() {
  console.log('🚀 Menjalankan database migration...\n');
  const client = await pool.connect();

  try {
    const schemaSQL = fs.readFileSync(
      path.join(__dirname, 'schema.sql'),
      'utf8'
    );

    await client.query(schemaSQL);
    console.log('✅ Schema berhasil dibuat!');
    console.log('\nTabel yang dibuat:');
    console.log('  - users');
    console.log('  - advocates');
    console.log('  - advocate_specializations');
    console.log('  - complaints');
    console.log('  - chat_rooms');
    console.log('  - messages');
    console.log('  - reviews');
    console.log('  - refresh_tokens');
    console.log('\n✨ Migration selesai!');
  } catch (error) {
    // Ignore "already exists" errors (idempotent)
    if (error.message.includes('already exists')) {
      console.log('ℹ️  Schema sudah ada, tidak ada perubahan.');
    } else {
      console.error('❌ Migration error:', error.message);
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
