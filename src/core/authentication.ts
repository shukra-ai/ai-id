import * as oidc from 'openid-client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RuntimeConfig } from '../shared/config.js';
import type { Database } from '../shared/database.js';
import { hash, randomSecret, equalSecret, seal, unseal } from '../shared/crypto.js';
import { Problem, provision, appendAudit, lockDomain, type Actor } from './domain.js';

interface SessionRow {hash:string;domain_id:string;principal_id:string;entity_id:string;role:'admin'|'member';display_name:string;domain_name:string;csrf:string;tokens:string;expires_at:Date;last_seen:Date}
interface Tokens {access_token:string;refresh_token?:string;id_token?:string;expires_at:number;subject:string}

export function registerAuthentication(app:FastifyInstance,db:Database,config:RuntimeConfig,override?:(req:FastifyRequest)=>Promise<Actor>) {
  let discovery:Promise<oidc.Configuration>|undefined;
  const client=()=>discovery??=(oidc.discovery(new URL(config.issuer),'aiid-dashboard',config.oidcClientSecret,undefined,{execute:[oidc.allowInsecureRequests],timeout:5}).catch(e=>{discovery=undefined;throw e;}));
  const cookies={path:'/',httpOnly:true,sameSite:'lax' as const,secure:config.production};
  app.get('/auth/login',async(_req,reply)=>{
    const cfg=await client();const verifier=oidc.randomPKCECodeVerifier();const state=randomSecret();const nonce=oidc.randomNonce();
    await db.query('DELETE FROM core_login_states WHERE expires_at<now()');
    await db.query("INSERT INTO core_login_states(hash,verifier,nonce,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",[hash(state),verifier,nonce]);
    const url=oidc.buildAuthorizationUrl(cfg,{redirect_uri:`${config.coreOrigin}/auth/callback`,scope:'openid profile email offline_access',code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',state,nonce,prompt:'consent'});
    reply.setCookie('aiid_login',state,{...cookies,maxAge:600});return reply.redirect(url.href);
  });
  app.get('/auth/callback',async(req,reply)=>{
    const input=z.object({state:z.string().min(16)}).passthrough().parse(req.query);
    const cookie=req.cookies.aiid_login??'';
    if(!equalSecret(cookie,input.state))throw new Problem(400,'invalid_state','La connexion a expiré ou provient d’un autre navigateur.');
    const record=(await db.query<{verifier:string;nonce:string}>("DELETE FROM core_login_states WHERE hash=$1 AND expires_at>now() RETURNING verifier,nonce",[hash(input.state)])).rows[0];
    reply.clearCookie('aiid_login',cookies);
    if(!record)throw new Problem(400,'invalid_state','Cette demande de connexion n’est plus utilisable.');
    const cfg=await client();const tokens=await oidc.authorizationCodeGrant(cfg,new URL(req.url,config.coreOrigin),{pkceCodeVerifier:record.verifier,expectedState:input.state,expectedNonce:record.nonce,idTokenExpected:true});
    const claims=tokens.claims();if(!claims)throw new Problem(401,'invalid_identity','ID token requis.');
    const profile=z.object({sub:z.string().min(1),domain_id:z.string().uuid(),domain_name:z.string().min(1).max(120),name:z.string().min(1).max(120)}).passthrough().parse(await oidc.fetchUserInfo(cfg,tokens.access_token,claims.sub));
    const actor=await provision(db,config.issuer,profile);
    const session=randomSecret();const csrf=randomSecret();
    const protectedTokens:Tokens={access_token:tokens.access_token,refresh_token:tokens.refresh_token,id_token:tokens.id_token,expires_at:Date.now()+(tokens.expires_in??300)*1000,subject:claims.sub};
    await db.transaction(async tx=>{
      await lockDomain(tx,actor.domain_id);
      await tx.query("INSERT INTO core_sessions(hash,domain_id,principal_id,csrf,tokens,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '8 hours')",[hash(session),actor.domain_id,actor.principal_id,csrf,seal(protectedTokens,config.cookieSecret)]);
      await appendAudit(tx,actor,'session.created',actor.principal_id,req.id);
    });
    reply.setCookie('aiid_session',session,{...cookies,maxAge:8*3600});return reply.redirect('/');
  });
  app.addHook('preHandler',async(req,reply)=>{
    const protectedRoute=req.url.startsWith('/v1/')||req.url==='/api/me'||req.url==='/auth/logout';
    if(!protectedRoute)return;
    if(override){req.actor=await override(req);return;}
    const auth=req.headers.authorization;
    if(auth){
      if(!/^Bearer aiid_[A-Za-z0-9_-]{43}$/.test(auth))throw new Problem(401,'invalid_token','Authentification requise.');
      const result=(await db.query<Actor>(`SELECT p.domain_id,p.id AS principal_id,p.entity_id,'member' AS role,e.display_name,d.name AS domain_name FROM core_api_keys k JOIN core_principals p ON p.domain_id=k.domain_id AND p.id=k.principal_id JOIN core_entities e ON e.domain_id=p.domain_id AND e.id=p.entity_id JOIN core_domains d ON d.id=p.domain_id WHERE k.hash=$1 AND k.revoked_at IS NULL AND k.expires_at>now() AND p.status='active' AND e.status='active'`,[hash(auth.slice(7))])).rows[0];
      if(!result)throw new Problem(401,'invalid_token','Clé API invalide, expirée ou révoquée.');
      req.actor={...result,auth:'api-key',api_key_hash:hash(auth.slice(7))};return;
    }
    const session=req.cookies.aiid_session;
    if(!session)throw new Problem(401,'login_required','Connectez-vous pour continuer.');
    const sessionHash=hash(session);
    // Single row lock prevents parallel browser requests rotating the same refresh token twice.
    const row=await db.transaction(async tx=>{
      const value=(await tx.query<SessionRow>(`SELECT s.*,p.entity_id,p.role,e.display_name,d.name AS domain_name FROM core_sessions s JOIN core_principals p ON p.id=s.principal_id AND p.domain_id=s.domain_id JOIN core_entities e ON e.id=p.entity_id AND e.domain_id=p.domain_id JOIN core_domains d ON d.id=s.domain_id WHERE s.hash=$1 AND s.expires_at>now() AND s.last_seen>now()-interval '30 minutes' AND p.status='active' AND e.status='active' FOR UPDATE OF s`,[sessionHash])).rows[0];
      if(!value)return undefined;
      let tokens=unseal<Tokens>(value.tokens,config.cookieSecret);const cfg=await client();
      try {
        if(tokens.expires_at<Date.now()+30000){
          if(!tokens.refresh_token)return undefined;
          const fresh=await oidc.refreshTokenGrant(cfg,tokens.refresh_token);
          tokens={...tokens,...fresh,refresh_token:fresh.refresh_token??tokens.refresh_token,expires_at:Date.now()+(fresh.expires_in??300)*1000};
        }
        const status=await oidc.tokenIntrospection(cfg,tokens.access_token);
        if(!status.active)return undefined;
      }catch(error){
        if(error instanceof oidc.ResponseBodyError && ['invalid_grant','invalid_token'].includes(error.error))return undefined;
        throw new Problem(503,'authentication_unavailable','Le service d’authentification est momentanément indisponible.');
      }
      await tx.query('UPDATE core_sessions SET last_seen=now(),tokens=$2 WHERE hash=$1',[sessionHash,seal(tokens,config.cookieSecret)]);
      return value;
    });
    if(!row){await db.query('DELETE FROM core_sessions WHERE hash=$1',[sessionHash]);reply.clearCookie('aiid_session',cookies);throw new Problem(401,'session_expired','Session expirée ou révoquée.');}
    req.actor={domain_id:row.domain_id,principal_id:row.principal_id,entity_id:row.entity_id,role:row.role,display_name:row.display_name,domain_name:row.domain_name,csrf_token:row.csrf,session_hash:sessionHash,auth:'session'};
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
      if(req.headers.origin!==config.coreOrigin || !equalSecret(String(req.headers['x-csrf-token']??''),row.csrf))throw new Problem(403,'csrf_failed','Actualisez la page et réessayez depuis le tableau de bord.');
    }
  });
  app.post('/auth/logout',async(req,reply)=>{
    if(req.actor.auth!=='session'||!req.actor.session_hash)throw new Problem(403,'session_required','Session navigateur requise.');
    const row=(await db.query<{tokens:string}>('DELETE FROM core_sessions WHERE hash=$1 RETURNING tokens',[req.actor.session_hash])).rows[0];
    let redirect='/';
    if(row){
      const tokens=unseal<Tokens>(row.tokens,config.cookieSecret);
      if(tokens.id_token)redirect=oidc.buildEndSessionUrl(await client(),{id_token_hint:tokens.id_token,post_logout_redirect_uri:config.coreOrigin+'/'}).href;
      try{await oidc.tokenRevocation(await client(),tokens.refresh_token??tokens.access_token);}catch{/* local revocation still succeeds; no token is retained */}
    }
    await db.transaction(async tx=>{await lockDomain(tx,req.actor.domain_id);await appendAudit(tx,req.actor,'session.revoked',req.actor.principal_id,req.id);});
    reply.clearCookie('aiid_session',cookies);return {logged_out:true,redirect};
  });
}
