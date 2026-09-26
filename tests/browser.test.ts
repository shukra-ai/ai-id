import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import express from 'express';
import Provider from 'oidc-provider';
import { buildAuth } from '../src/auth/server.js';
import { buildCore } from '../src/core/server.js';
import { buildWitness } from '../src/witness/server.js';
import { publishPending, compareWitness } from '../src/core/witness.js';
import { loadDevelopmentJwks } from '../src/auth/keys.js';
import { testConfig } from './helpers.js';
import { createAIIDClient } from '../src/sdk/index.js';
import { unseal } from '../src/shared/crypto.js';

test('Browser integration: OIDC, PKCE, session, passkey, SDK, federation, witness', { timeout: 240000 }, async t => {
  const config = testConfig(4410);
  const upstreamIssuer = 'http://localhost:4413';
  const upstream = new Provider(upstreamIssuer, {
    jwks: await loadDevelopmentJwks({ ...config, dataDir: join(config.dataDir, 'upstream') }),
    clients: [{ client_id: 'test-broker', client_secret: config.internalAuthSecret, redirect_uris: [config.issuer + '/federation/test/callback'], response_types: ['code'], grant_types: ['authorization_code'], token_endpoint_auth_method: 'client_secret_basic' }],
    features: { devInteractions: { enabled: false } },
    interactions: { url: (_ctx, current) => `/interaction/${current.uid}` },
    claims: { openid: ['sub'], profile: ['name'], email: ['email', 'email_verified'] },
    findAccount: async (_ctx, id) => ({ accountId: id, claims: async () => ({ sub: id, name: 'Federated Tester', email: 'local@example.test', email_verified: true }) }),
    cookies: { keys: [config.internalAuthSecret] },
  });
  const upstreamApp = express();
  upstreamApp.get('/interaction/:uid', async (req, res) => {
    const current = await upstream.interactionDetails(req, res);
    if (current.prompt.name === 'login') await upstream.interactionFinished(req, res, { login: { accountId: 'upstream-user' } }, { mergeWithLastSubmission: false });
    else {
      const grant = new upstream.Grant({ accountId: 'upstream-user', clientId: 'test-broker' }); grant.addOIDCScope('openid profile email');
      await upstream.interactionFinished(req, res, { consent: { grantId: await grant.save() } }, { mergeWithLastSubmission: true });
    }
  });
  upstreamApp.use(upstream.callback());
  const upstreamServer = upstreamApp.listen(4413, '127.0.0.1');
  t.after(() => new Promise<void>(resolve => { upstreamServer.closeAllConnections(); upstreamServer.close(() => resolve()); }));
  process.env.AIID_FEDERATED_OIDC_PROVIDERS = JSON.stringify([{ id: 'test', label: 'Test IdP', issuer: upstreamIssuer, clientId: 'test-broker', clientSecret: config.internalAuthSecret }]);
  const auth = await buildAuth(config); delete process.env.AIID_FEDERATED_OIDC_PROVIDERS;
  const authServer = auth.app.listen(4411, '127.0.0.1');
  t.after(async () => { await new Promise<void>(resolve => { authServer.closeAllConnections(); authServer.close(() => resolve()); }); await auth.db.close(); });
  const core = await buildCore(config, { logger: false }); t.after(() => core.app.close());
  const witness = await buildWitness(config); t.after(() => witness.app.close());
  await Promise.all([core.app.listen({ host: '127.0.0.1', port: 4410 }), witness.app.listen({ host: '127.0.0.1', port: 4412 })]);
  const browser = await chromium.launch({ channel: process.env.AIID_BROWSER_CHANNEL || 'chrome', headless: true }); t.after(() => browser.close());
  const context = await browser.newContext(); const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('response', async response => { if(response.status()>=400)console.log('HTTP failure',response.status(),new URL(response.url()).pathname,(await response.text()).slice(0,400)); });
  const failures: string[] = []; page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => {if(message.type()==='error')console.log('Browser:',message.text().slice(0,300));});
  const cdp = await context.newCDPSession(page); await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  let me: { domain_id: string; principal_id: string; entity_id: string; csrf_token: string };
  const headers = () => ({ Origin: config.coreOrigin, 'X-CSRF-Token': me.csrf_token, 'Idempotency-Key': randomUUID() });
  await t.test('register, consent and real authorization code callback create an authenticated console', async () => {
    await page.goto(config.coreOrigin); await page.locator('#login-link').click();
    await page.getByRole('link', { name: 'Créer un nouveau domaine' }).click();
    await page.getByLabel('Nom du domaine').fill('Browser test domain'); await page.getByLabel('Votre nom').fill('Local Tester');
    await page.getByLabel('Email').fill('local@example.test'); await page.getByLabel('Mot de passe').fill('Local-test-password-1234');
    await page.getByRole('button', { name: 'Créer le domaine' }).click();
    await page.getByRole('button', { name: 'Autoriser', exact: true }).click();
    await page.locator('#app-shell').waitFor({ state: 'visible', timeout: 15000 });
    const response = await context.request.get(config.coreOrigin + '/api/me'); assert.equal(response.status(), 200, await response.text()); me = await response.json();
    assert.equal(failures.length, 0, failures.join('\n'));
  });
  if(!me!)throw new Error('Registration failed; later steps require an authenticated console.');
  await t.test('CSRF and wrong host are refused; refresh is serialized across simultaneous browser reads', async () => {
    const denied = await context.request.post(config.coreOrigin + '/v1/entities', { data: { kind: 'agent', display_name: 'No' } }); assert.equal(denied.status(), 403);
    assert.equal((await core.app.inject({ url: '/healthz', headers: { host: 'attacker.invalid' } })).statusCode, 400);
    const row = (await core.db.query<{ hash: string; tokens: string }>('SELECT hash,tokens FROM core_sessions LIMIT 1')).rows[0]!;
    const tokens = unseal<{ refresh_token?: string }>(row.tokens, config.cookieSecret); assert.ok(tokens.refresh_token, 'Refresh token issued');
    // Advance only the local refresh threshold, not the actual issuer clock.
    const { seal } = await import('../src/shared/crypto.js');
    await core.db.query('UPDATE core_sessions SET tokens=$2 WHERE hash=$1', [row.hash, seal({ ...unseal<object>(row.tokens, config.cookieSecret), expires_at: 0 }, config.cookieSecret)]);
    const responses = await Promise.all([context.request.get(config.coreOrigin + '/api/me'), context.request.get(config.coreOrigin + '/api/me')]);
    for (const response of responses) assert.equal(response.status(), 200, await response.text());
  });
  await t.test('real WebAuthn enrollment in virtual authenticator', async () => {
    await page.goto(config.issuer + '/passkeys/enroll');
    const submissionPromise=page.waitForRequest(request=>request.method()==='POST'&&request.url().endsWith('/passkeys/registration/verify'));
    await page.getByRole('button', { name: 'Créer la passkey' }).click();
    await page.getByText('Passkey enregistrée.', { exact: true }).waitFor({ timeout: 15000 });
    assert.equal((await auth.db.query('SELECT credential_id FROM auth_passkeys')).rows.length, 1);
    const submission=await submissionPromise;
    const replay=await context.request.post(submission.url(),{headers:{Origin:config.issuer,'X-CSRF-Token':submission.headers()['x-csrf-token']!},data:submission.postDataJSON()});
    assert.equal(replay.status(),400,'Used WebAuthn challenge must not be accepted twice');
  });
  let principal: { id: string }, agent: { id: string };
  await t.test('dashboard form, actual API key and SDK execute a delegated call, then revocation denies', async () => {
    await page.goto(config.coreOrigin); await page.locator('[data-view="identities"]').click(); await page.locator('#toggle-entity-form').click();
    await page.locator('#entity-form [name="kind"]').selectOption('agent'); await page.locator('#entity-form [name="display_name"]').fill('Browser Agent');
    await page.locator('#entity-form button[type="submit"]').click(); await page.getByText('Browser Agent', { exact: true }).first().waitFor();
    const entities = await (await context.request.get(config.coreOrigin + '/v1/entities')).json(); agent = entities.data.find((v: { display_name: string }) => v.display_name === 'Browser Agent'); assert.ok(agent);
    const created = await context.request.post(config.coreOrigin + `/v1/entities/${agent.id}/principals`, { headers: headers(), data: { custody: 'workload-custodial' } }); assert.equal(created.status(), 201, await created.text()); principal = await created.json();
    for (const subject_id of [me.principal_id, principal.id]) {
      const response = await context.request.post(config.coreOrigin + '/v1/relationships', { headers: headers(), data: { subject_id, resource: 'tool:demo', action: 'execute' } }); assert.equal(response.status(), 201, await response.text());
    }
    const delegation = await (await context.request.post(config.coreOrigin + '/v1/delegations', { headers: headers(), data: { delegate_principal_id: principal.id, resource: 'tool:demo', action: 'execute', ttl_seconds: 300 } })).json();
    const issued = await (await context.request.post(config.coreOrigin + '/v1/api-keys', { headers: headers(), data: { principal_id: principal.id, name: 'Browser SDK', ttl_seconds: 60 } })).json();
    const client = createAIIDClient({ baseUrl: config.coreOrigin, token: issued.secret });
    assert.equal((await client.getMe()).principal_id, principal.id);
    const result = await client.request<{ output: string }>('/v1/tool-executions', { method: 'POST', body: { delegation_id: delegation.id, input: 'verified integration' }, idempotencyKey: randomUUID() }); assert.equal(result.output, 'VERIFIED INTEGRATION');
    const denied = await context.request.post(config.coreOrigin + `/v1/delegations/${delegation.id}/revoke`, { headers: headers(), data: {} }); assert.equal(denied.status(), 200);
    await assert.rejects(client.request('/v1/tool-executions', { method: 'POST', body: { delegation_id: delegation.id, input: 'denied' }, idempotencyKey: randomUUID() }), { status: 403 });
    await context.request.delete(config.coreOrigin + `/v1/api-keys/${issued.id}`, { headers: headers() });
    await assert.rejects(client.getMe(), { status: 401 });
    await page.screenshot({ path: join(config.dataDir, 'console.png'), fullPage: true });
  });
  await t.test('independent checkpoint rejects forks and detects tail truncation', async () => {
    await publishPending(core.db, config); const checked = await compareWitness(core.db, config, me.domain_id); assert.equal(checked.status, 'consistent');
    const checkpoint = checked.checkpoint!;
    const row = (await core.db.query<Record<string, unknown>>('SELECT * FROM core_audit WHERE domain_id=$1 AND sequence=$2', [me.domain_id, checkpoint.sequence])).rows[0]!;
    const rejected = await fetch(config.witnessOrigin + '/internal/checkpoints', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.witnessSecret }, body: JSON.stringify({ ...row, sequence: Number(row.sequence), action: 'tampered' }) }); assert.equal(rejected.status, 409);
    await core.db.transaction(async tx => { await tx.query('DELETE FROM core_outbox WHERE event_id=$1', [row.id]); await tx.query('DELETE FROM core_audit WHERE id=$1', [row.id]); });
    assert.equal((await compareWitness(core.db, config, me.domain_id)).status, 'diverged');
    // Restore the test event so later session tests do not create an artificial fork.
    await core.db.query('INSERT INTO core_audit(id,domain_id,sequence,actor_id,action,resource_id,request_id,occurred_at,previous_hash,hash,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [row.id,row.domain_id,row.sequence,row.actor_id,row.action,row.resource_id,row.request_id,row.occurred_at,row.previous_hash,row.hash,JSON.stringify(row.data)]);
  });
  await t.test('logout revokes session and passkey authenticates a new OIDC login', async () => {
    const sessions=await (await context.request.get(config.coreOrigin+'/v1/sessions')).json();
    assert.equal(sessions.data.length,1);assert.equal(sessions.data[0].tokens,undefined);assert.equal(sessions.data[0].hash,undefined);
    const response = await context.request.post(config.coreOrigin + '/auth/logout', { headers: headers(), data: {} }); assert.equal(response.status(), 200, await response.text());
    assert.equal((await context.request.get(config.coreOrigin + '/api/me')).status(), 401);
    await page.goto((await response.json()).redirect); await page.getByRole('button', { name: 'Confirmer la déconnexion' }).click();
    await page.waitForURL(config.coreOrigin + '/'); await page.locator('#login-link').click();
    await page.getByRole('button', { name: 'Utiliser une passkey' }).click();
    await page.getByRole('button', { name: 'Autoriser', exact: true }).click(); await page.locator('#app-shell').waitFor({ state: 'visible' });
    const current = await (await context.request.get(config.coreOrigin + '/api/me')).json(); assert.equal(current.domain_id, me.domain_id);
  });
  await t.test('real upstream OIDC federation creates a distinct domain despite matching email', async () => {
    const second = await browser.newContext(); const tab = await second.newPage();
    try {
      await tab.goto(config.coreOrigin + '/auth/login'); await tab.getByRole('link', { name: 'Continuer avec Test IdP' }).click();
      await tab.getByRole('button', { name: 'Autoriser', exact: true }).click(); await tab.locator('#app-shell').waitFor({ state: 'visible' });
      const federated = await (await second.request.get(config.coreOrigin + '/api/me')).json(); assert.notEqual(federated.domain_id, me.domain_id);
      assert.equal((await auth.db.query('SELECT id FROM auth_federated_identities')).rows.length, 1);
    } finally { await second.close(); }
  });
  await t.test('session management revokes an opaque session identifier immediately',async()=>{
    const current=await(await context.request.get(config.coreOrigin+'/api/me')).json();
    const sessions=await(await context.request.get(config.coreOrigin+'/v1/sessions')).json();
    const response=await context.request.delete(config.coreOrigin+'/v1/sessions/'+sessions.data[0].id,{headers:{...headers(),'X-CSRF-Token':current.csrf_token}});
    assert.equal(response.status(),200,await response.text());
    assert.equal((await context.request.get(config.coreOrigin+'/api/me')).status(),401);
  });
  assert.deepEqual(failures, []);
  console.log(`Browser artifacts: ${config.dataDir}`);
});
