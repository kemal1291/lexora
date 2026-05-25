const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

// =============================================
// MIDDLEWARE: Verifikasi JWT Token
// =============================================
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Token autentikasi diperlukan',
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Ambil data user/advocate dari database
    if (decoded.role === 'advocate') {
      const result = await query(
        'SELECT id, name, email, photo_url, is_active FROM advocates WHERE id = $1',
        [decoded.id]
      );
      if (!result.rows[0] || !result.rows[0].is_active) {
        return res.status(401).json({ success: false, message: 'Akun tidak aktif' });
      }
      req.user = { ...result.rows[0], role: 'advocate' };
    } else {
      const result = await query(
        'SELECT id, name, email, photo_url, is_active FROM users WHERE id = $1',
        [decoded.id]
      );
      if (!result.rows[0] || !result.rows[0].is_active) {
        return res.status(401).json({ success: false, message: 'Akun tidak aktif' });
      }
      req.user = { ...result.rows[0], role: 'user' };
    }

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token sudah kadaluarsa' });
    }
    return res.status(401).json({ success: false, message: 'Token tidak valid' });
  }
};

// =============================================
// MIDDLEWARE: Hanya untuk Advokat
// =============================================
const advocateOnly = (req, res, next) => {
  if (req.user?.role !== 'advocate') {
    return res.status(403).json({
      success: false,
      message: 'Akses ditolak. Hanya untuk advokat.',
    });
  }
  next();
};

// =============================================
// MIDDLEWARE: Hanya untuk User (klien)
// =============================================
const userOnly = (req, res, next) => {
  if (req.user?.role !== 'user') {
    return res.status(403).json({
      success: false,
      message: 'Akses ditolak. Hanya untuk klien.',
    });
  }
  next();
};

// =============================================
// HELPER: Buat JWT Token
// =============================================
const generateToken = (id, role = 'user') => {
  return jwt.sign(
    { id, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
};

module.exports = { authenticate, advocateOnly, userOnly, generateToken };
