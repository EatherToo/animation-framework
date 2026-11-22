import { describe, expect, it } from '@jest/globals'
// @ts-expect-error test tsconfig 不引入 node 类型；运行时由 Jest 提供
import { existsSync, statSync } from 'node:fs'
// @ts-expect-error 同上
import { join } from 'node:path'

const ROOT = 'test/fixtures/spine'
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
    it(`${dir} has non-empty json/atlas/png`, () => {
      for (const file of files) {
        const path = join(ROOT, dir, file)
        expect(existsSync(path)).toBe(true)
        expect(statSync(path).size).toBeGreaterThan(0)
      }
    })
  }
})
