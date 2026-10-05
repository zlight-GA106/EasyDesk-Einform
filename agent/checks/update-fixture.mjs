import http from 'node:http';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
const base = path.resolve(process.argv[2]);
const port = Number(process.argv[3] || 8079);
const good = await fs.readFile(path.join(base,'update-fixture-v5.apk'));
const other = await fs.readFile(path.join(base,'update-fixture-other-signature.apk'));
const api21 = await fs.readFile(path.join(base,'update-fixture-api21.apk'));
let mode = 'good'; const heartbeats=[];
http.createServer(async(req,res)=>{
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/control'){mode=url.searchParams.get('mode')||mode;return json({mode,heartbeats});}
    if(url.pathname==='/api/v1/heartbeat'){
      let body='';for await(const chunk of req)body+=chunk;
      heartbeats.push(JSON.parse(body));return json({ok:true});
    }
    const bytes=mode==='signature'?other:mode==='sdk'?api21:good;
    const release={package_name:mode==='package'?'com.wrong.app':'com.easysmart.einform',update_available:true,version_name:'0.1.4-z9-TEST',version_code:mode==='old'?3:5,
      mandatory:false,release_notes:'Isolated test APK; never publish this build.',download_url:`http://10.0.2.2:${port}/api/v1/apps/com.easysmart.einform/releases/5/download`,size:bytes.length,
      sha256:mode==='hash'?'0'.repeat(64):crypto.createHash('sha256').update(bytes).digest('hex')};
    if(mode==='foreign')release.download_url='http://127.0.0.1:9999/api/v1/apps/com.easysmart.einform/releases/5/download';
    if(mode==='size')release.size++;
    if(url.pathname==='/api/v1/apps/com.easysmart.einform/latest')return json(release);
    if(url.pathname==='/api/v1/apps/com.easysmart.einform/releases/5/download'){
      if(mode==='redirect'){res.writeHead(302,{Location:'http://127.0.0.1:9999/untrusted.apk'});return res.end();}
      res.writeHead(200,{'Content-Type':'application/vnd.android.package-archive','Content-Length':bytes.length});return res.end(bytes);
    }
    return json({error:'unknown'},404);
  }catch(error){if(!res.destroyed&&!res.headersSent)return json({error:String(error)},500);}
}).listen(port,'0.0.0.0',()=>console.log(`Easyupdate isolated fixture ${port}`));
