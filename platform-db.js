'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@libsql/client');
const { verifyIdToken } = require('./firebase-auth');
const questionBank = require('./question-banks.json');
let client;
let initialization;

async function database() {
  if (!initialization) {
    initialization = (async () => {
      const url = process.env.TURSO_DATABASE_URL;
      const authToken = process.env.TURSO_AUTH_TOKEN;
      if ((url && !authToken) || (!url && authToken)) throw new Error('Configure TURSO_DATABASE_URL e TURSO_AUTH_TOKEN juntos.');
      if (url) client = createClient({ url, authToken });
      else if (process.env.NODE_ENV === 'production') throw new Error('Banco Turso não configurado no ambiente de produção.');
      else client = createClient({ url: process.env.BIOMATCH_LOCAL_DB || 'file:./biomatch.local.db' });
      const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sqlite.sql'), 'utf8');
      const statements = schema.split(';').map(sql => sql.trim()).filter(Boolean);
      for (const sql of statements) await client.execute(sql);
      const columns = await client.execute('PRAGMA table_info(users)');
      const names = new Set(columns.rows.map(row => row.name));
      if (!names.has('email')) await client.execute('ALTER TABLE users ADD COLUMN email TEXT');
      if (!names.has('password_hash')) await client.execute('ALTER TABLE users ADD COLUMN password_hash TEXT');
      if (!names.has('firebase_migrated')) await client.execute('ALTER TABLE users ADD COLUMN firebase_migrated INTEGER NOT NULL DEFAULT 0');
      await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL');
      return client;
    })().catch(error => { initialization = null; throw error; });
  }
  return initialization;
}
function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(data));
}
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 12000) { const error = new Error('Pedido muito grande.'); error.status = 413; throw error; }
  }
  try { return JSON.parse(raw || '{}'); }
  catch { const error = new Error('Pedido inválido.'); error.status = 400; throw error; }
}
function cleanName(value) {
  return typeof value === 'string' ? value.replace(/[<>\u0000-\u001f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 18) : '';
}
function parseJson(value, fallback) { try { return JSON.parse(value || ''); } catch { return fallback; } }
function profile(row) {
  return { id: row.id, name: row.display_name, xp: Number(row.xp), level: Math.floor(Number(row.xp) / 500) + 1,
    answers: Number(row.answers), correct: Number(row.correct), streak: Number(row.streak),
    badges: parseJson(row.badges_json, []), dailyAnswers: Number(row.daily_answers), subjectStats: parseJson(row.subject_stats_json, {}) };
}
async function getUser(db, id) {
  if (typeof id !== 'string' || id.length > 80) return null;
  const result = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] });
  return result.rows[0] || null;
}
async function snapshot(db, user) { return { profile: profile(user) }; }
async function handleAuth(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'Método não permitido.' });
    const body = await readBody(req), action = body.action;
    if (action === 'logout') return send(res, 200, { ok: true });
    if (action === 'sync') {
      const db = await database();
      const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
      const decoded = bearer && await verifyIdToken(bearer[1]);
      if (!decoded?.uid || !decoded.email) return send(res, 401, { error: 'Sua sessão expirou. Entre novamente.' });
      const id = decoded.uid, email = decoded.email.trim().toLowerCase(), name = cleanName(body.name) || cleanName(decoded.name) || 'Estudante';
      const existing = await getUser(db, id);
      if (existing && existing.email && existing.email.toLowerCase() !== email) return send(res, 409, { error: 'A conta autenticada não corresponde ao perfil existente.' });
      if (!existing) {
        const emailOwner = await db.execute({ sql: 'SELECT id FROM users WHERE email = ? COLLATE NOCASE', args: [email] });
        if (emailOwner.rows.length) return send(res, 409, { error: 'Este e-mail está associado a uma conta antiga ainda não migrada.' });
        await db.execute({ sql: 'INSERT INTO users (id, display_name, email, password_hash) VALUES (?, ?, ?, NULL)', args: [id, name, email] });
      } else if (!existing.email) {
        await db.execute({ sql: 'UPDATE users SET email = ? WHERE id = ?', args: [email, id] });
      }
      return send(res, 200, { user: profile(await getUser(db, id)) });
    }
    return send(res, 404, { error: 'Ação de autenticação não encontrada.' });
  } catch (error) {
    const status = error.status || (/UNIQUE|unique constraint/i.test(error.message || '') ? 409 : 500);
    if (status === 500) console.error('BioMatch auth:', error.message);
    return send(res, status, { error: status === 409 ? 'Este e-mail já está cadastrado.' : status === 400 ? error.message : 'Não foi possível concluir a autenticação.' });
  }
}
async function handlePlatform(req, res) {
  let body = {};
  try {
    if (req.method === 'POST') body = await readBody(req);
    const db = await database();
    const url = new URL(req.url, 'http://localhost');
    const action = req.method === 'GET' ? url.searchParams.get('action') : body.action;
    const guestId = req.method === 'GET' ? url.searchParams.get('guestId') : body.guestId;
    if (action === 'guest' && req.method === 'POST') {
      const name = cleanName(body.name) || 'Visitante';
      if (name.length < 2) return send(res, 400, { error: 'Escolha um apelido com pelo menos 2 caracteres.' });
      const id = crypto.randomUUID();
      await db.execute({ sql: 'INSERT INTO users (id, display_name) VALUES (?, ?)', args: [id, name] });
      return send(res, 201, { guestId: id, profile: profile(await getUser(db, id)) });
    }
    const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    let user = null;
    if (bearer) {
      const decoded = await verifyIdToken(bearer[1]);
      user = decoded?.uid ? await getUser(db, decoded.uid) : null;
    } else user = await getUser(db, guestId);
    if (!user) return send(res, 401, { error: 'Perfil visitante não encontrado. Entre novamente ou verifique os dados salvos neste dispositivo.' });
    if (action === 'snapshot') return send(res, 200, await snapshot(db, user));
    if (action === 'questions') {
      const subject = String(req.method === 'GET' ? url.searchParams.get('subject') : body.subject || '');
      const rows = questionBank.filter(question => question.subject === subject);
      return send(res, 200, { questions: rows.map(({ id, subject, topic, question, options }) => ({ id, subject, topic, question, options })) });
    }
    if (action === 'answer') {
      const question = questionBank.find(item => item.id === body.questionId);
      if (!question) return send(res, 404, { error: 'Questão não encontrada.' });
      const choice = Number(body.choice);
      if (!Number.isInteger(choice) || choice < 0 || choice > 3) return send(res, 400, { error: 'Alternativa inválida.' });
      const tx = await db.transaction('write');
      try {
        const existing = await tx.execute({ sql: 'SELECT id FROM question_attempts WHERE user_id = ? AND question_id = ?', args: [user.id, question.id] });
        if (existing.rows.length) { await tx.rollback(); return send(res, 409, { error: 'Você já respondeu esta questão neste perfil.' }); }
        const currentResult = await tx.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [user.id] });
        const current = currentResult.rows[0];
        if (!current) { await tx.rollback(); return send(res, 401, { error: 'Perfil não encontrado. Entre novamente como visitante.' }); }
        const correct = choice === question.answer, earned = correct ? 100 : 10;
        const today = new Date().toISOString().slice(0, 10);
        const dailyAnswers = current.daily_date === today ? Number(current.daily_answers) + 1 : 1;
        const subjectStats = parseJson(current.subject_stats_json, {});
        const stats = subjectStats[question.subject] || { answers: 0, correct: 0 };
        stats.answers += 1; if (correct) stats.correct += 1; subjectStats[question.subject] = stats;
        const answers = Number(current.answers) + 1, totalCorrect = Number(current.correct) + (correct ? 1 : 0), xp = Number(current.xp) + earned;
        const badges = parseJson(current.badges_json, []);
        for (const [count, label] of [[1, 'Primeiros passos'], [5, 'Curioso incansável'], [10, 'Aprendiz dedicado'], [20, 'Explorador do conhecimento']]) {
          if (answers >= count && !badges.includes(label)) badges.push(label);
        }
        await tx.execute({ sql: 'INSERT INTO question_attempts (user_id, question_id, subject, selected_option, is_correct, xp_earned) VALUES (?, ?, ?, ?, ?, ?)', args: [user.id, question.id, question.subject, choice, correct ? 1 : 0, earned] });
        await tx.execute({ sql: 'UPDATE users SET xp = ?, answers = ?, correct = ?, badges_json = ?, subject_stats_json = ?, daily_date = ?, daily_answers = ? WHERE id = ?', args: [xp, answers, totalCorrect, JSON.stringify(badges), JSON.stringify(subjectStats), today, dailyAnswers, user.id] });
        await tx.commit();
        return send(res, 200, { correct, answer: question.answer, explanation: question.explanation, earned,
          profile: profile(await getUser(db, user.id)),
          missions: { daily: { progress: dailyAnswers, target: 3, complete: dailyAnswers >= 3 }, tenAnswers: { progress: answers, target: 10, complete: answers >= 10 } } });
      } catch (error) { try { await tx.rollback(); } catch {} throw error; }
    }
    if (action === 'leaderboard') {
      const result = await db.execute({ sql: 'SELECT display_name, xp FROM users ORDER BY xp DESC, created_at ASC LIMIT 50' });
      return send(res, 200, { rows: result.rows.map(row => ({ name: row.display_name, xp: Number(row.xp), level: Math.floor(Number(row.xp) / 500) + 1 })) });
    }
    return send(res, 404, { error: 'Ação não encontrada.' });
  } catch (error) {
    const status = error.status || (/UNIQUE|unique constraint/i.test(error.message || '') ? 409 : 500);
    if (status === 500) console.error('BioMatch platform database:', error.message);
    return send(res, status, { error: status === 409 ? (error.status ? error.message : 'Esta ação já foi registrada.') :
      status === 404 ? error.message : status === 503 ? 'Banco de dados indisponível. Tente novamente em instantes.' :
      status === 400 || status === 413 ? error.message : 'Não foi possível acessar os dados da plataforma.' });
  }
}
async function getDatabase() { return database(); }
module.exports = { handlePlatform, handleAuth, getDatabase };
