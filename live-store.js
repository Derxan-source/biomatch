'use strict';
const { getDatabase } = require('./platform-db');
const roomWrites = new Map();

async function saveRoom(room) {
  const state = {
    code: room.code,
    host: room.host,
    questionPool: room.questionPool,
    questionCount: room.questionCount,
    questionIndex: room.questionIndex,
    phase: room.phase,
    deadline: room.deadline,
    soloTest: room.soloTest,
    questions: room.questions,
    players: [...room.players.values()].map(player => ({
      id: player.id,
      session: player.session,
      nickname: player.nickname,
      score: player.score,
      disconnectedAt: player.disconnectedAt || null
    })),
    answers: [...room.answers.entries()]
  };
  const code = room.code;
  const previous = roomWrites.get(code) || Promise.resolve();
  const write = previous.catch(() => {}).then(async () => {
    const db = await getDatabase();
    await db.execute({
      sql: "INSERT INTO live_rooms(code,state_json) VALUES(?,?) ON CONFLICT(code) DO UPDATE SET state_json=excluded.state_json, updated_at=datetime('now')",
      args: [code, JSON.stringify(state)]
    });
  });
  roomWrites.set(code, write);
  try {
    await write;
  } finally {
    if (roomWrites.get(code) === write) roomWrites.delete(code);
  }
}

async function deleteRoom(code) {
  const previous = roomWrites.get(code) || Promise.resolve();
  const write = previous.catch(() => {}).then(async () => {
    const db = await getDatabase();
    await db.execute({ sql: 'DELETE FROM live_rooms WHERE code=?', args: [code] });
  });
  roomWrites.set(code, write);
  try {
    await write;
  } finally {
    if (roomWrites.get(code) === write) roomWrites.delete(code);
  }
}

async function loadRooms() {
  const db = await getDatabase();
  const result = await db.execute('SELECT state_json FROM live_rooms');
  const rooms = [];
  for (const row of result.rows) {
    try {
      const state = JSON.parse(row.state_json);
      if (state && /^[A-HJ-NP-Z2-9]{6}$/.test(state.code) && Array.isArray(state.players)) rooms.push(state);
    } catch {}
  }
  return rooms;
}

module.exports = { saveRoom, deleteRoom, loadRooms };
