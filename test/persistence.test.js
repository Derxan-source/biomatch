'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');

process.env.NODE_ENV = 'test';
process.env.BIOMATCH_LOCAL_DB = 'file:./biomatch.test.db';
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const { handlePlatform, handleAuth, getDatabase } = require('../platform-db');
const liveStore = require('../live-store');
const questionBank = require('../question-banks.json');

function request(method, url, body, ip = '127.0.0.1') {
  const req = Readable.from(method === 'POST' ? [JSON.stringify(body || {})] : []);
  req.method = method;
  req.url = url;
  req.headers = {};
  req.socket = { remoteAddress: ip };
  return req;
}
function response() {
  return {
    status: 0,
    body: '',
    headers: {},
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(value) { this.body = value || ''; }
  };
}
async function auth(body, token = '', ip) { const req = request('POST', '/api/auth', body, ip); if (token) req.headers.authorization = 'Bearer ' + token; const res = response(); await handleAuth(req, res); return { status: res.status, data: JSON.parse(res.body || '{}') }; }
async function api(method, action, body = {}, guestId = '', token = '') {
  const url = '/api/platform?action=' + encodeURIComponent(action) +
    (guestId ? '&guestId=' + encodeURIComponent(guestId) : '');
  const res = response();
  const req = request(method, url, { ...body, action, guestId }); req.headers = token ? { authorization: 'Bearer ' + token } : {};
  await handlePlatform(req, res);
  return { status: res.status, data: JSON.parse(res.body || '{}') };
}

(async () => {
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync('./biomatch.test.db' + suffix); } catch {}
  }
  try {
    const account = await auth({ action: 'register', name: 'Conta Teste', email: 'conta@biomatch.test', password: 'senha-forte-123' });
    assert.equal(account.status, 201);
    assert.ok(account.data.token);
    const accountSnapshot = await api('GET', 'snapshot', {}, '', account.data.token);
    assert.equal(accountSnapshot.status, 200);
    assert.equal(accountSnapshot.data.profile.name, 'Conta Teste');
    const login = await auth({ action: 'login', email: 'CONTA@BIOMATCH.TEST', password: 'senha-forte-123' });
    assert.equal(login.status, 200);
    const invalidLogin = await auth({ action: 'login', email: 'conta@biomatch.test', password: 'senha-errada' });
    assert.equal(invalidLogin.status, 401);

    const originalFetch = global.fetch;
    const originalEnv = { ...process.env };
    const sentEmails = [];
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.RESEND_API_KEY = 'test-resend-key';
    process.env.RESEND_FROM_EMAIL = 'BioMatch <noreply@example.test>';
    global.fetch = async (url, options) => { sentEmails.push({ url: String(url), body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ id: 'email-test' }) }; };
    const resetRequest = await auth({ action: 'request_password_reset', email: 'conta@biomatch.test' }, '', '198.51.100.11');
    assert.equal(resetRequest.status, 200);
    assert.match(resetRequest.data.message, /Se houver uma conta/);
    assert.equal(sentEmails.length, 1);
    const resetLink = new URL(sentEmails[0].body.text.match(/http:\/\/localhost:3000\/\?reset=[^\s]+/)[0]);
    const resetToken = resetLink.searchParams.get('reset');
    const db = await getDatabase();
    const storedReset = await db.execute({ sql: 'SELECT token_hash, expires_at FROM password_reset_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)', args: ['conta@biomatch.test'] });
    assert.equal(storedReset.rows.length, 1);
    assert.equal(storedReset.rows[0].token_hash, crypto.createHash('sha256').update(resetToken).digest('hex'));
    assert.ok(Number(storedReset.rows[0].expires_at) > Date.now());
    assert.ok(Number(storedReset.rows[0].expires_at) <= Date.now() + 30 * 60 * 1000);
    assert.notEqual(storedReset.rows[0].token_hash, resetToken);
    const unknownReset = await auth({ action: 'request_password_reset', email: 'ausente@biomatch.test' }, '', '198.51.100.12');
    assert.deepEqual(unknownReset, resetRequest);
    assert.equal(sentEmails.length, 1);
    for (let attempt = 0; attempt < 8; attempt++) {
      const limited = await auth({ action: 'request_password_reset', email: `limit-${attempt}@biomatch.test` }, '', '198.51.100.55');
      assert.equal(limited.status, 200);
    }
    assert.equal((await auth({ action: 'request_password_reset', email: 'limit-last@biomatch.test' }, '', '198.51.100.55')).status, 429);
    const changedPassword = await auth({ action: 'reset_password', token: resetToken, password: 'senha-nova-456' });
    assert.equal(changedPassword.status, 200);
    assert.equal((await api('GET', 'snapshot', {}, '', account.data.token)).status, 401);
    assert.equal((await api('GET', 'snapshot', {}, '', login.data.token)).status, 401);
    assert.equal((await auth({ action: 'reset_password', token: resetToken, password: 'senha-nova-789' })).status, 400);
    assert.equal((await auth({ action: 'login', email: 'conta@biomatch.test', password: 'senha-nova-456' })).status, 200);

    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'test-only-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/google/callback';
    const { handleGoogleStart, handleGoogleCallback } = require('../platform-db');
    const startReq = request('GET', '/auth/google', null, '198.51.100.20'), startRes = response();
    await handleGoogleStart(startReq, startRes);
    assert.equal(startRes.status, 302);
    const authUrl = new URL(startRes.headers.location);
    assert.equal(authUrl.origin, 'https://accounts.google.com');
    assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    const state = authUrl.searchParams.get('state');
    global.fetch = async (url) => String(url).includes('/tokeninfo?')
      ? { ok: true, json: async () => ({ aud: process.env.GOOGLE_CLIENT_ID, iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 300), email_verified: 'true', email: 'google@biomatch.test', sub: 'google-sub-test', name: 'Google Estudante' }) }
      : { ok: true, json: async () => ({ id_token: 'mock-google-id-token' }) };
    const callbackReq = request('GET', '/auth/google/callback?code=google-code&state=' + encodeURIComponent(state));
    const callbackRes = response(); await handleGoogleCallback(callbackReq, callbackRes);
    assert.equal(callbackRes.status, 302);
    const exchangeCode = new URL(callbackRes.headers.location).searchParams.get('oauth_code');
    const googleLogin = await auth({ action: 'oauth_exchange', code: exchangeCode });
    assert.equal(googleLogin.status, 200);
    assert.equal(googleLogin.data.user.name, 'Google Estudante');
    assert.equal((await auth({ action: 'oauth_exchange', code: exchangeCode })).status, 401);
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    const guest = await api('POST', 'guest', { name: 'Teste Turso' });
    assert.equal(guest.status, 201);
    const id = guest.data.guestId;
    assert.ok(id);

    const snapshot = await api('GET', 'snapshot', {}, id);
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.data.profile.name, 'Teste Turso');

    const biology = questionBank.find(q => q.subject === 'Biologia');
    assert.ok(biology, 'A bank must contain Biology questions');
    const answer = await api('POST', 'answer', { questionId: biology.id, choice: biology.answer }, id);
    assert.equal(answer.status, 200);
    assert.equal(answer.data.correct, true);
    assert.equal(answer.data.profile.xp, 100);

    const duplicate = await api('POST', 'answer', { questionId: biology.id, choice: biology.answer }, id);
    assert.equal(duplicate.status, 409);

    const leaderboard = await api('GET', 'leaderboard', {}, id);
    assert.equal(leaderboard.status, 200);
    assert.equal(leaderboard.data.rows[0].name, 'Teste Turso');

    const room = {
      code: 'A7K2Q9', host: 'player-1', questionPool: [biology], questionCount: 1,
      questionIndex: 0, phase: 'question', deadline: Date.now() + 15000,
      soloTest: true, questions: [biology],
      players: new Map([['player-1', { id: 'player-1', session: 'session-test', nickname: 'Teste', score: 10 }]]),
      answers: new Map([['player-1', { choice: 0, correct: true, points: 10 }]])
    };
    await liveStore.saveRoom(room);
    const restored = await liveStore.loadRooms();
    assert.ok(restored.some(item => item.code === room.code));
    await liveStore.deleteRoom(room.code);

    const token = 'test-question-token';
    await liveStore.saveQuestionSet(token, { questions: [biology], count: 1, expires: Date.now() + 10000 });
    const set = await liveStore.takeQuestionSet(token);
    assert.equal(set.count, 1);
    assert.equal(await liveStore.takeQuestionSet(token), null);

    await db.close();
    console.log('Persistence tests passed: email/Google authentication, password reset expiry/hash/use-once/session revocation, guests, progress, duplicate protection, leaderboard and live persistence.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.rmSync('./biomatch.test.db' + suffix); } catch {}
    }
  }
})();
