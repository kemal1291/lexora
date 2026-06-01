// src/routes/subscriptions.js
const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { sendSuccess, sendError } = require('../middleware/errorHandler');
const { sendToDevice } = require('../config/firebase');

const router = express.Router();

const _fmt = (v) => {
  if (!v) return 'Gratis';
  if (v >= 1000000) return `Rp ${(v/1000000).toFixed(0)}jt`;
  if (v >= 1000)    return `Rp ${(v/1000).toFixed(0)}rb`;
  return `Rp ${v}`;
};

// =============================================
// POST /api/subscriptions/chat
// User berlangganan chat → notif ke advokat
// =============================================
router.post('/chat', authenticate, async (req, res, next) => {
  try {
    const { advocateId, conversationId } = req.body;
    const userId = req.user.id;

    const [userRes, advRes] = await Promise.all([
      query('SELECT name FROM users WHERE id = $1', [userId]),
      query('SELECT name, fcm_token, consultation_fee FROM advocates WHERE id = $1',
        [advocateId]),
    ]);

    const userName   = userRes.rows[0]?.name          ?? 'Pengguna';
    const fcmToken   = advRes.rows[0]?.fcm_token;
    const fee        = advRes.rows[0]?.consultation_fee;
    const feeLabel   = _fmt(fee);

    // Simpan ke database
    await query(
      `INSERT INTO subscriptions
         (user_id, advocate_id, type, conversation_id, created_at)
       VALUES ($1, $2, 'chat', $3, NOW())
       ON CONFLICT (user_id, advocate_id, type) DO UPDATE
         SET conversation_id = EXCLUDED.conversation_id,
             created_at = NOW()`,
      [userId, advocateId, conversationId ?? null]
    );

    // Kirim FCM ke advokat
    if (fcmToken) {
      try {
        await sendToDevice(fcmToken,
          {
            title: '✅ Klien Berlangganan Chat!',
            body:  `${userName} telah berlangganan konsultasi chat (${feeLabel}). Anda dapat mulai membalas pesan.`,
          },
          {
            type:           'new_chat_subscription',
            userId,
            userName,
            conversationId: conversationId ?? '',
          }
        );
        console.log(`[FCM] Notif langganan chat → advokat ${advocateId}`);
      } catch (fcmErr) {
        console.warn('[FCM] Error chat sub:', fcmErr.message);
      }
    }

    return sendSuccess(res, { type: 'chat' }, 'Langganan chat dicatat');
  } catch (error) { next(error); }
});

// =============================================
// POST /api/subscriptions/complaint
// User buat pengaduan → notif ke advokat
// =============================================
router.post('/complaint', authenticate, async (req, res, next) => {
  try {
    const { advocateId } = req.body;
    const userId = req.user.id;

    const [userRes, advRes] = await Promise.all([
      query('SELECT name FROM users WHERE id = $1', [userId]),
      query('SELECT name, fcm_token, complaint_fee FROM advocates WHERE id = $1',
        [advocateId]),
    ]);

    const userName = userRes.rows[0]?.name        ?? 'Pengguna';
    const fcmToken = advRes.rows[0]?.fcm_token;
    const fee      = advRes.rows[0]?.complaint_fee;
    const feeLabel = _fmt(fee);

    // Simpan ke database
    await query(
      `INSERT INTO subscriptions (user_id, advocate_id, type, created_at)
       VALUES ($1, $2, 'complaint', NOW())
       ON CONFLICT (user_id, advocate_id, type) DO UPDATE
         SET created_at = NOW()`,
      [userId, advocateId]
    );

    // Kirim FCM ke advokat
    if (fcmToken) {
      try {
        await sendToDevice(fcmToken,
          {
            title: '📋 Pengaduan Baru Masuk!',
            body:  `${userName} mengajukan pengaduan (${feeLabel}). Segera tinjau di tab Pengaduan.`,
          },
          {
            type:     'new_complaint',
            userId,
            userName,
          }
        );
        console.log(`[FCM] Notif pengaduan → advokat ${advocateId}`);
      } catch (fcmErr) {
        console.warn('[FCM] Error complaint notif:', fcmErr.message);
      }
    }

    return sendSuccess(res, { type: 'complaint' }, 'Notifikasi pengaduan terkirim');
  } catch (error) { next(error); }
});

module.exports = router;