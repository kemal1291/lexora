// src/routes/articles.js
const express  = require('express');
const router   = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

// ── GET semua artikel (publik, untuk user dashboard) ──────────────────────────
router.get('/', async (req, res) => {
  try {
    const { category, limit = 20, offset = 0 } = req.query;
    let sql = `
      SELECT a.*,
             u.name      AS advocate_name,
             u.photo_url AS advocate_photo,
             adv.title   AS advocate_title
      FROM articles a
      JOIN users u ON a.advocate_id = u.id
      LEFT JOIN advocates adv ON adv.id = u.id
      WHERE a.is_published = true
      ${category ? 'AND a.category = $3' : ''}
      ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const params = category ? [limit, offset, category] : [limit, offset];
    const result = await query(sql, params);
    res.json({ success: true, data: { articles: result.rows } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET artikel milik advokat yang login ──────────────────────────────────────
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
      LEFT JOIN advocates adv ON adv.id = u.id
      WHERE a.id = $1
    `, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Artikel tidak ditemukan' });
    res.json({ success: true, data: { article: result.rows[0] } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST buat artikel baru ────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const { title, content, category = 'Umum', coverUrl, isPublished = true } = req.body;
    if (!title || !content) {
      return res.status(400).json({ message: 'Title dan konten wajib diisi' });
    }
    const result = await query(`
      INSERT INTO articles (advocate_id, title, content, category, cover_url, is_published)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [req.user.id, title, content, category, coverUrl || null, isPublished]);
    res.status(201).json({ success: true, data: { article: result.rows[0] } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT update artikel ────────────────────────────────────────────────────────
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { title, content, category, coverUrl, isPublished } = req.body;
    const result = await query(`
      UPDATE articles
      SET title=$1, content=$2, category=$3, cover_url=$4, is_published=$5, updated_at=NOW()
      WHERE id=$6 AND advocate_id=$7
      RETURNING *
    `, [title, content, category, coverUrl || null, isPublished, req.params.id, req.user.id]);
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