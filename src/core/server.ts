import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { RuntimeConfig } from '../shared/config.js';
import { createDatabase } from '../shared/database.js';
import { coreSchema } from './schema.js';
import { Problem, type Actor } from './domain.js';
import { registerAuthentication } from './authentication.js';
import { registerRoutes } from './routes.js';
import { publishPending } from './witness.js';
import { openApi } from './openapi.js';

export async function buildCore(config:RuntimeConfig,options:{authenticate?:(req:FastifyRequest)=>Promise<Actor>;logger?:boolean}={}){
  if(config.production)throw new Error('Production deployment is gated; this is a local pilot.');
  const db=await createDatabase('core',config);await db.exec(coreSchema);
  const app=Fastify({logger:options.logger?{redact:['req.url','req.headers.authorization','req.headers.cookie','res.headers.set-cookie']}:false,bodyLimit:32768,requestTimeout:15000});
  await app.register(cookie);
  await app.register(rateLimit,{max:180,timeWindow:'1 minute'});
  app.addHook('onRequest',async(req,reply)=>{
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('X-Frame-Options','DENY').header('Cache-Control','no-store').header('X-Request-ID',req.id);
    reply.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const incoming=new URL(`http://${req.headers.host??''}`);
    if(incoming.host!==new URL(config.coreOrigin).host && !options.authenticate)throw new Problem(400,'invalid_host','Hôte inattendu.');
  });
  app.setErrorHandler((error,req,reply)=>{
    const candidate=Number((error as {statusCode?:number}).statusCode);
    const problem=error instanceof Problem?error:error instanceof z.ZodError?new Problem(400,'validation_error','Paramètres invalides : '+error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')):(error as {code?:string}).code==='23505'?new Problem(409,'already_exists','Cet enregistrement existe déjà.'):new Problem(candidate>=400&&candidate<500?candidate:500,'request_failed','Impossible de traiter cette requête.');
    if(problem.status===500)app.log.error({err:error},'Request failed');
    if(req.url==='/v1/authorize')return reply.code(problem.status).send({error:problem.code,message:problem.message});
    return reply.type('application/problem+json').code(problem.status).send({type:`urn:aiid:problem:${problem.code}`,title:problem.code,status:problem.status,detail:problem.message,request_id:req.id});
  });
  app.get('/healthz',async()=>({status:'ok',service:'core',mode:'local-pilot'}));
  app.get('/api/config',async()=>({issuer:config.issuer,coreOrigin:config.coreOrigin,mode:'local-pilot'}));
  registerAuthentication(app,db,config,options.authenticate);
  registerRoutes(app,db,config);
  app.get('/openapi.json',async()=>openApi(config.coreOrigin));
  await app.register(staticFiles,{root:fileURLToPath(new URL('../../public/',import.meta.url)),prefix:'/',index:'index.html'});
  let stopped=false;
  let publishing:Promise<unknown>|undefined;
  const timer=setInterval(()=>{
    if(stopped||publishing)return;
    publishing=publishPending(db,config).catch(()=>{ /* Outbox remains pending; /audit/verify reports availability. */ }).finally(()=>{publishing=undefined;});
  },2000);
  timer.unref();
  app.addHook('onClose',async()=>{stopped=true;clearInterval(timer);await publishing;await db.close();});
  return {app,db};
}
