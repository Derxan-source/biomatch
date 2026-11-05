'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Readable } = require('node:stream');

process.env.NODE_ENV = 'test';
process.env.BIOMATCH_LOCAL_DB = 'file:./biomatch.test.db';
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const { handlePlatform, getDatabase } = require('../platform-db');
const liveStore = require('../live-store');
const questionBank = require('../question-banks.json');

function request(method, url, body) {
  const req = Readable.from(method === 'POST' ? [JSON.stringify(body || {})] : []);
  req.method = method;
  req.url = url;
  return req;
}
function response() {
  return {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; },
    end(value) { this.body = value || ''; }
  };
}
async function api(method, action, body = {}, guestId = '') {
  const url = '/api/platform?action=' + encodeURIComponent(action) +
    (guestId ? '&guestId=' + encodeURIComponent(guestId) : '');
  const res = response();
  await handlePlatform(request(method, url, { ...body, action, guestId }), res);
  return { status: res.status, data: JSON.parse(res.body || '{}') };
}

(async () => {
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync('./biomatch.test.db' + suffix); } catch {}
  }
  try {
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

    const db = await getDatabase();
    await db.close();
    console.log('Persistence tests passed: guest, progress, duplicate protection, leaderboard, live rooms and generated sets.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.rmSync('./biomatch.test.db' + suffix); } catch {}
    }
  }
})();
