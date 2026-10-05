import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const png = await fs.readFile(path.resolve(process.argv[2] || 'artifacts/deployed-lunar-preview.png'));
const port = Number(process.argv[3] || 8067);
let revision = 'qa-1', mode = 'good', heartbeatMode = 'good';
const commands = new Map();
const acknowledgements = [], requests = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (value, status=200) => { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(value)); };
  try {
  if (url.pathname === '/control') {
    mode = url.searchParams.get('mode') || mode;
    heartbeatMode = url.searchParams.get('heartbeat') || heartbeatMode;
    revision = url.searchParams.get('revision') || revision;
    if (url.searchParams.has('command')) {
      const command = {id:Number(url.searchParams.get('command')),type:url.searchParams.get('type') || 'force_redraw'};
      if (url.searchParams.get('automatic') === '1') command.payload={automatic:true,revision,image:'/api/display/Z9-QA.png'};
      commands.set(command.id,command);
    }
    return json({mode,heartbeatMode,revision,acknowledgements,requests});
  }
  requests.push({url:req.url,at:Date.now()});
  if (mode === 'offline') return json({error:'offline fixture'}, 503);
  if (url.pathname === '/api/device/heartbeat') {
    if (heartbeatMode === 'fail') return json({error:'heartbeat-only failure'},503);
    let body=''; for await (const chunk of req) body+=chunk;
    const data=JSON.parse(body);
    if (heartbeatMode === 'slow') await new Promise(resolve=>setTimeout(resolve,15000));
    if (!data.internalUuid) return json({error:'uuid required'},400);
    return json({ok:true,deviceId:data.deviceId,siteId:data.siteId,refreshIntervalSeconds:300,image:'/api/display/Z9-QA.png',commands:[...commands.values()]});
  }
  if (/^\/api\/device\/[^/]+\/commands$/.test(url.pathname)) {
    if (!url.searchParams.get('internalUuid')) return json({error:'uuid required'},400);
    if (!commands.size) await new Promise(resolve=>setTimeout(resolve,500));
    return json({ok:true,deviceId:'Z9-QA',siteId:'QA',refreshIntervalSeconds:300,cursor:Math.max(0,...commands.keys()),commands:[...commands.values()]});
  }
  if (/^\/api\/device\/command\/\d+\/ack$/.test(url.pathname)) {
    let body=''; for await (const chunk of req) body+=chunk;
    const data=JSON.parse(body); acknowledgements.push({id:Number(url.pathname.split('/')[4]),status:data.status,at:Date.now()});
    commands.delete(Number(url.pathname.split('/')[4])); return json({ok:true});
  }
  if (/^\/api\/device\/[^/]+\/meta$/.test(url.pathname)) return json({revision,image:'/api/display/Z9-QA.png',stale:false,refreshIntervalSeconds:300});
  if (url.pathname === '/api/display/Z9-QA.png') {
    const etag=`"${revision}"`;
    if (req.headers['if-none-match']===etag && mode==='good') { res.writeHead(304,{'ETag':etag}); return res.end(); }
    res.writeHead(200,{'Content-Type':'image/png','ETag':etag,'X-EasyDesk-Revision':revision});
    return res.end(mode==='corrupt'?png.subarray(0,png.length-20):png);
  }
  return json({error:'unknown'},404);
  } catch (error) { if (!res.destroyed && !res.headersSent) return json({error:String(error)},500); }
});
server.listen(port,'0.0.0.0',()=>console.log(`Agent QA fixture listening on ${port}`));
