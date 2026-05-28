// src/routes/subscriptions.js
const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { sendSuccess, sendError } = require('../middleware/errorHandler');
const { sendPushNotification } = require('../config/firebase'); // pakai firebase.js yang ada

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/subscriptions/chat
// User berlangganan chat → notif ke advokat
// ─────────────────────────────────────────────────────────────────────────────
router.post('/chat', authenticate, async (req, res, next) => {
  try {
    const { advocateId, conversationId } = req.body;
    const userId = req.user.id;

    // Ambil nama user & FCM token advokat dari PostgreSQL
    const [userRes, advRes] = await Promise.all([
      query('SELECT name FROM users WHERE id = $1', [userId]),
      query('SELECT name, fcm_token FROM advocates WHERE id = $1', [advocateId]),
    ]);

    const userName  = userRes.rows[0]?.name      ?? 'Pengguna';
    const fcmToken  = advRes.rows[0]?.fcm_token;

    // Simpan ke tabel subscriptions (PostgreSQL)
    await query(
      `INSERT INTO subscriptions
         (user_id, advocate_id, type, conversation_id, created_at)
       VALUES ($1, $2, 'chat', $3, NOW())
       ON CONFLICT (user_id, advocate_id, type) DO UPDATE
         SET conversation_id = EXCLUDED.conversation_id,
             created_at = NOW()`,
      [userId, advocateId, conversationId ?? null]
    );

    // Kirim FCM push notification ke advokat
    await sendPushNotification({
      fcmToken,
      title: '💬 Klien Baru Berlangganan Chat!',
      body:  `${userName} telah berlangganan konsultasi dengan Anda.`,
      data:  {
        type:           'new_chat_subscription',
        userId,
        userName,
        conversationId: conversationId ?? '',
      },
    });

    return sendSuccess(res, { type: 'chat' }, 'Langganan chat dicatat');
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/subscriptions/complaint
// User buat pengaduan → notif ke advokat
// ─────────────────────────────────────────────────────────────────────────────
router.post('/complaint', authenticate, async (req, res, next) => {
  try {
    const { advocateId } = req.body;
    const userId = req.user.id;

    const [userRes, advRes] = await Promise.all([
      query('SELECT name FROM users WHERE id = $1', [userId]),
      query('SELECT name, fcm_token FROM advocates WHERE id = $1', [advocateId]),
    ]);

    const userName = userRes.rows[0]?.name    ?? 'Pengguna';
    const fcmToken = advRes.rows[0]?.fcm_token;

    // Simpan ke PostgreSQL
    await query(
      `INSERT INTO subscriptions
         (user_id, advocate_id, type, created_at)
       VALUES ($1, $2, 'complaint', NOW())
       ON CONFLICT (user_id, advocate_id, type) DO UPDATE
         SET created_at = NOW()`,
      [userId, advocateId]
    );

    // Kirim FCM
    await sendPushNotification({
      fcmToken,
      title: '📋 Pengaduan Baru Masuk!',
      body:  `${userName} telah mengajukan pengaduan. Segera tinjau.`,
      data:  {
        type:     'new_complaint',
        userId,
        userName,
      },
    });

    return sendSuccess(res, { type: 'complaint' }, 'Notifikasi pengaduan terkirim');
  } catch (error) {
    next(error);
  }
});

module.exports = router;