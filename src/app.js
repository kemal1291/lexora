const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

const { initFirebase } = require('./config/firebase');
initFirebase();

const authRoutes          = require('./routes/auth');
const advocatesRoutes     = require('./routes/advocates');
const complaintsRoutes    = require('./routes/complaints');
const chatRoutes          = require('./routes/chat');
const subscriptionsRoutes = require('./routes/subscriptions');
const articlesRoutes      = require('./routes/articles');  // ← TAMBAH INI
const { errorHandler, notFound } = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Terlalu banyak permintaan. Coba lagi nanti.' },
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' },
});
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Lexora Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/advocates',     advocatesRoutes);
app.use('/api/complaints',    complaintsRoutes);
app.use('/api/chat',          chatRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/api/articles',      articlesRoutes);  // ← TAMBAH INI

app.get('/api', (req, res) => {
  res.json({
    success: true,
    app: 'Lexora API',
    version: '1.0.0',
    endpoints: {
      auth: {
        'POST /api/auth/register':      'Daftar dengan email & password',
        'POST /api/auth/login':         'Login dengan email & password',
        'POST /api/auth/google':        'Login dengan Google (Firebase token)',
        'POST /api/auth/phone/verify':  'Verifikasi OTP telepon (Firebase token)',
        'POST /api/auth/advocate/login':'Login khusus advokat',
        'GET /api/auth/me':             'Profil user yang login [AUTH]',
        'PUT /api/auth/profile':        'Update profil [AUTH]',
        'PUT /api/auth/change-password':'Ubah password [AUTH]',
      },
      advocates: {
        'GET /api/advocates':           'Daftar advokat',
        'GET /api/advocates/me/profile':'Profil advokat login [ADVOCATE]',
        'PUT /api/advocates/me/fee':    'Update tarif [ADVOCATE]',
        'GET /api/advocates/:id':       'Detail advokat',
      },
      articles: {
        'GET /api/articles':            'Semua artikel (publik)',
        'GET /api/articles/my/list':    'Artikel milik advokat [ADVOCATE]',
        'GET /api/articles/:id':        'Detail artikel',
        'POST /api/articles':           'Buat artikel [ADVOCATE]',
        'PUT /api/articles/:id':        'Update artikel [ADVOCATE]',
        'DELETE /api/articles/:id':     'Hapus artikel [ADVOCATE]',
      },
      complaints: {
        'GET /api/complaints':          'Daftar pengaduan [AUTH]',
        'POST /api/complaints':         'Buat pengaduan baru [USER]',
        'GET /api/complaints/:id':      'Detail pengaduan [AUTH]',
        'PATCH /api/complaints/:id/status':'Update status [ADVOCATE]',
      },
      chat: {
        'GET /api/chat/rooms':          'Daftar chat room [AUTH]',
        'POST /api/chat/rooms':         'Buat chat room [USER]',
        'GET /api/chat/rooms/:id/messages':'Riwayat pesan [AUTH]',
      },
    },
  });
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;