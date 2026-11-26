import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const engine = join(root, '../render-engine/dist');
const engineFiles = new Set([
  'core/math.js', 'core/pose.js', 'render/render.js', 'render/shader-variants.js',
  'render/clipping.js', 'mesh/mesh.js', 'asset/image.js', 'backend/backend.js',
]);
const appFiles = new Set(['/main.js', '/chongyue-native.js', '/chongyue-pose.js', '/chongyue-images.js']);
const characterFiles = new Set([
  '/assets/chongyue/front/character-native.json',
  '/assets/chongyue/front/character-pose.bin',
  '/assets/chongyue/front/skeleton.json',
]);
const partFile = /^\/assets\/chongyue\/front\/parts\/CY_Front_[A-Za-z_]+\.png$/;
const port = Number(process.env.PORT ?? 5178);
createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return void response.writeHead(405).end();
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (pathname === '/front' || pathname === '/front/' || pathname === '/front.html') {
    return void response.writeHead(308, { Location: '/' }).end();
  }
  const requestedEngineFile = pathname.startsWith('/engine/') ? pathname.slice(8) : null;
  const engineFile = requestedEngineFile === null ? null
    : requestedEngineFile.endsWith('.js') ? requestedEngineFile : `${requestedEngineFile}.js`;
  const file = pathname === '/' || pathname === '/index.html' ? join(root, 'index.html')
    : appFiles.has(pathname) || characterFiles.has(pathname) || partFile.test(pathname) ? join(root, pathname.slice(1))
    : engineFile !== null && engineFiles.has(engineFile) ? join(engine, engineFile) : null;
  if (file === null) return void response.writeHead(404).end();
  try {
    const info = await stat(file);
    response.writeHead(200, {
      'Content-Type': ({ '.png': 'image/png', '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
        '.bin': 'application/octet-stream' })[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size, 'Cache-Control': 'no-store',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end('File unavailable');
  }
}).listen(port, '127.0.0.1', () => console.log(`Chongyue front pose editor: http://127.0.0.1:${port}/`));
