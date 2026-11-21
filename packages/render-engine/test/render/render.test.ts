import { describe, expect, it } from '@jest/globals'
import {
  atlasRegionUv,
  batchKey,
  buildMeshPacket,
  buildRegionPacket,
  outlineEdges,
  sortPackets,
  toPma,
  validateAtlasPages,
  validateMaskPath,
  type RenderPacket,
} from '@/render/render'

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps)

function quadPositions(): Float32Array {
  return new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
}

function quadUvs(): Float32Array {
  return new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
}

function quadIndices(): Uint16Array {
  return new Uint16Array([0, 1, 2, 0, 2, 3])
}

/** 构造一个满足契约的最小 packet，便于只覆盖需要测试的字段。 */
function mkPacket(id: number, over: Partial<RenderPacket> = {}): RenderPacket {
  return {
    id,
    kind: 'region',
    version: 1,
    positions: quadPositions(),
    uvs: quadUvs(),
    colors: new Uint8Array([
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]),
    depth: null,
    indices: quadIndices(),
    materialId: 0,
    blend: 'normal',
    maskPath: 0,
    order: 0,
    depthKey: 0,
    subOrder: 0,
    seq: id,
    ...over,
  }
}

describe('M4 render: 排序与合批键', () => {
  it('按 order / depthKey / subOrder / seq 全升序排列，不修改输入', () => {
    const packets = [
      mkPacket(1, { order: 2, depthKey: 0, subOrder: 0, seq: 1 }),
      mkPacket(2, { order: 1, depthKey: 5, subOrder: 0, seq: 2 }),
      mkPacket(3, { order: 1, depthKey: 5, subOrder: 1, seq: 3 }),
      mkPacket(4, { order: 1, depthKey: -1, subOrder: 0, seq: 4 }),
    ]
    const before = packets.map((p) => p.id)
    const out = sortPackets(packets)
    expect(out.map((p) => p.id)).toEqual([4, 2, 3, 1])
    expect(packets.map((p) => p.id)).toEqual(before)
    for (let i = 1; i < out.length; i += 1) {
      const a = out[i - 1]!
      const b = out[i]!
      const ascending =
        a.order < b.order ||
        (a.order === b.order && a.depthKey < b.depthKey) ||
        (a.order === b.order && a.depthKey === b.depthKey && a.subOrder < b.subOrder) ||
        (a.order === b.order && a.depthKey === b.depthKey && a.subOrder === b.subOrder && a.seq <= b.seq)
      expect(ascending).toBe(true)
    }
  })

  it('排序稳定：完全相同的键保持输入相对次序', () => {
    const packets = [
      mkPacket(7, { order: 0, seq: 0 }),
      mkPacket(8, { order: 0, seq: 0 }),
      mkPacket(9, { order: 0, seq: 0 }),
    ]
    expect(sortPackets(packets).map((p) => p.id)).toEqual([7, 8, 9])
  })

  it('batchKey 由 materialId|blend|maskPath|indexType|kind 组成', () => {
    const base = mkPacket(1, { materialId: 3, blend: 'add', maskPath: 2, kind: 'region' })
    expect(batchKey(base)).toBe('3|add|2|16|region')
    expect(
      batchKey(mkPacket(1, {
        materialId: 3, blend: 'add', maskPath: 2, kind: 'region', indices: new Uint32Array([0, 1, 2]),
      })),
    ).toBe('3|add|2|32|region')
    expect(batchKey(mkPacket(1, { materialId: 3, blend: 'add', maskPath: 2, kind: 'outline' }))).not.toBe(batchKey(base))
    expect(batchKey(mkPacket(1, { materialId: 4, blend: 'add', maskPath: 2, kind: 'region' }))).not.toBe(batchKey(base))
    expect(batchKey(mkPacket(1, { materialId: 3, blend: 'normal', maskPath: 2, kind: 'region' }))).not.toBe(batchKey(base))
    expect(batchKey(mkPacket(1, { materialId: 3, blend: 'add', maskPath: 3, kind: 'region' }))).not.toBe(batchKey(base))
  })
})

describe('M4 render: 颜色、UV 与校验', () => {
  it('PMA 只乘一次，且 clamp 到 [0,1]', () => {
    const pma = toPma([1, 1, 1, 0.5])
    close(pma[0]!, 0.5)
    close(pma[1]!, 0.5)
    close(pma[2]!, 0.5)
    close(pma[3]!, 0.5)
    const clamped = toPma([2, -1, 0.5, 2])
    close(clamped[0]!, 1)
    close(clamped[1]!, 0)
    close(clamped[2]!, 0.5)
    close(clamped[3]!, 1)
  })

  it('buildRegionPacket 把直通颜色烘焙成 Uint8 PMA，pma 输入不二次预乘', () => {
    const straight = buildRegionPacket({
      id: 1, positions: quadPositions(), uvs: quadUvs(),
      color: [1, 1, 1, 0.5], materialId: 0, order: 0, depthKey: 0,
    })
    expect(Array.from(straight.colors.slice(0, 4))).toEqual([128, 128, 128, 128])

    const already = buildRegionPacket({
      id: 1, positions: quadPositions(), uvs: quadUvs(),
      color: [0.5, 0.5, 0.5, 0.5], materialId: 0, order: 0, depthKey: 0, pma: true,
    })
    expect(Array.from(already.colors.slice(0, 4))).toEqual([128, 128, 128, 128])

    const naughty = buildRegionPacket({
      id: 1, positions: quadPositions(), uvs: quadUvs(),
      color: [0.5, 0.5, 0.5, 0.5], materialId: 0, order: 0, depthKey: 0,
    })
    expect(Array.from(naughty.colors.slice(0, 4))).toEqual([64, 64, 64, 128])
    expect(straight.version).toBe(1)
    expect(straight.kind).toBe('region')
  })

  it('半 texel 内缩成图集 UV', () => {
    const uv = atlasRegionUv(
      { x: 2, y: 3, width: 10, height: 20 },
      { width: 100, height: 200 },
    )
    close(uv.u0, 2.5 / 100)
    close(uv.v0, 3.5 / 200)
    close(uv.u1, 11.5 / 100)
    close(uv.v1, 22.5 / 200)
  })

  it('region 用图集矩形映射 UV，无 region 时原样使用 UV', () => {
    const rect = { x: 2, y: 3, width: 10, height: 20 }
    const page = { width: 100, height: 200 }
    const uv = atlasRegionUv(rect, page)
    const mapped = buildRegionPacket({
      id: 1, positions: quadPositions(), uvs: quadUvs(),
      color: [1, 1, 1, 1], materialId: 0, order: 0, depthKey: 0,
      region: { rect, page },
    })
    // UV 存入 Float32Array，需容忍 float32 舍入。
    const closeF32 = (a: number, b: number) => close(a, b, 1e-6)
    closeF32(mapped.uvs[0]!, uv.u0)
    closeF32(mapped.uvs[1]!, uv.v0)
    closeF32(mapped.uvs[2]!, uv.u1)
    closeF32(mapped.uvs[3]!, uv.v0)
    closeF32(mapped.uvs[4]!, uv.u1)
    closeF32(mapped.uvs[5]!, uv.v1)

    const raw = quadUvs()
    const plain = buildRegionPacket({
      id: 1, positions: quadPositions(), uvs: raw,
      color: [1, 1, 1, 1], materialId: 0, order: 0, depthKey: 0,
    })
    expect(Array.from(plain.uvs)).toEqual(Array.from(raw))
  })

  it('buildMeshPacket 带上 indices / depth / 排序状态', () => {
    const positions = new Float32Array([0, 0, 1, 0, 0, 1])
    const indices = new Uint16Array([0, 1, 2])
    const depth = new Float32Array([1, 2, 3])
    const mesh = buildMeshPacket({
      id: 9, positions, uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      color: [1, 0, 0, 1], materialId: 4, order: 2, depthKey: 3,
      indices, depth, maskPath: 4, seq: 5, subOrder: 1, blend: 'add',
    })
    expect(mesh.kind).toBe('mesh')
    expect(mesh.indices).toBe(indices)
    expect(mesh.depth).toBe(depth)
    expect(mesh.materialId).toBe(4)
    expect(mesh.order).toBe(2)
    expect(mesh.depthKey).toBe(3)
    expect(mesh.maskPath).toBe(4)
    expect(mesh.seq).toBe(5)
    expect(mesh.subOrder).toBe(1)
    expect(mesh.blend).toBe('add')
    expect(Array.from(mesh.colors.slice(0, 4))).toEqual([255, 0, 0, 255])
  })

  it('图集页必须在 1..4；maskPath 为非负整数', () => {
    for (const n of [1, 2, 3, 4]) expect(validateAtlasPages(n)).toBe(true)
    for (const n of [0, 5, -1, 1.5, NaN]) expect(validateAtlasPages(n)).toBe(false)
    for (const n of [0, 1, 42]) expect(validateMaskPath(n)).toBe(true)
    for (const n of [-1, 1.5, NaN]) expect(validateMaskPath(n)).toBe(false)
  })
})

describe('M4 render: 描边边表', () => {
  it('共享边只出现一次，边界边稳定排序', () => {
    expect(outlineEdges(new Uint16Array([0, 1, 2, 0, 2, 3]))).toEqual([
      [0, 1], [0, 3], [1, 2], [2, 3],
    ])
    expect(outlineEdges(new Uint32Array([0, 1, 2]))).toEqual([
      [0, 1], [0, 2], [1, 2],
    ])
  })
})
