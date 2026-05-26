const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticate, advocateOnly } = require('../middleware/auth');
const { sendSuccess, sendError } = require('../middleware/errorHandler');

const router = express.Router();

// Multer config untuk upload dokumen
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/complaints');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `complaint_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Format file tidak didukung'));
  }
});

const VALID_CATEGORIES = [
  'pidana', 'perdata', 'keluarga', 'bisnis',
  'properti', 'tenaga_kerja', 'konsumen', 'lainnya',
];
const VALID_STATUSES = ['pending', 'review', 'in_progress', 'resolved', 'rejected'];

// =============================================
// GET /complaints
// Daftar pengaduan milik user yang login
// =============================================
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status, category, page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    let whereConditions = [];

    // Filter berdasarkan role
    if (req.user.role === 'user') {
      params.push(req.user.id);
      whereConditions.push(`c.user_id = $${params.length}`);
    } else if (req.user.role === 'advocate') {
      params.push(req.user.id);
      whereConditions.push(`c.advocate_id = $${params.length}`);
    }

    if (status && VALID_STATUSES.includes(status)) {
      params.push(status);
      whereConditions.push(`c.status = $${params.length}`);
    }

    if (category && VALID_CATEGORIES.includes(category)) {
      params.push(category);
      whereConditions.push(`c.category = $${params.length}`);
    }

    const whereClause = whereConditions.length > 0
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';

    // Count
    const countResult = await query(
      `SELECT COUNT(*) FROM complaints c ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Data
    params.push(parseInt(limit), offset);
    const result = await query(
      `SELECT
         c.*,
         u.name as user_name,
         u.photo_url as user_photo,
         a.name as advocate_name,
         a.photo_url as advocate_photo,
         a.title as advocate_title
       FROM complaints c
       JOIN users u ON c.user_id = u.id
       LEFT JOIN advocates a ON c.advocate_id = a.id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const complaints = result.rows.map(c => ({
      id: c.id,
      title: c.title,
      description: c.description,
      category: c.category,
      status: c.status,
      responseNote: c.response_note,
      attachments: c.attachments || [],
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      user: {
        id: c.user_id,
        name: c.user_name,
        photoUrl: c.user_photo,
      },
      advocate: c.advocate_id ? {
        id: c.advocate_id,
        name: c.advocate_name,
        photoUrl: c.advocate_photo,
        title: c.advocate_title,
      } : null,
    }));

    return sendSuccess(res, {
      complaints,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// =============================================
// POST /complaints
// Buat pengaduan baru
// =============================================
router.post(
  '/',
  authenticate,
  [
    body('title').trim().notEmpty().withMessage('Judul wajib diisi')
      .isLength({ max: 500 }).withMessage('Judul maksimal 500 karakter'),
    body('description').trim().isLength({ min: 50 }).withMessage('Deskripsi minimal 50 karakter'),
    body('category').isIn(VALID_CATEGORIES).withMessage('Kategori tidak valid'),
    body('advocateId').optional().isUUID().withMessage('ID advokat tidak valid'),
  ],
  async (req, res, next) => {
    try {
      if (req.user.role !== 'user') {
        return sendError(res, 'Hanya klien yang bisa membuat pengaduan', 403);
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 'Data tidak valid', 422, errors.array());
      }

      const { title, description, category, advocateId } = req.body;

      // Validasi advokat jika disertakan
      if (advocateId) {
        const advResult = await query(
          'SELECT id FROM advocates WHERE id = $1 AND is_active = true',
          [advocateId]
        );
        if (!advResult.rows[0]) {
          return sendError(res, 'Advokat tidak ditemukan', 404);
        }
      }

      const result = await query(
        `INSERT INTO complaints (user_id, advocate_id, title, description, category)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [req.user.id, advocateId || null, title, description, category]
      );

      const complaint = result.rows[0];

      // Jika ada advokat, buat atau ambil chat room
      let chatRoom = null;
      if (advocateId) {
        const roomResult = await query(
          `INSERT INTO chat_rooms (user_id, advocate_id, complaint_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, advocate_id) DO UPDATE SET complaint_id = $3
           RETURNING *`,
          [req.user.id, advocateId, complaint.id]
        );
        chatRoom = roomResult.rows[0];
      }

      return sendSuccess(res, {
        complaint: {
          id: complaint.id,
          title: complaint.title,
          description: complaint.description,
          category: complaint.category,
          status: complaint.status,
          createdAt: complaint.created_at,
        },
        chatRoomId: chatRoom?.id || null,
      }, 'Pengaduan berhasil dibuat', 201);
    } catch (error) {
      next(error);
    }
  }
);

// =============================================
// GET /complaints/:id
// Detail pengaduan
// =============================================
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         c.*,
         u.name as user_name, u.email as user_email, u.photo_url as user_photo,
         a.name as advocate_name, a.photo_url as advocate_photo,
         a.title as advocate_title, a.phone as advocate_phone
       FROM complaints c
       JOIN users u ON c.user_id = u.id
       LEFT JOIN advocates a ON c.advocate_id = a.id
       WHERE c.id = $1`,
      [req.params.id]
    );

    if (!result.rows[0]) {
      return sendError(res, 'Pengaduan tidak ditemukan', 404);
    }

    const c = result.rows[0];

    // Pastikan user hanya bisa lihat pengaduannya sendiri
    if (req.user.role === 'user' && c.user_id !== req.user.id) {
      return sendError(res, 'Akses ditolak', 403);
    }
    if (req.user.role === 'advocate' && c.advocate_id !== req.user.id) {
      return sendError(res, 'Akses ditolak', 403);
    }

    return sendSuccess(res, {
      complaint: {
        id: c.id,
        title: c.title,
        description: c.description,
        category: c.category,
        status: c.status,
        responseNote: c.response_note,
        attachments: c.attachments || [],
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        user: { id: c.user_id, name: c.user_name, email: c.user_email, photoUrl: c.user_photo },
        advocate: c.advocate_id ? {
          id: c.advocate_id,
          name: c.advocate_name,
          photoUrl: c.advocate_photo,
          title: c.advocate_title,
          phone: c.advocate_phone,
        } : null,
      },
    });
  } catch (error) {
    next(error);
  }
});

// =============================================
// PATCH /complaints/:id/status
// Update status pengaduan (hanya advokat)
// =============================================
router.patch('/:id/status', authenticate, advocateOnly, async (req, res, next) => {
  try {
    const { status, responseNote } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return sendError(res, 'Status tidak valid', 400);
    }

    const result = await query(
      `UPDATE complaints
       SET status = $1, response_note = COALESCE($2, response_note)
       WHERE id = $3 AND advocate_id = $4
       RETURNING *`,
      [status, responseNote, req.params.id, req.user.id]
    );

    if (!result.rows[0]) {
      return sendError(res, 'Pengaduan tidak ditemukan atau bukan tanggung jawab Anda', 404);
    }

    return sendSuccess(res, { complaint: result.rows[0] }, 'Status pengaduan diperbarui');
  } catch (error) {
    next(error);
  }
});

// =============================================
// PATCH /complaints/:id/assign
// Assign advokat ke pengaduan
// =============================================
router.patch('/:id/assign', authenticate, async (req, res, next) => {
  try {
    const { advocateId } = req.body;
    if (!advocateId) return sendError(res, 'advocateId diperlukan', 400);

    // Pastikan hanya pemilik pengaduan yang bisa assign
    const complaintResult = await query(
      'SELECT * FROM complaints WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!complaintResult.rows[0]) {
      return sendError(res, 'Pengaduan tidak ditemukan', 404);
    }

    // Validasi advokat
    const advResult = await query(
      'SELECT id FROM advocates WHERE id = $1 AND is_active = true',
      [advocateId]
    );
    if (!advResult.rows[0]) {
      return sendError(res, 'Advokat tidak ditemukan', 404);
    }

    // Update complaint
    await query(
      `UPDATE complaints SET advocate_id = $1, status = 'review' WHERE id = $2`,
      [advocateId, req.params.id]
    );

    // Buat chat room
    const roomResult = await query(
      `INSERT INTO chat_rooms (user_id, advocate_id, complaint_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, advocate_id) DO UPDATE SET complaint_id = $3
       RETURNING *`,
      [req.user.id, advocateId, req.params.id]
    );

    return sendSuccess(res, {
      chatRoomId: roomResult.rows[0].id,
    }, 'Advokat berhasil dipilih');
  } catch (error) {
    next(error);
  }
});


// =============================================
// POST /complaints/upload
// Upload dokumen/foto untuk pengaduan
// =============================================
router.post('/upload', authenticate, upload.array('files', 5), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return sendError(res, 'Tidak ada file yang diupload', 400);
    }

    const baseUrl = process.env.BASE_URL || 'https://lexora-production.up.railway.app';
    const urls = req.files.map(file => ({
      url: `${baseUrl}/uploads/complaints/${file.filename}`,
      name: file.originalname,
      size: file.size,
      type: file.mimetype,
    }));

    return sendSuccess(res, { files: urls }, 'File berhasil diupload');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
