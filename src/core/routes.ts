import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database, Queryable } from '../shared/database.js';
import type { RuntimeConfig } from '../shared/config.js';
import { hash, canonical, randomSecret, seal, unseal } from '../shared/crypto.js';
import { admin, appendAudit, activePrincipal, allowed, lockDomain, Problem, POLICY, CONTEXT, uuid, verifyAudit, type Actor } from './domain.js';
import { compareWitness } from './witness.js';

declare module 'fastify' { interface FastifyRequest { actor: Actor } }
const entityBody=z.object({kind:z.enum(['human','agent','service','organization']),display_name:z.string().trim().min(1).max(120)}).strict();
const relationBody=z.object({subject_id:uuid,resource:z.literal('tool:demo'),action:z.literal('execute')}).strict();
const delegationBody=z.object({delegate_principal_id:uuid,resource:z.literal('tool:demo'),action:z.literal('execute'),ttl_seconds:z.number().int().min(30).max(900).default(300)}).strict();
const keyBody=z.object({principal_id:uuid,name:z.string().trim().min(1).max(80),ttl_seconds:z.number().int().min(60).max(3600).default(3600)}).strict();
const evidenceBody=z.object({subject_entity_id:uuid,context:z.literal(CONTEXT),outcome:z.enum(['success','failure']),reference:z.string().min(1).max(200)}).strict();
const authzBody=z.object({subject:z.object({type:z.literal('principal'),id:uuid}).strict(),resource:z.object({type:z.literal('tool'),id:z.literal('demo')}).strict(),action:z.object({name:z.literal('execute')}).strict()}).strict();
const principalBody=z.object({custody:z.literal('workload-custodial')}).strict();
const executionBody=z.object({delegation_id:uuid,input:z.string().min(1).max(500)}).strict();
export const apiBodies = {
  '/v1/entities':entityBody,'/v1/entities/{id}/principals':principalBody,
  '/v1/relationships':relationBody,'/v1/delegations':delegationBody,'/v1/api-keys':keyBody,
  '/v1/evidence':evidenceBody,'/v1/authorize':authzBody,'/v1/tool-executions':executionBody,
};
const idParam=(req:FastifyRequest)=>uuid.parse((req.params as {id:string}).id);

export function registerRoutes(app:FastifyInstance,db:Database,config:RuntimeConfig) {
  async function mutation(req:FastifyRequest,action:(tx:Queryable)=>Promise<{status?:number;body:unknown}>) {
    const key=z.string().min(8).max(128).parse(req.headers['idempotency-key']);
    const fingerprint=hash(canonical({method:req.method,url:req.url,body:req.body??null}));
    return db.transaction(async tx=>{
      await lockDomain(tx,req.actor.domain_id);
      // Recheck after obtaining the serialization lock, including the actor's Entity.
      await activePrincipal(tx,req.actor.domain_id,req.actor.principal_id);
      if(req.actor.auth==='api-key' && !(await tx.query('SELECT id FROM core_api_keys WHERE domain_id=$1 AND principal_id=$2 AND hash=$3 AND revoked_at IS NULL AND expires_at>now()',[req.actor.domain_id,req.actor.principal_id,req.actor.api_key_hash])).rows.length)throw new Problem(401,'invalid_token','Clé expirée ou révoquée.');
      if(req.actor.session_hash && !(await tx.query('SELECT hash FROM core_sessions WHERE hash=$1 AND expires_at>now()',[req.actor.session_hash])).rows.length)throw new Problem(401,'session_expired','Session révoquée.');
      const old=(await tx.query<{request_hash:string;response:{sealed:string};status:number}>(`SELECT request_hash,response,status FROM core_idempotency WHERE domain_id=$1 AND principal_id=$2 AND key=$3 AND expires_at>now()`,[req.actor.domain_id,req.actor.principal_id,key])).rows[0];
      if(old){if(old.request_hash!==fingerprint)throw new Problem(409,'idempotency_conflict','Cette clé a déjà été utilisée pour une autre requête.'); return {status:old.status,body:unseal(old.response.sealed,config.cookieSecret)};}
      const result=await action(tx);
      await tx.query(`INSERT INTO core_idempotency(domain_id,principal_id,key,request_hash,status,response,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '24 hours') ON CONFLICT(domain_id,principal_id,key) DO UPDATE SET request_hash=EXCLUDED.request_hash,status=EXCLUDED.status,response=EXCLUDED.response,expires_at=EXCLUDED.expires_at`,[req.actor.domain_id,req.actor.principal_id,key,fingerprint,result.status??200,JSON.stringify({sealed:seal(result.body,config.cookieSecret)})]);
      return result;
    });
  }
  const list=async(req:FastifyRequest,table:string,fields:string,extra='',extraParams:unknown[]=[])=>{
    const query=z.object({cursor:uuid.optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(req.query);
    const cursor=query.cursor??'00000000-0000-0000-0000-000000000000';
    const rows=(await db.query<Record<string,unknown>>(`SELECT ${fields} FROM ${table} WHERE domain_id=$1 AND id>$2 ${extra} ORDER BY id LIMIT $3`,[req.actor.domain_id,cursor,query.limit+1,...extraParams])).rows;
    const data=rows.slice(0,query.limit); return {data,next_cursor:rows.length>query.limit?data.at(-1)?.id:null};
  };
  app.get('/api/me',async req=>({...req.actor,scope:req.actor.role==='admin'?'domain:admin':'self',session_hash:undefined,api_key_hash:undefined}));
  app.get('/v1/sessions',async req=>{admin(req.actor);return list(req,'core_sessions','id,principal_id,created_at,last_seen,expires_at');});
  app.delete('/v1/sessions/:id',async(req,reply)=>{
    admin(req.actor);const id=idParam(req);
    const result=await mutation(req,async tx=>{
      const row=(await tx.query('DELETE FROM core_sessions WHERE domain_id=$1 AND id=$2 RETURNING id',[req.actor.domain_id,id])).rows[0];
      if(!row)throw new Problem(404,'not_found','Session introuvable.');
      await appendAudit(tx,req.actor,'session.revoked',id,req.id);
      return {body:{id,revoked:true,scope:'core-session-only'}};
    });return reply.send(result.body);
  });
  app.get('/v1/entities',async req=>{admin(req.actor);return list(req,'core_entities','id,kind,display_name,status,created_at');});
  app.post('/v1/entities',async(req,reply)=>{
    admin(req.actor); const body=entityBody.parse(req.body);
    const result=await mutation(req,async tx=>{
      const row=(await tx.query('INSERT INTO core_entities(id,domain_id,kind,display_name) VALUES($1,$2,$3,$4) RETURNING id,kind,display_name,status,created_at',[randomUUID(),req.actor.domain_id,body.kind,body.display_name])).rows[0];
      await appendAudit(tx,req.actor,'entity.created',(row as {id:string}).id,req.id,{kind:body.kind});return {status:201,body:row};
    });return reply.code(result.status??200).send(result.body);
  });
  app.post('/v1/entities/:id/disable',async(req,reply)=>{
    admin(req.actor); const id=idParam(req);
    if(id===req.actor.entity_id)throw new Problem(409,'self_disable','Impossible de désactiver la session propriétaire active.');
    const result=await mutation(req,async tx=>{
      const row=(await tx.query("UPDATE core_entities SET status='disabled' WHERE domain_id=$1 AND id=$2 AND status='active' RETURNING id,status",[req.actor.domain_id,id])).rows[0];
      if(!row)throw new Problem(404,'not_found','Entité active introuvable.');
      await tx.query("UPDATE core_principals SET status='disabled' WHERE domain_id=$1 AND entity_id=$2",[req.actor.domain_id,id]);
      await tx.query('DELETE FROM core_sessions WHERE domain_id=$1 AND principal_id IN (SELECT id FROM core_principals WHERE domain_id=$1 AND entity_id=$2)',[req.actor.domain_id,id]);
      await appendAudit(tx,req.actor,'entity.disabled',id,req.id);return {body:row};
    });return reply.send(result.body);
  });
  app.get('/v1/principals',async req=>{admin(req.actor);return list(req,'core_principals','id,entity_id,custody,role,status,created_at');});
  app.post('/v1/entities/:id/principals',async(req,reply)=>{
    admin(req.actor); const id=idParam(req);const body=principalBody.parse(req.body);
    const result=await mutation(req,async tx=>{
      const entity=(await tx.query<{kind:string}>("SELECT kind FROM core_entities WHERE domain_id=$1 AND id=$2 AND status='active'",[req.actor.domain_id,id])).rows[0];
      if(!entity)throw new Problem(404,'not_found','Entité active introuvable.');
      if(!['agent','service'].includes(entity.kind))throw new Problem(400,'invalid_kind','Un principal technique requiert une entité agent ou service.');
      const row=(await tx.query('INSERT INTO core_principals(id,domain_id,entity_id,custody) VALUES($1,$2,$3,$4) RETURNING id,entity_id,custody,role,status,created_at',[randomUUID(),req.actor.domain_id,id,body.custody])).rows[0];
      await appendAudit(tx,req.actor,'principal.created',(row as {id:string}).id,req.id,{entity_id:id});return {status:201,body:row};
    });return reply.code(result.status??200).send(result.body);
  });
  app.get('/v1/relationships',async req=>{admin(req.actor);return list(req,'core_relationships','id,subject_id,resource,action,created_at');});
  app.post('/v1/relationships',async(req,reply)=>{
    admin(req.actor);const body=relationBody.parse(req.body);
    const result=await mutation(req,async tx=>{
      await activePrincipal(tx,req.actor.domain_id,body.subject_id);
      const row=(await tx.query('INSERT INTO core_relationships(id,domain_id,subject_id,resource,action) VALUES($1,$2,$3,$4,$5) RETURNING id,subject_id,resource,action,created_at',[randomUUID(),req.actor.domain_id,body.subject_id,body.resource,body.action])).rows[0];
      await appendAudit(tx,req.actor,'relationship.created',(row as {id:string}).id,req.id,{subject_id:body.subject_id,resource:body.resource,action:body.action});return {status:201,body:row};
    });return reply.code(result.status??200).send(result.body);
  });
  app.delete('/v1/relationships/:id',async(req,reply)=>{
    admin(req.actor);const id=idParam(req);const result=await mutation(req,async tx=>{
      const row=(await tx.query('DELETE FROM core_relationships WHERE domain_id=$1 AND id=$2 RETURNING id',[req.actor.domain_id,id])).rows[0];
      if(!row)throw new Problem(404,'not_found','Relation introuvable.');
      await appendAudit(tx,req.actor,'relationship.deleted',id,req.id);return {body:{id,deleted:true}};
    });return reply.send(result.body);
  });
  app.post('/v1/authorize',async req=>{
    const body=authzBody.parse(req.body);
    if(req.actor.role!=='admin' && body.subject.id!==req.actor.principal_id)throw new Problem(403,'forbidden','Vous pouvez évaluer uniquement vos propres permissions.');
    const decision=await allowed(db,req.actor.domain_id,body.subject.id,`${body.resource.type}:${body.resource.id}`,body.action.name);
    return {decision,context:{decision_id:randomUUID(),policy_version:POLICY,reason:decision?'EXPLICIT_RELATION':'DEFAULT_DENY'}};
  });
  app.get('/v1/delegations',async req=>{admin(req.actor);return list(req,'core_delegations','id,grantor_principal_id,delegate_principal_id,resource,action,status,max_depth,epoch,policy_version,expires_at,created_at');});
  app.post('/v1/delegations',async(req,reply)=>{
    admin(req.actor);const body=delegationBody.parse(req.body);
    const result=await mutation(req,async tx=>{
      const delegate=await activePrincipal(tx,req.actor.domain_id,body.delegate_principal_id);
      if(!['agent','service'].includes(delegate.kind))throw new Problem(400,'invalid_delegate','La délégation cible un agent ou un service.');
      if(!await allowed(tx,req.actor.domain_id,req.actor.principal_id,body.resource,body.action) || !await allowed(tx,req.actor.domain_id,body.delegate_principal_id,body.resource,body.action))throw new Problem(403,'delegation_denied','Le délégant et le délégué doivent tous deux posséder le droit explicite.');
      const id=randomUUID();const decisionId=randomUUID();
      const row=(await tx.query('INSERT INTO core_delegations(id,domain_id,grantor_principal_id,delegate_principal_id,resource,action,decision_id,policy_version,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[id,req.actor.domain_id,req.actor.principal_id,body.delegate_principal_id,body.resource,body.action,decisionId,POLICY,new Date(Date.now()+body.ttl_seconds*1000)])).rows[0];
      await appendAudit(tx,req.actor,'delegation.created',id,req.id,{delegate_principal_id:body.delegate_principal_id,decision_id:decisionId});return {status:201,body:row};
    });return reply.code(result.status??200).send(result.body);
  });
  app.post('/v1/delegations/:id/revoke',async(req,reply)=>{
    admin(req.actor);const id=idParam(req);const result=await mutation(req,async tx=>{
      const row=(await tx.query("UPDATE core_delegations SET status='revoked',epoch=epoch+1 WHERE domain_id=$1 AND id=$2 AND status='active' RETURNING id,status,epoch",[req.actor.domain_id,id])).rows[0];
      if(!row)throw new Problem(404,'not_found','Délégation active introuvable.');
      await appendAudit(tx,req.actor,'delegation.revoked',id,req.id);return {body:row};
    });return reply.send(result.body);
  });
  app.get('/v1/api-keys',async req=>{admin(req.actor);return list(req,'core_api_keys','id,principal_id,name,expires_at,revoked_at,created_at');});
  app.post('/v1/api-keys',async(req,reply)=>{
    admin(req.actor);const body=keyBody.parse(req.body);const result=await mutation(req,async tx=>{
      const p=await activePrincipal(tx,req.actor.domain_id,body.principal_id);
      if(!['agent','service'].includes(p.kind))throw new Problem(400,'invalid_principal','Les clés API sont réservées aux agents/services, jamais aux administrateurs.');
      const secret=`aiid_${randomSecret()}`;const id=randomUUID();const expires=new Date(Date.now()+body.ttl_seconds*1000);
      await tx.query('INSERT INTO core_api_keys(id,domain_id,principal_id,name,hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[id,req.actor.domain_id,p.id,body.name,hash(secret),expires]);
      await appendAudit(tx,req.actor,'api_key.created',id,req.id,{principal_id:p.id});return {status:201,body:{id,principal_id:p.id,name:body.name,secret,expires_at:expires.toISOString()}};
    });return reply.code(result.status??200).send(result.body);
  });
  app.delete('/v1/api-keys/:id',async(req,reply)=>{
    admin(req.actor);const id=idParam(req);const result=await mutation(req,async tx=>{
      const row=(await tx.query('UPDATE core_api_keys SET revoked_at=now() WHERE domain_id=$1 AND id=$2 AND revoked_at IS NULL RETURNING id',[req.actor.domain_id,id])).rows[0];
      if(!row)throw new Problem(404,'not_found','Clé active introuvable.');await appendAudit(tx,req.actor,'api_key.revoked',id,req.id);return {body:{id,revoked:true}};
    });return reply.send(result.body);
  });
  app.post('/v1/tool-executions',async(req,reply)=>{
    const body=executionBody.parse(req.body);
    const result=await mutation(req,async tx=>{
      const grant=(await tx.query<{grantor_principal_id:string;delegate_principal_id:string;resource:string;action:string;epoch:number}>("SELECT * FROM core_delegations WHERE domain_id=$1 AND id=$2 AND delegate_principal_id=$3 AND status='active' AND expires_at>now()",[req.actor.domain_id,body.delegation_id,req.actor.principal_id])).rows[0];
      if(!grant || !await allowed(tx,req.actor.domain_id,grant.grantor_principal_id,grant.resource,grant.action) || !await allowed(tx,req.actor.domain_id,req.actor.principal_id,grant.resource,grant.action))throw new Problem(403,'delegation_denied','Délégation absente, expirée, révoquée ou permission retirée.');
      const id=randomUUID();const evidenceId=randomUUID();const grantor=await activePrincipal(tx,req.actor.domain_id,grant.grantor_principal_id);
      // Side-effect-free sandbox tool. Input/output are absent from evidence and audit;
      // the encrypted idempotency response retains output for 24 hours.
      const output=body.input.trim().toUpperCase();
      await tx.query("INSERT INTO core_evidence(id,domain_id,subject_entity_id,source_entity_id,context,outcome,reference_hash,provenance) VALUES($1,$2,$3,$4,$5,'success',$6,'resource-observed')",[evidenceId,req.actor.domain_id,req.actor.entity_id,grantor.entity_id,CONTEXT,hash(id)]);
      await appendAudit(tx,req.actor,'tool.executed',id,req.id,{delegation_id:body.delegation_id,epoch:grant.epoch,grantor_principal_id:grant.grantor_principal_id,evidence_id:evidenceId});return {status:201,body:{id,output,evidence_id:evidenceId,delegation_id:body.delegation_id}};
    });return reply.code(result.status??200).send(result.body);
  });
  app.get('/v1/evidence',async req=>{admin(req.actor);return list(req,'core_evidence','id,subject_entity_id,source_entity_id,context,outcome,status,provenance,created_at');});
  app.post('/v1/evidence',async(req,reply)=>{
    admin(req.actor);const body=evidenceBody.parse(req.body);const result=await mutation(req,async tx=>{
      if(!(await tx.query("SELECT id FROM core_entities WHERE domain_id=$1 AND id=$2 AND status='active'",[req.actor.domain_id,body.subject_entity_id])).rows.length)throw new Problem(404,'not_found','Sujet introuvable.');
      const id=randomUUID();const row=(await tx.query("INSERT INTO core_evidence(id,domain_id,subject_entity_id,source_entity_id,context,outcome,reference_hash,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,'tenant-asserted') RETURNING id,subject_entity_id,context,outcome,status,provenance,created_at",[id,req.actor.domain_id,body.subject_entity_id,req.actor.entity_id,body.context,body.outcome,hash(`${req.actor.domain_id}:${body.reference}`)])).rows[0];
      await appendAudit(tx,req.actor,'evidence.recorded',id,req.id,{subject_entity_id:body.subject_entity_id,context:body.context});return {status:201,body:row};
    });return reply.code(result.status??200).send(result.body);
  });
  app.post('/v1/evidence/:id/dispute',async(req,reply)=>{
    admin(req.actor);const id=idParam(req);const result=await mutation(req,async tx=>{
      const row=(await tx.query("UPDATE core_evidence SET status='disputed' WHERE domain_id=$1 AND id=$2 AND status='active' RETURNING id,status",[req.actor.domain_id,id])).rows[0];
      if(!row)throw new Problem(404,'not_found','Preuve active introuvable.');await appendAudit(tx,req.actor,'evidence.disputed',id,req.id);return {body:row};
    });return reply.send(result.body);
  });
  app.get('/v1/assessments/:id',async req=>{
    const id=idParam(req);z.object({context:z.literal(CONTEXT).default(CONTEXT)}).parse(req.query);
    if(req.actor.role!=='admin' && id!==req.actor.entity_id)throw new Problem(403,'forbidden','Évaluation privée au domaine.');
    if(!(await db.query('SELECT id FROM core_entities WHERE domain_id=$1 AND id=$2',[req.actor.domain_id,id])).rows.length)throw new Problem(404,'not_found','Sujet introuvable.');
    const rows=(await db.query<{id:string;outcome:string;source_entity_id:string;status:string;created_at:Date;provenance:string}>("SELECT id,outcome,source_entity_id,status,created_at,provenance FROM core_evidence WHERE domain_id=$1 AND subject_entity_id=$2 AND context=$3 AND created_at>now()-interval '30 days' ORDER BY id",[req.actor.domain_id,id,CONTEXT])).rows;
    const active=rows.filter(r=>r.status==='active');const observed=active.filter(r=>r.provenance==='resource-observed');const successes=observed.filter(r=>r.outcome==='success').length;
    return {subject_entity_id:id,context:CONTEXT,result:{band:observed.length<5?'unknown':successes===observed.length?'consistent':'mixed'},sample_size:observed.length,asserted_sample_size:active.length-observed.length,source_diversity:new Set(observed.map(r=>r.source_entity_id)).size,confidence_band:observed.length<5?'insufficient':'limited',window_days:30,disputed_count:rows.length-active.length,model:'tool-outcomes',model_version:'1.0.0',evidence_hash:hash(canonical(rows)),evidence_cutoff:new Date().toISOString(),explanation_codes:[observed.length<5?'INSUFFICIENT_OBSERVATIONS':'TENANT_LOCAL_OBSERVATIONS','NOT_A_PERMISSION','NOT_INDEPENDENT_VERIFICATION'],status:'active'};
  });
  for(const [path,table] of [['/v1/audit','core_audit'],['/v1/events','core_outbox']] as const){
    app.get(path,async req=>{
      admin(req.actor);const q=z.object({cursor:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(req.query);
      const rows=(await db.query<Record<string,unknown>>(`SELECT * FROM ${table} WHERE domain_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3`,[req.actor.domain_id,q.cursor,q.limit+1])).rows;const data=rows.slice(0,q.limit);
      return {data,next_cursor:rows.length>q.limit?String(data.at(-1)?.sequence):null};
    });
  }
  app.get('/v1/audit/verify',async req=>{
    admin(req.actor);
    const local=await verifyAudit(db,req.actor.domain_id);
    const witness=await compareWitness(db,config,req.actor.domain_id);
    return {...local,valid:local.valid&&!['diverged','invalid_signature'].includes(witness.status),witness};
  });
}
