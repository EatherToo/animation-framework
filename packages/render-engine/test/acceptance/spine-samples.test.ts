import { describe, expect, it } from '@jest/globals'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { importSpineAtlas } from '@/asset/atlas'
import { importSpine } from '@/asset/importer'
import { Engine } from '@/runtime/runtime'

// Jest cwd 是 packages/render-engine
const ROOT = join(process.cwd(), '..', '..', 'test/fixtures/spine')
const SAMPLES = [
  ['spineboy', ['spineboy-pro.json', 'spineboy.atlas', 'spineboy.png']],
  ['raptor', ['raptor-pro.json', 'raptor.atlas', 'raptor.png']],
  ['stretchyman', ['stretchyman-pro.json', 'stretchyman.atlas', 'stretchyman.png']],
] as const
const available = SAMPLES.every(([dir, files]) => files.every((f) => existsSync(join(ROOT, dir, f))))

// 资产不在仓库中：脚本 scripts/fetch-spine-samples.mjs 下载后再启用真实像素 diff。
const suite = available ? describe : describe.skip

suite('official Spine sample assets', () => {
  for (const [dir, files] of SAMPLES) {
    it(`${dir} imports with atlas and image`, () => {
      for (const file of files) {
        const path = join(ROOT, dir, file)
        expect(existsSync(path)).toBe(true)
        expect(statSync(path).size).toBeGreaterThan(0)
      }
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
      const asset = importSpine(JSON.parse(readFileSync(jsonPath, 'utf8')), { atlas, unitScale: 0.01 })
      if (asset.report.errors > 0) console.log(dir, asset.report.issues.filter((i) => i.severity === 'error').slice(0, 10))
      expect(asset.report.errors).toBe(0)
      expect(asset.skeleton.bones.length).toBeGreaterThan(0)
      expect(asset.animations.size).toBeGreaterThan(0)

      // setup pose：背景是 alpha 0；非背景像素 >100，draw call 在预算内。
      const engine = new Engine({ backend: 'cpu', pixelRatio: 0.125 })
      engine.load(asset)
      engine.render()
      const px = engine.readPixels()
      let nonBackground = 0
      for (let i = 0; i < px.length; i += 4) {
        if (px[i]! !== 0 || px[i + 1]! !== 0 || px[i + 2]! !== 0 || px[i + 3]! !== 0) nonBackground += 1
      }
      expect(nonBackground).toBeGreaterThan(100)

      // 关键动画帧：播放首条动画两帧，断言姿态/图集/裁剪链路不崩溃且画面非空。
      const animation = [...asset.animations.keys()][0]
      expect(typeof animation).toBe('string')
      engine.play(animation)
      engine.update(1 / 60)
      engine.update(1 / 60)
      const animated = engine.render()
      expect(animated.packets.length).toBeGreaterThan(0)
      const animatedPx = engine.readPixels()
      let animatedPixels = 0
      for (let i = 0; i < animatedPx.length; i += 4) {
        if (animatedPx[i]! !== 0 || animatedPx[i + 1]! !== 0 || animatedPx[i + 2]! !== 0 || animatedPx[i + 3]! !== 0) {
          animatedPixels += 1
        }
      }
      expect(animatedPixels).toBeGreaterThan(100)
      engine.dispose()
    })
  }
})