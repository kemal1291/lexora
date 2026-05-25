const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { verifyFirebaseToken } = require('../config/firebase');
const { generateToken, authenticate } = require('../middleware/auth');
const { sendSuccess, sendError } = require('../middleware/errorHandler');

const router = express.Router();

// =============================================
// HELPER: Format response user
// =============================================
const formatUser = (user, token) => ({
  token,
  user: {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    photoUrl: user.photo_url,
    nik: user.nik,
    address: user.address,
    isVerified: user.is_verified,
    authProvider: user.auth_provider,
    createdAt: user.created_at,
  },
});

// =============================================
// POST /auth/register
// Daftar dengan email & password
// =============================================
router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Nama wajib diisi'),
    body('email').isEmail().withMessage('Format email tidak valid'),
    body('password')
      .isLength({ min: 8 }).withMessage('Password minimal 8 karakter')
      .matches(/[0-9]/).withMessage('Password harus mengandung angka')
      .matches(/[A-Z]/).withMessage('Password harus mengandung huruf kapital'),
    body('phone').optional().isMobilePhone('id-ID').withMessage('Format nomor telepon tidak valid'),
    body('nik').optional().isLength({ min: 16, max: 16 }).withMessage('NIK harus 16 digit'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 'Data tidak valid', 422, errors.array());
      }

      const { name, email, password, phone, nik, address } = req.body;

      // Cek email sudah terdaftar
      const existingUser = await query(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase()]
      );
      if (existingUser.rows.length > 0) {
        return sendError(res, 'Email sudah terdaftar', 409);
      }

      // Cek phone sudah terdaftar
      if (phone) {
        const existingPhone = await query(
          'SELECT id FROM users WHERE phone = $1',
          [phone]
        );
        if (existingPhone.rows.length > 0) {
          return sendError(res, 'Nomor telepon sudah terdaftar', 409);
        }
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      // Simpan user
      const result = await query(
        `INSERT INTO users (name, email, phone, password_hash, nik, address, auth_provider)
         VALUES ($1, $2, $3, $4, $5, $6, 'email')
         RETURNING *`,
        [name, email.toLowerCase(), phone || null, passwordHash, nik || null, address || null]
      );

      const user = result.rows[0];
      const token = generateToken(user.id, 'user');

      return sendSuccess(
        res,
        formatUser(user, token),
        'Registrasi berhasil',
        201
      );
    } catch (error) {
      next(error);
    }
  }
);

// =============================================
// POST /auth/login
// Login dengan email & password
// =============================================
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Format email tidak valid'),
    body('password').notEmpty().withMessage('Password wajib diisi'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 'Data tidak valid', 422, errors.array());
      }

      const { email, password } = req.body;

      const result = await query(
        'SELECT * FROM users WHERE email = $1 AND is_active = true',
        [email.toLowerCase()]
      );

      const user = result.rows[0];
      if (!user || !user.password_hash) {
        return sendError(res, 'Email atau password salah', 401);
      }

      const isPasswordValid = await bcrypt.compare(password, user.password_hash);
      if (!isPasswordValid) {
        return sendError(res, 'Email atau password salah', 401);
      }

      const token = generateToken(user.id, 'user');
      return sendSuccess(res, formatUser(user, token), 'Login berhasil');
    } catch (error) {
      next(error);
    }
  }
);

// =============================================
// POST /auth/google
// Login / Daftar dengan Google (Firebase Token)
// =============================================
router.post('/google', async (req, res, next) => {
  try {
    const { firebaseToken } = req.body;
    if (!firebaseToken) {
      return sendError(res, 'Firebase token diperlukan', 400);
    }

    // Verifikasi token dari Firebase
    let decodedToken;
    try {
      decodedToken = await verifyFirebaseToken(firebaseToken);
    } catch {
      return sendError(res, 'Token Google tidak valid', 401);
    }

    const { uid, email, name, picture } = decodedToken;

    // Cari atau buat user berdasarkan firebase_uid
    let userResult = await query(
      'SELECT * FROM users WHERE firebase_uid = $1 OR email = $2',
      [uid, email?.toLowerCase()]
    );

    let user;
    if (userResult.rows.length > 0) {
      user = userResult.rows[0];
      // Update firebase_uid jika belum ada
      if (!user.firebase_uid) {
        await query(
          'UPDATE users SET firebase_uid = $1, photo_url = $2 WHERE id = $3',
          [uid, picture, user.id]
        );
        user.firebase_uid = uid;
        user.photo_url = picture;
      }
    } else {
      // Buat user baru
      const newUser = await query(
        `INSERT INTO users (name, email, firebase_uid, photo_url, auth_provider, is_verified)
         VALUES ($1, $2, $3, $4, 'google', true)
         RETURNING *`,
        [name || 'Pengguna Baru', email?.toLowerCase(), uid, picture]
      );
      user = newUser.rows[0];
    }

    const token = generateToken(user.id, 'user');
    return sendSuccess(res, formatUser(user, token), 'Login Google berhasil');
  } catch (error) {
    next(error);
  }
});

// =============================================
// POST /auth/phone/verify
// Verifikasi OTP dan login via nomor telepon (Firebase)
// =============================================
router.post('/phone/verify', async (req, res, next) => {
  try {
    const { firebaseToken, phone } = req.body;
    if (!firebaseToken) {
      return sendError(res, 'Firebase token diperlukan', 400);
    }

    // Verifikasi token dari Firebase Phone Auth
    let decodedToken;
    try {
      decodedToken = await verifyFirebaseToken(firebaseToken);
    } catch {
      return sendError(res, 'Kode OTP tidak valid atau sudah kadaluarsa', 401);
    }

    const uid = decodedToken.uid;
    const phoneNumber = decodedToken.phone_number || phone;

    // Cari atau buat user
    let userResult = await query(
      'SELECT * FROM users WHERE firebase_uid = $1 OR phone = $2',
      [uid, phoneNumber]
    );

    let user;
    if (userResult.rows.length > 0) {
      user = userResult.rows[0];
      if (!user.firebase_uid) {
        await query(
          'UPDATE users SET firebase_uid = $1 WHERE id = $2',
          [uid, user.id]
        );
      }
    } else {
      // Buat user baru dari nomor telepon
      const newUser = await query(
        `INSERT INTO users (name, phone, firebase_uid, auth_provider, is_verified)
         VALUES ($1, $2, $3, 'phone', true)
         RETURNING *`,
        ['Pengguna ' + phoneNumber?.slice(-4), phoneNumber, uid]
      );
      user = newUser.rows[0];
    }

    const token = generateToken(user.id, 'user');
    return sendSuccess(res, formatUser(user, token), 'Verifikasi OTP berhasil');
  } catch (error) {
    next(error);
  }
});

// =============================================
// GET /auth/me
// Ambil profil user yang sedang login
// =============================================
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const table = req.user.role === 'advocate' ? 'advocates' : 'users';
    const result = await query(`SELECT * FROM ${table} WHERE id = $1`, [req.user.id]);

    if (!result.rows[0]) {
      return sendError(res, 'User tidak ditemukan', 404);
    }

    const userData = result.rows[0];
    delete userData.password_hash;

    return sendSuccess(res, { user: userData, role: req.user.role });
  } catch (error) {
    next(error);
  }
});

// =============================================
// PUT /auth/profile
// Update profil user
// =============================================
router.put(
  '/profile',
  authenticate,
  [
    body('name').optional().trim().notEmpty().withMessage('Nama tidak boleh kosong'),
    body('phone').optional().isMobilePhone('id-ID').withMessage('Format nomor telepon tidak valid'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 'Data tidak valid', 422, errors.array());
      }

      const { name, phone, nik, address } = req.body;
      const table = req.user.role === 'advocate' ? 'advocates' : 'users';

      const result = await query(
        `UPDATE ${table}
         SET name = COALESCE($1, name),
             phone = COALESCE($2, phone),
             nik = COALESCE($3, nik),
             address = COALESCE($4, address)
         WHERE id = $5
         RETURNING *`,
        [name, phone, nik, address, req.user.id]
      );

      const updated = result.rows[0];
      delete updated.password_hash;

      return sendSuccess(res, { user: updated }, 'Profil berhasil diperbarui');
    } catch (error) {
      next(error);
    }
  }
);

// =============================================
// PUT /auth/change-password
// Ubah password
// =============================================
router.put(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Password lama wajib diisi'),
    body('newPassword')
      .isLength({ min: 8 }).withMessage('Password baru minimal 8 karakter')
      .matches(/[0-9]/).withMessage('Password harus mengandung angka')
      .matches(/[A-Z]/).withMessage('Password harus mengandung huruf kapital'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 'Data tidak valid', 422, errors.array());
      }

      const { currentPassword, newPassword } = req.body;
      const table = req.user.role === 'advocate' ? 'advocates' : 'users';

      const result = await query(
        `SELECT password_hash FROM ${table} WHERE id = $1`,
        [req.user.id]
      );

      const isValid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
      if (!isValid) {
        return sendError(res, 'Password lama tidak benar', 401);
      }

      const newHash = await bcrypt.hash(newPassword, 12);
      await query(
        `UPDATE ${table} SET password_hash = $1 WHERE id = $2`,
        [newHash, req.user.id]
      );

      return sendSuccess(res, {}, 'Password berhasil diubah');
    } catch (error) {
      next(error);
    }
  }
);

// =============================================
// POST /auth/advocate/login
// Login khusus untuk advokat
// =============================================
router.post(
  '/advocate/login',
  [
    body('email').isEmail().withMessage('Format email tidak valid'),
    body('password').notEmpty().withMessage('Password wajib diisi'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 'Data tidak valid', 422, errors.array());
      }

      const { email, password } = req.body;

      const result = await query(
        'SELECT * FROM advocates WHERE email = $1 AND is_active = true',
        [email.toLowerCase()]
      );

      const advocate = result.rows[0];
      if (!advocate || !advocate.password_hash) {
        return sendError(res, 'Email atau password salah', 401);
      }

      const isValid = await bcrypt.compare(password, advocate.password_hash);
      if (!isValid) {
        return sendError(res, 'Email atau password salah', 401);
      }

      const token = generateToken(advocate.id, 'advocate');

      return sendSuccess(res, {
        token,
        advocate: {
          id: advocate.id,
          name: advocate.name,
          email: advocate.email,
          phone: advocate.phone,
          photoUrl: advocate.photo_url,
          title: advocate.title,
          firmName: advocate.firm_name,
          isVerified: advocate.is_verified,
          isAvailable: advocate.is_available,
          role: 'advocate',
        },
      }, 'Login advokat berhasil');
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;

// =============================================
// POST /auth/users/fcm-token
// Simpan/update FCM token device
// =============================================
router.post('/users/fcm-token', authenticate, async (req, res, next) => {
  try {
    const { fcmToken, platform } = req.body;
    if (!fcmToken) return sendError(res, 'fcmToken diperlukan', 400);

    const table = req.user.role === 'advocate' ? 'advocates' : 'users';
    
    // Cek apakah kolom fcm_token ada, kalau tidak tambahkan
    await query(`
      ALTER TABLE ${table} 
      ADD COLUMN IF NOT EXISTS fcm_token VARCHAR(500),
      ADD COLUMN IF NOT EXISTS fcm_platform VARCHAR(20)
    `).catch(() => {});

    await query(
      `UPDATE ${table} SET fcm_token = $1, fcm_platform = $2 WHERE id = $3`,
      [fcmToken, platform || 'android', req.user.id]
    );

    return sendSuccess(res, {}, 'FCM token disimpan');
  } catch (error) {
    next(error);
  }
});
