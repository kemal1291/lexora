const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { notifyNewMessage } = require('../services/fcmService');

const onlineUsers = new Map();
const socketRooms = new Map();

const setupSocket = (io) => {

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token ||
                    socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) return next(new Error('Token diperlukan'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      if (decoded.role === 'advocate') {
        const result = await query(
          'SELECT id, name, photo_url FROM advocates WHERE id = $1 AND is_active = true',
          [decoded.id]
        );
        if (!result.rows[0]) return next(new Error('Akun tidak ditemukan'));
        socket.user = { ...result.rows[0], role: 'advocate' };
      } else {
        const result = await query(
          'SELECT id, name, photo_url FROM users WHERE id = $1 AND is_active = true',
          [decoded.id]
        );
        if (!result.rows[0]) return next(new Error('Akun tidak ditemukan'));
        socket.user = { ...result.rows[0], role: 'user' };
      }

      next();
    } catch (error) {
      next(new Error('Token tidak valid'));
    }
  });

  io.on('connection', (socket) => {
    const userKey = `${socket.user.role}_${socket.user.id}`;
    onlineUsers.set(userKey, socket.id);
    socketRooms.set(socket.id, new Set());

    console.log(`🟢 ${socket.user.role} "${socket.user.name}" terhubung`);

    socket.broadcast.emit('user:online', {
      userId: socket.user.id,
      role: socket.user.role,
      isOnline: true,
    });

    // JOIN ROOM
    socket.on('room:join', async ({ roomId }, callback) => {
      try {
        const roomResult = await query(
          'SELECT * FROM chat_rooms WHERE id = $1', [roomId]);
        const room = roomResult.rows[0];
        if (!room) return callback?.({ success: false, message: 'Room tidak ditemukan' });

        const hasAccess =
          (socket.user.role === 'user' && room.user_id === socket.user.id) ||
          (socket.user.role === 'advocate' && room.advocate_id === socket.user.id);
        if (!hasAccess) return callback?.({ success: false, message: 'Akses ditolak' });

        socket.join(roomId);
        socketRooms.get(socket.id)?.add(roomId);

        const messagesResult = await query(
          `SELECT * FROM messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT 30`,
          [roomId]
        );

        const senderType = socket.user.role === 'user' ? 'advocate' : 'user';
        await query(
          `UPDATE messages SET is_read = true, read_at = NOW()
           WHERE room_id = $1 AND sender_type = $2 AND is_read = false`,
          [roomId, senderType]
        );

        const messages = messagesResult.rows.reverse().map(formatMessage);
        callback?.({ success: true, messages });
        socket.to(roomId).emit('messages:read', { roomId });

      } catch (error) {
        callback?.({ success: false, message: error.message });
      }
    });

    // LEAVE ROOM
    socket.on('room:leave', ({ roomId }) => {
      socket.leave(roomId);
      socketRooms.get(socket.id)?.delete(roomId);
    });

    // SEND MESSAGE + FCM NOTIFICATION
    socket.on('message:send', async ({ roomId, content, messageType = 'text' }, callback) => {
      try {
        if (!content?.trim() && messageType === 'text') {
          return callback?.({ success: false, message: 'Pesan kosong' });
        }

        const roomResult = await query(
          'SELECT * FROM chat_rooms WHERE id = $1 AND is_active = true', [roomId]);
        const room = roomResult.rows[0];
        if (!room) return callback?.({ success: false, message: 'Room tidak ditemukan' });

        const hasAccess =
          (socket.user.role === 'user' && room.user_id === socket.user.id) ||
          (socket.user.role === 'advocate' && room.advocate_id === socket.user.id);
        if (!hasAccess) return callback?.({ success: false, message: 'Akses ditolak' });

        // Simpan pesan
        const result = await query(
          `INSERT INTO messages (room_id, sender_id, sender_type, content, message_type)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [roomId, socket.user.id, socket.user.role, content.trim(), messageType]
        );

        const message = formatMessage(result.rows[0]);
        message.senderName = socket.user.name;
        message.senderPhoto = socket.user.photo_url;

        await query('UPDATE chat_rooms SET updated_at = NOW() WHERE id = $1', [roomId]);

        // Kirim ke room
        io.to(roomId).emit('message:new', message);

        // Notifikasi ke lawan bicara
        const otherKey = socket.user.role === 'user'
          ? `advocate_${room.advocate_id}`
          : `user_${room.user_id}`;
        const otherSocketId = onlineUsers.get(otherKey);
        const otherSocket = otherSocketId
          ? io.sockets.sockets.get(otherSocketId)
          : null;

        // Kirim socket notif kalau tidak di room
        if (otherSocket && !otherSocket.rooms.has(roomId)) {
          otherSocket.emit('notification:message', {
            roomId,
            senderName: socket.user.name,
            senderPhoto: socket.user.photo_url,
            content: content.substring(0, 80),
          });
        }

        // ===== FCM PUSH NOTIFICATION =====
        // Kirim FCM kalau lawan bicara offline atau tidak di room
        const isOtherInRoom = otherSocket?.rooms.has(roomId);
        if (!isOtherInRoom) {
          try {
            // Ambil FCM token lawan bicara
            const otherTable = socket.user.role === 'user' ? 'advocates' : 'users';
            const otherId = socket.user.role === 'user'
              ? room.advocate_id : room.user_id;
            const otherUser = await query(
              `SELECT fcm_token FROM ${otherTable} WHERE id = $1`,
              [otherId]
            );

            const fcmToken = otherUser.rows[0]?.fcm_token;
            if (fcmToken) {
              await notifyNewMessage(
                fcmToken,
                socket.user.name,
                content,
                roomId,
                socket.user.role === 'user' ? socket.user.id : room.advocate_id
              );
            }
          } catch (fcmError) {
            console.error('FCM send error:', fcmError.message);
          }
        }

        callback?.({ success: true, message });
        console.log(`💬 [${roomId}] ${socket.user.name}: ${content.substring(0, 50)}`);

      } catch (error) {
        console.error('message:send error:', error.message);
        callback?.({ success: false, message: error.message });
      }
    });

    // TYPING
    socket.on('typing:start', ({ roomId }) => {
      socket.to(roomId).emit('typing:start', {
        roomId, userId: socket.user.id,
        role: socket.user.role, name: socket.user.name,
      });
    });

    socket.on('typing:stop', ({ roomId }) => {
      socket.to(roomId).emit('typing:stop', {
        roomId, userId: socket.user.id, role: socket.user.role,
      });
    });

    // MARK READ
    socket.on('messages:read', async ({ roomId }, callback) => {
      try {
        const senderType = socket.user.role === 'user' ? 'advocate' : 'user';
        await query(
          `UPDATE messages SET is_read = true, read_at = NOW()
           WHERE room_id = $1 AND sender_type = $2 AND is_read = false`,
          [roomId, senderType]
        );
        socket.to(roomId).emit('messages:read', {
          roomId, readBy: socket.user.id, role: socket.user.role,
        });
        callback?.({ success: true });
      } catch (error) {
        callback?.({ success: false, message: error.message });
      }
    });

    // DISCONNECT
    socket.on('disconnect', async () => {
      onlineUsers.delete(userKey);
      socketRooms.delete(socket.id);

      socket.broadcast.emit('user:offline', {
        userId: socket.user.id, role: socket.user.role, isOnline: false,
      });

      console.log(`🔴 ${socket.user.role} "${socket.user.name}" terputus`);
    });
  });

  console.log('✅ Socket.io handler siap');
};

const formatMessage = (msg) => ({
  id: msg.id, roomId: msg.room_id, senderId: msg.sender_id,
  senderType: msg.sender_type, content: msg.content,
  fileUrl: msg.file_url, fileName: msg.file_name,
  messageType: msg.message_type, isRead: msg.is_read,
  readAt: msg.read_at, createdAt: msg.created_at,
});

const isOnline = (role, id) => onlineUsers.has(`${role}_${id}`);

module.exports = { setupSocket, isOnline };
