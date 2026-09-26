import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAIIDClient, ApiError } from '../src/sdk/index.js';
import { openApi } from '../src/core/openapi.js';
import { canonical, seal, unseal } from '../src/shared/crypto.js';
import { loadConfig } from '../src/shared/config.js';

test('SDK preserves idempotency and sends credentials only in headers', async () => {
  const client = createAIIDClient({ baseUrl: 'http://localhost:4100', token: 'test', fetch: async (url, init) => {
    assert.equal(url, 'http://localhost:4100/v1/tool-executions');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test');
    assert.equal(new Headers(init?.headers).get('Idempotency-Key'), 'fixed-key-123');
    assert.equal(init?.redirect, 'error');
    return Response.json({ output: 'OK' }, { status: 201 });
  } });
  assert.equal((await client.executeTool({ delegation_id: 'id', input: 'ok' }, { idempotencyKey: 'fixed-key-123' })).output, 'OK');
  await assert.rejects(client.request('//attacker.invalid'), TypeError);
  assert.throws(() => createAIIDClient({ baseUrl: 'http://public.example', token: 'test' }), TypeError);
});
test('SDK reports structured errors with request id, never raw HTML', async () => {
  const client = createAIIDClient({ baseUrl: 'https://api.example', token: 'test', fetch: async () => Response.json({ type:'urn:test',title:'forbidden',status:403,detail:'No permission' }, { status:403,headers:{'X-Request-ID':'test-request'} }) });
  await assert.rejects(client.getMe(), error => error instanceof ApiError && error.status===403 && error.requestId==='test-request' && error.message==='No permission');
});
test('SDK session mode uses same-origin cookies and CSRF, no workload key', async () => {
  const client=createAIIDClient({baseUrl:'http://localhost:4100',csrfToken:'csrf',fetch:async (_url,init)=>{
    assert.equal(init?.credentials,'same-origin');assert.equal(new Headers(init?.headers).get('X-CSRF-Token'),'csrf');assert.equal(new Headers(init?.headers).get('Authorization'),null);return Response.json({});
  }});
  await client.createEntity({kind:'agent',display_name:'Test'},{idempotencyKey:'fixed-key-123'});
});
test('OpenAPI exposes executed request schemas, bounded delegation and admin-only routes', () => {
  const document=openApi('http://localhost:4100');
  const paths=document.paths as Record<string,any>;
  assert.equal(document.openapi,'3.1.0');
  assert.equal(paths['/v1/delegations'].post.requestBody.content['application/json'].schema.properties.ttl_seconds.maximum,900);
  assert.deepEqual(paths['/v1/entities'].post.security,[{SessionCookie:[]}]);
  assert.ok(paths['/v1/tool-executions'].post.requestBody.content['application/json'].schema.required.includes('delegation_id'));
});
test('canonical audit digest is key-order independent and secret envelope rejects tampering', () => {
  assert.equal(canonical({b:2,a:1}),canonical({a:1,b:2}));
  const value=seal({secret:'test'},'test-key');assert.deepEqual(unseal(value,'test-key'),{secret:'test'});
  assert.throws(()=>unseal(value,'different-key'));
  const bytes=Buffer.from(value,'base64url');bytes[bytes.length-1]!^=1;assert.throws(()=>unseal(bytes.toString('base64url'),'test-key'));
});
test('production mode fails closed before local initialization',async()=>{
  const previous=process.env.NODE_ENV;
  process.env.NODE_ENV='production';
  try{await assert.rejects(loadConfig(),/Production gated/);}
  finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
