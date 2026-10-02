import fs from 'node:fs/promises';
import path from 'node:path';
import {loadConfig} from '../../src/config/config.js';
import {createApp} from '../../src/app.js';
import express from 'express';
const directory=path.resolve('artifacts/agent-qa/live-server');
const config=await loadConfig();
for(const key of ['dataDir','cacheDir','logDir'])config.storage[key]=path.join(directory,key);
config.render.cacheDir=path.join(directory,'render');config.logging.console=false;config.qweather.provider='mock';
const system=await createApp(config);
const app=express();
app.get('/control',async(req,res)=>{
  const device=system.registry.list().find(d=>d.internalUuid===req.query.uuid);
  if(req.query.force&&device)await system.commands.enqueue(device.internalUuid,'force_redraw');
  res.json({commands:device?system.commands.list(device.internalUuid):[]});
});
app.use(system.app);
const server=app.listen(8068,'0.0.0.0',()=>console.log('Actual isolated Einform backend listening on 8068'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{server.close();await system.close();process.exit(0);});
