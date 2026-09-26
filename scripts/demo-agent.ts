import { randomUUID } from 'node:crypto';
import { createAIIDClient } from '../src/sdk/index.js';

const token=process.env.AIID_API_KEY;
const delegation=process.env.AIID_DELEGATION_ID;
if(!token||!delegation)throw new Error('Créer une clé et une délégation dans la console, puis définir AIID_API_KEY et AIID_DELEGATION_ID.');
const client=createAIIDClient({baseUrl:process.env.AIID_CORE_ORIGIN??'http://localhost:4100',token});
const me=await client.getMe();
const decision=await client.authorize({subject:{type:'principal',id:me.principal_id},resource:{type:'tool',id:'demo'},action:{name:'execute'}},{idempotencyKey:randomUUID()});
if(!decision.decision)throw new Error('Permission tool:demo/execute absente.');
console.log(await client.executeTool({delegation_id:delegation,input:'Hello from AI ID'},{idempotencyKey:randomUUID()}));
