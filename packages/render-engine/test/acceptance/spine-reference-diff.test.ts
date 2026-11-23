import { describe, expect, it } from '@jest/globals'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { importSpineAtlas } from '@/asset/atlas'
import { importSpine } from '@/asset/importer'
import { Engine } from '@/runtime/runtime'
import { DEFAULT_CAMERA } from '@/render/camera'

const ROOT = join(process.cwd(), '..', '..', 'test/fixtures/spine')
const REF = join(process.cwd(), '..', '..', 'preview/golden/spine-reference')
const SAMPLES = [
  ['spineboy', ['spineboy-pro.json', 'spineboy.atlas', 'spineboy.png']],
  ['raptor', ['raptor-pro.json', 'raptor.atlas', 'raptor.png']],
  ['stretchyman', ['stretchyman-pro.json', 'stretchyman.atlas', 'stretchyman.png']],
] as const
const assetsPresent = (SAMPLES as readonly (readonly [string, readonly [string, string, string]])[]).every(([dir, files]) => files.every((f) => existsSync(join(ROOT, dir, f))))
if (process.env.SPINE_PARITY_REQUIRED === '1' && !assetsPresent) {
  throw new Error('Official Spine samples missing; run node scripts/fetch-spine-samples.mjs before release parity')
}

function ensureReference(): void {
  if (!SAMPLES.every(([dir]) => existsSync(join(REF, dir, 'setup.png')))) {
    execFileSync(process.execPath, ['scripts/render-spine-reference.mjs'], {
      cwd: join(process.cwd(), '..', '..'),
      stdio: 'pipe',
    })
  }
}

function loadAsset(dir: string, files: readonly [string, string, string]) {
  const jsonPath = join(ROOT, dir, files[0])
  const atlasPath = join(ROOT, dir, files[1])
  const pngPath = join(ROOT, dir, files[2])
  const png = PNG.sync.read(readFileSync(pngPath))
  const parsed = importSpineAtlas(readFileSync(atlasPath, 'utf8'))
  const atlas = {
    ...parsed,
    pages: parsed.pages.map((page) => ({
      ...page,
      image: { width: png.width, height: png.height, data: new Uint8Array(png.data) },
    })),
  }
  const meta = JSON.parse(readFileSync(jsonPath, 'utf8')).skeleton
  const asset = importSpine(JSON.parse(readFileSync(jsonPath, 'utf8')), { atlas, unitScale: 0.01, sourceYDown: false })
  return { asset, meta }
}

function diff(reference: PNG, actual: Uint8ClampedArray): { mean: number; max: number } {
  let sum = 0
  let max = 0
  for (let i = 0; i < reference.data.length; i += 4) {
    for (let c = 0; c < 4; c += 1) {
      const d = Math.abs(reference.data[i + c]! - actual[i + c]!)
      sum += d
      max = Math.max(max, d)
    }
  }
  return { mean: sum / reference.data.length, max }
}

// Canvas ignores slot blendMode and has different AA/mixing; this is visual diagnostics only.
const suite = assetsPresent ? describe : describe.skip

suite('official Spine reference pixel diff', () => {
  it('records official canvas diagnostics, not a pixel parity gate', () => {
    ensureReference()
    for (const [dir, files] of SAMPLES as readonly (readonly [string, readonly [string, string, string]])[]) {
      const { asset, meta } = loadAsset(dir, files)
      const scale = Math.min(256 / Math.max(1, meta.width), 192 / Math.max(1, meta.height)) * 0.8
      const camera = {
        ...DEFAULT_CAMERA,
        target: [(meta.x + meta.width / 2) * 0.01, (meta.y + meta.height / 2) * 0.01, 0] as [number, number, number],
        orthoHeight: (192 / scale) * 0.01,
        viewport: { width: 256, height: 192, dpr: 1 },
      }
      const engine = new Engine({ backend: 'cpu', pixelRatio: 256 / DEFAULT_CAMERA.viewport.width, supersample: 8 })
      engine.load(asset)
      engine.setCamera(camera)

      engine.render()
      const setup = PNG.sync.read(readFileSync(join(REF, dir, 'setup.png')))
      expect([setup.width, setup.height]).toEqual([256, 192])
      const setupDiff = diff(setup, engine.readPixels())
      console.log('setup-diff', dir, setupDiff)
      const animation = [...asset.animations.keys()][0]
      engine.play(animation)
      engine.update(0.25)
      engine.render()
      const animated = PNG.sync.read(readFileSync(join(REF, dir, 'anim-0-25.png')))
      expect([animated.width, animated.height]).toEqual([256, 192])
      const animatedDiff = diff(animated, engine.readPixels())
      console.log('anim-diff', dir, animatedDiff)
      engine.dispose()
    }
  })
})
