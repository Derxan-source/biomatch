'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@libsql/client');
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
      if (!names.has('google_sub')) await client.execute('ALTER TABLE users ADD COLUMN google_sub TEXT');
      await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL');
      await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL');
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
async function findTarget(db, name, selfId) {
  const result = await db.execute({ sql: 'SELECT id, display_name FROM users WHERE display_name = ? COLLATE NOCASE AND id <> ? ORDER BY created_at DESC LIMIT 2', args: [name, selfId] });
  if (result.rows.length > 1) { const error = new Error('Há mais de um visitante com esse apelido. Peça um apelido diferente.'); error.status = 409; throw error; }
  if (!result.rows.length) { const error = new Error('Não encontramos esse visitante. Confira o apelido e tente novamente.'); error.status = 404; throw error; }
  return result.rows[0];
}
async function snapshot(db, user) {
  const id = user.id;
  const [friendRows, messageRows, challengeRows] = await Promise.all([
    db.execute({ sql: 'SELECT f.requester_id, f.addressee_id, f.status, u.id AS peer_id, u.display_name AS peer_name FROM friendships f JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END WHERE f.requester_id = ? OR f.addressee_id = ? ORDER BY f.created_at DESC', args: [id, id, id] }),
    db.execute({ sql: 'SELECT m.sender_id, m.body, sender.display_name AS sender_name, recipient.display_name AS recipient_name FROM direct_messages m JOIN users sender ON sender.id = m.sender_id JOIN users recipient ON recipient.id = m.recipient_id WHERE m.sender_id = ? OR m.recipient_id = ? ORDER BY m.created_at DESC LIMIT 50', args: [id, id] }),
    db.execute({ sql: 'SELECT c.challenger_id, c.status, challenger.display_name AS challenger_name, challenged.display_name AS challenged_name FROM challenges c JOIN users challenger ON challenger.id = c.challenger_id JOIN users challenged ON challenged.id = c.challenged_id WHERE c.challenger_id = ? OR c.challenged_id = ? ORDER BY c.created_at DESC LIMIT 50', args: [id, id] })
  ]);
  return {
    profile: profile(user),
    friends: friendRows.rows.map(row => ({ id: row.peer_id, name: row.peer_name, status: row.status === 'accepted' ? 'Amigos' : row.requester_id === id ? 'Convite enviado' : 'Convite recebido' })),
    messages: messageRows.rows.map(row => ({ from: row.sender_id === id ? 'Você → ' + row.recipient_name : row.sender_name, text: row.body })),
    challenges: challengeRows.rows.map(row => ({ from: row.challenger_id === id ? 'Você → ' + row.challenged_name : row.challenger_name, status: row.status === 'pending' ? (row.challenger_id === id ? 'Enviado' : 'Recebido') : row.status }))
  };
}
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function passwordHash(password, salt) { return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key.toString('hex')))); }
function requestIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',').map(value => value.trim()).filter(Boolean).at(-1);
  return forwarded || req.socket?.remoteAddress || 'unknown';
}
async function authRateLimited(db, key, max, windowMs) {
  const now = Date.now(), keyHash = hashToken(key), start = now - windowMs;
  const result = await db.execute({
    sql: `INSERT INTO auth_rate_limits (key_hash, window_start, hit_count) VALUES (?, ?, 1)
      ON CONFLICT(key_hash) DO UPDATE SET
        hit_count = CASE WHEN auth_rate_limits.window_start <= ? THEN 1 ELSE auth_rate_limits.hit_count + 1 END,
        window_start = CASE WHEN auth_rate_limits.window_start <= ? THEN ? ELSE auth_rate_limits.window_start END
      RETURNING hit_count`,
    args: [keyHash, now, start, start, now]
  });
  return Number(result.rows[0]?.hit_count || 0) > max;
}
function validEmail(value) { return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function appBaseUrl() {
  const value = process.env.APP_BASE_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
  if (!value) throw new Error('APP_BASE_URL não configurada.');
  const url = new URL(value);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('APP_BASE_URL precisa usar HTTPS em produção.');
  return url.origin;
}
function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID || '707380459534-7kte22tun22b9h18c296kfsiued2v0nh.apps.googleusercontent.com';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || new URL('/auth/google/callback', appBaseUrl()).href;
  if (!clientSecret) throw new Error('Google OAuth não configurado no servidor.');
  return { clientId, clientSecret, redirectUri };
}
function redirect(res, url) { res.writeHead(302, { location: url, 'cache-control': 'no-store' }); res.end(); }
async function handleGoogleStart(req, res) {
  try {
    const db = await database();
    if (await authRateLimited(db, 'oauth-start:' + requestIp(req), 10, 15 * 60 * 1000)) return send(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos.' });
    const { clientId, redirectUri } = googleConfig();
    const state = crypto.randomBytes(32).toString('base64url'), verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    await db.execute({ sql: 'INSERT INTO auth_oauth_states (state_hash, verifier, expires_at) VALUES (?, ?, ?)', args: [hashToken(state), verifier, Date.now() + 10 * 60 * 1000] });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [key, value] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' })) url.searchParams.set(key, value);
    return redirect(res, url.href);
  } catch (error) {
    console.error('BioMatch Google OAuth start:', error.message);
    return send(res, 503, { error: 'O login com Google não está configurado.' });
  }
}
async function handleGoogleCallback(req, res) {
  const base = (() => { try { return appBaseUrl(); } catch { return 'https://biomatch-oyxn.onrender.com'; } })();
  const fail = () => redirect(res, base + '/?oauth_error=1');
  try {
    const params = new URL(req.url, base).searchParams, state = params.get('state'), code = params.get('code');
    if (!state || !code || params.has('error')) return fail();
    const db = await database(), stateHash = hashToken(state), tx = await db.transaction('write');
    let saved;
    try {
      const row = await tx.execute({ sql: 'SELECT verifier, expires_at FROM auth_oauth_states WHERE state_hash = ?', args: [stateHash] });
      saved = row.rows[0];
      await tx.execute({ sql: 'DELETE FROM auth_oauth_states WHERE state_hash = ?', args: [stateHash] });
      await tx.commit();
    } catch (error) { try { await tx.rollback(); } catch {} throw error; }
    if (!saved || Number(saved.expires_at) < Date.now()) return fail();
    const { clientId, clientSecret, redirectUri } = googleConfig();
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: saved.verifier }) });
    if (!tokenResponse.ok) return fail();
    const tokenData = await tokenResponse.json();
    if (typeof tokenData.id_token !== 'string') return fail();
    const verifyResponse = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tokenData.id_token));
    if (!verifyResponse.ok) return fail();
    const identity = await verifyResponse.json();
    if (identity.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(identity.iss) || Number(identity.exp) * 1000 <= Date.now() || identity.email_verified !== 'true' || !validEmail(identity.email) || !identity.sub) return fail();
    let userResult = await db.execute({ sql: 'SELECT * FROM users WHERE google_sub = ?', args: [identity.sub] });
    let user = userResult.rows[0];
    if (!user) {
      userResult = await db.execute({ sql: 'SELECT * FROM users WHERE email = ? COLLATE NOCASE', args: [identity.email.toLowerCase()] });
      user = userResult.rows[0];
      if (user) await db.execute({ sql: 'UPDATE users SET google_sub = ? WHERE id = ?', args: [identity.sub, user.id] });
      else {
        let name = cleanName(identity.name || identity.given_name || identity.email.split('@')[0]);
        if (name.length < 2) name = 'Estudante';
        const id = crypto.randomUUID();
        await db.execute({ sql: 'INSERT INTO users (id, display_name, email, google_sub) VALUES (?, ?, ?, ?)', args: [id, name, identity.email.toLowerCase(), identity.sub] });
        user = await getUser(db, id);
      }
    }
    const exchange = crypto.randomBytes(32).toString('base64url');
    await db.execute({ sql: 'INSERT INTO auth_oauth_exchanges (code_hash, user_id, expires_at) VALUES (?, ?, ?)', args: [hashToken(exchange), user.id, Date.now() + 60 * 1000] });
    return redirect(res, base + '/?oauth_code=' + encodeURIComponent(exchange));
  } catch (error) { console.error('BioMatch Google OAuth callback:', error.message); return fail(); }
}
async function sendPasswordReset(email, token) {
  const apiKey = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) throw new Error('Resend não está configurado no servidor.');
  const url = new URL('/', appBaseUrl()); url.searchParams.set('reset', token);
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' }, body: JSON.stringify({ from, to: [email], subject: 'Redefina sua senha do BioMatch', text: `Recebemos uma solicitação para redefinir a senha da sua conta BioMatch. Acesse este link em até 30 minutos e use-o uma única vez:\n\n${url.href}\n\nSe você não pediu essa alteração, ignore este e-mail.` }) });
  if (!response.ok) throw new Error('Resend recusou o envio do e-mail de recuperação.');
}
async function handleAuth(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'Método não permitido.' });
    const body = await readBody(req), db = await database(), action = body.action;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (['register', 'login', 'request_password_reset'].includes(action) && await authRateLimited(db, action + ':ip:' + requestIp(req), action === 'login' ? 20 : 8, 15 * 60 * 1000)) return send(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
    if (action === 'register') {
      const name = cleanName(body.name), password = typeof body.password === 'string' ? body.password : '';
      if (name.length < 2) return send(res, 400, { error: 'Informe um nome com pelo menos 2 caracteres.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return send(res, 400, { error: 'Informe um e-mail válido.' });
      if (password.length < 8 || password.length > 128) return send(res, 400, { error: 'A senha precisa ter entre 8 e 128 caracteres.' });
      const exists = await db.execute({ sql: 'SELECT id FROM users WHERE email = ? COLLATE NOCASE', args: [email] });
      if (exists.rows.length) return send(res, 409, { error: 'Este e-mail já possui uma conta. Entre ou use outro e-mail.' });
      const salt = crypto.randomBytes(16).toString('hex'), digest = await passwordHash(password, salt), id = crypto.randomUUID(), token = crypto.randomBytes(32).toString('base64url');
      await db.execute({ sql: 'INSERT INTO users (id, display_name, email, password_hash) VALUES (?, ?, ?, ?)', args: [id, name, email, salt + ':' + digest] });
      await db.execute({ sql: 'INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', args: [hashToken(token), id, Date.now() + 30 * 24 * 60 * 60 * 1000] });
      return send(res, 201, { token, user: profile(await getUser(db, id)) });
    }
    if (action === 'login') {
      const password = typeof body.password === 'string' ? body.password : '';
      const result = await db.execute({ sql: 'SELECT * FROM users WHERE email = ? COLLATE NOCASE', args: [email] }), user = result.rows[0], stored = user && user.password_hash;
      if (!stored || !stored.includes(':')) return send(res, 401, { error: 'E-mail ou senha incorretos.' });
      const [salt, expected] = stored.split(':'), actual = await passwordHash(password, salt);
      if (!crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))) return send(res, 401, { error: 'E-mail ou senha incorretos.' });
      const token = crypto.randomBytes(32).toString('base64url');
      await db.execute({ sql: 'INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', args: [hashToken(token), user.id, Date.now() + 30 * 24 * 60 * 60 * 1000] });
      return send(res, 200, { token, user: profile(user) });
    }
    if (action === 'logout') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (token) await db.execute({ sql: 'DELETE FROM auth_sessions WHERE token_hash = ?', args: [hashToken(token)] });
      return send(res, 200, { ok: true });
    }
    if (action === 'oauth_exchange') {
      const code = typeof body.code === 'string' ? body.code : '';
      if (!code || code.length > 100) return send(res, 400, { error: 'Código de autenticação inválido.' });
      const tx = await db.transaction('write');
      try {
        const result = await tx.execute({ sql: 'SELECT user_id, expires_at FROM auth_oauth_exchanges WHERE code_hash = ?', args: [hashToken(code)] });
        const exchange = result.rows[0];
        await tx.execute({ sql: 'DELETE FROM auth_oauth_exchanges WHERE code_hash = ?', args: [hashToken(code)] });
        if (!exchange || Number(exchange.expires_at) < Date.now()) { await tx.commit(); return send(res, 401, { error: 'A sessão do Google expirou. Tente novamente.' }); }
        const token = crypto.randomBytes(32).toString('base64url');
        await tx.execute({ sql: 'INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', args: [hashToken(token), exchange.user_id, Date.now() + 30 * 24 * 60 * 60 * 1000] });
        await tx.commit();
        return send(res, 200, { token, user: profile(await getUser(db, exchange.user_id)) });
      } catch (error) { try { await tx.rollback(); } catch {} throw error; }
    }
    if (action === 'request_password_reset') {
      const generic = { ok: true, message: 'Se houver uma conta para esse e-mail, enviaremos as instruções de recuperação.' };
      if (!validEmail(email)) return send(res, 200, generic);
      if (await authRateLimited(db, 'password-reset:email:' + email, 3, 60 * 60 * 1000)) return send(res, 200, generic);
      const result = await db.execute({ sql: 'SELECT id, email FROM users WHERE email = ? COLLATE NOCASE', args: [email] }), user = result.rows[0];
      if (user) {
        const token = crypto.randomBytes(32).toString('base64url');
        await db.execute({ sql: 'DELETE FROM password_reset_tokens WHERE user_id = ?', args: [user.id] });
        await db.execute({ sql: 'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)', args: [hashToken(token), user.id, Date.now() + 30 * 60 * 1000] });
        try { await sendPasswordReset(user.email, token); }
        catch (error) { console.error('BioMatch password reset email:', error.message); }
      }
      return send(res, 200, generic);
    }
    if (action === 'reset_password') {
      const token = typeof body.token === 'string' ? body.token : '', password = typeof body.password === 'string' ? body.password : '';
      if (password.length < 8 || password.length > 128) return send(res, 400, { error: 'A senha precisa ter entre 8 e 128 caracteres.' });
      if (token.length < 32 || token.length > 100) return send(res, 400, { error: 'Este link de redefinição é inválido ou expirou.' });
      const salt = crypto.randomBytes(16).toString('hex'), digest = await passwordHash(password, salt), tx = await db.transaction('write');
      try {
        const found = await tx.execute({ sql: 'SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ?', args: [hashToken(token), Date.now()] });
        const reset = found.rows[0];
        if (!reset) { await tx.rollback(); return send(res, 400, { error: 'Este link de redefinição é inválido ou expirou.' }); }
        await tx.execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [salt + ':' + digest, reset.user_id] });
        await tx.execute({ sql: 'DELETE FROM password_reset_tokens WHERE user_id = ?', args: [reset.user_id] });
        await tx.execute({ sql: 'DELETE FROM auth_sessions WHERE user_id = ?', args: [reset.user_id] });
        await tx.commit();
        return send(res, 200, { ok: true });
      } catch (error) { try { await tx.rollback(); } catch {} throw error; }
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
      const auth = await db.execute({ sql: 'SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?', args: [hashToken(bearer[1]), Date.now()] });
      user = auth.rows[0] || null;
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
    if (action === 'friend' || action === 'message' || action === 'challenge') {
      const targetName = cleanName(action === 'friend' ? body.name : body.to);
      if (targetName.length < 2) return send(res, 400, { error: 'Informe um apelido válido.' });
      const target = await findTarget(db, targetName, user.id);
      if (action === 'friend') {
        await db.execute({ sql: 'INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, ?)', args: [user.id, target.id, 'pending'] });
        return send(res, 201, { ok: true });
      }
      if (action === 'message') {
        const message = typeof body.text === 'string' ? body.text.trim().slice(0, 240) : '';
        if (!message) return send(res, 400, { error: 'Escreva uma mensagem.' });
        await db.execute({ sql: 'INSERT INTO direct_messages (sender_id, recipient_id, body) VALUES (?, ?, ?)', args: [user.id, target.id, message] });
        return send(res, 201, { ok: true });
      }
      await db.execute({ sql: 'INSERT INTO challenges (challenger_id, challenged_id, status) VALUES (?, ?, ?)', args: [user.id, target.id, 'pending'] });
      return send(res, 201, { ok: true });
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
module.exports = { handlePlatform, handleAuth, handleGoogleStart, handleGoogleCallback, getDatabase };
