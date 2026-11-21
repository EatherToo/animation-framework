import type { RenderPacket } from './types'

/** 2D 描边几何：屏幕/局部平面点 + 三角形。颜色由调用者按 OutlineStyle 给。 */
export type OutlineRibbon = {
  readonly positions: Float32Array
  readonly indices: Uint16Array
}

type Edge = {
  readonly lo: number
  readonly hi: number
  net: number
}

const CIRCLE_SEGMENTS = 12

/**
 * 从渲染包的边界提取屏幕空间等宽描边。
 *
 * 宽度按最终屏幕像素给：`widthPx`，`scale` 是“单位 → 像素”。
 * 每条边界边生成一个 quad；每个非 seam 端点生成一个圆，近似 round join/cap。
 * @param packet 渲染包
 * @param scale 像素/单位
 * @param widthPx 覆盖宽度；省略时用 packet.outline.widthPx
 */
export function buildOutlineRibbon(
  packet: RenderPacket,
  scale: number,
  widthPx?: number,
): OutlineRibbon | null {
  if (packet.outline === null) return null
  const width = widthPx ?? packet.outline.widthPx
  if (!(scale > 0) || !(width > 0)) return null
  const half = width / (2 * scale)
  const edges = boundaryEdges(packet)
  if (edges.length === 0) return null
  const positions: number[] = []
  const indices: number[] = []
  const boundary = new Set<number>()
  for (const edge of edges) {
    const from = edge.net > 0 ? edge.lo : edge.hi
    const to = edge.net > 0 ? edge.hi : edge.lo
    const ax = packet.vertices[from * 2]!
    const ay = packet.vertices[from * 2 + 1]!
    const bx = packet.vertices[to * 2]!
    const by = packet.vertices[to * 2 + 1]!
    const dx = bx - ax
    const dy = by - ay
    const length = Math.hypot(dx, dy)
    if (length < 1e-9) continue
    const nx = (dy / length) * half
    const ny = (-dx / length) * half
    const base = positions.length / 2
    positions.push(ax + nx, ay + ny, ax - nx, ay - ny, bx + nx, by + ny, bx - nx, by - ny)
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
    boundary.add(from)
    boundary.add(to)
  }
  for (const vertex of boundary) {
    if (packet.seam[vertex] === 1) continue
    const cx = packet.vertices[vertex * 2]!
    const cy = packet.vertices[vertex * 2 + 1]!
    const center = positions.length / 2
    positions.push(cx, cy)
    for (let i = 0; i < CIRCLE_SEGMENTS; i += 1) {
      const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2
      positions.push(cx + Math.cos(angle) * half, cy + Math.sin(angle) * half)
    }
    for (let i = 0; i < CIRCLE_SEGMENTS; i += 1) {
      indices.push(center, center + 1 + i, center + 1 + ((i + 1) % CIRCLE_SEGMENTS))
    }
  }
  if (indices.length === 0) return null
  return { positions: new Float32Array(positions), indices: new Uint16Array(indices) }
}

/** 边界边：净走向不为 0，且两端不都是 seam。 */
function boundaryEdges(packet: RenderPacket): Edge[] {
  const edges = new Map<string, Edge>()
  const positions = packet.vertices
  const indices = packet.indices
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!
    const b = indices[t + 1]!
    const c = indices[t + 2]!
    const ax = positions[a * 2]!
    const ay = positions[a * 2 + 1]!
    const cross =
      (positions[b * 2]! - ax) * (positions[c * 2 + 1]! - ay) -
      (positions[b * 2 + 1]! - ay) * (positions[c * 2]! - ax)
    const turn = cross < 0 ? -1 : 1
    add(edges, a, b, turn)
    add(edges, b, c, turn)
    add(edges, c, a, turn)
  }
  const result: Edge[] = []
  for (const edge of edges.values()) {
    if (edge.net === 0) continue
    if (packet.seam[edge.lo] === 1 && packet.seam[edge.hi] === 1) continue
    result.push(edge)
  }
  return result
}

function add(edges: Map<string, Edge>, from: number, to: number, turn: number): void {
  const lo = from < to ? from : to
  const hi = from < to ? to : from
  const key = `${lo}:${hi}`
  const dir = from === lo ? turn : -turn
  const found = edges.get(key)
  if (found === undefined) {
    edges.set(key, { lo, hi, net: dir })
  } else {
    found.net += dir
  }
}
