/**
 * M9 验收门禁：黄金帧。
 *
 * 固定 64×64 场景（两个三角形 + 一个 region 四边形），无 viewProjection，
 * 位置即设备像素。CpuBackend 连续渲染两次必须逐字节一致；像素流的
 * FNV-1a 64 位 hash 与硬编码常量一致，用于检测任何渲染回归。
 */
import { describe, expect, it } from '@jest/globals'
import { CpuBackend } from '@/backend/backend'
import { buildRegionPacket, sortPackets, type RenderFrame } from '@/render/render'

const SIZE = 64

/** 与 parity.test.ts 中的 makeFrame 必须完全一致。 */
function makeFrame(): RenderFrame {
  const triangleA = buildRegionPacket({
    id: 1,
    positions: new Float32Array([4, 4, 28, 4, 4, 28]),
    color: [1, 0, 0, 1],
    materialId: 0,
    order: 0,
    depthKey: 0,
    seq: 1,
  })
  const triangleB = buildRegionPacket({
    id: 2,
    positions: new Float32Array([36, 36, 60, 36, 36, 60]),
    color: [0, 1, 0, 1],
    materialId: 0,
    order: 1,
    depthKey: 0,
    seq: 2,
  })
  const region = buildRegionPacket({
    id: 3,
    positions: new Float32Array([34, 4, 60, 4, 60, 30, 34, 30]),
    color: [0, 0, 1, 1],
    materialId: 0,
    order: 2,
    depthKey: 0,
    seq: 3,
  })
  return { packets: sortPackets([triangleA, triangleB, region]), width: SIZE, height: SIZE }
}

/** FNV-1a 64 位，输出 16 位小写 hex；字节序就是 readPixels 的 RGBA 顺序。 */
function fnv1a64(bytes: ArrayLike<number>): string {
  let h = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= BigInt(bytes[i]!)
    h = (h * prime) & mask
  }
  return h.toString(16).padStart(16, '0')
}

/** 首次运行红灯取得后写死；详见 golden-frame.txt。 */
const EXPECTED_FNV1A64 = '8e308586c8b4c67d'

describe('M9 黄金帧：64×64 固定场景确定性', () => {
  it('同一帧渲染两次，像素逐字节一致', () => {
    const backend = new CpuBackend(SIZE, SIZE)
    const frame = makeFrame()
    backend.draw(frame)
    const first = backend.readPixels()
    backend.draw(frame)
    const second = backend.readPixels()
    expect(first.length).toBe(SIZE * SIZE * 4)
    expect(Array.from(first)).toEqual(Array.from(second))
    backend.dispose()
  })

  it('像素流 FNV-1a 64 位 hash 命中硬编码常量', () => {
    const backend = new CpuBackend(SIZE, SIZE)
    backend.draw(makeFrame())
    const hash = fnv1a64(backend.readPixels())
    // 红灯阶段用于取值；常量写死后该输出仅作诊断。
    console.log(`[golden] fnv1a64=${hash}`)
    expect(hash).toBe(EXPECTED_FNV1A64)
    backend.dispose()
  })
})
