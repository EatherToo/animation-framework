/**
 * 调试叠加层：把骨骼/slot/mesh/clipping/bounds 转成独立的线段列表。
 *
 * 设计约束（docs/22-Spine渲染对标/debug-tooling.md）：
 * - 只读输入，不修改 pose / slotSet / packet / mask；
 * - 仅生成线段，不参与生产 packet 的排序、合批或 draw call；
 * - flags 默认全部关闭，关闭时短路并返回空数组。
 */
import { WORLD_STRIDE, type Pose } from '../core/pose'
import type { RenderFrame, RenderMask, RenderPacket } from '../render/render'
import type { SlotSet } from '../slot/slot'

export type DebugFlags = {
  bones: boolean
  slots: boolean
  attachments: boolean
  meshes: boolean
  clipping: boolean
  bounds: boolean
  drawOrder: boolean
  stats: boolean
}

export type DebugColor = readonly [number, number, number, number]

export type DebugLine = {
  x1: number
  y1: number
  x2: number
  y2: number
  color: DebugColor
}

export const DEFAULT_DEBUG_FLAGS: Readonly<DebugFlags> = Object.freeze({
  bones: false,
  slots: false,
  attachments: false,
  meshes: false,
  clipping: false,
  bounds: false,
  drawOrder: false,
  stats: false,
})

/** 固定颜色，保证 debug 线不受 tint/blend/mask 影响。 */
export const DEBUG_COLORS = {
  bone: [1, 0.45, 0.1, 1],
  slot: [0.2, 0.8, 1, 1],
  mesh: [0.2, 1, 0.35, 1],
  clipping: [1, 0.2, 0.9, 1],
  bounds: [1, 0.95, 0.2, 1],
} as const satisfies Record<string, DebugColor>

const ROOT_CROSS_HALF = 4
const SLOT_CROSS_HALF = 3

export type DebugBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type DebugOverlayInput = {
  readonly pose: Pose
  readonly slotSet: SlotSet
  readonly packets?: readonly RenderPacket[] | undefined
  readonly masks?: readonly (RenderMask | null)[] | undefined
  readonly bounds?: DebugBounds | undefined
  readonly flags?: Partial<DebugFlags> | undefined
}

function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: DebugColor,
): DebugLine {
  return { x1, y1, x2, y2, color }
}

function pushCross(out: DebugLine[], x: number, y: number, half: number, color: DebugColor): void {
  out.push(
    line(x - half, y, x + half, y, color),
    line(x, y - half, x, y + half, color),
  )
}

function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y)
}

/** 读取骨骼世界枢轴；越界或非有限值返回 null。 */
function bonePivot(pose: Pose, bone: number): readonly [number, number] | null {
  if (!Number.isInteger(bone) || bone < 0 || bone >= pose.skeleton.count) return null
  const offset = bone * WORLD_STRIDE
  const x = pose.world[offset + 4]!
  const y = pose.world[offset + 5]!
  return isFinitePoint(x, y) ? [x, y] : null
}

function pushBones(out: DebugLine[], pose: Pose): void {
  const color = DEBUG_COLORS.bone
  for (let bone = 0; bone < pose.skeleton.count; bone += 1) {
    const pivot = bonePivot(pose, bone)
    if (pivot === null) continue
    const parent = pose.skeleton.parent[bone]!
    if (parent < 0) {
      pushCross(out, pivot[0], pivot[1], ROOT_CROSS_HALF, color)
      continue
    }
    const parentPivot = bonePivot(pose, parent)
    if (parentPivot === null) continue
    out.push(line(parentPivot[0], parentPivot[1], pivot[0], pivot[1], color))
  }
}

function pushSlots(out: DebugLine[], pose: Pose, slotSet: SlotSet): void {
  for (const slot of slotSet.slots) {
    const pivot = bonePivot(pose, slot.data.bone)
    if (pivot === null) continue
    pushCross(out, pivot[0], pivot[1], SLOT_CROSS_HALF, DEBUG_COLORS.slot)
  }
}

/** 单个 packet 的三角形边线；共享边按无向 key 去重，避免重复画内部对角线。 */
function pushPacketWireframe(out: DebugLine[], packet: RenderPacket): void {
  const { positions, indices } = packet
  const vertexCount = Math.floor(positions.length / 2)
  const seen = new Set<string>()
  const addEdge = (a: number, b: number): void => {
    if (a === b || a < 0 || b < 0 || a >= vertexCount || b >= vertexCount) return
    const lo = a < b ? a : b
    const hi = a < b ? b : a
    const key = `${lo}:${hi}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(line(
      positions[lo * 2]!,
      positions[lo * 2 + 1]!,
      positions[hi * 2]!,
      positions[hi * 2 + 1]!,
      DEBUG_COLORS.mesh,
    ))
  }
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i]!
    const b = indices[i + 1]!
    const c = indices[i + 2]!
    addEdge(a, b)
    addEdge(b, c)
    addEdge(c, a)
  }
}

function pushMeshes(out: DebugLine[], packets: readonly RenderPacket[]): void {
  for (const packet of packets) pushPacketWireframe(out, packet)
}

/** stencil mask 的 polygon 边线，按顶点顺序闭合；scissor/alpha 不画。 */
function pushClipping(out: DebugLine[], masks: readonly (RenderMask | null)[]): void {
  for (const mask of masks) {
    if (mask === null || mask.mode !== 'stencil') continue
    const { positions } = mask
    const count = Math.floor(positions.length / 2)
    if (count < 3) continue
    for (let i = 0; i < count; i += 1) {
      const j = (i + 1) % count
      out.push(line(
        positions[i * 2]!,
        positions[i * 2 + 1]!,
        positions[j * 2]!,
        positions[j * 2 + 1]!,
        DEBUG_COLORS.clipping,
      ))
    }
  }
}

function pushBounds(out: DebugLine[], bounds: DebugBounds): void {
  const { x, y, width, height } = bounds
  if (![x, y, width, height].every(Number.isFinite)) return
  const right = x + width
  const bottom = y + height
  const color = DEBUG_COLORS.bounds
  out.push(
    line(x, y, right, y, color),
    line(right, y, right, bottom, color),
    line(right, bottom, x, bottom, color),
    line(x, bottom, x, y, color),
  )
}

/**
 * 按 flags 生成调试线段。返回新数组；任何输入都不会被修改。
 * `attachments` / `drawOrder` / `stats` 不产生几何（分别由 inspector、stats 元数据承担）。
 */
export function buildDebugLines(input: DebugOverlayInput): DebugLine[] {
  const { pose, slotSet } = input
  const flags: DebugFlags = {
    bones: input.flags?.bones === true,
    slots: input.flags?.slots === true,
    attachments: input.flags?.attachments === true,
    meshes: input.flags?.meshes === true,
    clipping: input.flags?.clipping === true,
    bounds: input.flags?.bounds === true,
    drawOrder: input.flags?.drawOrder === true,
    stats: input.flags?.stats === true,
  }

  if (!flags.bones && !flags.slots && !flags.meshes && !flags.clipping && !flags.bounds) {
    return []
  }

  const out: DebugLine[] = []
  if (flags.bones) pushBones(out, pose)
  if (flags.slots) pushSlots(out, pose, slotSet)
  if (flags.meshes && input.packets) pushMeshes(out, input.packets)
  if (flags.clipping && input.masks) pushClipping(out, input.masks)
  if (flags.bounds && input.bounds) pushBounds(out, input.bounds)
  return out
}

// —— 帧统计 ——

export type FrameStats = {
  /** Renderable packets before batching, including packets later clipped to zero triangles. */
  inputPackets: number
  packets: number
  batches: number
  drawCalls: number
  textureBinds: number
  programSwitches: number
  clippedTriangles: number
  /** Runtime geometry clipping only; stencil/scissor/alpha fragment rejection is excluded. */
  clippedIn: number
  clippedOut: number
  uploadedBytes: number
  frameMs: number
}

/** 后端只需要暴露 stats；字段缺失时由 collectStats 回退 0。 */
export type DebugStatsBackend = {
  readonly stats?: Partial<FrameStats> | null
}

function toStat(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Backend counters describe submissions; frame.stats carries runtime prebatch/preclip counts.
 * Missing fields fall back to 0, except inputPackets, which defaults to submitted packets.
 */
export function collectStats(
  backend: DebugStatsBackend | null | undefined,
  frame: RenderFrame | null | undefined,
  frameMs: number,
): FrameStats {
  const stats = backend?.stats ?? {}
  return {
    inputPackets: toStat(frame?.stats?.inputPackets ?? stats.inputPackets ?? stats.packets),
    packets: toStat(stats.packets),
    batches: toStat(stats.batches),
    drawCalls: toStat(stats.drawCalls),
    textureBinds: toStat(stats.textureBinds),
    programSwitches: toStat(stats.programSwitches),
    clippedTriangles: toStat(stats.clippedTriangles),
    clippedIn: toStat(frame?.stats?.clippedIn ?? stats.clippedIn),
    clippedOut: toStat(frame?.stats?.clippedOut ?? stats.clippedOut),
    uploadedBytes: toStat(stats.uploadedBytes),
    frameMs: toStat(frameMs),
  }
}

/** 稳定、定序的一行 JSON，便于 golden 与日志比对。 */
export function formatStats(stats: FrameStats): string {
  return JSON.stringify({
    inputPackets: toStat(stats.inputPackets),
    packets: toStat(stats.packets),
    batches: toStat(stats.batches),
    drawCalls: toStat(stats.drawCalls),
    textureBinds: toStat(stats.textureBinds),
    programSwitches: toStat(stats.programSwitches),
    clippedTriangles: toStat(stats.clippedTriangles),
    clippedIn: toStat(stats.clippedIn),
    clippedOut: toStat(stats.clippedOut),
    uploadedBytes: toStat(stats.uploadedBytes),
    frameMs: toStat(stats.frameMs),
  })
}
