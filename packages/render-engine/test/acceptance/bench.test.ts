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
  batchPackets,
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

// A33a is a 256x256 raster workload proxy, not a measured 1080p pixel budget.
describe('A33a: 100-armature CPU workload', () => {
  it('measures 600 warmed frames with bounded typed-array output', () => {
    const poses = Array.from({ length: 100 }, () => createPose(skeleton))
    const backend = new CpuBackend(256, 256)
    const samples: number[] = []
    let maxBytes = 0
    let maxDrawCalls = 0
    let checksum = 0
    const runFrame = (): number => {
      const start = performance.now()
      const packets: RenderPacket[] = []
      for (let i = 0; i < poses.length; i += 1) {
        const pose = poses[i]!
        addRotation(pose, spineId, 0.001)
        updateWorld(pose)
        const x = i % 10 * 24 + 3 + pose.world[spineId * WORLD_STRIDE + 4]! * 0.01
        const y = Math.floor(i / 10) * 24 + 3
        for (let slot = 0; slot < 4; slot += 1) {
          const dx = slot % 2 * 6
          const dy = Math.floor(slot / 2) * 6
          packets.push(buildRegionPacket({
            id: i * 4 + slot,
            positions: new Float32Array([x + dx, y + dy, x + dx + 4, y + dy,
              x + dx + 4, y + dy + 4, x + dx, y + dy + 4]),
            color: [1, 0.5, 0.25, 1], materialId: 0,
            order: i * 4 + slot, depthKey: 0, seq: i * 4 + slot,
          }))
        }
      }
      const bytes = (p: RenderPacket): number => p.positions.byteLength + p.uvs.byteLength +
        p.colors.byteLength + p.indices.byteLength + (p.depth?.byteLength ?? 0)
      const batches = batchPackets(sortPackets(packets))
      maxBytes = Math.max(maxBytes, packets.reduce((n, p) => n + bytes(p), 0) +
        batches.reduce((n, p) => n + bytes(p), 0))
      backend.draw({ packets: batches, width: 256, height: 256 })
      maxDrawCalls = Math.max(maxDrawCalls, backend.stats.drawCalls)
      checksum += backend.stats.uploadedVertices
      expect(packets).toHaveLength(400)
      return performance.now() - start
    }
    try {
      for (let i = 0; i < 60; i += 1) runFrame()
      for (let i = 0; i < 600; i += 1) samples.push(runFrame())
      samples.sort((a, b) => a - b)
      const p50 = samples[299]!
      const p95 = samples[569]!
      console.log(`[A33a] 100 armatures, 400 attachments, 256x256: p50=${p50.toFixed(2)}ms ` +
        `p95=${p95.toFixed(2)}ms drawCalls=${maxDrawCalls} typedBytes/frame<=${maxBytes}`)
      expect(checksum).toBeGreaterThan(0)
      expect(backend.readPixels()[(4 * 256 + 4) * 4]).toBeGreaterThan(0)
      expect(maxBytes).toBeLessThanOrEqual(120_000)
      expect(maxDrawCalls).toBeLessThanOrEqual(50)
      expect(p95).toBeLessThanOrEqual(16.6)
    } finally {
      backend.dispose()
    }
  }, 120000)
})

// Run with A33A_CPU_1080P=1 pnpm -C packages/render-engine exec jest --runInBand --runTestsByPath test/acceptance/bench.test.ts -t 'actual 1920x1080'.
// This measures real 1920x1080 CPU rasterization, not a scaled-up proxy result.
const fullHdEnabled = process.env.A33A_CPU_1080P === '1'
if (!fullHdEnabled) {
  console.warn('[A33a 1920x1080 SKIP] Set A33A_CPU_1080P=1 to measure the full-resolution CPU gate; no 1080p pass was measured')
}

describe('A33a: actual 1920x1080 CPU raster', () => {
  const fullHdIt = fullHdEnabled ? it : it.skip
  fullHdIt('100 armatures / 400 attachments / 600 warmed frames: p95 <= 16.6ms, draw calls <= 50', () => {
    const width = 1920
    const height = 1080
    const warmup = 60
    const measured = 600
    const poses = Array.from({ length: 100 }, () => createPose(skeleton))
    const backend = new CpuBackend(width, height, 1)
    const samples: number[] = []
    let maxDrawCalls = 0
    let minDrawCalls = Infinity
    let minVertices = Infinity
    let minPackets = Infinity

    const runFrame = (): number => {
      const start = performance.now()
      const packets: RenderPacket[] = []
      for (let i = 0; i < poses.length; i += 1) {
        const pose = poses[i]!
        addRotation(pose, spineId, 0.001)
        updateWorld(pose)
        const x = (i % 10) * 192 + 20 + pose.world[spineId * WORLD_STRIDE + 4]! * 0.01
        const y = Math.floor(i / 10) * 108 + 12
        for (let slot = 0; slot < 4; slot += 1) {
          const left = x + (slot % 2) * 70
          const top = y + Math.floor(slot / 2) * 45
          const id = i * 4 + slot
          packets.push(buildRegionPacket({
            id,
            positions: new Float32Array([
              left, top, left + 36, top, left + 36, top + 24, left, top + 24,
            ]),
            color: [1, 0.5, 0.25, 1], materialId: 0,
            order: id, depthKey: 0, seq: id,
          }))
        }
      }
      const batches = batchPackets(sortPackets(packets))
      backend.draw({ packets: batches, width, height })
      maxDrawCalls = Math.max(maxDrawCalls, backend.stats.drawCalls)
      minDrawCalls = Math.min(minDrawCalls, backend.stats.drawCalls)
      minVertices = Math.min(minVertices, backend.stats.uploadedVertices)
      minPackets = Math.min(minPackets, packets.length)
      return performance.now() - start
    }

    try {
      for (let i = 0; i < warmup; i += 1) runFrame()
      for (let i = 0; i < measured; i += 1) samples.push(runFrame())
      samples.sort((a, b) => a - b)
      const p50 = samples[Math.ceil(measured * 0.5) - 1]!
      const p95 = samples[Math.ceil(measured * 0.95) - 1]!
      const pixels = backend.readPixels()
      console.log(`[A33a 1920x1080] node=${process.version} platform=${process.platform}/${process.arch} ` +
        `warmup=${warmup} measured=${measured} p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms ` +
        `drawCalls=${minDrawCalls}..${maxDrawCalls} coverage=400x36x24 pixels/frame`)
      expect(samples).toHaveLength(measured)
      expect(minPackets).toBe(400)
      expect(minVertices).toBe(1600)
      expect(pixels).toHaveLength(width * height * 4)
      expect(pixels[(17 * width + 25) * 4]).toBeGreaterThan(0)
      expect(pixels[(1034 * width + 1823) * 4]).toBeGreaterThan(0)
      expect(minDrawCalls).toBeGreaterThan(0)
      expect(maxDrawCalls).toBeLessThanOrEqual(50)
      expect(p95).toBeLessThanOrEqual(16.6)
    } finally {
      backend.dispose()
    }
  }, 600000)
})
