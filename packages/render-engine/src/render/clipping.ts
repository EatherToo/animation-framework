/**
 * H3：clipping attachment 的 CPU 三角形裁剪。
 * 输入/输出都是世界空间；UV 与顶点同步插值，输出三角形列表（顶点可重复）。
 */
import { triangulatePolygon } from './render'

export type ClippedGeometry = {
  readonly positions: Float32Array
  readonly uvs: Float32Array
  readonly indices: Uint16Array
}

type Vertex = { x: number; y: number; u: number; v: number }

const EPS = 1e-9

function signedArea(points: Float32Array): number {
  let area = 0
  const n = Math.floor(points.length / 2)
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n
    area += points[i * 2]! * points[j * 2 + 1]! - points[j * 2]! * points[i * 2 + 1]!
  }
  return area
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

function clipAgainstConvex(poly: readonly Vertex[], convex: readonly Vertex[]): Vertex[] {
  let out = poly.slice()
  for (let i = 0; i < convex.length && out.length > 0; i += 1) {
    const a = convex[i]!
    const b = convex[(i + 1) % convex.length]!
    const input = out
    out = []
    for (let j = 0; j < input.length; j += 1) {
      const p = input[j]!
      const q = input[(j + 1) % input.length]!
      const cp = cross(a.x, a.y, b.x, b.y, p.x, p.y)
      const cq = cross(a.x, a.y, b.x, b.y, q.x, q.y)
      const insideP = cp >= -EPS
      const insideQ = cq >= -EPS
      if (insideP) out.push(p)
      if (insideP !== insideQ) {
        const denom = cp - cq
        const t = Math.abs(denom) < EPS ? 0 : cp / denom
        const k = Math.min(1, Math.max(0, t))
        out.push({
          x: p.x + (q.x - p.x) * k,
          y: p.y + (q.y - p.y) * k,
          u: p.u + (q.u - p.u) * k,
          v: p.v + (q.v - p.v) * k,
        })
      }
    }
  }
  return out
}

/**
 * 用若干简单多边形裁剪三角形列表；凹多边形内部先耳切。
 * 每个输出多边形扇形三角化，不做跨凸块的布尔合并。
 */
export function clipTriangles(
  positions: Float32Array,
  uvs: Float32Array,
  indices: Uint16Array | Uint32Array,
  clipPolygons: readonly Float32Array[],
): ClippedGeometry {
  const convexParts: Vertex[][] = []
  for (const polygon of clipPolygons) {
    if (polygon.length < 6) continue
    const ccw = signedArea(polygon) >= 0
    const tri = triangulatePolygon(polygon)
    for (let i = 0; i + 2 < tri.length; i += 3) {
      const ids = [tri[i]!, tri[i + 1]!, tri[i + 2]!]
      const part: Vertex[] = ids.map((id) => {
        const x = polygon[id * 2]!
        const y = polygon[id * 2 + 1]!
        return { x, y, u: 0, v: 0 }
      })
      if (!ccw) part.reverse()
      convexParts.push(part)
    }
  }
  if (convexParts.length === 0) {
    return { positions: new Float32Array(0), uvs: new Float32Array(0), indices: new Uint16Array(0) }
  }

  const outPositions: number[] = []
  const outUvs: number[] = []
  const outIndices: number[] = []
  const vertexAt = (id: number): Vertex => ({
    x: positions[id * 2] ?? 0,
    y: positions[id * 2 + 1] ?? 0,
    u: uvs[id * 2] ?? 0,
    v: uvs[id * 2 + 1] ?? 0,
  })

  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = vertexAt(indices[t]!)
    const b = vertexAt(indices[t + 1]!)
    const c = vertexAt(indices[t + 2]!)
    for (const part of convexParts) {
      const poly = clipAgainstConvex([a, b, c], part)
      if (poly.length < 3) continue
      const base = outPositions.length / 2
      for (const p of poly) {
        outPositions.push(p.x, p.y)
        outUvs.push(p.u, p.v)
      }
      for (let i = 1; i + 1 < poly.length; i += 1) {
        outIndices.push(base, base + i, base + i + 1)
      }
    }
  }
  return {
    positions: Float32Array.from(outPositions),
    uvs: Float32Array.from(outUvs),
    indices: Uint16Array.from(outIndices),
  }
}
