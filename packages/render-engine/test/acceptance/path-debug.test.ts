import { it } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { importSpineAtlas } from '@/asset/atlas'
import { importSpine } from '@/asset/importer'

it('path debug', () => {
  const root = join(process.cwd(), '..', '..', 'test/fixtures/spine/stretchyman')
  const png = PNG.sync.read(readFileSync(join(root, 'stretchyman.png')))
  const parsed = importSpineAtlas(readFileSync(join(root, 'stretchyman.atlas'), 'utf8'))
  const atlas = { ...parsed, pages: parsed.pages.map((p) => ({ ...p, image: { width: png.width, height: png.height, data: new Uint8Array(png.data) } })) }
  const asset = importSpine(JSON.parse(readFileSync(join(root, 'stretchyman-pro.json'), 'utf8')), { atlas, unitScale: 0.01, sourceYDown: false })
  const skin = asset.skins.get('default')!
  for (const [key, attachment] of skin.attachments) {
    if (attachment.kind === 'path') console.log(key + '=' + JSON.stringify({ len: attachment.polygon.length, head: Array.from(attachment.polygon.slice(0, 12)), hasNaN: Array.from(attachment.polygon).some((v) => !Number.isFinite(v)) }))
  }
  for (const c of asset.constraints ?? []) if (c.kind === 'path') console.log('constraint=' + JSON.stringify({ id: c.id, len: c.points.length, head: Array.from(c.points.slice(0, 12)) }))
})
