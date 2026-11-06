'use strict';
const assert = require('node:assert/strict');
const { migrateFirebaseUsers } = require('../scripts/migrate-firebase-auth');

const legacy = { id: 42, email: 'legacy@example.test', display_name: 'Legacy', password_hash: `${'a'.repeat(32)}:${'b'.repeat(128)}`, firebase_migrated: 0 };
const rows = [legacy];
const statements = [];
const db = {
  async execute() { return { rows: rows.filter(row => row.password_hash && row.firebase_migrated === 0) }; },
  async batch(items) {
    statements.push(...items);
    for (const item of items) {
      if (item.sql.startsWith('UPDATE users SET firebase_migrated')) rows[0].firebase_migrated = 1;
      if (item.sql.startsWith('UPDATE users SET password_hash')) rows[0].password_hash = null;
    }
  }
};
const users = new Map();
const auth = {
  async getUser(uid) { const user = users.get(uid); if (!user) { const error = new Error('missing'); error.code = 'auth/user-not-found'; throw error; } return user; },
  async importUsers(records, options) {
    assert.equal(options.hash.algorithm, 'STANDARD_SCRYPT');
    for (const record of records) users.set(record.uid, { uid: record.uid, email: record.email });
    return { errors: [] };
  }
};

(async () => {
  const result = await migrateFirebaseUsers({ db, auth });
  assert.deepEqual(result, { imported: 1, alreadyPresent: 0, migrated: 1 });
  assert.equal(rows[0].firebase_migrated, 1);
  assert.ok(rows[0].password_hash, 'legacy password hash must remain available for rollback');
  assert.equal((await migrateFirebaseUsers({ db, auth })).migrated, 0, 'startup migration is idempotent');
  await migrateFirebaseUsers({ db, auth, finalize: true });
  assert.equal(rows[0].password_hash, null, 'explicit finalization can remove verified legacy hashes');
  assert.ok(statements.some(item => item.sql.startsWith('DELETE FROM auth_sessions')));
  console.log('Firebase migration tests passed: import, verification, idempotency, rollback hash preservation, explicit finalization.');
})().catch(error => { console.error(error); process.exitCode = 1; });
