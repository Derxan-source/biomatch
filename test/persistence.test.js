'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Readable } = require('node:stream');

process.env.NODE_ENV = 'test';
process.env.BIOMATCH_LOCAL_DB = 'file:./biomatch.test.db';
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const { handlePlatform, handleAuth, getDatabase } = require('../platform-db');
require('../firebase-auth').setAuthForTests({ verifyIdToken: async token => token === 'valid-firebase-token' ? { uid: 'firebase-user-1', email: 'conta@biomatch.test', name: 'Conta Firebase' } : null });
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
    const account = await auth({ action: 'sync', name: 'Conta Firebase' }, 'valid-firebase-token');
    assert.equal(account.status, 200);
    assert.equal(account.data.user.name, 'Conta Firebase');
    const accountSnapshot = await api('GET', 'snapshot', {}, '', 'valid-firebase-token');
    assert.equal(accountSnapshot.status, 200);
    assert.equal(accountSnapshot.data.profile.name, 'Conta Firebase');
    assert.equal((await auth({ action: 'sync', name: 'Falsificado' }, 'invalid-token')).status, 401);
    assert.equal((await api('GET', 'snapshot', {}, '', 'invalid-token')).status, 401);
    const db = await getDatabase();
    const firebaseProfile = await db.execute({ sql: 'SELECT id, email, password_hash FROM users WHERE id = ?', args: ['firebase-user-1'] });
    assert.equal(firebaseProfile.rows.length, 1);
    assert.equal(firebaseProfile.rows[0].email, 'conta@biomatch.test');
    assert.equal(firebaseProfile.rows[0].password_hash, null);
    assert.equal((await auth({ action: 'register', email: 'x', password: 'x' })).status, 404);
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
    console.log('Persistence tests passed: Firebase token sync and verification, guests, progress, duplicate protection, leaderboard and live persistence.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.rmSync('./biomatch.test.db' + suffix); } catch {}
    }
  }
})();
