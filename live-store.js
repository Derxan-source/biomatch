'use strict';
const { getDatabase } = require('./platform-db');
const roomWrites = new Map();
async function saveRoom(room) {
  const previous = roomWrites.get(room.code) || Promise.resolve();
  const write = previous.catch(() => {}).then(async () => {
  const db = await getDatabase();
  const state = {
    code: room.code, host: room.host, questionPool: room.questionPool,
    questionCount: room.questionCount, questionIndex: room.questionIndex,
    phase: room.phase, deadline: room.deadline, soloTest: room.soloTest,
    questions: room.questions,
    players: [...room.players.values()].map(p => ({
      id:p.id, session:p.session, nickname:p.nickname, score:p.score, disconnectedAt:p.disconnectedAt||null
    })),
    answers: [...room.answers.entries()]
  };
  await db.execute({sql:'INSERT INTO live_rooms(code,state_json) VALUES(?,?) ON CONFLICT(code) DO UPDATE SET state_json=excluded.state_json, updated_at=datetime(\'now\')',args:[room.code,JSON.stringify(state)]});
}
async function deleteRoom(code) {
  const previous = roomWrites.get(code) || Promise.resolve();
  const write = previous.catch(() => {}).then(async () => {
    const db = await getDatabase();
    await db.execute({sql:'DELETE FROM live_rooms WHERE code=?',args:[code]});
  });
  roomWrites.set(code, write);
  try { await write; } finally { if (roomWrites.get(code) === write) roomWrites.delete(code); }
}
async function loadRooms() {
  const db = await getDatabase();
  const result = await db.execute('SELECT state_json FROM live_rooms');
  const rooms = [];
  for (const row of result.rows) {
    try {
      const state = JSON.parse(row.state_json);
      if (!state || !/^[A-HJ-NP-Z2-9]{6}$/.test(state.code) || !Array.isArray(state.players)) continue;
      rooms.push(state);
    } catch {}
  }
  return rooms;
}
async function saveQuestionSet(token,set) {
  const db=await getDatabase();
  await db.execute({sql:'INSERT INTO live_question_sets(token,state_json,expires_at) VALUES(?,?,?) ON CONFLICT(token) DO UPDATE SET state_json=excluded.state_json,expires_at=excluded.expires_at',args:[token,JSON.stringify(set),set.expires]});
}
async function takeQuestionSet(token) {
  const db=await getDatabase();
  const result=await db.execute({sql:'SELECT state_json,expires_at FROM live_question_sets WHERE token=?',args:[token]});
  await db.execute({sql:'DELETE FROM live_question_sets WHERE token=?',args:[token]});
  if(!result.rows.length || Number(result.rows[0].expires_at)<Date.now()) return null;
  try{return JSON.parse(result.rows[0].state_json)}catch{return null}
}
async function cleanup() {
  const db=await getDatabase();
  await db.execute({sql:'DELETE FROM live_question_sets WHERE expires_at < ?',args:[Date.now()]});
}
module.exports={saveRoom,deleteRoom,loadRooms,saveQuestionSet,takeQuestionSet,cleanup};
