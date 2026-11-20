import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
const port = Number(process.argv[2] || 4173);
const root = process.argv[3] ? resolve(process.argv[3]) : fileURLToPath(new URL('.',import.meta.url));
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8','.png':'image/png'};
http.createServer(async(req,res)=>{
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let path = resolve(root,`.${pathname}`);
    if (path !== root && !path.startsWith(root.endsWith(sep)?root:root+sep)) {res.writeHead(403).end();return;}
    if ((await stat(path)).isDirectory()) {
      if (!pathname.endsWith('/')) {res.writeHead(302,{Location:pathname+'/'+new URL(req.url,'http://localhost').search}).end();return;}
      path = resolve(path,'index.html');
    }
    const data = await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);
  } catch {res.writeHead(404,{'Content-Type':'text/plain'}).end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Pocket local preview: http://127.0.0.1:${port}/`));
