const admin = require('firebase-admin');

let firebaseApp = null;

const initFirebase = () => {
  if (firebaseApp) return firebaseApp;

  if (!process.env.FIREBASE_PROJECT_ID) {
    console.warn('⚠️  Firebase credentials tidak ditemukan. Firebase Auth dinonaktifkan.');
    return null;
  }

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
    console.log('✅ Firebase Admin SDK terhubung');
    return firebaseApp;
  } catch (error) {
    console.error('❌ Firebase init error:', error.message);
    return null;
  }
};

const verifyFirebaseToken = async (idToken) => {
  if (!firebaseApp) throw new Error('Firebase tidak dikonfigurasi');
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch (error) {
    throw new Error('Firebase token tidak valid: ' + error.message);
  }
};

const createCustomToken = async (uid, claims = {}) => {
  if (!firebaseApp) throw new Error('Firebase tidak dikonfigurasi');
  return await admin.auth().createCustomToken(uid, claims);
};

// ─────────────────────────────────────────────────────────────────────────────
// Kirim FCM push notification ke satu device
// ─────────────────────────────────────────────────────────────────────────────
const sendPushNotification = async ({ fcmToken, title, body, data = {} }) => {
  if (!firebaseApp) {
    console.warn('[FCM] Firebase tidak aktif, notifikasi dilewati');
    return false;
  }
  if (!fcmToken) {
    console.warn('[FCM] FCM token kosong, notifikasi dilewati');
    return false;
  }

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: {
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
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
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    });

    console.log(`[FCM] Notifikasi terkirim → "${title}"`);
    return true;
  } catch (err) {
    console.warn('[FCM] Gagal kirim notifikasi:', err.message);
    return false;
  }
};

module.exports = {
  initFirebase,
  verifyFirebaseToken,
  createCustomToken,
  sendPushNotification, // ← export baru
};