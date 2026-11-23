import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const samples = ['spineboy', 'raptor', 'stretchyman']
const files = new Map([
  ['/index.html', join(here, 'index.html')],
  ['/main.js', join(here, 'main.js')],
  ['/pose.html', join(here, 'pose.html')],
  ['/pose.js', join(here, 'pose.js')],
])
for (const name of samples) {
  for (const ext of ['pro.json', 'atlas', 'png']) {
    const filename = ext === 'pro.json' ? `${name}-pro.json` : `${name}.${ext}`
    files.set(`/samples/${name}/${filename}`, join(here, '..', 'test', 'fixtures', 'spine', name, filename))
  }
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.atlas': 'text/plain', '.png': 'image/png' }
const port = Number(process.env.PORT ?? '5173')

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname === '/' ? '/index.html' : url.pathname
  const target = files.get(path)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  if (target === undefined) {
    res.writeHead(404).end('Not found')
    return
  }
  try {
    const info = await stat(target)
    const ext = target.slice(target.lastIndexOf('.'))
    res.writeHead(200, { 'Content-Type': mime[ext] ?? 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-store' })
    if (req.method === 'HEAD') res.end()
    else createReadStream(target).pipe(res)
  } catch {
    res.writeHead(404).end('Sample missing. Run pnpm fetch:spine-samples first.')
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Spine preview: http://127.0.0.1:${port}/`)
})
