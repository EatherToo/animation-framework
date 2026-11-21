import type { RenderPacket, RGBA } from './types'

type Point = { x: number; y: number }
type Vertex = {
  x: number
  y: number
  u: number
  v: number
  r: number
  g: number
  b: number
  a: number
  depth: number
  seam: number
}

/**
 * 用一个屏幕空间直线把渲染包切成两侧的子包。
 * 三角形跨线时用 Sutherland–Hodgman 裁剪，位置/UV/颜色/深度线性插值。
 * 用于极端交叉的兜底切分；不改变原包的 order/material。
 * @param packet 渲染包
 * @param a 线起点
 * @param b 线终点
 */
export function splitPacketByLine(
  packet: RenderPacket,
  a: Point,
  b: Point,
): { positive: RenderPacket | null; negative: RenderPacket | null } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.hypot(dx, dy) <= 1e-9) return { positive: packet, negative: null }
  const side = (p: Point): number => dx * (p.y - a.y) - dy * (p.x - a.x)
  const count = packet.vertices.length / 2
  const vertices: Vertex[] = []
  for (let v = 0; v < count; v += 1) {
    vertices.push({
      x: packet.vertices[v * 2]!,
      y: packet.vertices[v * 2 + 1]!,
      u: packet.uvs[v * 2] ?? 0,
      v: packet.uvs[v * 2 + 1] ?? 0,
      r: packet.colors[v * 4] ?? 255,
      g: packet.colors[v * 4 + 1] ?? 255,
      b: packet.colors[v * 4 + 2] ?? 255,
      a: packet.colors[v * 4 + 3] ?? 255,
      depth: packet.depth[v] ?? 0,
      seam: packet.seam[v] ?? 0,
    })
  }
  const positive = new MeshDraft()
  const negative = new MeshDraft()
  for (let t = 0; t < packet.indices.length; t += 3) {
    const tri = [vertices[packet.indices[t]!]!, vertices[packet.indices[t + 1]!]!, vertices[packet.indices[t + 2]!]!]
    addClipped(positive, tri, side, 1)
    addClipped(negative, tri, side, -1)
  }
  return {
    positive: positive.finish(packet),
    negative: negative.finish(packet),
  }
}

class MeshDraft {
  readonly positions: number[] = []
  readonly uvs: number[] = []
  readonly colors: number[] = []
  readonly depths: number[] = []
  readonly seam: number[] = []
  readonly indices: number[] = []

  add(vertex: Vertex): number {
    const index = this.positions.length / 2
    this.positions.push(vertex.x, vertex.y)
    this.uvs.push(vertex.u, vertex.v)
    this.colors.push(vertex.r, vertex.g, vertex.b, vertex.a)
    this.depths.push(vertex.depth)
    this.seam.push(vertex.seam)
    return index
  }

  finish(source: RenderPacket): RenderPacket | null {
    if (this.indices.length < 3) return null
    const count = this.positions.length / 2
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (let v = 0; v < count; v += 1) {
      minX = Math.min(minX, this.positions[v * 2]!)
      maxX = Math.max(maxX, this.positions[v * 2]!)
      minY = Math.min(minY, this.positions[v * 2 + 1]!)
      maxY = Math.max(maxY, this.positions[v * 2 + 1]!)
    }
    return {
      ...source,
      vertices: Float32Array.from(this.positions),
      uvs: Float32Array.from(this.uvs),
      colors: Uint8Array.from(this.colors.map((value) => Math.max(0, Math.min(255, Math.round(value))))),
      depth: Float32Array.from(this.depths),
      seam: Uint8Array.from(this.seam.map((value) => (value === 1 ? 1 : 0))),
      indices: Uint16Array.from(this.indices),
      bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    }
  }
}

function addClipped(
  draft: MeshDraft,
  triangle: readonly Vertex[],
  side: (p: Point) => number,
  sign: 1 | -1,
): void {
  const polygon: Vertex[] = []
  for (let i = 0; i < 3; i += 1) {
    const current = triangle[i]!
    const next = triangle[(i + 1) % 3]!
    const currentSide = side(current) * sign
    const nextSide = side(next) * sign
    if (currentSide >= -1e-9) polygon.push(current)
    if ((currentSide > 1e-9 && nextSide < -1e-9) || (currentSide < -1e-9 && nextSide > 1e-9)) {
      const t = currentSide / (currentSide - nextSide)
      polygon.push(lerpVertex(current, next, t))
    }
  }
  if (polygon.length < 3) return
  const base = draft.add(polygon[0]!)
  for (let i = 1; i + 1 < polygon.length; i += 1) {
    const b = draft.add(polygon[i]!)
    const c = draft.add(polygon[i + 1]!)
    draft.indices.push(base, b, c)
  }
}

function lerpVertex(a: Vertex, b: Vertex, t: number): Vertex {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    u: a.u + (b.u - a.u) * t,
    v: a.v + (b.v - a.v) * t,
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
    depth: a.depth + (b.depth - a.depth) * t,
    seam: a.seam,
  }
}

/**
 * 把 RGBA 0–1 转成字节，供外部构造测试包。
 * @param color 颜色
 */
export function colorBytes(color: RGBA): [number, number, number, number] {
  return [
    Math.round(color.r * 255),
    Math.round(color.g * 255),
    Math.round(color.b * 255),
    Math.round(color.a * 255),
  ]
}
