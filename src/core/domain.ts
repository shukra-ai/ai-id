import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Queryable, Database } from '../shared/database.js';
import { canonical, hash } from '../shared/crypto.js';

export interface Actor {
  domain_id: string; principal_id: string; entity_id: string; role: 'admin'|'member';
  display_name: string; domain_name: string; csrf_token?: string; session_hash?: string;
  auth: 'session'|'api-key'; api_key_hash?: string;
}
export class Problem extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const uuid = z.string().uuid();
export const POLICY = 'core-local-v1';
export const CONTEXT = 'tool.execution.v1';
export function admin(actor: Actor) { if (actor.role !== 'admin' || actor.auth !== 'session') throw new Problem(403,'forbidden','Une session administrateur est requise.'); }
export async function lockDomain(tx: Queryable, domain: string) {
  const result = await tx.query('SELECT id FROM core_domains WHERE id=$1 FOR UPDATE',[domain]);
  if (!result.rows.length) throw new Problem(404,'not_found','Domaine introuvable.');
}
export async function appendAudit(tx: Queryable, actor: Actor, action: string, resource: string, requestId: string, data: Record<string,unknown> = {}) {
  // Caller holds the domain row lock: sequence and chain head are linearizable.
  const prior = (await tx.query<{hash:string;sequence:string}>('SELECT hash,sequence FROM core_audit WHERE domain_id=$1 ORDER BY sequence DESC LIMIT 1',[actor.domain_id])).rows[0];
  const sequence = Number(prior?.sequence ?? 0)+1;
  const envelope = { id:randomUUID(),domain_id:actor.domain_id,sequence,actor_id:actor.principal_id,action,resource_id:resource,request_id:requestId,occurred_at:new Date().toISOString(),previous_hash:prior?.hash ?? '0'.repeat(64),data };
  const digest = hash(canonical(envelope));
  await tx.query('INSERT INTO core_audit(id,domain_id,sequence,actor_id,action,resource_id,request_id,occurred_at,previous_hash,hash,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[envelope.id,envelope.domain_id,sequence,envelope.actor_id,action,resource,requestId,envelope.occurred_at,envelope.previous_hash,digest,JSON.stringify(data)]);
  await tx.query('INSERT INTO core_outbox(event_id,domain_id,sequence,event_type,aggregate_id,data) VALUES($1,$2,$3,$4,$5,$6)',[envelope.id,actor.domain_id,sequence,action,resource,JSON.stringify({event_id:envelope.id,type:action,resource_id:resource,sequence,occurred_at:envelope.occurred_at,audit_hash:digest})]);
  return {...envelope,hash:digest};
}
export async function activePrincipal(tx: Queryable, domain: string, id: string) {
  const row = (await tx.query<{id:string;entity_id:string;role:'admin'|'member';kind:string}>(`SELECT p.id,p.entity_id,p.role,e.kind FROM core_principals p JOIN core_entities e ON e.domain_id=p.domain_id AND e.id=p.entity_id WHERE p.domain_id=$1 AND p.id=$2 AND p.status='active' AND e.status='active'`,[domain,id])).rows[0];
  if (!row) throw new Problem(404,'not_found','Principal actif introuvable dans ce domaine.');
  return row;
}
export async function allowed(tx: Queryable, domain: string, principal: string, resource: string, action: string): Promise<boolean> {
  return (await tx.query(`SELECT r.id FROM core_relationships r JOIN core_principals p ON p.domain_id=r.domain_id AND p.id=r.subject_id JOIN core_entities e ON e.domain_id=p.domain_id AND e.id=p.entity_id WHERE r.domain_id=$1 AND r.subject_id=$2 AND r.resource=$3 AND r.action=$4 AND p.status='active' AND e.status='active'`,[domain,principal,resource,action])).rows.length>0;
}
export async function provision(db: Database, issuer: string, profile: {sub:string;domain_id:string;domain_name:string;name:string}): Promise<Actor> {
  const domain = uuid.parse(profile.domain_id);
  return db.transaction(async tx => {
    await tx.query('INSERT INTO core_domains(id,name,auth_subject) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[domain,profile.domain_name,profile.sub]);
    await lockDomain(tx,domain);
    const previous = (await tx.query<{principal_id:string}>('SELECT principal_id FROM core_auth_links WHERE issuer=$1 AND subject=$2 AND domain_id=$3',[issuer,profile.sub,domain])).rows[0];
    if (previous) {
      const p = await activePrincipal(tx,domain,previous.principal_id);
      return {domain_id:domain,principal_id:p.id,entity_id:p.entity_id,role:p.role,display_name:profile.name,domain_name:profile.domain_name,auth:'session'};
    }
    const owner = (await tx.query<{auth_subject:string}>('SELECT auth_subject FROM core_domains WHERE id=$1',[domain])).rows[0];
    if (owner?.auth_subject !== profile.sub) throw new Problem(403,'domain_claim_conflict','Le profil ne peut pas prendre le contrôle de ce domaine.');
    const entity = randomUUID(); const principal = randomUUID();
    await tx.query("INSERT INTO core_entities(id,domain_id,kind,display_name) VALUES($1,$2,'human',$3)",[entity,domain,profile.name]);
    await tx.query("INSERT INTO core_principals(id,domain_id,entity_id,custody,role) VALUES($1,$2,$3,'personal','admin')",[principal,domain,entity]);
    await tx.query('INSERT INTO core_auth_links(issuer,subject,domain_id,principal_id) VALUES($1,$2,$3,$4)',[issuer,profile.sub,domain,principal]);
    const actor:Actor={domain_id:domain,principal_id:principal,entity_id:entity,role:'admin',display_name:profile.name,domain_name:profile.domain_name,auth:'session'};
    await appendAudit(tx,actor,'domain.created',domain,randomUUID());
    return actor;
  });
}
export async function verifyAudit(tx: Queryable, domain: string) {
  const rows=(await tx.query<Record<string,unknown>>('SELECT * FROM core_audit WHERE domain_id=$1 ORDER BY sequence',[domain])).rows;
  let previous='0'.repeat(64); let sequence=0;
  for(const row of rows) {
    const envelope={id:row.id,domain_id:row.domain_id,sequence:Number(row.sequence),actor_id:row.actor_id,action:row.action,resource_id:row.resource_id,request_id:row.request_id,occurred_at:row.occurred_at,previous_hash:row.previous_hash,data:row.data};
    if (Number(row.sequence)!==++sequence || row.previous_hash!==previous || hash(canonical(envelope))!==row.hash) return {valid:false,count:rows.length,head_hash:previous,failed_sequence:sequence};
    previous=row.hash as string;
  }
  return {valid:true,count:rows.length,head_hash:previous};
}
