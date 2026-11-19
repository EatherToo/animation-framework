import type { Mesh } from '../mesh/strip'

const AREA_EPSILON = 1e-8

/**
 * 验收三角形、退化、边的使用次数和连通性。失败时抛出，不改网格。
 * 外向绕向由网格生成保证；屏幕上的绕向在投影之后调整。
 * @param mesh 待验收的网格
 */
export function validateMesh(mesh: Mesh): void {
  const positions = mesh.positions
  const indices = mesh.indices
  if (positions.length < 9 || positions.length % 3 !== 0) throw new Error('mesh')
  if (indices.length < 3 || indices.length % 3 !== 0) throw new Error('mesh')

  const vertexCount = positions.length / 3
  for (let i = 0; i < indices.length; i += 1) {
    const index = indices[i]!
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
      throw new Error('indices')
    }
  }

  const triangleCount = indices.length / 3
  for (let t = 0; t < triangleCount; t += 1) {
    if (crossLength(positions, indices, t) <= AREA_EPSILON) throw new Error('degenerate')
  }

  const edges = new Map<string, { count: number; dir: number }>()
  for (let t = 0; t < triangleCount; t += 1) {
    const a = indices[t * 3]!
    const b = indices[t * 3 + 1]!
    const c = indices[t * 3 + 2]!
    addEdge(edges, a, b)
    addEdge(edges, b, c)
    addEdge(edges, c, a)
  }

  const neighbors: number[][] = Array.from({ length: triangleCount }, () => [])
  const used = new Map<string, number>()
  for (let t = 0; t < triangleCount; t += 1) {
    const a = indices[t * 3]!
    const b = indices[t * 3 + 1]!
    const c = indices[t * 3 + 2]!
    link(neighbors, used, t, a, b)
    link(neighbors, used, t, b, c)
    link(neighbors, used, t, c, a)
  }
  const seen = new Array<boolean>(triangleCount).fill(false)
  const stack = [0]
  seen[0] = true
  let visited = 0
  while (stack.length > 0) {
    const current = stack.pop()!
    visited += 1
    const next = neighbors[current]!
    for (let i = 0; i < next.length; i += 1) {
      const other = next[i]!
      if (seen[other]) continue
      seen[other] = true
      stack.push(other)
    }
  }
  if (visited !== triangleCount) throw new Error('connectivity')
}

function crossLength(positions: Float32Array, indices: Uint16Array, triangle: number): number {
  const i0 = indices[triangle * 3]! * 3
  const i1 = indices[triangle * 3 + 1]! * 3
  const i2 = indices[triangle * 3 + 2]! * 3
  const ux = positions[i1]! - positions[i0]!
  const uy = positions[i1 + 1]! - positions[i0 + 1]!
  const uz = positions[i1 + 2]! - positions[i0 + 2]!
  const vx = positions[i2]! - positions[i0]!
  const vy = positions[i2 + 1]! - positions[i0 + 1]!
  const vz = positions[i2 + 2]! - positions[i0 + 2]!
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
}

function addEdge(
  edges: Map<string, { count: number; dir: number }>,
  from: number,
  to: number,
): void {
  const lo = from < to ? from : to
  const hi = from < to ? to : from
  const key = `${lo}:${hi}`
  const dir = from === lo ? 1 : -1
  const previous = edges.get(key)
  if (previous === undefined) {
    edges.set(key, { count: 1, dir })
    return
  }
  if (previous.count === 2 || previous.dir === dir) throw new Error('manifold')
  previous.count = 2
}

function link(
  neighbors: number[][],
  used: Map<string, number>,
  triangle: number,
  from: number,
  to: number,
): void {
  const lo = from < to ? from : to
  const hi = from < to ? to : from
  const key = `${lo}:${hi}`
  const other = used.get(key)
  if (other === undefined) {
    used.set(key, triangle)
    return
  }
  neighbors[triangle]!.push(other)
  neighbors[other]!.push(triangle)
}
