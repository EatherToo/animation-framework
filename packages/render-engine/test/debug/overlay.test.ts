import { describe, expect, it } from '@jest/globals'
import { compileSkeleton, type BoneSpec } from '@/core/skeleton'
import { createPose, updateWorld } from '@/core/pose'
import { createSlotSet, type SlotData, type SlotSet } from '@/slot/slot'
import {
  buildMaskSet,
  buildMeshPacket,
  type RenderFrame,
  type RenderMask,
  type RenderPacket,
} from '@/render/render'
import {
  buildDebugLines,
  collectStats,
  DEFAULT_DEBUG_FLAGS,
  formatStats,
  type DebugFlags,
} from '@/debug/overlay'

const ALL_OFF: DebugFlags = {
  bones: false,
  slots: false,
  attachments: false,
  meshes: false,
  clipping: false,
  bounds: false,
  drawOrder: false,
  stats: false,
}

function makeRig() {
  const skeleton = compileSkeleton({
    name: 'debug-rig',
    profile: 'full2d',
    bones: [
      { name: 'root', parent: -1, length: 0 },
      { name: 'child', parent: 0, length: 1, rest: { x: 10, y: 0 } },
      { name: 'tip', parent: 1, length: 1, rest: { x: 10, y: 0 } },
    ] as BoneSpec[],
  })
  const pose = createPose(skeleton)
  updateWorld(pose)
  return { skeleton, pose }
}

function makeSlotSet(): SlotSet {
  const color = { r: 1, g: 1, b: 1, a: 1 }
  const slots: SlotData[] = [
    {
      id: 'slot-a', bone: 0, order: 0, color, blend: 'normal',
      attachment: null, mask: null, zOffset: 0,
    },
    {
      id: 'slot-b', bone: 1, order: 1, color, blend: 'normal',
      attachment: null, mask: null, zOffset: 0,
    },
  ]
  const skins = new Map([['default', { id: 'default', attachments: new Map() }]])
  return createSlotSet(slots, skins, 'default')
}

function makeQuadPacket(): RenderPacket {
  return buildMeshPacket({
    id: 1,
    positions: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    color: [1, 1, 1, 1],
    materialId: 0,
    order: 0,
    depthKey: 0,
  })
}

function makeStencilMask(id: number): RenderMask {
  return {
    id,
    mode: 'stencil',
    invert: false,
    feather: 0,
    positions: new Float32Array([0, 0, 10, 0, 0, 10]),
    indices: new Uint32Array([0, 1, 2]),
    bounds: { x: 0, y: 0, width: 10, height: 10 },
  }
}

describe('debug overlay / buildDebugLines', () => {
  it('默认全部关闭，不产生任何调试线', () => {
    const { pose } = makeRig()
    expect(DEFAULT_DEBUG_FLAGS).toEqual(ALL_OFF)
    expect(buildDebugLines({ pose, slotSet: makeSlotSet() })).toEqual([])
  })

  it('bones：每根有父的骨画父→子枢轴，根画十字', () => {
    const { pose } = makeRig()
    const lines = buildDebugLines({ pose, slotSet: makeSlotSet(), flags: { bones: true } })

    // 根节点十字两条，加 root → child、child → tip 两条骨线。
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatchObject({ x1: -4, y1: 0, x2: 4, y2: 0 })
    expect(lines[1]).toMatchObject({ x1: 0, y1: -4, x2: 0, y2: 4 })
    expect(lines[2]).toMatchObject({ x1: 0, y1: 0, x2: 10, y2: 0 })
    expect(lines[3]).toMatchObject({ x1: 10, y1: 0, x2: 20, y2: 0 })
  })

  it('slots：每个 slot 在其绑定骨的世界位置画小十字', () => {
    const { pose } = makeRig()
    const lines = buildDebugLines({ pose, slotSet: makeSlotSet(), flags: { slots: true } })

    expect(lines).toHaveLength(4)
    // 两条线一组，分别围绕 slot-a 的骨 0 与 slot-b 的骨 1。
    expect(lines[0]).toMatchObject({ x1: -3, y1: 0, x2: 3, y2: 0 })
    expect(lines[2]).toMatchObject({ x1: 7, y1: 0, x2: 13, y2: 0 })
  })

  it('meshes：按 packet 索引画三角形边线并去重共享边', () => {
    const { pose } = makeRig()
    const packet = makeQuadPacket()
    const lines = buildDebugLines({
      pose,
      slotSet: makeSlotSet(),
      packets: [packet],
      flags: { meshes: true },
    })

    // 四边形两个三角形：外围 4 条 + 共享对角线 1 条。
    expect(lines).toHaveLength(5)
    expect(lines[0]).toMatchObject({ x1: 0, y1: 0, x2: 10, y2: 0 })
    expect(lines[2]).toMatchObject({ x1: 0, y1: 0, x2: 10, y2: 10 })
  })

  it('clipping：只画 stencil mask 的多边形边线（闭合）', () => {
    const { pose } = makeRig()
    const scissor: RenderMask = {
      id: 9,
      mode: 'scissor',
      invert: false,
      feather: 0,
      positions: new Float32Array(0),
      indices: new Uint32Array(0),
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    }
    const lines = buildDebugLines({
      pose,
      slotSet: makeSlotSet(),
      masks: [makeStencilMask(0), scissor, null],
      flags: { clipping: true },
    })

    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ x1: 0, y1: 0, x2: 10, y2: 0 })
    expect(lines[1]).toMatchObject({ x1: 10, y1: 0, x2: 0, y2: 10 })
    expect(lines[2]).toMatchObject({ x1: 0, y1: 10, x2: 0, y2: 0 })
  })

  it('bounds：矩形四条边', () => {
    const { pose } = makeRig()
    const lines = buildDebugLines({
      pose,
      slotSet: makeSlotSet(),
      bounds: { x: 1, y: 2, width: 8, height: 6 },
      flags: { bounds: true },
    })

    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatchObject({ x1: 1, y1: 2, x2: 9, y2: 2 })
    expect(lines[1]).toMatchObject({ x1: 9, y1: 2, x2: 9, y2: 8 })
    expect(lines[2]).toMatchObject({ x1: 9, y1: 8, x2: 1, y2: 8 })
    expect(lines[3]).toMatchObject({ x1: 1, y1: 8, x2: 1, y2: 2 })
  })

  it('attachments / drawOrder / stats 不产生线', () => {
    const { pose } = makeRig()
    const lines = buildDebugLines({
      pose,
      slotSet: makeSlotSet(),
      packets: [makeQuadPacket()],
      flags: { attachments: true, drawOrder: true, stats: true },
    })
    expect(lines).toEqual([])
  })

  it('不修改输入 pose / slotSet / packets / masks', () => {
    const { pose } = makeRig()
    const slotSet = makeSlotSet()
    const packet = makeQuadPacket()
    const mask = makeStencilMask(0)
    const frame: RenderFrame = {
      packets: [packet],
      width: 64,
      height: 64,
      masks: buildMaskSet([mask]),
    }

    const before = JSON.stringify({
      world: Array.from(pose.world),
      local: Array.from(pose.local),
      dirty: Array.from(pose.dirty),
      version: pose.version,
      drawOrder: slotSet.drawOrder,
      slots: slotSet.slots.map((slot) => [slot.skinId, slot.attachmentId]),
      positions: Array.from(packet.positions),
      indices: Array.from(packet.indices),
      maskPositions: Array.from(mask.positions),
      maskIndices: Array.from(mask.indices),
    })

    buildDebugLines({
      pose,
      slotSet,
      packets: frame.packets,
      masks: frame.masks?.masks,
      bounds: { x: 0, y: 0, width: 64, height: 64 },
      flags: {
        bones: true,
        slots: true,
        attachments: true,
        meshes: true,
        clipping: true,
        bounds: true,
        drawOrder: true,
        stats: true,
      },
    })

    const after = JSON.stringify({
      world: Array.from(pose.world),
      local: Array.from(pose.local),
      dirty: Array.from(pose.dirty),
      version: pose.version,
      drawOrder: slotSet.drawOrder,
      slots: slotSet.slots.map((slot) => [slot.skinId, slot.attachmentId]),
      positions: Array.from(packet.positions),
      indices: Array.from(packet.indices),
      maskPositions: Array.from(mask.positions),
      maskIndices: Array.from(mask.indices),
    })

    expect(after).toBe(before)
  })
})

describe('debug overlay / stats', () => {
  it('collectStats 读取后端字段，缺失字段回退 0', () => {
    const frame: RenderFrame = { packets: [], width: 1, height: 1 }
    const stats = collectStats(
      { stats: { packets: 2, drawCalls: 1, uploadedBytes: 64 } },
      frame,
      8.5,
    )

    expect(stats).toEqual({
      packets: 2,
      batches: 0,
      drawCalls: 1,
      textureBinds: 0,
      programSwitches: 0,
      clippedTriangles: 0,
      uploadedBytes: 64,
      frameMs: 8.5,
    })
  })

  it('collectStats 对缺失 stats / 非有限值回退 0', () => {
    const frame: RenderFrame = { packets: [], width: 1, height: 1 }
    expect(collectStats({}, frame, Number.NaN)).toEqual({
      packets: 0,
      batches: 0,
      drawCalls: 0,
      textureBinds: 0,
      programSwitches: 0,
      clippedTriangles: 0,
      uploadedBytes: 0,
      frameMs: 0,
    })
  })

  it('formatStats 输出稳定、定序的 JSON', () => {
    const stats = collectStats(
      { stats: { packets: 2, batches: 3, drawCalls: 4, textureBinds: 5, programSwitches: 6 } },
      { packets: [], width: 1, height: 1 },
      8.5,
    )

    const text = formatStats(stats)
    expect(text).toBe(
      '{"packets":2,"batches":3,"drawCalls":4,"textureBinds":5,"programSwitches":6,' +
      '"clippedTriangles":0,"uploadedBytes":0,"frameMs":8.5}',
    )
    expect(formatStats(stats)).toBe(text)
    expect(JSON.parse(text)).toEqual(stats)
  })
})
