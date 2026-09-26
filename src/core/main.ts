import {loadConfig} from '../shared/config.js';
import {buildCore} from './server.js';
const config=await loadConfig();const {app}=await buildCore(config,{logger:true});
await app.listen({host:'127.0.0.1',port:Number(new URL(config.coreOrigin).port)});
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close().then(()=>process.exit(0));});
