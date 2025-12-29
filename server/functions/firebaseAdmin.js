const { applicationDefault, cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

function initFirebaseAdmin() {
  if (getApps().length) return;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    const parsed = JSON.parse(serviceAccountJson);
    initializeApp({ credential: cert(parsed) });
    return;
  }

  // Falls back to GOOGLE_APPLICATION_CREDENTIALS / default credentials.
  initializeApp({ credential: applicationDefault() });
}

function getFirebaseAdminAuth() {
  initFirebaseAdmin();
  return getAuth();
}

module.exports = {
  getFirebaseAdminAuth,
};
