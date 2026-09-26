import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildCore } from '../src/core/server.js';
import { provision, verifyAudit, appendAudit, lockDomain, type Actor } from '../src/core/domain.js';
import { hash } from '../src/shared/crypto.js';
import { testConfig } from './helpers.js';

test('Core: domain isolation, atomic writes, permissions, delegation, audit', { timeout: 180000 }, async t => {
  const config = testConfig();
  let actor: Actor;
  const { app, db } = await buildCore(config, { authenticate: async () => actor });
  t.after(() => app.close());
  const alice = await provision(db, config.issuer, { sub: 'alice', domain_id: randomUUID(), domain_name: 'Alpha', name: 'Alice' });
  const bob = await provision(db, config.issuer, { sub: 'bob', domain_id: randomUUID(), domain_name: 'Beta', name: 'Bob' });
  actor = alice;
  const call = (method: 'GET'|'POST'|'DELETE', url: string, payload?: unknown, key = randomUUID()) => app.inject({ method, url, ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }), headers: { 'content-type': 'application/json', 'idempotency-key': key } });
  let entity: { id: string }, principal: { id: string }, delegation: { id: string };
  await t.test('idempotency returns same result and rejects key reuse with changed body', async () => {
    const key = randomUUID(); const body = { kind: 'agent', display_name: 'Sandbox agent' };
    const first = await call('POST', '/v1/entities', body, key); assert.equal(first.statusCode, 201, first.body); entity = first.json();
    const replay = await call('POST', '/v1/entities', body, key); assert.deepEqual(replay.json(), first.json());
    assert.equal((await call('POST', '/v1/entities', { ...body, display_name: 'Different' }, key)).statusCode, 409);
    const rows = (await db.query('SELECT id FROM core_audit WHERE domain_id=$1 AND action=$2', [alice.domain_id, 'entity.created'])).rows;
    assert.equal(rows.length, 1);
  });
  await t.test('foreign domain cannot list or mutate another domain entity', async () => {
    actor = bob;
    const visible = (await call('GET', '/v1/entities')).json(); assert.ok(!visible.data.some((e: { id: string }) => e.id === entity.id));
    assert.equal((await call('POST', `/v1/entities/${entity.id}/principals`, { custody: 'workload-custodial' })).statusCode, 404);
    assert.equal((await call('POST', `/v1/entities/${entity.id}/disable`, {})).statusCode, 404);
    actor = alice;
  });
  await t.test('principal binding is database-immutable', async () => {
    const created = await call('POST', `/v1/entities/${entity.id}/principals`, { custody: 'workload-custodial' });
    assert.equal(created.statusCode, 201, created.body); principal = created.json();
    await assert.rejects(db.query('UPDATE core_principals SET entity_id=$2 WHERE id=$1', [principal.id, alice.entity_id]), /immutable/);
  });
  await t.test('admin has no implicit tool permission; grants require both participants', async () => {
    const authz = { subject: { type: 'principal', id: alice.principal_id }, resource: { type: 'tool', id: 'demo' }, action: { name: 'execute' } };
    assert.equal((await call('POST', '/v1/authorize', authz)).json().decision, false);
    const body = { delegate_principal_id: principal.id, resource: 'tool:demo', action: 'execute', ttl_seconds: 300 };
    assert.equal((await call('POST', '/v1/delegations', body)).statusCode, 403);
    for (const subject_id of [alice.principal_id, principal.id]) assert.equal((await call('POST', '/v1/relationships', { subject_id, resource: 'tool:demo', action: 'execute' })).statusCode, 201);
    assert.equal((await call('POST', '/v1/delegations', { ...body, parent: randomUUID() })).statusCode, 400);
    const response = await call('POST', '/v1/delegations', body); assert.equal(response.statusCode, 201, response.body); delegation = response.json();
  });
  let agent: Actor;
  await t.test('API keys cannot gain admin rights; delegated tool creates observed evidence', async () => {
    const issued = await call('POST', '/v1/api-keys', { principal_id: principal.id, name: 'test', ttl_seconds: 60 }); assert.equal(issued.statusCode, 201, issued.body);
    agent = { ...alice, role: 'member', principal_id: principal.id, entity_id: entity.id, auth: 'api-key', api_key_hash: hash(issued.json().secret) };
    actor = agent;
    assert.equal((await call('POST', '/v1/entities', { kind: 'agent', display_name: 'No' })).statusCode, 403);
    const response = await call('POST', '/v1/tool-executions', { delegation_id: delegation.id, input: 'hello' });
    assert.equal(response.statusCode, 201, response.body); assert.equal(response.json().output, 'HELLO');
    assert.equal((await call('GET', `/v1/assessments/${entity.id}`)).json().sample_size, 1);
  });
  await t.test('revocation rejects the next distinct execution', async () => {
    actor = alice;
    assert.equal((await call('POST', `/v1/delegations/${delegation.id}/revoke`, {})).statusCode, 200);
    actor = agent;
    assert.equal((await call('POST', '/v1/tool-executions', { delegation_id: delegation.id, input: 'denied' })).statusCode, 403);
    actor = alice;
  });
  await t.test('self-asserted reputation never counts as resource-observed', async () => {
    const evidence = await call('POST', '/v1/evidence', { subject_entity_id: entity.id, context: 'tool.execution.v1', outcome: 'success', reference: 'one' }); assert.equal(evidence.statusCode, 201, evidence.body);
    assert.equal((await call('POST', '/v1/evidence', { subject_entity_id: entity.id, context: 'tool.execution.v1', outcome: 'success', reference: 'one' })).statusCode, 409);
    const assessment = (await call('GET', `/v1/assessments/${entity.id}`)).json();
    assert.equal(assessment.sample_size, 1); assert.equal(assessment.asserted_sample_size, 1); assert.equal(assessment.result.band, 'unknown');
  });
  await t.test('rollback removes audit and outbox together', async () => {
    const before = await verifyAudit(db, alice.domain_id);
    await assert.rejects(db.transaction(async tx => { await lockDomain(tx, alice.domain_id); await appendAudit(tx, alice, 'test.rollback', entity.id, 'test'); throw new Error('rollback'); }));
    assert.deepEqual(await verifyAudit(db, alice.domain_id), before);
    const counts = (await db.query<{ audit: string; outbox: string }>('SELECT (SELECT count(*) FROM core_audit)::text AS audit,(SELECT count(*) FROM core_outbox)::text AS outbox')).rows[0]!;
    assert.equal(counts.audit, counts.outbox);
  });
  await t.test('audit tampering is detected', async () => {
    assert.equal((await verifyAudit(db, alice.domain_id)).valid, true);
    await db.query("UPDATE core_audit SET action='tampered' WHERE domain_id=$1 AND sequence=1", [alice.domain_id]);
    assert.equal((await verifyAudit(db, alice.domain_id)).valid, false);
  });
});
