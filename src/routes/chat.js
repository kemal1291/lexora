// Tambahkan ke src/routes/chat.js SEBELUM module.exports

// =============================================
// GET /chat/rooms/:roomId/message-count
// Jumlah pesan yang dikirim user di room ini
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
  } catch (error) {
    next(error);
  }
});

// =============================================
// GET /chat/rooms/:roomId/subscription
// Cek apakah user sudah berlangganan (premium) di room ini
// =============================================
router.get('/rooms/:roomId/subscription', authenticate, async (req, res, next) => {
  try {
    // Cek di tabel subscriptions apakah user punya chat sub dengan advokat ini
    const roomResult = await query(
      'SELECT advocate_id FROM chat_rooms WHERE id = $1',
      [req.params.roomId]
    );

    if (!roomResult.rows[0]) {
      return sendSuccess(res, { isPremium: false });
    }

    const advocateId = roomResult.rows[0].advocate_id;

    const subResult = await query(
      `SELECT id FROM subscriptions
       WHERE user_id = $1 AND advocate_id = $2 AND type = 'chat'`,
      [req.user.id, advocateId]
    );

    return sendSuccess(res, { isPremium: subResult.rows.length > 0 });
  } catch (error) {
    next(error);
  }
});

// =============================================
// POST /chat/rooms/:roomId/subscribe
// Tandai room sebagai premium (setelah bayar)
// =============================================
router.post('/rooms/:roomId/subscribe', authenticate, async (req, res, next) => {
  try {
    const roomResult = await query(
      'SELECT advocate_id FROM chat_rooms WHERE id = $1',
      [req.params.roomId]
    );

    if (!roomResult.rows[0]) {
      return sendError(res, 'Room tidak ditemukan', 404);
    }

    const advocateId = roomResult.rows[0].advocate_id;

    // Simpan ke tabel subscriptions
    await query(
      `INSERT INTO subscriptions (user_id, advocate_id, type, conversation_id, created_at)
       VALUES ($1, $2, 'chat', $3, NOW())
       ON CONFLICT (user_id, advocate_id, type) DO UPDATE
         SET conversation_id = EXCLUDED.conversation_id,
             created_at = NOW()`,
      [req.user.id, advocateId, req.params.roomId]
    );

    return sendSuccess(res, { isPremium: true }, 'Langganan chat aktif');
  } catch (error) {
    next(error);
  }
});