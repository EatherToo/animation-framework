/**
 * M9 验收门禁：CI 宽松性能预算。
 *
 * 32×32 帧，1000 轮「pose update → packet build → sort → CPU raster」，
 * 预热后计时，总耗时 < 5000ms（5ms/帧上限，留足 CI 抖动余量）。
 */
import { describe, expect, it } from '@jest/globals'
import { CpuBackend } from '@/backend/backend'
import { WORLD_STRIDE, addRotation, createPose, updateWorld, type Pose } from '@/core/pose'
import { compileSkeleton } from '@/core/skeleton'
import {
  buildRegionPacket,
  sortPackets,
  type RenderFrame,
  type RenderPacket,
} from '@/render/render'

const SIZE = 32
const FRAMES = 1000
const WARMUP = 60
const BUDGET_MS = 5000

const skeleton = compileSkeleton({
  name: 'bench-skeleton',
  profile: 'simple2d',
  bones: [
    { name: 'root', parent: -1, length: 0 },
    { name: 'spine', parent: 0, length: 10 },
    { name: 'arm', parent: 1, length: 8 },
  ],
})
const spineId = skeleton.boneIdByName.get('spine')!

/** 用 spine 骨的世界平移驱动四个四边形，sort 有真实键可用。 */
function buildPackets(pose: Pose): RenderPacket[] {
  const ox = pose.world[spineId * WORLD_STRIDE + 4]!
  const oy = pose.world[spineId * WORLD_STRIDE + 5]!
  const specs: ReadonlyArray<{
    readonly id: number
    readonly color: readonly [number, number, number, number]
    readonly order: number
    readonly dx: number
    readonly dy: number
  }> = [
    { id: 1, color: [1, 0, 0, 1], order: 0, dx: 0, dy: 0 },
    { id: 2, color: [0, 1, 0, 1], order: 1, dx: 6, dy: 0 },
    { id: 3, color: [0, 0, 1, 1], order: 2, dx: 0, dy: 6 },
    { id: 4, color: [1, 1, 0, 1], order: 3, dx: 6, dy: 6 },
  ]
  return sortPackets(specs.map((s) => buildRegionPacket({
    id: s.id,
    positions: new Float32Array([
      ox + s.dx, oy + s.dy,
      ox + s.dx + 5, oy + s.dy,
      ox + s.dx + 5, oy + s.dy + 5,
      ox + s.dx, oy + s.dy + 5,
    ]),
    color: s.color,
    materialId: 0,
    order: s.order,
    depthKey: 0,
    seq: s.id,
  })))
}

describe('M9 bench：1000 帧固定场景总耗时', () => {
  it('pose + packet + sort + CPU raster 总耗时 < 5000ms', () => {
    const pose = createPose(skeleton)
    const backend = new CpuBackend(SIZE, SIZE)
    let frame: RenderFrame = { packets: [], width: SIZE, height: SIZE }

    const runFrame = (index: number): void => {
      addRotation(pose, spineId, 0.01)
      updateWorld(pose)
      frame = { packets: buildPackets(pose), width: SIZE, height: SIZE }
      backend.draw(frame)
      // 防止死代码消除，同时验证每帧确实走完整条链路。
      if (index === FRAMES - 1) expect(backend.stats.packets).toBe(4)
    }

    for (let i = 0; i < WARMUP; i += 1) runFrame(i)

    const start = performance.now()
    for (let i = 0; i < FRAMES; i += 1) runFrame(i)
    const total = performance.now() - start

    const perFrame = total / FRAMES
    console.log(`[bench] ${FRAMES} 帧总计 ${total.toFixed(1)}ms，平均 ${perFrame.toFixed(4)}ms/帧`)
    expect(total).toBeLessThan(BUDGET_MS)
    expect(frame.packets).toHaveLength(4)
    backend.dispose()
  }, 30000)
})
