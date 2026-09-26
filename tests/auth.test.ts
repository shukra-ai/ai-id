import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/shared/database.js';
import { initializeAuthSchema } from '../src/auth/schema.js';
import { PersistentOidcAdapter } from '../src/auth/adapter.js';
import { createLocalAccount, authenticatePassword, claimsForAccount, createFederatedAccount } from '../src/auth/accounts.js';
import { pairwiseSubject } from '../src/auth/security.js';
import { loadFederationProviders } from '../src/auth/federation.js';
import { testConfig } from './helpers.js';

test('Auth: persistent one-use objects, password isolation and federation mappings', { timeout: 180000 }, async t => {
  const config = testConfig(); const db = await createDatabase('auth', config); t.after(() => db.close()); await initializeAuthSchema(db);
  await t.test('authorization codes cannot be consumed twice or resurrected by an update', async () => {
    const adapter = new PersistentOidcAdapter('AuthorizationCode', db);
    await adapter.upsert('code1', { grantId: 'grant1' }, 60); await adapter.consume('code1');
    await assert.rejects(adapter.consume('code1'));
    await adapter.upsert('code1', { grantId: 'grant1' }, 60); assert.ok((await adapter.find('code1'))?.consumed);
    await adapter.revokeByGrantId('grant1'); assert.equal(await adapter.find('code1'), undefined);
  });
  await t.test('same email creates distinct accounts; password requires domain; no false verified email', async () => {
    const input = { domainName: 'Test', name: 'Test operator', email: 'test@example.test', password: 'Not-a-real-secret-1234' };
    const one = await createLocalAccount(db, input); const two = await createLocalAccount(db, input);
    assert.notEqual(one.id, two.id); assert.notEqual(one.domain_id, two.domain_id);
    assert.equal((await authenticatePassword(db, one.domain_id, input.email, input.password))?.id, one.id);
    assert.equal(await authenticatePassword(db, one.domain_id, input.email, 'incorrect'), undefined);
    assert.equal(claimsForAccount(one).email_verified, false);
    const fed = await createFederatedAccount(db, { providerId: 'test', issuer: 'https://id.example', subject: 'sub1', email: input.email });
    assert.notEqual(fed.id, one.id);
    const again = await createFederatedAccount(db, { providerId: 'test', issuer: 'https://id.example', subject: 'sub1', email: 'different@example.test' });
    assert.equal(fed.id, again.id);
  });
  await t.test('pairwise subjects are stable within a sector and different across sectors', () => {
    assert.equal(pairwiseSubject('secret', 'one', 'a'), pairwiseSubject('secret', 'one', 'a'));
    assert.notEqual(pairwiseSubject('secret', 'one', 'a'), pairwiseSubject('secret', 'two', 'a'));
  });
  await t.test('federation allowlist rejects unsafe issuers and preserves exact issuer', () => {
    const provider = { id: 'test', issuer: 'https://issuer.example/', clientId: 'a', clientSecret: 'b' };
    assert.equal(loadFederationProviders(false, JSON.stringify([provider]))[0]!.issuer, provider.issuer);
    assert.throws(() => loadFederationProviders(false, JSON.stringify([{ ...provider, issuer: 'http://169.254.169.254/' }])));
    assert.throws(() => loadFederationProviders(false, JSON.stringify([provider, provider])));
  });
});
