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
assert.doesNotMatch(fs.readFileSync('./index.html', 'utf8'), /Continuar com Google|href=["']\/auth\/google/);
assert.doesNotMatch(fs.readFileSync('./server.js', 'utf8'), /\/auth\/google/);

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
    assert.equal((await auth({ action: 'oauth_exchange', code: 'retired-google-login' })).status, 404);
    const guest = await api('POST', 'guest', { name: 'Teste Turso' });
    assert.equal(guest.status, 201);
    const id = guest.data.guestId;
    assert.ok(id);

    const snapshot = await api('GET', 'snapshot', {}, id);
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.data.profile.name, 'Teste Turso');
    assert.deepEqual(Object.keys(snapshot.data), ['profile']);
    for (const action of ['friend', 'message', 'challenge']) {
      const disabled = await api('POST', action, { name: 'Outro', to: 'Outro', text: 'Oi' }, id);
      assert.equal(disabled.status, 404, `${action} stays unavailable until safety controls exist`);
    }

    const subjects = ['Biologia', 'Química', 'História', 'Informática'];
    for (const subject of subjects) {
      const subjectQuestions = questionBank.filter(q => q.subject === subject);
      assert.equal(subjectQuestions.length, 5, `${subject} must have five starter questions`);
      for (const question of subjectQuestions) {
        assert.equal(question.options.length, 4, `${question.id} must have four choices`);
        assert.ok(Number.isInteger(question.answer) && question.answer >= 0 && question.answer < 4, `${question.id} must have a valid answer`);
        assert.ok(question.explanation.length > 0, `${question.id} must explain its answer`);
      }
    }
    const biology = questionBank.find(q => q.subject === 'Biologia');
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

    await db.close();
    console.log('Persistence tests passed: email/password authentication, password reset expiry/hash/use-once/session revocation, guests, progress, duplicate protection, leaderboard and live persistence.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.rmSync('./biomatch.test.db' + suffix); } catch {}
    }
  }
})();
