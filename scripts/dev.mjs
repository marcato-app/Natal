// Servidor local pra jogar sem Cloudflare: serve os arquivos da raiz e manda /api
// pro mesmo Worker de produção, com o banco num SQLite local (.wrangler/dev.sqlite).
//
//   node scripts/dev.mjs        → http://localhost:8787

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.js';
import { bancoLocal, makeD1 } from './d1-local.mjs';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const porta = Number(process.env.PORT) || 8787;
await mkdir(join(raiz, '.wrangler'), { recursive: true });
const DB = makeD1(bancoLocal(join(raiz, '.wrangler', 'dev.sqlite')));
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.glb': 'model/gltf-binary' };
const BLOQUEADO = /^\/(src|test|migrations|scripts|\.wrangler|\.git|node_modules)(\/|$)/;

const ASSETS = {
  async fetch(req) {
    let path = decodeURIComponent(new URL(req.url).pathname);
    if (path.endsWith('/')) path += 'index.html';
    path = normalize(path);
    if (BLOQUEADO.test(path)) return new Response('Não encontrado', { status: 404 });
    try {
      const body = await readFile(join(raiz, path));
      return new Response(body, { headers: { 'Content-Type': TIPOS[extname(path)] || 'application/octet-stream' } });
    } catch { return new Response('Não encontrado', { status: 404 }); }
  },
};

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://localhost:${porta}${req.url}`, {
    method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const r = await worker.fetch(request, { DB, ASSETS });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(porta, () => console.log(`Vila de Natal em http://localhost:${porta}`));
