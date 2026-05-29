// src/services/fcmService.js
const admin = require('firebase-admin');

const sendToDevice = async (fcmToken, notification, data = {}) => {
  if (!fcmToken) return null;
  try {
    const message = {
      token: fcmToken,
      notification: { title: notification.title, body: notification.body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        notification: {
          channelId: 'lexora_high_importance',
          priority: 'high',
          color: '#0D1B3E',
        },
        priority: 'high',
      },
      apns: { payload: { aps: { badge: 1, sound: 'default' } } },
    };
    const response = await admin.messaging().send(message);
    console.log(`📤 FCM: ${notification.title}`);
    return response;
  } catch (error) {
    if (error.code === 'messaging/registration-token-not-registered') {
      return { invalid: true, token: fcmToken };
    }
    console.error('FCM error:', error.message);
    return null;
  }
};

// consultationFee ditambahkan di parameter
const notifyNewMessage = (fcmToken, senderName, content, roomId, senderId, consultationFee = '0') =>
  sendToDevice(fcmToken,
    {
      title: `💬 ${senderName}`,
      body: content.length > 80 ? content.substring(0, 80) + '...' : content,
    },
    {
      type:            'chat',
      roomId:          roomId          || '',
      advocateName:    senderName      || '',
      advocateId:      senderId        || '',
      consultationFee: String(consultationFee), // ← fee dikirim ke Flutter
    }
  );

const notifyNewComplaint = (fcmToken, userName, title) =>
  sendToDevice(fcmToken,
    { title: '📋 Pengaduan Baru', body: `${userName}: ${title}` },
    { type: 'complaint' }
  );

const notifyComplaintUpdate = (fcmToken, status, title) => {
  const labels = {
    review: 'sedang ditinjau', in_progress: 'sedang ditangani',
    resolved: 'telah selesai', rejected: 'tidak dapat diproses',
  };
  return sendToDevice(fcmToken,
    { title: '⚖️ Update Pengaduan', body: `"${title}" ${labels[status] || status}` },
    { type: 'complaint' }
  );
};

module.exports = { sendToDevice, notifyNewMessage, notifyNewComplaint, notifyComplaintUpdate };