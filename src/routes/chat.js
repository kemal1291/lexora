const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { sendSuccess, sendError } = require('../middleware/errorHandler');

const router = express.Router();

// =============================================
// GET /chat/rooms
// =============================================
router.get('/rooms', authenticate, async (req, res, next) => {
  try {
    let result;
    if (req.user.role === 'user') {
      result = await query(
        `SELECT cr.*,
           a.name as other_name, a.photo_url as other_photo,
           a.title as other_title, a.is_available as other_online,
           m.content as last_message, m.message_type as last_message_type,
           m.created_at as last_message_at, m.sender_type as last_sender_type,
           (SELECT COUNT(*) FROM messages
            WHERE room_id = cr.id AND is_read = false AND sender_type = 'advocate') as unread_count
         FROM chat_rooms cr
         JOIN advocates a ON cr.advocate_id = a.id
         LEFT JOIN LATERAL (
           SELECT content, message_type, created_at, sender_type
           FROM messages WHERE room_id = cr.id
           ORDER BY created_at DESC LIMIT 1
         ) m ON true
         WHERE cr.user_id = $1 AND cr.is_active IS NOT FALSE
         ORDER BY COALESCE(m.created_at, cr.created_at) DESC`,
        [req.user.id]
      );
    } else {
      result = await query(
        `SELECT cr.*,
           u.name as other_name, u.photo_url as other_photo,
           NULL as other_title, false as other_online,
           m.content as last_message, m.message_type as last_message_type,
           m.created_at as last_message_at, m.sender_type as last_sender_type,
           (SELECT COUNT(*) FROM messages
            WHERE room_id = cr.id AND is_read = false AND sender_type = 'user') as unread_count
         FROM chat_rooms cr
         JOIN users u ON cr.user_id = u.id
         LEFT JOIN LATERAL (
           SELECT content, message_type, created_at, sender_type
           FROM messages WHERE room_id = cr.id
           ORDER BY created_at DESC LIMIT 1
         ) m ON true
         WHERE cr.advocate_id = $1 AND cr.is_active IS NOT FALSE
         ORDER BY COALESCE(m.created_at, cr.created_at) DESC`,
        [req.user.id]
      );
    }

    const rooms = result.rows.map(r => ({
      id: r.id,
      complaintId: r.complaint_id,
      other: {
        id: req.user.role === 'user' ? r.advocate_id : r.user_id,
        name: r.other_name,
        photoUrl: r.other_photo,
        title: r.other_title,
        isOnline: r.other_online,
      },
      lastMessage: r.last_message ? {
        content: r.last_message,
        type: r.last_message_type,
        sentAt: r.last_message_at,
        isFromMe: r.last_sender_type === req.user.role,
      } : null,
      unreadCount: parseInt(r.unread_count) || 0,
      createdAt: r.created_at,
    }));

    return sendSuccess(res, { rooms });
  } catch (error) { next(error); }
});

// =============================================
// POST /chat/rooms
// =============================================
router.post('/rooms', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'user')
      return sendError(res, 'Hanya klien yang bisa membuat chat room', 403);

    const { advocateId, complaintId } = req.body;
    if (!advocateId) return sendError(res, 'advocateId diperlukan', 400);

    const advResult = await query(
      'SELECT id, name, photo_url, title, is_available FROM advocates WHERE id = $1',
      [advocateId]
    );
    if (!advResult.rows[0]) return sendError(res, 'Advokat tidak ditemukan', 404);

    const roomResult = await query(
      `INSERT INTO chat_rooms (user_id, advocate_id, complaint_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, advocate_id) DO UPDATE SET is_active = true
       RETURNING *`,
      [req.user.id, advocateId, complaintId || null]
    );

    const room = roomResult.rows[0];
    const adv  = advResult.rows[0];

    return sendSuccess(res, {
      room: {
        id: room.id,
        complaintId: room.complaint_id,
        advocate: {
          id: adv.id, name: adv.name, photoUrl: adv.photo_url,
          title: adv.title, isOnline: adv.is_available,
        },
        createdAt: room.created_at,
      },
    }, 'Chat room berhasil dibuat', 201);
  } catch (error) { next(error); }
});

// =============================================
// GET /chat/rooms/:roomId/messages
// =============================================
router.get('/rooms/:roomId/messages', authenticate, async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const roomResult = await query(
      'SELECT * FROM chat_rooms WHERE id = $1', [req.params.roomId]);
    const room = roomResult.rows[0];
    if (!room) return sendError(res, 'Chat room tidak ditemukan', 404);

    const hasAccess =
      (req.user.role === 'user'     && room.user_id     === req.user.id) ||
      (req.user.role === 'advocate' && room.advocate_id === req.user.id);
    if (!hasAccess) return sendError(res, 'Akses ditolak', 403);

    const messagesResult = await query(
      `SELECT * FROM messages WHERE room_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.params.roomId, parseInt(limit), offset]
    );

    const senderType = req.user.role === 'user' ? 'advocate' : 'user';
    await query(
      `UPDATE messages SET is_read = true, read_at = NOW()
       WHERE room_id = $1 AND sender_type = $2 AND is_read = false`,
      [req.params.roomId, senderType]
    );

    const messages = messagesResult.rows.reverse().map(m => ({
      id: m.id, roomId: m.room_id, senderId: m.sender_id,
      senderType: m.sender_type, content: m.content,
      fileUrl: m.file_url, fileName: m.file_name,
      messageType: m.message_type, isRead: m.is_read,
      readAt: m.read_at, createdAt: m.created_at,
    }));

    const countResult = await query(
      'SELECT COUNT(*) FROM messages WHERE room_id = $1', [req.params.roomId]);

    return sendSuccess(res, {
      messages,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page), limit: parseInt(limit),
      },
    });
  } catch (error) { next(error); }
});

// =============================================
// GET /chat/unread-count
// =============================================
router.get('/unread-count', authenticate, async (req, res, next) => {
  try {
    const senderType = req.user.role === 'user' ? 'advocate' : 'user';
    const roomColumn = req.user.role === 'user' ? 'user_id' : 'advocate_id';

    const result = await query(
      `SELECT COUNT(*) as total FROM messages m
       JOIN chat_rooms cr ON m.room_id = cr.id
       WHERE cr.${roomColumn} = $1 AND m.sender_type = $2 AND m.is_read = false`,
      [req.user.id, senderType]
    );

    return sendSuccess(res, { unreadCount: parseInt(result.rows[0].total) });
  } catch (error) { next(error); }
});

// =============================================
// POST /chat/rooms/:roomId/messages (REST fallback)
// =============================================
router.post('/rooms/:roomId/messages', authenticate, async (req, res, next) => {
  try {
    const { roomId } = req.params;
    const { content, messageType = 'text' } = req.body;
    if (!content?.trim()) return sendError(res, 'Pesan tidak boleh kosong', 400);

    const roomResult = await query(
      'SELECT * FROM chat_rooms WHERE id = $1 AND is_active IS NOT FALSE', [roomId]);
    const room = roomResult.rows[0];
    if (!room) return sendError(res, 'Room tidak ditemukan', 404);

    const hasAccess =
      (req.user.role === 'user'     && room.user_id     === req.user.id) ||
      (req.user.role === 'advocate' && room.advocate_id === req.user.id);
    if (!hasAccess) return sendError(res, 'Akses ditolak', 403);

    const result = await query(
      `INSERT INTO messages (room_id, sender_id, sender_type, content, message_type)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [roomId, req.user.id, req.user.role, content.trim(), messageType]
    );
    await query('UPDATE chat_rooms SET updated_at = NOW() WHERE id = $1', [roomId]);

    const senderTable = req.user.role === 'advocate' ? 'advocates' : 'users';
    const senderInfo  = await query(
      `SELECT name, photo_url FROM ${senderTable} WHERE id = $1`, [req.user.id]);

    const msg = result.rows[0];
    const msgData = {
      id: msg.id, roomId: msg.room_id, senderId: msg.sender_id,
      senderType: msg.sender_type,
      senderName:  senderInfo.rows[0]?.name,
      senderPhoto: senderInfo.rows[0]?.photo_url,
      content: msg.content, messageType: msg.message_type,
      isRead: false, createdAt: msg.created_at,
    };

    try {
      const { notifyNewMessage, sendToDevice } = require('../services/fcmService');
      const otherRole  = req.user.role === 'user' ? 'advocate' : 'user';
      const otherId    = req.user.role === 'user' ? room.advocate_id : room.user_id;
      const otherTable = otherRole === 'advocate' ? 'advocates' : 'users';
      const otherUser  = await query(
        `SELECT fcm_token FROM ${otherTable} WHERE id = $1`, [otherId]);
      const fcmToken   = otherUser.rows[0]?.fcm_token;

      const advInfo = await query(
        'SELECT consultation_fee FROM advocates WHERE id = $1',
        [room.advocate_id]);
      const consultationFee = advInfo.rows[0]?.consultation_fee || 0;

      if (fcmToken) {
        await notifyNewMessage(
          fcmToken,
          senderInfo.rows[0]?.name || 'Pengguna',
          content, roomId, req.user.id,
          String(consultationFee)
        );
      }

      if (req.user.role === 'user') {
        const msgCountResult = await query(
          `SELECT COUNT(*) as count FROM messages
           WHERE room_id = $1 AND sender_id = $2 AND sender_type = 'user'`,
          [roomId, req.user.id]
        );
        const msgCount = parseInt(msgCountResult.rows[0].count) || 0;

        const isPremium = await query(
          `SELECT id FROM subscriptions
           WHERE user_id = $1 AND advocate_id = $2 AND type = 'chat'`,
          [req.user.id, room.advocate_id]
        );

        if (msgCount === 5 && isPremium.rows.length === 0) {
          const advocateUser = await query(
            'SELECT fcm_token FROM advocates WHERE id = $1',
            [room.advocate_id]);
          const advFcmToken = advocateUser.rows[0]?.fcm_token;

          if (advFcmToken) {
            const userName = senderInfo.rows[0]?.name || 'Klien';
            await sendToDevice(advFcmToken,
              {
                title: '⏳ Klien Kehabisan Pesan Gratis',
                body:  `${userName} telah mencapai batas 5 pesan gratis. Tunggu hingga mereka berlangganan.`,
              },
              {
                type:   'chat_limit_reached',
                roomId: roomId,
                userId: req.user.id,
              }
            );
          }
        }
      }
    } catch (_) {}

    return sendSuccess(res, { message: msgData }, 'Pesan terkirim', 201);
  } catch (error) { next(error); }
});

// =============================================
// DELETE /chat/rooms/:roomId/messages/:messageId  ← BARU
// =============================================
router.delete('/rooms/:roomId/messages/:messageId', authenticate, async (req, res, next) => {
  try {
    const { roomId, messageId } = req.params;

    // 1. Cek room & akses
    const roomResult = await query(
      'SELECT * FROM chat_rooms WHERE id = $1 AND is_active IS NOT FALSE', [roomId]);
    const room = roomResult.rows[0];
    if (!room) return sendError(res, 'Room tidak ditemukan', 404);

    const hasAccess =
      (req.user.role === 'user'     && room.user_id     === req.user.id) ||
      (req.user.role === 'advocate' && room.advocate_id === req.user.id);
    if (!hasAccess) return sendError(res, 'Akses ditolak', 403);

    // 2. Cek pesan ada & milik pengirim
    const msgResult = await query(
      'SELECT * FROM messages WHERE id = $1 AND room_id = $2', [messageId, roomId]);
    const msg = msgResult.rows[0];
    if (!msg) return sendError(res, 'Pesan tidak ditemukan', 404);

    if (msg.sender_id !== req.user.id)
      return sendError(res, 'Tidak berhak menghapus pesan ini', 403);

    // 3. Hapus dari database
    await query('DELETE FROM messages WHERE id = $1', [messageId]);

    // 4. Broadcast ke socket agar semua client di room hapus bubble-nya
    //    io di-attach ke app lewat req.app.get('io')
    const io = req.app.get('io');
    if (io) {
      io.to(roomId).emit('message:deleted', { messageId, roomId });
    }

    console.log(`🗑️  Pesan ${messageId} dihapus oleh ${req.user.role} ${req.user.id}`);
    return sendSuccess(res, { messageId }, 'Pesan berhasil dihapus');
  } catch (error) { next(error); }
});

// =============================================
// GET /chat/rooms/:roomId/message-count
// =============================================
router.get('/rooms/:roomId/message-count', authenticate, async (req, res, next) => {
  try {
    const senderType = req.user.role === 'user' ? 'user' : 'advocate';
    const result = await query(
      `SELECT COUNT(*) as count FROM messages
       WHERE room_id = $1 AND sender_id = $2 AND sender_type = $3`,
      [req.params.roomId, req.user.id, senderType]
    );
    return sendSuccess(res, { count: parseInt(result.rows[0].count) || 0 });
  } catch (error) { next(error); }
});

// =============================================
// GET /chat/rooms/:roomId/subscription
// =============================================
router.get('/rooms/:roomId/subscription', authenticate, async (req, res, next) => {
  try {
    const roomResult = await query(
      'SELECT advocate_id FROM chat_rooms WHERE id = $1', [req.params.roomId]);
    if (!roomResult.rows[0]) return sendSuccess(res, { isPremium: false });

    const advocateId = roomResult.rows[0].advocate_id;
    const subResult  = await query(
      `SELECT id FROM subscriptions
       WHERE user_id = $1 AND advocate_id = $2 AND type = 'chat'`,
      [req.user.id, advocateId]
    );
    return sendSuccess(res, { isPremium: subResult.rows.length > 0 });
  } catch (error) { next(error); }
});

// =============================================
// POST /chat/rooms/:roomId/subscribe
// =============================================
router.post('/rooms/:roomId/subscribe', authenticate, async (req, res, next) => {
  try {
    const roomResult = await query(
      'SELECT advocate_id FROM chat_rooms WHERE id = $1', [req.params.roomId]);
    if (!roomResult.rows[0]) return sendError(res, 'Room tidak ditemukan', 404);

    const advocateId = roomResult.rows[0].advocate_id;
    await query(
      `INSERT INTO subscriptions (user_id, advocate_id, type, conversation_id, created_at)
       VALUES ($1, $2, 'chat', $3, NOW())
       ON CONFLICT (user_id, advocate_id, type) DO UPDATE
         SET conversation_id = EXCLUDED.conversation_id, created_at = NOW()`,
      [req.user.id, advocateId, req.params.roomId]
    );
    return sendSuccess(res, { isPremium: true }, 'Langganan chat aktif');
  } catch (error) { next(error); }
});

module.exports = router;