'use strict';
// Import legacy BioMatch accounts into Firebase Auth without exporting plaintext passwords.
// Run only after setting TURSO_DATABASE_URL, TURSO_AUTH_TOKEN,
// FIREBASE_PROJECT_ID, and FIREBASE_SERVICE_ACCOUNT_JSON.
const { createClient } = require('@libsql/client');
const { getFirebaseAuth } = require('../firebase-auth');

async function migrateFirebaseUsers({ db, auth, finalize = false }) {
  const result = await db.execute('SELECT id, email, display_name, password_hash FROM users WHERE email IS NOT NULL AND password_hash IS NOT NULL AND firebase_migrated = 0 ORDER BY id');
  const records = result.rows.map(row => {
    const parts = String(row.password_hash).split(':');
    if (parts.length !== 2 || !/^[a-f\d]{32}$/i.test(parts[0]) || !/^[a-f\d]{128}$/i.test(parts[1])) {
      throw new Error(`Hash antigo inválido para o perfil ${row.id}; nenhuma conta foi limpa.`);
    }
    return {
      uid: String(row.id), email: String(row.email).trim().toLowerCase(),
      displayName: String(row.display_name),
      // Legacy code passed the hex salt as a UTF-8 string to crypto.scrypt.
      passwordSalt: Buffer.from(parts[0], 'utf8'),
      passwordHash: Buffer.from(parts[1], 'hex')
    };
  });
  if (!records.length) {
    if (finalize) await db.batch([
      { sql: 'UPDATE users SET password_hash = NULL WHERE firebase_migrated = 1', args: [] },
      { sql: 'DELETE FROM auth_sessions', args: [] },
      { sql: 'DELETE FROM password_reset_tokens', args: [] }
    ], 'write');
    return { imported: 0, alreadyPresent: 0, migrated: 0 };
  }

  let imported = 0, alreadyPresent = 0;
  for (let offset = 0; offset < records.length; offset += 1000) {
    const batch = records.slice(offset, offset + 1000), pending = [];
    for (const record of batch) {
      try {
        const current = await auth.getUser(record.uid);
        if (current.email?.toLowerCase() !== record.email) throw new Error(`UID ${record.uid} já existe no Firebase com outro email.`);
        alreadyPresent++;
      } catch (error) {
        if (error.code !== 'auth/user-not-found') throw error;
        pending.push(record);
      }
    }
    if (pending.length) {
      const outcome = await auth.importUsers(pending, { hash: {
        algorithm: 'STANDARD_SCRYPT', memoryCost: 16384, parallelization: 1,
        blockSize: 8, derivedKeyLength: 64
      } });
      if (outcome.errors.length) {
        const summary = outcome.errors.map(item => `${item.index}:${item.error?.code || 'erro'}`).join(', ');
        throw new Error(`Firebase recusou ${outcome.errors.length} conta(s) no lote (${summary}). Senhas legadas não foram apagadas; corrija e rode novamente.`);
      }
      imported += pending.length;
    }
  }

  // Verify each UID and email exists before removing the legacy password hashes.
  for (const record of records) {
    const current = await auth.getUser(record.uid);
    if (current.email?.toLowerCase() !== record.email) throw new Error(`Verificação falhou para ${record.uid}; hashes legados foram preservados.`);
  }
  await db.batch(records.map(record => ({
    sql: 'UPDATE users SET firebase_migrated = 1 WHERE id = ? AND password_hash IS NOT NULL', args: [record.uid]
  })), 'write');
  if (finalize) await db.batch([
    { sql: 'UPDATE users SET password_hash = NULL WHERE firebase_migrated = 1', args: [] },
    { sql: 'DELETE FROM auth_sessions', args: [] },
    { sql: 'DELETE FROM password_reset_tokens', args: [] }
  ], 'write');
  return { imported, alreadyPresent, migrated: records.length };
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error('Configure TURSO_DATABASE_URL e TURSO_AUTH_TOKEN.');
  const db = createClient({ url, authToken });
  try {
    const result = await migrateFirebaseUsers({ db, auth: getFirebaseAuth(), finalize: process.argv.includes('--finalize') });
    console.log(`Migração concluída: ${result.imported} importada(s), ${result.alreadyPresent} já existente(s), ${result.migrated} marcada(s).`);
  } finally { await db.close(); }
}

if (require.main === module) main().catch(error => { console.error('Migração Firebase não concluída:', error.message); process.exitCode = 1; });
module.exports = { migrateFirebaseUsers };
