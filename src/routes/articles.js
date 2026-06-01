// src/routes/articles.js
// Tambahkan ke app.js: app.use('/api/articles', require('./routes/articles'));
// Jalankan SQL dulu di Railway:
// CREATE TABLE IF NOT EXISTS articles (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   advocate_id UUID REFERENCES users(id) ON DELETE CASCADE,
//   title VARCHAR(200) NOT NULL,
//   content TEXT NOT NULL,
//   category VARCHAR(50) DEFAULT 'Umum',
//   cover_url TEXT,
//   is_published BOOLEAN DEFAULT true,
//   views INT DEFAULT 0,
//   created_at TIMESTAMP DEFAULT NOW(),
//   updated_at TIMESTAMP DEFAULT NOW()
// );

const express  = require('express');
const router   = express.Router();
const { Pool } = require('pg');
const pool     = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Middleware auth (sesuaikan dengan yang sudah ada)
const authMiddleware = require('../middleware/auth');

// ── GET semua artikel (untuk user dashboard) ──────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { category, limit = 20, offset = 0 } = req.query;
    let query = `
      SELECT a.*, 
             u.name as advocate_name,
             u.photo_url as advocate_photo,
             adv.title as advocate_title
      FROM articles a
      JOIN users u ON a.advocate_id = u.id
      LEFT JOIN advocates adv ON adv.user_id = u.id
      WHERE a.is_published = true
      ${category ? "AND a.category = $3" : ""}
      ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const params = category
      ? [limit, offset, category]
      : [limit, offset];
    const result = await pool.query(query, params);
    res.json({ success: true, data: { articles: result.rows } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET artikel by ID ─────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    // Increment views
    await pool.query('UPDATE articles SET views = views + 1 WHERE id = $1', [req.params.id]);
    const result = await pool.query(`
      SELECT a.*, u.name as advocate_name, u.photo_url as advocate_photo,
             adv.title as advocate_title, adv.specializations
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

// ── POST buat artikel baru (advokat) ─────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, content, category = 'Umum', coverUrl, isPublished = true } = req.body;
    if (!title || !content) return res.status(400).json({ message: 'Title dan konten wajib diisi' });
    const result = await pool.query(`
      INSERT INTO articles (advocate_id, title, content, category, cover_url, is_published)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [req.user.id, title, content, category, coverUrl, isPublished]);
    res.status(201).json({ success: true, data: { article: result.rows[0] } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT update artikel ────────────────────────────────────────────────────────
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { title, content, category, coverUrl, isPublished } = req.body;
    const result = await pool.query(`
      UPDATE articles SET title=$1, content=$2, category=$3,
        cover_url=$4, is_published=$5, updated_at=NOW()
      WHERE id=$6 AND advocate_id=$7 RETURNING *
    `, [title, content, category, coverUrl, isPublished, req.params.id, req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Artikel tidak ditemukan' });
    res.json({ success: true, data: { article: result.rows[0] } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE artikel ────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM articles WHERE id=$1 AND advocate_id=$2',
        [req.params.id, req.user.id]);
    res.json({ success: true, message: 'Artikel dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET artikel milik advokat yang login ──────────────────────────────────────
router.get('/my/list', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM articles WHERE advocate_id = $1
      ORDER BY created_at DESC
    `, [req.user.id]);
    res.json({ success: true, data: { articles: result.rows } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;