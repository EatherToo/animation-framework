import { describe, expect, it } from '@jest/globals'
import { CpuBackend } from '@/backend/backend'
import { buildOutlinePacket, buildRegionPacket, type RenderFrame, type RenderPacket } from '@/render/render'

// Independent analytic reference: a square with a centered, four-pixel border.
// Expected coordinates and pixels never come from outlineEdges or the output packet.
const SIDE = 64
const LEFT = 16
const RIGHT = 40
const CENTER = 28
const WIDTH_PX = 4
const ORIGINAL_UVS = [0.125, 0.25, 0.875, 0.25, 0.875, 0.75, 0.125, 0.75]

function source(): RenderPacket {
  return buildRegionPacket({
    id: 1,
    positions: Float32Array.from([LEFT, LEFT, RIGHT, LEFT, RIGHT, RIGHT, LEFT, RIGHT]),
    uvs: Float32Array.from(ORIGINAL_UVS),
    color: [0, 0, 0, 1], materialId: 0, order: 0, depthKey: 0,
  })
}

function scene(scale = 1, clipped = false): RenderFrame {
  const base = source()
  const outline = buildOutlinePacket(base, WIDTH_PX / scale, [1, 0, 0, 1])
  const frame: RenderFrame = {
    packets: [base, outline], width: SIDE, height: SIDE,
    viewProjection: Float32Array.from([
      scale, 0, 0, 0, scale, 0, CENTER * (1 - scale), CENTER * (1 - scale), 1,
    ]),
  }
  if (!clipped) return frame
  return {
    ...frame,
    packets: [{ ...base, maskPath: 0 }, { ...outline, maskPath: 0 }],
    maskPaths: [{ maskId: 0, parent: -1 }],
    masks: { version: 1, masks: [{
      id: 0, mode: 'scissor', invert: false, feather: 0,
      positions: new Float32Array(0), indices: new Uint16Array(0),
      bounds: { x: 0, y: 0, width: 28, height: SIDE },
    }] },
  }
}

function pixels(frame: RenderFrame): Uint8ClampedArray {
  const cpu = new CpuBackend(SIDE, SIDE, 4)
  try {
    cpu.draw(frame)
    return cpu.readPixels()
  } finally {
    cpu.dispose()
  }
}

function red(image: Uint8ClampedArray, x: number, y: number): number {
  return image[(y * SIDE + x) * 4]!
}

describe('A10 independent stroke scene', () => {
  it('uses four original hull edges, source UVs and opaque red vertex color', () => {
    const outline = buildOutlinePacket(source(), WIDTH_PX, [1, 0, 0, 1])
    expect(outline.kind).toBe('outline')
    expect(outline.indices).toHaveLength(4 * 6)
    expect(outline.positions).toHaveLength(4 * 8)
    expect(outline.uvs).toHaveLength(4 * 8)
    const expectedVertices = [
      [LEFT, LEFT], [RIGHT, LEFT], [RIGHT, RIGHT], [LEFT, RIGHT],
    ]
    const expectedEdges = [[0, 1], [0, 3], [1, 2], [2, 3]]
    for (let edge = 0; edge < expectedEdges.length; edge += 1) {
      const a = expectedEdges[edge]![0]!
      const b = expectedEdges[edge]![1]!
      const p = edge * 8
      const uv = edge * 8
      const midpointA = [
        (outline.positions[p]! + outline.positions[p + 2]!) / 2,
        (outline.positions[p + 1]! + outline.positions[p + 3]!) / 2,
      ]
      const midpointB = [
        (outline.positions[p + 4]! + outline.positions[p + 6]!) / 2,
        (outline.positions[p + 5]! + outline.positions[p + 7]!) / 2,
      ]
      expect(midpointA).toEqual(expectedVertices[a])
      expect(midpointB).toEqual(expectedVertices[b])
      expect(Array.from(outline.uvs.slice(uv, uv + 8))).toEqual([
        ORIGINAL_UVS[a * 2], ORIGINAL_UVS[a * 2 + 1],
        ORIGINAL_UVS[a * 2], ORIGINAL_UVS[a * 2 + 1],
        ORIGINAL_UVS[b * 2], ORIGINAL_UVS[b * 2 + 1],
        ORIGINAL_UVS[b * 2], ORIGINAL_UVS[b * 2 + 1],
      ])
    }
    for (let i = 0; i < outline.colors.length; i += 4) {
      expect(Array.from(outline.colors.slice(i, i + 4))).toEqual([255, 0, 0, 255])
    }
  })

  it.each([0.5, 1, 2])('draws a continuous %sx four-pixel stroke', (scale) => {
    const image = pixels(scene(scale))
    const lo = CENTER + (LEFT - CENTER) * scale
    const hi = CENTER + (RIGHT - CENTER) * scale
    for (const x of [CENTER - 3, CENTER, CENTER + 3]) {
      expect(red(image, x, Math.round(lo - 1))).toBeGreaterThan(240)
      expect(red(image, x, Math.round(hi + 1))).toBeGreaterThan(240)
      expect(red(image, x, CENTER)).toBe(0)
    }
    for (const y of [CENTER - 3, CENTER, CENTER + 3]) {
      expect(red(image, Math.round(lo - 1), y)).toBeGreaterThan(240)
      expect(red(image, Math.round(hi + 1), y)).toBeGreaterThan(240)
    }
    // Integral AA coverage along a normal is independent of stroke tessellation.
    const thickness = Array.from({ length: SIDE }, (_, y) => red(image, CENTER, y) / 255)
      .slice(Math.floor(lo - WIDTH_PX / 2 - 2), Math.ceil(lo + WIDTH_PX / 2 + 2))
      .reduce((sum, coverage) => sum + coverage, 0)
    expect(Math.abs(thickness - WIDTH_PX)).toBeLessThan(0.5)
  })

  it('does not double-blend the shared corner of translucent edges', () => {
    const outline = buildOutlinePacket(source(), WIDTH_PX, [1, 0, 0, 0.5])
    const image = pixels({ packets: [outline], width: SIDE, height: SIDE })
    // Straight RGBA (1,0,0,0.5) is PMA red 128 over black. Two overlapping
    // quads would reach ~192 at (15,15), even though a single stroke is ~128.
    expect(red(image, 15, 15)).toBeGreaterThan(110)
    expect(red(image, 15, 15)).toBeLessThan(145)
    expect(red(image, CENTER, 15)).toBeGreaterThan(110)
  })

  it('does not create a ghost edge at the clipping cut', () => {
    const image = pixels(scene(1, true))
    expect(red(image, LEFT - 1, 27)).toBeGreaterThan(240)
    expect(red(image, 26, 27)).toBe(0)
    expect(red(image, 29, 27)).toBe(0)
  })
})
