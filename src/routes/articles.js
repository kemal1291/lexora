// src/routes/articles.js
const express  = require('express');
const router   = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

// ── Upload config ─────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/articles');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const name = `article_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp|pdf|doc|docx/;
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype) ||
    file.mimetype === 'application/pdf' ||
    file.mimetype === 'application/msword' ||
    file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext || mime) cb(null, true);
  else cb(new Error('Format file tidak didukung'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Helper: dapatkan user_id dari advocate login
// req.user.id bisa berupa advocate.id atau user.id tergantung auth middleware
async function getAdvocateUserId(req) {
  // Coba langsung pakai sebagai user_id
  const check = await query(
    'SELECT id FROM users WHERE id = $1', [req.user.id]);
  if (check.rows[0]) return req.user.id;

  // Kalau tidak ada, cari di tabel advocates
  const adv = await query(
    'SELECT user_id FROM advocates WHERE id = $1', [req.user.id]);
  if (adv.rows[0]) return adv.rows[0].user_id;

  return req.user.id;
}

// ── GET semua artikel (publik) ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { category, limit = 20, offset = 0 } = req.query;
    const params = category ? [limit, offset, category] : [limit, offset];
    const sql = `
      SELECT a.*,
             u.name      AS advocate_name,
             u.photo_url AS advocate_photo,
             adv.title   AS advocate_title
      FROM articles a
      JOIN users u ON a.advocate_id = u.id
      LEFT JOIN advocates adv ON adv.user_id = u.id
      WHERE a.is_published = true
      ${category ? 'AND a.category = $3' : ''}
      ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const result = await query(sql, params);
    res.json({ success: true, data: { articles: result.rows } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET artikel milik advokat login ───────────────────────────────────────────
router.get('/my/list', authenticate, async (req, res) => {
  try {
    const userId = await getAdvocateUserId(req);
    const result = await query(
      'SELECT * FROM articles WHERE advocate_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    res.json({ success: true, data: { articles: result.rows } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET artikel by ID ─────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    await query('UPDATE articles SET views = views + 1 WHERE id = $1', [req.params.id]);
    const result = await query(`
      SELECT a.*, u.name AS advocate_name, u.photo_url AS advocate_photo,
             adv.title AS advocate_title
      FROM articles a
      JOIN users u ON a.advocate_id = u.id
      LEFT JOIN advocates adv ON adv.user_id = u.id
      WHERE a.id = $1
    `, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Artikel tidak ditemukan' });
    res.json({ success: true, data: { article: result.rows[0] } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST upload gambar/dokumen ─────────────────────────────────────────────────
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'File wajib diunggah' });
    const baseUrl = process.env.BASE_URL || 'https://lexora-production.up.railway.app';
    const fileUrl = `${baseUrl}/uploads/articles/${req.file.filename}`;
    const isImage = /jpeg|jpg|png|gif|webp/.test(req.file.mimetype);
    res.json({
      success: true,
      data: {
        url:      fileUrl,
        filename: req.file.filename,
        size:     req.file.size,
        type:     isImage ? 'image' : 'document',
        mimetype: req.file.mimetype,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST buat artikel baru ────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const { title, content, category = 'Umum', coverUrl, attachments, isPublished = true } = req.body;
    if (!title || !content) {
      return res.status(400).json({ message: 'Title dan konten wajib diisi' });
    }
    const userId = await getAdvocateUserId(req);
    const result = await query(`
      INSERT INTO articles (advocate_id, title, content, category, cover_url, attachments, is_published)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [userId, title, content, category, coverUrl || null,
        attachments ? JSON.stringify(attachments) : null, isPublished]);
    res.status(201).json({ success: true, data: { article: result.rows[0] } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT update artikel ────────────────────────────────────────────────────────
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { title, content, category, coverUrl, attachments, isPublished } = req.body;
    const userId = await getAdvocateUserId(req);
    const result = await query(`
      UPDATE articles
      SET title=$1, content=$2, category=$3, cover_url=$4,
          attachments=$5, is_published=$6, updated_at=NOW()
      WHERE id=$7 AND advocate_id=$8
      RETURNING *
    `, [title, content, category, coverUrl || null,
        attachments ? JSON.stringify(attachments) : null,
        isPublished, req.params.id, userId]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Artikel tidak ditemukan' });
    res.json({ success: true, data: { article: result.rows[0] } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE artikel ────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const userId = await getAdvocateUserId(req);
    await query('DELETE FROM articles WHERE id=$1 AND advocate_id=$2',
      [req.params.id, userId]);
    res.json({ success: true, message: 'Artikel dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;