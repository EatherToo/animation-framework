import { describe, expect, it } from '@jest/globals'
import { CpuBackend } from '@/backend/backend'
import { buildRegionPacket, type RenderFrame, type RenderPacket } from '@/render/render'

type SlotPacket = { slotIndex: number; slot: string; attachment: string; packet: RenderPacket }

const WIDTH = 16
const HEIGHT = 8

function render(packets: readonly RenderPacket[]): Uint8ClampedArray {
  const backend = new CpuBackend({ width: WIDTH, height: HEIGHT, supersample: 1, background: [0, 0, 0, 255] })
  const frame: RenderFrame = { packets, width: WIDTH, height: HEIGHT }
  try {
    backend.draw(frame)
    return backend.readPixels()
  } finally {
    backend.dispose()
  }
}

function firstPixelDifference(expected: Uint8ClampedArray, actual: Uint8ClampedArray): number {
  if (expected.length !== actual.length) throw new Error(`pixel length: ${expected.length} != ${actual.length}`)
  for (let i = 0; i < expected.length; i++) if (expected[i] !== actual[i]) return i
  return -1
}

function firstComponentDifference(expected: RenderPacket, actual: RenderPacket): string {
  for (const field of ['positions', 'uvs', 'colors', 'dark', 'indices'] as const) {
    const left = expected[field]
    const right = actual[field]
    if (left?.length !== right?.length) return `${field}.length`
    if (left !== undefined && right !== undefined) {
      for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return `${field}[${i}]`
    }
  }
  for (const field of ['page', 'materialId', 'blend', 'maskPath'] as const) {
    if (expected[field] !== actual[field]) return field
  }
  return 'rendered pixels (no packet component differs)'
}

function assertSlotDiff(expected: readonly SlotPacket[], actual: readonly SlotPacket[]): void {
  const expectedPixels = render(expected.map(entry => entry.packet))
  const actualPixels = render(actual.map(entry => entry.packet))
  const offset = firstPixelDifference(expectedPixels, actualPixels)
  if (offset < 0) return

  // Isolated slot passes preserve provenance even when the full frame's packets are batched.
  const first = expected.findIndex((entry, index) => {
    const candidate = actual[index]
    return candidate === undefined || render([entry.packet])[offset] !== render([candidate.packet])[offset]
  })
  if (first < 0) throw new Error(`pixel (${Math.floor(offset / 4) % WIDTH}, ${Math.floor(offset / 4 / WIDTH)}) differs, no slot attribution`)
  const source = expected[first]!
  const changed = actual[first]
  const component = changed === undefined ? 'packet missing' : firstComponentDifference(source.packet, changed.packet)
  const pixel = Math.floor(offset / 4)
  const channel = ['R', 'G', 'B', 'A'][offset % 4]
  throw new Error(`first differing slot ${source.slotIndex} (${source.slot}), attachment ${source.attachment}, component ${component}; pixel (${pixel % WIDTH}, ${Math.floor(pixel / WIDTH)}) ${channel}: ${expectedPixels[offset]} != ${actualPixels[offset]}`)
}

function slot(slotIndex: number, name: string, attachment: string, x: number): SlotPacket {
  return {
    slotIndex, slot: name, attachment,
    packet: buildRegionPacket({
      id: slotIndex, positions: new Float32Array([x, 1, x + 5, 1, x + 5, 6, x, 6]),
      color: [1, 0, 0, 1], materialId: 0, order: slotIndex, depthKey: 0,
    }),
  }
}

describe('A32 slot-level pixel diff location', () => {
  it('names the first differing slot, attachment and component on a pixel-producing perturbation', () => {
    const reference = [slot(0, 'body', 'torso', 1), slot(1, 'face', 'eyes', 9)]
    const perturbed = reference.map(entry => ({ ...entry, packet: entry.packet }))
    const face = reference[1]!
    const colors = new Uint8Array(face.packet.colors)
    for (let i = 0; i < colors.length; i += 4) colors[i] = 0
    perturbed[1] = { ...face, packet: { ...face.packet, colors } }

    expect(() => assertSlotDiff(reference, reference)).not.toThrow()
    expect(() => assertSlotDiff(reference, perturbed)).toThrow(
      /first differing slot 1 \(face\), attachment eyes, component colors\[0\]; pixel \(\d+, \d+\) R: 255 != 0/,
    )
  })

  it('reports the earliest differing slot when more than one attachment is perturbed', () => {
    const reference = [slot(0, 'body', 'torso', 1), slot(1, 'face', 'eyes', 9)]
    const perturbed = reference.map(entry => {
      const colors = new Uint8Array(entry.packet.colors)
      for (let i = 0; i < colors.length; i += 4) colors[i] = 0
      return { ...entry, packet: { ...entry.packet, colors } }
    })

    expect(() => assertSlotDiff(reference, perturbed)).toThrow(
      /first differing slot 0 \(body\), attachment torso, component colors\[0\]; pixel \(\d+, \d+\) R: 255 != 0/,
    )
  })
})
