import { meshBounds } from './scene'
import type { RenderMesh } from './types'

/** 一个 2D 形状的原始三角形数据。positions 步长 2。 */
export type Shape = {
  readonly positions: Float32Array
  readonly indices: Uint16Array
  readonly depth: Float32Array
}

/**
 * 多边形按中心扇形三角化。多边形必须逆时针；中心点取顶点平均。
 * @param points 逆时针外轮廓
 */
export function fanShape(points: readonly { x: number; y: number; depth: number }[]): Shape {
  if (points.length < 3) throw new Error('shape')
  let cx = 0
  let cy = 0
  let cd = 0
  for (const point of points) {
    cx += point.x
    cy += point.y
    cd += point.depth
  }
  cx /= points.length
  cy /= points.length
  cd /= points.length
  const positions = new Float32Array((points.length + 1) * 2)
  const depth = new Float32Array(points.length + 1)
  const indices = new Uint16Array(points.length * 3)
  for (let i = 0; i < points.length; i += 1) {
    positions[i * 2] = points[i]!.x
    positions[i * 2 + 1] = points[i]!.y
    depth[i] = points[i]!.depth
    indices[i * 3] = points.length
    indices[i * 3 + 1] = i
    indices[i * 3 + 2] = (i + 1) % points.length
  }
  positions[points.length * 2] = cx
  positions[points.length * 2 + 1] = cy
  depth[points.length] = cd
  return { positions, indices, depth }
}

/**
 * 椭圆/圆环形状。`u` 是长轴方向，`n` 是短轴方向；两者应为单位正交。
 * @param center 中心
 * @param u 长轴方向
 * @param n 短轴方向
 * @param halfU 长半轴
 * @param halfN 短半轴
 * @param segments 段数，至少 3
 * @param depth 深度
 */
export function ellipseShape(
  center: { x: number; y: number },
  u: { x: number; y: number },
  n: { x: number; y: number },
  halfU: number,
  halfN: number,
  segments: number,
  depth: number,
): Shape {
  const count = Math.max(3, Math.floor(segments))
  const points: { x: number; y: number; depth: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2
    const a = Math.cos(angle) * halfU
    const b = Math.sin(angle) * halfN
    points.push({
      x: center.x + u.x * a + n.x * b,
      y: center.y + u.y * a + n.y * b,
      depth,
    })
  }
  return fanShape(points)
}

/**
 * 两条同长轮廓之间的条带三角化：每截面两点，逐段两个三角形。
 * @param left 左轮廓
 * @param right 右轮廓
 */
export function stripShape(
  left: readonly { x: number; y: number; depth: number }[],
  right: readonly { x: number; y: number; depth: number }[],
): Shape {
  if (left.length !== right.length || left.length < 2) throw new Error('shape')
  const count = left.length
  const positions = new Float32Array(count * 4)
  const depth = new Float32Array(count * 2)
  const indices: number[] = []
  for (let i = 0; i < count; i += 1) {
    positions[i * 4] = right[i]!.x
    positions[i * 4 + 1] = right[i]!.y
    positions[i * 4 + 2] = left[i]!.x
    positions[i * 4 + 3] = left[i]!.y
    depth[i * 2] = right[i]!.depth
    depth[i * 2 + 1] = left[i]!.depth
  }
  for (let i = 0; i + 1 < count; i += 1) {
    const a = i * 2
    const b = a + 1
    const c = a + 2
    const d = a + 3
    indices.push(a, b, c, b, d, c)
  }
  return { positions, indices: Uint16Array.from(indices), depth }
}

/**
 * 规则网格：每行点数相同，逐格两个三角形。
 * @param rows 行优先的点阵
 */
export function gridShape(
  rows: readonly (readonly { x: number; y: number; depth: number }[])[],
): Shape {
  if (rows.length < 2) throw new Error('shape')
  const columns = rows[0]!.length
  if (columns < 2) throw new Error('shape')
  let count = 0
  for (const row of rows) {
    if (row.length !== columns) throw new Error('shape')
    count += row.length
  }
  const positions = new Float32Array(count * 2)
  const depth = new Float32Array(count)
  const indices: number[] = []
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = 0; j < columns; j += 1) {
      const v = i * columns + j
      positions[v * 2] = rows[i]![j]!.x
      positions[v * 2 + 1] = rows[i]![j]!.y
      depth[v] = rows[i]![j]!.depth
    }
  }
  for (let i = 0; i + 1 < rows.length; i += 1) {
    for (let j = 0; j + 1 < columns; j += 1) {
      const a = i * columns + j
      const b = a + 1
      const c = a + columns
      const d = c + 1
      indices.push(a, b, c, b, d, c)
    }
  }
  return { positions, indices: Uint16Array.from(indices), depth }
}

/**
 * 椭圆网格：中心 + 若干同心环，用于头这类闭合形状。
 * @param center 中心
 * @param u 长轴方向
 * @param n 短轴方向
 * @param halfU 长半轴
 * @param halfN 短半轴
 * @param segments 每环段数
 * @param rings 环数，至少 1
 * @param depth 深度
 */
export function ellipseGridShape(
  center: { x: number; y: number },
  u: { x: number; y: number },
  n: { x: number; y: number },
  halfU: number,
  halfN: number,
  segments: number,
  rings: number,
  depth: number,
): Shape {
  const count = Math.max(3, Math.floor(segments))
  const ringCount = Math.max(1, Math.floor(rings))
  const vertexCount = 1 + count * ringCount
  const positions = new Float32Array(vertexCount * 2)
  const depths = new Float32Array(vertexCount)
  const indices: number[] = []
  positions[0] = center.x
  positions[1] = center.y
  depths[0] = depth
  for (let r = 1; r <= ringCount; r += 1) {
    const radius = r / ringCount
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2
      const a = Math.cos(angle) * halfU * radius
      const b = Math.sin(angle) * halfN * radius
      const v = 1 + (r - 1) * count + i
      positions[v * 2] = center.x + u.x * a + n.x * b
      positions[v * 2 + 1] = center.y + u.y * a + n.y * b
      depths[v] = depth
    }
  }
  for (let i = 0; i < count; i += 1) {
    indices.push(0, 1 + i, 1 + ((i + 1) % count))
  }
  for (let r = 1; r < ringCount; r += 1) {
    const inner = 1 + (r - 1) * count
    const outer = 1 + r * count
    for (let i = 0; i < count; i += 1) {
      const j = (i + 1) % count
      indices.push(inner + i, outer + i, outer + j, inner + i, outer + j, inner + j)
    }
  }
  return { positions, indices: Uint16Array.from(indices), depth: depths }
}

/**
 * 四边形形状，按逆时针给四个角；直接两个三角形。
 * @param a 角 0
 * @param b 角 1
 * @param c 角 2
 * @param d 角 3
 */
export function quadShape(
  a: { x: number; y: number; depth: number },
  b: { x: number; y: number; depth: number },
  c: { x: number; y: number; depth: number },
  d: { x: number; y: number; depth: number },
): Shape {
  return {
    positions: Float32Array.from([
      a.x, a.y,
      b.x, b.y,
      c.x, c.y,
      d.x, d.y,
    ]),
    indices: Uint16Array.from([0, 1, 2, 0, 2, 3]),
    depth: Float32Array.from([a.depth, b.depth, c.depth, d.depth]),
  }
}

/**
 * 合并多个不相连的形状（例如手掌 + 五指）。
 * @param shapes 形状列表
 */
export function mergeShapes(shapes: readonly Shape[]): Shape {
  let vertexCount = 0
  let indexCount = 0
  for (const shape of shapes) {
    vertexCount += shape.positions.length / 2
    indexCount += shape.indices.length
  }
  const positions = new Float32Array(vertexCount * 2)
  const depth = new Float32Array(vertexCount)
  const indices = new Uint16Array(indexCount)
  let vo = 0
  let io = 0
  for (const shape of shapes) {
    const count = shape.positions.length / 2
    positions.set(shape.positions, vo * 2)
    depth.set(shape.depth, vo)
    for (let i = 0; i < shape.indices.length; i += 1) indices[io + i] = shape.indices[i]! + vo
    vo += count
    io += shape.indices.length
  }
  return { positions, indices, depth }
}

/**
 * 把 Shape 包成没有 UV/颜色/权重的 RenderMesh。
 * @param shape 形状
 * @param seam 可选缝线顶点数（默认空）
 */
export function shapeToMesh(shape: Shape, seam = new Uint8Array(0)): RenderMesh {
  if (shape.depth.length !== shape.positions.length / 2) throw new Error('depth')
  return {
    positions: shape.positions,
    uvs: new Float32Array(0),
    indices: shape.indices,
    colors: new Uint8Array(0),
    boneIndices: new Uint16Array(0),
    weights: new Float32Array(0),
    seam,
    depth: shape.depth,
    bounds: meshBounds(shape.positions),
  }
}
