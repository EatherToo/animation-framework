import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const engine = resolve(root, '../render-engine/dist');
const port = Number(process.env.PORT ?? 5179);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.atlas': 'text/plain' };
createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) return void response.writeHead(405).end();
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const isEngine = path.startsWith('/engine/');
    const base = isEngine ? engine : root;
    let relative = isEngine ? path.slice(8) : path === '/' ? 'index.html' : path.slice(1);
    if (isEngine && !extname(relative)) relative += '.js';
    const file = resolve(base, relative);
    if (!file.startsWith(base + sep) || (isEngine && extname(file) !== '.js')) {
      return void response.writeHead(404).end();
    }
    const info = await stat(file);
    if (!info.isFile()) return void response.writeHead(404).end();
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size, 'Cache-Control': 'no-store' });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
  } catch { response.writeHead(404).end('File unavailable'); }
}).listen(port, '127.0.0.1', () => console.log(`Chibi Stickers: http://127.0.0.1:${port}/`));
