const admin = require('firebase-admin');

let firebaseApp = null;

const initFirebase = () => {
  if (firebaseApp) return firebaseApp;

  // Cek apakah Firebase credentials ada di environment
  if (!process.env.FIREBASE_PROJECT_ID) {
    console.warn('⚠️  Firebase credentials tidak ditemukan. Firebase Auth dinonaktifkan.');
    return null;
  }

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
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

// Verifikasi Firebase ID Token (dari Google Sign-In atau Phone Auth)
const verifyFirebaseToken = async (idToken) => {
  if (!firebaseApp) {
    throw new Error('Firebase tidak dikonfigurasi');
  }
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    throw new Error('Firebase token tidak valid: ' + error.message);
  }
};

// Buat custom token untuk user (opsional)
const createCustomToken = async (uid, claims = {}) => {
  if (!firebaseApp) throw new Error('Firebase tidak dikonfigurasi');
  return await admin.auth().createCustomToken(uid, claims);
};

module.exports = { initFirebase, verifyFirebaseToken, createCustomToken };
