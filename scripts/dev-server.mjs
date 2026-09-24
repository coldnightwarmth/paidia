import http from 'node:http';
import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { refreshPageUpdates } from './lib/page-updates.mjs';
const root=path.resolve('.');
let pending;
const refresh=()=>pending??=(refreshPageUpdates(path.join(root,'data')).finally(()=>{pending=null;}));
await refresh();
// Rebuild only when source data changes, never in response to a page request.
let timer;
const watcher = watch(path.join(root, 'data'), { recursive: true }, (event, filename) => {
  if (!filename) return;
  const name = filename.toString().replaceAll('\\', '/');
  if (!name.endsWith('.json') || ['home-updates.json', 'page-revisions.json'].includes(name)) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      // If a previous scan is active, follow it with a scan of the latest edit.
      if (pending) await pending;
      await refresh();
    } catch (error) { console.error('Page updates:', error.message); }
  }, 300);
});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf','.pdf':'application/pdf'};
http.createServer(async(req,res)=>{
  try {
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
    const url=new URL(req.url,'http://localhost');
    const relative=decodeURIComponent(url.pathname);
    const file=path.resolve(root,'.'+(relative==='/'?'/index.html':relative));
    if(!file.startsWith(root+path.sep)||relative.split('/').some(p=>p.startsWith('.'))){res.writeHead(403).end();return;}
    const body=await fs.readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'});
    res.end(req.method==='HEAD'?undefined:body);
  } catch(error){res.writeHead(error.code==='ENOENT'?404:500).end('Unable to load resource');}
}).listen(Number(process.env.PORT??4173),'127.0.0.1',()=>console.log('Paidiasophia: http://localhost:4173'));
process.on('SIGTERM',()=>{clearTimeout(timer);watcher.close();process.exit();});
