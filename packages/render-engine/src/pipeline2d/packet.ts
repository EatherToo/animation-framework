import {
  attachmentOf,
  meshBounds,
} from './scene'
import type {
  RGBA,
  RenderAttachment,
  RenderPacket,
  RenderScene,
  RenderSlot,
} from './types'
import { RENDER_PACKET_VERSION } from './types'
import { splitPacketByLine } from './split'

/**
 * 把场景转成按绘制顺序排好的渲染包。没有附件的槽位被跳过。
 * 排序：`slot.order` 升序；相同 order 按 slots 数组顺序稳定。
 * @param scene 已校验的场景
 */
export function buildRenderPackets(scene: RenderScene): RenderPacket[] {
  const packets: RenderPacket[] = []
  for (let i = 0; i < scene.slots.length; i += 1) {
    const slot = scene.slots[i]!
    const attachment = attachmentOf(scene, slot)
    if (attachment === null) continue
    packets.push(buildRenderPacket(slot, attachment))
  }
  return sortRenderPackets(packets)
}

/** 极端兜底：同 order 且包围盒重叠的包，沿重叠中心线切开并给子包微调 order。 */
export function splitEqualOrderOverlaps(packets: readonly RenderPacket[]): RenderPacket[] {
  const result: RenderPacket[] = []
  for (const packet of packets) {
    const obstacles = result.filter((other) => other.order === packet.order && overlaps(other.bounds, packet.bounds))
    if (obstacles.length === 0) {
      result.push(packet)
      continue
    }
    const other = obstacles[0]!
    const cx = (Math.max(packet.bounds.x, other.bounds.x) + Math.min(packet.bounds.x + packet.bounds.width, other.bounds.x + other.bounds.width)) / 2
    const cy = (Math.max(packet.bounds.y, other.bounds.y) + Math.min(packet.bounds.y + packet.bounds.height, other.bounds.y + other.bounds.height)) / 2
    const dx = (packet.bounds.x + packet.bounds.width / 2) - (other.bounds.x + other.bounds.width / 2)
    const dy = (packet.bounds.y + packet.bounds.height / 2) - (other.bounds.y + other.bounds.height / 2)
    const length = Math.hypot(dx, dy) || 1
    const split = splitPacketByLine(packet, { x: cx - dy / length, y: cy + dx / length }, { x: cx + dy / length, y: cy - dx / length })
    if (split.positive === null || split.negative === null) {
      result.push(packet)
      continue
    }
    result.push({ ...split.negative, order: packet.order - 1e-3 })
    result.push({ ...split.positive, order: packet.order + 1e-3 })
  }
  return sortRenderPackets(result)
}

function overlaps(a: RenderPacket['bounds'], b: RenderPacket['bounds']): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/**
 * Slot 主序 + 深度次序：order 小先画；同 order 深度大的先画（更远）。
 * 相同 order/深度保持输入顺序，保证稳定。
 * @param packets 渲染包
 */
export function sortRenderPackets(packets: readonly RenderPacket[]): RenderPacket[] {
  const entries = packets.map((packet, index) => ({ packet, index, depth: averageDepth(packet.depth) }))
  entries.sort((a, b) => {
    if (a.packet.order !== b.packet.order) return a.packet.order - b.packet.order
    if (a.depth !== b.depth) return b.depth - a.depth
    return a.index - b.index
  })
  return entries.map((entry) => entry.packet)
}

function averageDepth(depth: Float32Array): number {
  if (depth.length === 0) return 0
  let sum = 0
  for (const value of depth) sum += value
  return sum / depth.length
}

/**
 * 由槽位与附件生成一个渲染包。顶点/索引/UV/深度都复制，不改输入。
 * @param slot 槽位
 * @param attachment 当前附件
 */
export function buildRenderPacket(slot: RenderSlot, attachment: RenderAttachment): RenderPacket {
  const mesh = attachment.mesh
  const count = mesh.positions.length / 2
  const material = attachment.material
  const tint = material.kind === 'atlas' ? multiply(slot.tint, material.tint) : slot.tint
  const base: RGBA = material.kind === 'flat' ? material.color : { r: 1, g: 1, b: 1, a: 1 }
  const colors = new Uint8Array(count * 4)
  if (mesh.colors.length === 0) {
    for (let v = 0; v < count; v += 1) {
      colors[v * 4] = byte(base.r * tint.r)
      colors[v * 4 + 1] = byte(base.g * tint.g)
      colors[v * 4 + 2] = byte(base.b * tint.b)
      colors[v * 4 + 3] = byte(base.a * tint.a)
    }
  } else {
    for (let v = 0; v < count; v += 1) {
      colors[v * 4] = byte((mesh.colors[v * 4]! / 255) * tint.r)
      colors[v * 4 + 1] = byte((mesh.colors[v * 4 + 1]! / 255) * tint.g)
      colors[v * 4 + 2] = byte((mesh.colors[v * 4 + 2]! / 255) * tint.b)
      colors[v * 4 + 3] = byte((mesh.colors[v * 4 + 3]! / 255) * tint.a)
    }
  }
  const uvs = mesh.uvs.length === 0 ? new Float32Array(count * 2) : mesh.uvs.slice()
  return {
    version: RENDER_PACKET_VERSION,
    partId: attachment.id,
    vertices: mesh.positions.slice(),
    uvs,
    indices: mesh.indices.slice(),
    colors,
    seam: mesh.seam.length === 0 ? new Uint8Array(count) : mesh.seam.slice(),
    outline: attachment.outline,
    atlasPage: material.kind === 'atlas' ? material.page : -1,
    atlasKey: attachment.atlasKey ?? attachment.id,
    materialId: material.kind === 'atlas' ? material.page : -1,
    blend: slot.blend,
    mask: slot.mask,
    order: slot.order,
    depth: mesh.depth.slice(),
    bounds: mesh.bounds ?? meshBounds(mesh.positions),
  }
}

/**
 * 校验一个渲染包的长度、版本与颜色。失败抛出稳定错误名。
 * @param packet 渲染包
 */
export function validateRenderPacket(packet: RenderPacket): void {
  if (packet.version !== RENDER_PACKET_VERSION) throw new Error('version')
  if (!Number.isInteger(packet.materialId) || packet.materialId < -1) throw new Error('material')
  if (packet.vertices.length === 0 || packet.vertices.length % 2 !== 0) throw new Error('vertices')
  const count = packet.vertices.length / 2
  if (packet.indices.length < 3 || packet.indices.length % 3 !== 0) throw new Error('indices')
  for (const index of packet.indices) if (index >= count) throw new Error('indices')
  if (packet.uvs.length !== count * 2) throw new Error('uvs')
  if (packet.colors.length !== count * 4) throw new Error('colors')
  if (packet.seam.length !== count) throw new Error('seam')
  if (packet.depth.length !== count) throw new Error('depth')
  if (!Number.isFinite(packet.order)) throw new Error('order')
  if (packet.atlasPage < -1 || !Number.isInteger(packet.atlasPage)) throw new Error('atlas')
}

function multiply(a: RGBA, b: RGBA): RGBA {
  return { r: a.r * b.r, g: a.g * b.g, b: a.b * b.b, a: a.a * b.a }
}

function byte(value: number): number {
  const rounded = Math.round(value * 255)
  if (rounded < 0) return 0
  if (rounded > 255) return 255
  return rounded
}
