import { z } from 'zod';
import { apiBodies } from './routes.js';

type Operation = { path: string; methods: string[]; summary: string; admin?: boolean; collection?: boolean };
const operations: Operation[] = [
  { path:'/api/config',methods:['get'],summary:'Configuration publique du pilote' },
  { path:'/api/me',methods:['get'],summary:'Identité de l’appelant, domaine et portée' },
  { path:'/v1/sessions',methods:['get'],summary:'Sessions locales du domaine, sans secrets',admin:true,collection:true },
  { path:'/v1/sessions/{id}',methods:['delete'],summary:'Révoquer une session Core (ne ferme pas le SSO chez l’IdP)',admin:true },
  { path:'/v1/entities',methods:['get','post'],summary:'Identités locales au domaine',admin:true,collection:true },
  { path:'/v1/entities/{id}/disable',methods:['post'],summary:'Désactiver une identité et ses principaux',admin:true },
  { path:'/v1/principals',methods:['get'],summary:'Principaux du domaine',admin:true,collection:true },
  { path:'/v1/entities/{id}/principals',methods:['post'],summary:'Créer un principal technique immuablement lié',admin:true },
  { path:'/v1/relationships',methods:['get','post'],summary:'Permissions explicites du domaine',admin:true,collection:true },
  { path:'/v1/relationships/{id}',methods:['delete'],summary:'Retirer une permission',admin:true },
  { path:'/v1/authorize',methods:['post'],summary:'Décision en ligne, refus par défaut (profil local, non certifié AuthZEN)' },
  { path:'/v1/delegations',methods:['get','post'],summary:'Délégations bornées sans sous-délégation',admin:true,collection:true },
  { path:'/v1/delegations/{id}/revoke',methods:['post'],summary:'Révoquer une délégation',admin:true },
  { path:'/v1/api-keys',methods:['get','post'],summary:'Clés agent/service, durée maximale 1 heure',admin:true,collection:true },
  { path:'/v1/api-keys/{id}',methods:['delete'],summary:'Révoquer une clé',admin:true },
  { path:'/v1/tool-executions',methods:['post'],summary:'Outil sandbox sans effet externe sous délégation' },
  { path:'/v1/evidence',methods:['get','post'],summary:'Observations et déclarations privées, dédupliquées',admin:true,collection:true },
  { path:'/v1/evidence/{id}/dispute',methods:['post'],summary:'Contester une preuve et l’exclure du calcul',admin:true },
  { path:'/v1/assessments/{id}',methods:['get'],summary:'Évaluation contextuelle informative (jamais une permission)' },
  { path:'/v1/events',methods:['get'],summary:'Historique transactionnel d’événements',admin:true,collection:true },
  { path:'/v1/audit',methods:['get'],summary:'Journal chaîné du domaine',admin:true,collection:true },
  { path:'/v1/audit/verify',methods:['get'],summary:'Vérification locale et comparaison au témoin',admin:true },
  { path:'/auth/logout',methods:['post'],summary:'Révoquer la session courante et obtenir l’URL de déconnexion SSO',admin:true },
];
export function openApi(origin: string) {
  const paths: Record<string,unknown> = {};
  for(const operation of operations) {
    const item: Record<string,unknown> = {};
    for(const method of operation.methods) {
      const body=method==='post'?apiBodies[operation.path as keyof typeof apiBodies]:undefined;
      const parameters:unknown[]=[];
      if(operation.path.includes('{id}'))parameters.push({name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}});
      if(method!=='get') {
        if(operation.path.startsWith('/v1/')&&operation.path!=='/v1/authorize')parameters.push({name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:8,maxLength:128},description:'Même clé pour toute reprise du même appel; portée principal/domaine; rétention 24 h.'});
        parameters.push({name:'X-CSRF-Token',in:'header',schema:{type:'string'},description:'Obligatoire avec la session navigateur; reçu depuis /api/me. Origin doit correspondre à la console.'});
      }
      if(method==='get'&&operation.collection) {
        parameters.push({name:'cursor',in:'query',schema:{type:'string'},description:operation.path==='/v1/events'||operation.path==='/v1/audit'?'Séquence numérique renvoyée par next_cursor':'UUID opaque renvoyé par next_cursor'});
        parameters.push({name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100,default:50}});
      }
      const success=method==='post'&&body&&operation.path!=='/v1/authorize'?'201':'200';
      item[method]={ summary:operation.summary,operationId:`${method}_${operation.path.replace(/[^a-z0-9]+/gi,'_')}`,
        security:operation.path==='/api/config'?[]:operation.admin?[{SessionCookie:[]}]:[{SessionCookie:[]},{WorkloadKey:[]}],parameters,
        ...(body?{requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(body,{target:'draft-2020-12'})}}}}:{}),
        responses:{[success]:{description:'Succès. Les réponses métier sont décrites par les types du SDK; schémas complets de sortie à ajouter.',content:{'application/json':{schema:operation.collection&&method==='get'?{type:'object',required:['data','next_cursor'],properties:{data:{type:'array',items:{type:'object'}},next_cursor:{type:['string','null']}}}:{type:'object'}}}},
          ...Object.fromEntries([400,401,403,404,409,429,503].map(status=>[status,{description:`Erreur ${status}`,content:{'application/problem+json':{schema:{$ref:'#/components/schemas/Problem'}}}}]))},
      };
    }
    paths[operation.path]=item;
  }
  return {openapi:'3.1.0',info:{title:'AI ID — local integration pilot',version:'0.1.0',description:'Contrats de requête dérivés des validateurs exécutés. API locale uniquement; pas de certification OAuth/AuthZEN. Les clés workload ne permettent pas les opérations administrateur.'},servers:[{url:origin}],paths,
    components:{securitySchemes:{SessionCookie:{type:'apiKey',in:'cookie',name:'aiid_session'},WorkloadKey:{type:'http',scheme:'bearer',description:'Clé opaque aiid_… pour agent/service, jamais un jeton administrateur'}},schemas:{Problem:{type:'object',required:['type','title','status','detail'],properties:{type:{type:'string'},title:{type:'string'},status:{type:'integer'},detail:{type:'string'},request_id:{type:'string'}}}}}};
}
