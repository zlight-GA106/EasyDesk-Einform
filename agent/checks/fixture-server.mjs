import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const png = await fs.readFile(path.resolve(process.argv[2] || 'artifacts/deployed-lunar-preview.png'));
const port = Number(process.argv[3] || 8067);
let revision = 'qa-1', mode = 'good', command = null;
const acknowledgements = [], requests = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (value, status=200) => { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(value)); };
  if (url.pathname === '/control') {
    mode = url.searchParams.get('mode') || mode;
    revision = url.searchParams.get('revision') || revision;
    if (url.searchParams.has('command')) command = {id:Number(url.searchParams.get('command')),type:'force_redraw'};
    return json({mode,revision,acknowledgements,requests});
  }
  requests.push({url:req.url,at:Date.now()});
  if (mode === 'offline') return json({error:'offline fixture'}, 503);
  if (url.pathname === '/api/device/heartbeat') {
    let body=''; for await (const chunk of req) body+=chunk;
    const data=JSON.parse(body);
    if (!data.internalUuid) return json({error:'uuid required'},400);
    return json({ok:true,deviceId:data.deviceId,siteId:data.siteId,refreshIntervalSeconds:300,image:'/api/display/Z9-QA.png',commands:command?[command]:[]});
  }
  if (/^\/api\/device\/command\/\d+\/ack$/.test(url.pathname)) {
    let body=''; for await (const chunk of req) body+=chunk;
    const data=JSON.parse(body); acknowledgements.push({id:Number(url.pathname.split('/')[4]),status:data.status,at:Date.now()});
    command=null; return json({ok:true});
  }
  if (/^\/api\/device\/[^/]+\/meta$/.test(url.pathname)) return json({revision,image:'/api/display/Z9-QA.png',stale:false});
  if (url.pathname === '/api/display/Z9-QA.png') {
    const etag=`"${revision}"`;
    if (req.headers['if-none-match']===etag && mode==='good') { res.writeHead(304,{'ETag':etag}); return res.end(); }
    res.writeHead(200,{'Content-Type':'image/png','ETag':etag,'X-EasyDesk-Revision':revision});
    return res.end(mode==='corrupt'?png.subarray(0,png.length-20):png);
  }
  return json({error:'unknown'},404);
});
server.listen(port,'0.0.0.0',()=>console.log(`Agent QA fixture listening on ${port}`));
