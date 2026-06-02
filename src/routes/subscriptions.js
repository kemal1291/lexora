// src/routes/subscriptions.js — versi dengan debug logging lengkap
const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { sendSuccess, sendError } = require('../middleware/errorHandler');

// ── Import firebase dengan aman (tidak crash jika gagal) ──────
let sendToDevice = null;
try {
  const firebase = require('../config/firebase');
  sendToDevice = firebase.sendToDevice;
} catch (e) {
  console.warn('[subscriptions] firebase import gagal:', e.message);
}

const router = express.Router();

const _fmt = (v) => {
  if (!v) return 'Gratis';
  if (v >= 1000000) return `Rp ${(v/1000000).toFixed(0)}jt`;
  if (v >= 1000)    return `Rp ${(v/1000).toFixed(0)}rb`;
  return `Rp ${v}`;
};

// =============================================
// GET /api/subscriptions
// =============================================
router.get('/', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.id;
    console.log(`[Sub] GET / → userId=${userId}`);

    const result = await query(`
      SELECT
        s.id,
        s.advocate_id,
        s.type,
        s.conversation_id,
        s.created_at,
        a.name        AS advocate_name,
        a.title       AS advocate_role,
        a.photo_url   AS advocate_photo
      FROM subscriptions s
      JOIN advocates a ON a.id = s.advocate_id
      WHERE s.user_id = $1
      ORDER BY s.created_at DESC
    `, [userId]);

    console.log(`[Sub] GET / → ${result.rows.length} rows`);
    return sendSuccess(res, { subscriptions: result.rows });
  } catch (error) {
    console.error('[Sub] GET / ERROR:', error.message);
    next(error);
  }
});

// =============================================
// POST /api/subscriptions/chat
// =============================================
router.post('/chat', authenticate, async (req, res, next) => {
  try {
    const { advocateId, conversationId } = req.body;
    const userId = req.user.id;

    console.log(`[Sub] POST /chat → userId=${userId} advocateId=${advocateId} convId=${conversationId}`);

    // Validasi input
    if (!advocateId) {
      return sendError(res, 'advocateId diperlukan', 400);
    }

    // Cek advocate ada
    const advCheck = await query(
      'SELECT id FROM advocates WHERE id = $1', [advocateId]);
    if (!advCheck.rows[0]) {
      console.log(`[Sub] POST /chat → advocate ${advocateId} tidak ditemukan`);
      return sendError(res, 'Advokat tidak ditemukan', 404);
    }

    // Insert / upsert
    const insertResult = await query(
      `INSERT INTO subscriptions
         (user_id, advocate_id, type, conversation_id, created_at)
       VALUES ($1, $2, 'chat', $3, NOW())
       ON CONFLICT (user_id, advocate_id, type) DO UPDATE
         SET conversation_id = EXCLUDED.conversation_id,
             created_at = NOW()
       RETURNING id`,
      [userId, advocateId, conversationId ?? null]
    );

    console.log(`[Sub] POST /chat → INSERT OK id=${insertResult.rows[0]?.id}`);

    // FCM (opsional, tidak crash jika gagal)
    if (sendToDevice) {
      try {
        const [userRes, advRes] = await Promise.all([
          query('SELECT name FROM users WHERE id = $1', [userId]),
          query('SELECT name, fcm_token, consultation_fee FROM advocates WHERE id = $1', [advocateId]),
        ]);
        const userName = userRes.rows[0]?.name ?? 'Pengguna';
        const fcmToken = advRes.rows[0]?.fcm_token;
        const feeLabel = _fmt(advRes.rows[0]?.consultation_fee);

        if (fcmToken) {
          await sendToDevice(fcmToken,
            {
              title: '✅ Klien Berlangganan Chat!',
              body:  `${userName} telah berlangganan konsultasi chat (${feeLabel}).`,
            },
            { type: 'new_chat_subscription', userId,
              conversationId: conversationId ?? '' }
          );
        }
      } catch (fcmErr) {
        console.warn('[Sub] FCM chat error (non-fatal):', fcmErr.message);
      }
    }

    return sendSuccess(res, { type: 'chat' }, 'Langganan chat dicatat');
  } catch (error) {
    console.error('[Sub] POST /chat ERROR:', error.message, error.stack);
    next(error);
  }
});

// =============================================
// POST /api/subscriptions/complaint
// =============================================
router.post('/complaint', authenticate, async (req, res, next) => {
  try {
    const { advocateId } = req.body;
    const userId = req.user.id;

    console.log(`[Sub] POST /complaint → userId=${userId} advocateId=${advocateId}`);

    if (!advocateId) {
      return sendError(res, 'advocateId diperlukan', 400);
    }

    const advCheck = await query(
      'SELECT id FROM advocates WHERE id = $1', [advocateId]);
    if (!advCheck.rows[0]) {
      console.log(`[Sub] POST /complaint → advocate ${advocateId} tidak ditemukan`);
      return sendError(res, 'Advokat tidak ditemukan', 404);
    }

    const insertResult = await query(
      `INSERT INTO subscriptions (user_id, advocate_id, type, created_at)
       VALUES ($1, $2, 'complaint', NOW())
       ON CONFLICT (user_id, advocate_id, type) DO UPDATE
         SET created_at = NOW()
       RETURNING id`,
      [userId, advocateId]
    );

    console.log(`[Sub] POST /complaint → INSERT OK id=${insertResult.rows[0]?.id}`);

    // FCM (opsional)
    if (sendToDevice) {
      try {
        const [userRes, advRes] = await Promise.all([
          query('SELECT name FROM users WHERE id = $1', [userId]),
          query('SELECT name, fcm_token, complaint_fee FROM advocates WHERE id = $1', [advocateId]),
        ]);
        const userName = userRes.rows[0]?.name ?? 'Pengguna';
        const fcmToken = advRes.rows[0]?.fcm_token;
        const feeLabel = _fmt(advRes.rows[0]?.complaint_fee);

        if (fcmToken) {
          await sendToDevice(fcmToken,
            {
              title: '📋 Pengaduan Baru Masuk!',
              body:  `${userName} mengajukan pengaduan (${feeLabel}).`,
            },
            { type: 'new_complaint', userId, userName }
          );
        }
      } catch (fcmErr) {
        console.warn('[Sub] FCM complaint error (non-fatal):', fcmErr.message);
      }
    }

    return sendSuccess(res, { type: 'complaint' }, 'Notifikasi pengaduan terkirim');
  } catch (error) {
    console.error('[Sub] POST /complaint ERROR:', error.message, error.stack);
    next(error);
  }
});

module.exports = router;