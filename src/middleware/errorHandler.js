// =============================================
// GLOBAL ERROR HANDLER
// =============================================
const errorHandler = (err, req, res, next) => {
  console.error('🔥 Error:', err.message);
  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  // PostgreSQL errors
  if (err.code === '23505') {
    const field = err.detail?.match(/\(([^)]+)\)/)?.[1] || 'data';
    return res.status(409).json({
      success: false,
      message: `${field} sudah terdaftar`,
    });
  }

  if (err.code === '23503') {
    return res.status(400).json({
      success: false,
      message: 'Referensi data tidak ditemukan',
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Token tidak valid' });
  }

  // Default error
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Terjadi kesalahan server',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

// =============================================
// HELPER: Standard API Response
// =============================================
const sendSuccess = (res, data = {}, message = 'Berhasil', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

const sendError = (res, message = 'Terjadi kesalahan', statusCode = 400, errors = null) => {
  return res.status(statusCode).json({
    success: false,
    message,
    ...(errors && { errors }),
  });
};

// =============================================
// MIDDLEWARE: Not Found Handler
// =============================================
const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} tidak ditemukan`,
  });
};

module.exports = { errorHandler, notFound, sendSuccess, sendError };
