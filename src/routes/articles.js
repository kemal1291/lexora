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

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf|doc|docx/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase())
      || file.mimetype === 'application/pdf'
      || file.mimetype.startsWith('image/')
      || file.mimetype.includes('word');
    cb(null, ok);
  },
});

// ── GET semua artikel (publik) ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { category, limit = 20, offset = 0 } = req.query;
    const params = category ? [limit, offset, category] : [limit, offset];
    const result = await query(`
      SELECT a.*,
             u.name      AS advocate_name,
             u.photo_url AS advocate_photo,
             adv.title   AS advocate_title
      FROM articles a
      JOIN users u ON a.advocate_id = u.id
      LEFT JOIN advocates adv ON adv.id = a.advocate_id
      WHERE a.is_published = true
      ${category ? 'AND a.category = $3' : ''}
      ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);
    res.json({ success: true, data: { articles: result.rows } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET artikel milik advokat login ───────────────────────────────────────────
router.get('/my/list', authenticate, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM articles WHERE advocate_id = $1 ORDER BY created_at DESC',
      [req.user.id]
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
      LEFT JOIN advocates adv ON adv.id = a.advocate_id
      WHERE a.id = $1
    `, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Artikel tidak ditemukan' });
    res.json({ success: true, data: { article: result.rows[0] } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST upload file ──────────────────────────────────────────────────────────
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'File wajib diunggah' });
    const baseUrl = process.env.BASE_URL || 'https://lexora-production.up.railway.app';
    const fileUrl = `${baseUrl}/uploads/articles/${req.file.filename}`;
    const isImage = req.file.mimetype.startsWith('image/');
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
    // req.user.id = id dari users table (bukan advocates)
    const result = await query(`
      INSERT INTO articles (advocate_id, title, content, category, cover_url, attachments, is_published)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [
      req.user.id,
      title,
      content,
      category,
      coverUrl || null,
      attachments ? JSON.stringify(attachments) : '[]',
      isPublished
    ]);
    res.status(201).json({ success: true, data: { article: result.rows[0] } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT update artikel ────────────────────────────────────────────────────────
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { title, content, category, coverUrl, attachments, isPublished } = req.body;
    const result = await query(`
      UPDATE articles
      SET title=$1, content=$2, category=$3, cover_url=$4,
          attachments=$5, is_published=$6, updated_at=NOW()
      WHERE id=$7 AND advocate_id=$8
      RETURNING *
    `, [
      title, content, category, coverUrl || null,
      attachments ? JSON.stringify(attachments) : '[]',
      isPublished, req.params.id, req.user.id
    ]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Artikel tidak ditemukan' });
    res.json({ success: true, data: { article: result.rows[0] } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE artikel ────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await query('DELETE FROM articles WHERE id=$1 AND advocate_id=$2',
      [req.params.id, req.user.id]);
    res.json({ success: true, message: 'Artikel dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
