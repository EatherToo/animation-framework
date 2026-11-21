import { describe, expect, it } from '@jest/globals'
import { CpuBackend, WebGL2Backend } from '@/backend/backend'
import {
  buildMaskSet,
  buildMeshPacket,
  buildRegionPacket,
  maskChain,
  validateMaskPaths,
  type MaterialDef,
  type MaskPathNode,
  type RenderAssets,
  type RenderFrame,
  type RenderMask,
  type TextureData,
} from '@/render/render'
import { FakeWebGL } from './fake-webgl'

const BG: readonly [number, number, number, number] = [0, 0, 0, 255]

function tex(width: number, height: number, pixels: number[]): TextureData {
  return { width, height, data: new Uint8Array(pixels), pma: true }
}

function fullQuad(width: number, height: number, color: readonly [number, number, number, number]): ReturnType<typeof buildRegionPacket> {
  return buildRegionPacket({
    id: 1,
    positions: new Float32Array([0, 0, width, 0, width, height, 0, height]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    color,
    materialId: 0,
    order: 0,
    depthKey: 0,
  })
}

function scissorMask(x: number, y: number, width: number, height: number, invert = false): RenderMask {
  return {
    id: 0,
    mode: 'scissor',
    invert,
    feather: 0,
    positions: new Float32Array(0),
    indices: new Uint32Array(0),
    bounds: { x, y, width, height },
  }
}

function polygonMask(positions: number[], invert = false, feather = 0): RenderMask {
  const count = positions.length / 2
  const indices = new Uint32Array(count * 3)
  let cursor = 0
  for (let i = 1; i + 1 < count; i += 1) {
    indices[cursor++] = 0
    indices[cursor++] = i
    indices[cursor++] = i + 1
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < positions.length; i += 2) {
    minX = Math.min(minX, positions[i]!)
    maxX = Math.max(maxX, positions[i]!)
    minY = Math.min(minY, positions[i]!)
    maxY = Math.max(maxY, positions[i]!)
  }
  return {
    id: 0,
    mode: 'stencil',
    invert,
    feather,
    positions: new Float32Array(positions),
    indices: indices.subarray(0, cursor),
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  }
}

function alphaMask(page: number, bounds: RenderMask['bounds'], invert = false): RenderMask {
  return {
    id: 0,
    mode: 'alpha',
    invert,
    feather: 0,
    positions: new Float32Array(0),
    indices: new Uint32Array(0),
    bounds,
    alpha: { page, uvMatrix: new Float32Array([1, 0, 0, 1, 0, 0]) },
  }
}

function frameWithMask(width: number, height: number, mask: RenderMask, packet = fullQuad(width, height, [1, 1, 1, 1]), assets?: RenderAssets): RenderFrame {
  const base: RenderFrame = {
    packets: [packet],
    width,
    height,
    maskPaths: [{ maskId: 0, parent: -1 }],
    masks: buildMaskSet([mask]),
  }
  return assets === undefined ? base : { ...base, assets }
}

function at(px: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number, number] {
  const o = (y * width + x) * 4
  return [px[o]!, px[o + 1]!, px[o + 2]!, px[o + 3]!]
}

function cpuFrame(frame: RenderFrame): Uint8ClampedArray {
  const backend = new CpuBackend({ width: frame.width, height: frame.height, supersample: 1, background: BG })
  backend.draw(frame)
  return backend.readPixels()
}

const SPRITE: MaterialDef = { id: 0, kind: 'sprite', page: 0, filter: 'nearest' }

describe('M10 mask: maskChain 与路径校验', () => {
  it('沿 parent 从根到内层返回 maskId 链', () => {
    const paths: MaskPathNode[] = [
      { maskId: 10, parent: -1 },
      { maskId: 11, parent: 0 },
      { maskId: 12, parent: 1 },
    ]
    expect(maskChain(-1, paths)).toEqual({ ids: [], error: false })
    expect(maskChain(0, paths)).toEqual({ ids: [10], error: false })
    expect(maskChain(2, paths)).toEqual({ ids: [10, 11, 12], error: false })
  })

  it('越界与循环返回空并标记 error', () => {
    expect(maskChain(9, [{ maskId: 0, parent: -1 }])).toEqual({ ids: [], error: true })
    // 0 → 1 → 0 形成环，没有根。
    const cyclic: MaskPathNode[] = [
      { maskId: 0, parent: 1 },
      { maskId: 1, parent: 0 },
    ]
    expect(maskChain(0, cyclic)).toEqual({ ids: [], error: true })
  })

  it('validateMaskPaths：父必须小于自身下标、最多 8 层', () => {
    expect(validateMaskPaths([{ maskId: 0, parent: -1 }, { maskId: 1, parent: 0 }])).toBe(true)
    // 父指向自身或更大下标均非法。
    expect(validateMaskPaths([{ maskId: 0, parent: 0 }])).toBe(false)
    expect(validateMaskPaths([{ maskId: 0, parent: -1 }, { maskId: 1, parent: 2 }])).toBe(false)
    // 9 层超出上限。
    const deep: MaskPathNode[] = []
    for (let i = 0; i < 9; i += 1) deep.push({ maskId: i, parent: i - 1 })
    expect(validateMaskPaths(deep)).toBe(false)
    // 8 层合法。
    expect(validateMaskPaths(deep.slice(0, 8))).toBe(true)
  })

  it('buildMaskSet 保留顺序与 null 占位', () => {
    const set = buildMaskSet([scissorMask(0, 0, 4, 4)])
    expect(set.version).toBe(1)
    expect(set.masks.length).toBe(1)
    expect(set.masks[0]?.mode).toBe('scissor')
  })
})

describe('M10 mask: CPU scissor / stencil / invert / alpha', () => {
  it('scissor 只保留矩形内像素', () => {
    const W = 16
    const H = 16
    const frame = frameWithMask(W, H, scissorMask(4, 4, 8, 8))
    const px = cpuFrame(frame)
    expect(at(px, W, 8, 8)).toEqual([255, 255, 255, 255])
    expect(at(px, W, 1, 1)).toEqual([0, 0, 0, 255])
    expect(at(px, W, 13, 13)).toEqual([0, 0, 0, 255])
  })

  it('stencil 用奇偶多边形，菱形角被裁掉', () => {
    const W = 16
    const H = 16
    const diamond = polygonMask([8, 2, 14, 8, 8, 14, 2, 8])
    const px = cpuFrame(frameWithMask(W, H, diamond))
    expect(at(px, W, 8, 8)).toEqual([255, 255, 255, 255])
    // 包围盒角落落在菱形外，证明不是 AABB 裁剪。
    expect(at(px, W, 3, 3)).toEqual([0, 0, 0, 255])
    expect(at(px, W, 12, 12)).toEqual([0, 0, 0, 255])
  })

  it('invert 反转 stencil 覆盖率', () => {
    const W = 16
    const H = 16
    const diamond = polygonMask([8, 2, 14, 8, 8, 14, 2, 8], true)
    const px = cpuFrame(frameWithMask(W, H, diamond))
    expect(at(px, W, 8, 8)).toEqual([0, 0, 0, 255])
    expect(at(px, W, 3, 3)).toEqual([255, 255, 255, 255])
  })

  it('alpha 页按阈值裁剪，支持 invert', () => {
    const W = 16
    const H = 16
    // 2x2 alpha 页：仅左上角 texel 不透明。
    const page = tex(2, 2, [
      255, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ])
    const assets: RenderAssets = {
      pages: [page],
      // 颜色走 flat，唯一页只作为 alpha mask 采样源。
      materials: [{ id: 0, kind: 'flat', page: -1, filter: 'nearest' }],
    }
    const mask = alphaMask(0, { x: 0, y: 0, width: W, height: H })
    const px = cpuFrame(frameWithMask(W, H, mask, undefined, assets))
    expect(at(px, W, 4, 4)).toEqual([255, 255, 255, 255])
    expect(at(px, W, 12, 4)).toEqual([0, 0, 0, 255])

    const inverted = cpuFrame(frameWithMask(W, H, alphaMask(0, { x: 0, y: 0, width: W, height: H }, true), undefined, assets))
    expect(at(inverted, W, 4, 4)).toEqual([0, 0, 0, 255])
    expect(at(inverted, W, 12, 4)).toEqual([255, 255, 255, 255])
  })
})

describe('M10 mask: 纹理 + mask 组合', () => {
  it('sprite 先采样纹理，再被 scissor 裁剪', () => {
    const W = 16
    const H = 16
    const page = tex(2, 1, [255, 0, 0, 255, 0, 0, 255, 255])
    const assets: RenderAssets = { pages: [page], materials: [SPRITE] }
    const packet = buildRegionPacket({
      id: 1,
      positions: new Float32Array([0, 0, W, 0, W, H, 0, H]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      color: [1, 1, 1, 1],
      materialId: 0,
      order: 0,
      depthKey: 0,
    })
    const px = cpuFrame(frameWithMask(W, H, scissorMask(0, 0, 8, H), packet, assets))
    // 左半：纹理红 texel；右半被 mask 裁掉。
    expect(at(px, W, 4, 8)).toEqual([255, 0, 0, 255])
    expect(at(px, W, 12, 8)).toEqual([0, 0, 0, 255])

    // 无 mask 时右半可见蓝 texel。
    const plain = cpuFrame({ packets: [packet], width: W, height: H, assets })
    expect(at(plain, W, 12, 8)).toEqual([0, 0, 255, 255])
  })
})

describe('M10 mask: 深度 test / write', () => {
  function depthQuad(
    width: number,
    height: number,
    color: readonly [number, number, number, number],
    z: number,
    order: number,
  ): ReturnType<typeof buildMeshPacket> {
    return buildMeshPacket({
      id: order + 1,
      positions: new Float32Array([0, 0, width, 0, width, height, 0, height]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      color,
      materialId: 0,
      order,
      depthKey: 0,
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
      depth: new Float32Array([z, z, z, z]),
    })
  }

  it('none 按提交顺序覆盖；test 只测不写；write 测后写', () => {
    const W = 8
    const H = 8
    const near = depthQuad(W, H, [1, 0, 0, 1], 0.2, 0)
    const far = depthQuad(W, H, [0, 0, 1, 1], 0.8, 1)
    const base = { packets: [near, far], width: W, height: H }

    const none = cpuFrame({ ...base, depthMode: 'none' })
    expect(at(none, W, 4, 4)).toEqual([0, 0, 255, 255])

    // test 不写深度：远处的蓝仍通过初始深度 1.0，覆盖红色。
    const test = cpuFrame({ ...base, depthMode: 'test' })
    expect(at(test, W, 4, 4)).toEqual([0, 0, 255, 255])

    // write 写入 0.2 后，远处 0.8 被拒绝，保留红色。
    const write = cpuFrame({ ...base, depthMode: 'write' })
    expect(at(write, W, 4, 4)).toEqual([255, 0, 0, 255])
  })
})

describe('M10 mask: WebGL2 scissor / stencil 与上下文恢复', () => {
  const page = tex(2, 2, new Array<number>(16).fill(255))
  const assets: RenderAssets = { pages: [page], materials: [SPRITE] }

  function packet(W: number, H: number): ReturnType<typeof buildRegionPacket> {
    return buildRegionPacket({
      id: 1,
      positions: new Float32Array([0, 0, W, 0, W, H, 0, H]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      color: [1, 1, 1, 1],
      materialId: 0,
      order: 0,
      depthKey: 0,
    })
  }

  it('scissor mask 调用 enable/scissor/disable，包绘制一次', () => {
    const gl = new FakeWebGL()
    const backend = new WebGL2Backend(gl)
    backend.resize({ width: 8, height: 8 })
    backend.prepare(assets)
    backend.draw(frameWithMask(8, 8, scissorMask(2, 2, 4, 4), packet(8, 8), assets))

    expect(gl.argsOf('scissor')).toContainEqual([2, 2, 4, 4])
    // GL_SCISSOR_TEST = 0x0c11
    expect(gl.argsOf('enable').some((a) => a[0] === 0x0c11)).toBe(true)
    expect(gl.argsOf('disable').some((a) => a[0] === 0x0c11)).toBe(true)
    expect(backend.stats.drawCalls).toBe(1)
    expect(backend.stats.packets).toBe(1)
  })

  it('stencil mask 先写 mask 几何再画 packet，并恢复颜色写', () => {
    const gl = new FakeWebGL()
    const backend = new WebGL2Backend(gl)
    backend.resize({ width: 8, height: 8 })
    backend.prepare(assets)
    const mask = polygonMask([4, 1, 7, 4, 4, 7, 1, 4])
    backend.draw(frameWithMask(8, 8, mask, packet(8, 8), assets))

    const enableStencil = gl.calls.findIndex((c) => c.op === 'enable' && c.args[0] === 0x0b90)
    expect(enableStencil).toBeGreaterThanOrEqual(0)
    const colorOff = gl.calls.findIndex((c) => c.op === 'colorMask' && c.args[0] === false)
    const colorOn = gl.calls.findIndex((c) => c.op === 'colorMask' && c.args[0] === true)
    const draws = gl.calls
      .map((c, i) => ({ c, i }))
      .filter((entry) => entry.c.op === 'drawElements')
      .map((entry) => entry.i)
    expect(draws.length).toBe(2)
    // 第一笔是 mask 几何（颜色关闭），第二笔是 packet（颜色恢复）。
    expect(colorOff).toBeLessThan(draws[0]!)
    expect(draws[0]!).toBeLessThan(colorOn!)
    expect(colorOn).toBeLessThan(draws[1]!)
    expect(gl.argsOf('stencilFunc').length).toBeGreaterThanOrEqual(2)
    expect(gl.argsOf('stencilOp').length).toBeGreaterThanOrEqual(2)
    expect(backend.stats.drawCalls).toBe(1)
  })

  it('restore 重建 buffer/纹理并记录次数，之后可继续绘制', () => {
    const gl = new FakeWebGL()
    const backend = new WebGL2Backend(gl)
    backend.resize({ width: 8, height: 8 })
    backend.prepare(assets)
    backend.draw({ packets: [packet(8, 8)], width: 8, height: 8, assets })

    const bufferCreates = gl.count('createBuffer')
    const textureUploads = gl.count('texImage2D')
    backend.restore()
    expect(backend.restoreCount).toBe(1)
    expect(gl.count('createBuffer')).toBeGreaterThan(bufferCreates)
    expect(gl.count('texImage2D')).toBeGreaterThan(textureUploads)

    backend.draw({ packets: [packet(8, 8)], width: 8, height: 8, assets })
    expect(backend.stats.drawCalls).toBe(1)
  })
})
