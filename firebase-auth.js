'use strict';
const admin = require('firebase-admin');

let app;
let authOverride;
function getFirebaseAuth() {
  if (authOverride) return authOverride;
  if (!app) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!projectId || !rawServiceAccount) throw new Error('Firebase Admin não está configurado no servidor.');
    let serviceAccount;
    try { serviceAccount = JSON.parse(rawServiceAccount); }
    catch { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON precisa conter JSON válido.'); }
    app = admin.apps.find(item => item.name === 'biomatch') || admin.initializeApp({
      credential: admin.credential.cert(serviceAccount), projectId
    }, 'biomatch');
  }
  return admin.auth(app);
}

async function verifyIdToken(token) {
  if (!token || token.length > 10000) return null;
  try { return await getFirebaseAuth().verifyIdToken(token, true); }
  catch (error) {
    if (error.message?.includes('não está configurado') || error.message?.includes('JSON válido')) throw error;
    return null;
  }
}

module.exports = { getFirebaseAuth, verifyIdToken };
module.exports.setAuthForTests = auth => { authOverride = auth; };
