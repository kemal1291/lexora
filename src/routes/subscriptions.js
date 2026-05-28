// src/routes/subscriptions.js
const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { sendSuccess, sendError } = require('../middleware/errorHandler');
const admin = require('firebase-admin'); // pastikan firebase-admin sudah di-init di app.js

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/subscriptions/chat
// User berlangganan chat dengan advokat → kirim notif ke advokat
// Body: { advocateId, advocateName, conversationId }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/chat', authenticate, async (req, res, next) => {
  try {
    const { advocateId, conversationId } = req.body;
    const userId = req.user.id;

    // Ambil data user & advokat
    const [userRes, advRes] = await Promise.all([
      query('SELECT name FROM users WHERE id = $1', [userId]),
      query('SELECT name, fcm_token FROM advocates WHERE id = $1', [advocateId]),
    ]);

    const userName    = userRes.rows[0]?.name    ?? 'Pengguna';
    const advocateName = advRes.rows[0]?.name    ?? 'Advokat';
    const fcmToken    = advRes.rows[0]?.fcm_token;

    // Simpan record langganan ke database
    await query(
      `INSERT INTO subscriptions (user_id, advocate_id, type, conversation_id, created_at)
       VALUES ($1, $2, 'chat', $3, NOW())
       ON CONFLICT (user_id, advocate_id, type) DO UPDATE
       SET conversation_id = EXCLUDED.conversation_id,
           created_at = NOW()`,
      [userId, advocateId, conversationId]
    );

    // Kirim FCM ke advokat jika punya token
    if (fcmToken) {
      try {
        await admin.messaging().send({
          token: fcmToken,
          notification: {
            title: '💬 Klien Baru Berlangganan Chat!',
            body: `${userName} telah berlangganan sesi konsultasi dengan Anda.`,
          },
          data: {
            type:           'new_chat_subscription',
            userId:         userId,
            userName:       userName,
            conversationId: conversationId ?? '',
            click_action:   'FLUTTER_NOTIFICATION_CLICK',
          },
          android: {
            notification: {
              channelId:   'lexora_channel',
              priority:    'high',
              sound:       'default',
            },
          },
          apns: {
            payload: {
              aps: { sound: 'default', badge: 1 },
            },
          },
        });
        console.log(`[Notif] Chat subscription sent to advocate ${advocateId}`);
      } catch (fcmErr) {
        // Jangan gagalkan request jika FCM error
        console.warn('[Notif] FCM error (chat):', fcmErr.message);
      }
    }

    return sendSuccess(res, { advocateId, type: 'chat' },
        'Langganan chat berhasil dicatat');
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/subscriptions/complaint
// User membuat pengaduan → kirim notif ke advokat
// Body: { advocateId }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/complaint', authenticate, async (req, res, next) => {
  try {
    const { advocateId } = req.body;
    const userId = req.user.id;

    const [userRes, advRes] = await Promise.all([
      query('SELECT name FROM users WHERE id = $1', [userId]),
      query('SELECT name, fcm_token FROM advocates WHERE id = $1', [advocateId]),
    ]);

    const userName = userRes.rows[0]?.name  ?? 'Pengguna';
    const fcmToken = advRes.rows[0]?.fcm_token;

    // Simpan record
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
        await admin.messaging().send({
          token: fcmToken,
          notification: {
            title: '📋 Pengaduan Baru Masuk!',
            body: `${userName} telah mengajukan pengaduan kepada Anda. Segera tinjau.`,
          },
          data: {
            type:         'new_complaint',
            userId:       userId,
            userName:     userName,
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
          },
          android: {
            notification: {
              channelId: 'lexora_channel',
              priority:  'high',
              sound:     'default',
            },
          },
          apns: {
            payload: {
              aps: { sound: 'default', badge: 1 },
            },
          },
        });
        console.log(`[Notif] Complaint notification sent to advocate ${advocateId}`);
      } catch (fcmErr) {
        console.warn('[Notif] FCM error (complaint):', fcmErr.message);
      }
    }

    return sendSuccess(res, { advocateId, type: 'complaint' },
        'Notifikasi pengaduan terkirim');
  } catch (error) {
    next(error);
  }
});

module.exports = router;