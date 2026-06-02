require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = require('./src/app');
const { pool } = require('./src/config/database');
const { initFirebase } = require('./src/config/firebase');
const { setupSocket } = require('./src/socket/chatHandler');

const PORT = process.env.PORT || 3000;

// =============================================
// BUAT DIREKTORI UPLOADS
// =============================================
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// =============================================
// HTTP SERVER + SOCKET.IO
// =============================================
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ── [TAMBAHAN] Expose io ke Express app ──────────────────────
// Wajib agar req.app.get('io') di chat.js bisa broadcast
// socket event 'message:deleted' saat REST DELETE dipanggil
app.set('io', io);

// =============================================
// INISIALISASI
// =============================================
async function startServer() {
  try {
    console.log('\n🔌 Menghubungkan ke database...');
    await pool.query('SELECT NOW()');

    initFirebase();
    setupSocket(io);

    server.listen(PORT, () => {
      console.log('\n╔═══════════════════════════════════════╗');
      console.log('║         LEXORA BACKEND SERVER         ║');
      console.log('╠═══════════════════════════════════════╣');
      console.log(`║  Port     : ${PORT.toString().padEnd(26)}║`);
      console.log(`║  Mode     : ${(process.env.NODE_ENV || 'development').padEnd(26)}║`);
      console.log(`║  API Docs : http://localhost:${PORT}/api  ║`);
      console.log(`║  Health   : http://localhost:${PORT}/health║`);
      console.log('╚═══════════════════════════════════════╝\n');
    });

  } catch (error) {
    console.error('\n❌ Gagal menjalankan server:', error.message);
    process.exit(1);
  }
}

// =============================================
// GRACEFUL SHUTDOWN
// =============================================
process.on('SIGTERM', async () => {
  console.log('\n⚠️  SIGTERM diterima. Menutup server...');
  server.close(async () => {
    await pool.end();
    console.log('✅ Server ditutup dengan bersih.');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('\n⚠️  SIGINT diterima. Menutup server...');
  await pool.end();
  process.exit(0);
});

startServer();