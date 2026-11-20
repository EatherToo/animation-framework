import type { Fill } from '../part/set'
import { createMeshTextures, type Texture } from './texture'

/** 顶点所在的空间。蒙皮网格在绑定角色空间，刚性零件在零件局部。 */
export type MeshSpace = 'character' | 'part'

/** 一份部件网格。`positions` 为 xyz 交错，步长 3。 */
export type Mesh = {
  readonly partId: string
  readonly space: MeshSpace
  readonly positions: Float32Array
  readonly indices: Uint16Array
  readonly textures: readonly Texture[]
  readonly triangleTexture: Uint16Array
  readonly uvs: Float32Array
}

/** 与部件顺序一致的网格集合。 */
export type MeshSet = {
  readonly meshes: readonly Mesh[]
}

/**
 * 圆管的一段中心线。`(px, py)` 是矢状面里的侧向单位向量，
 * `z0`、`z1` 是两端的横向位置。
 */
export type StripSegment = {
  readonly x0: number
  readonly y0: number
  readonly z0: number
  readonly x1: number
  readonly y1: number
  readonly z1: number
  readonly px: number
  readonly py: number
  readonly radius: number
}

/** 圆管截面的采样数。`θ = j · 2π / TUBE_SIDES`。 */
export const TUBE_SIDES = 16

/** 每根骨头沿轴向切开的等长子段数。 */
export const AXIAL_STEPS = 8

/**
 * 把中心线段收成两端敞开的圆管。空段列表抛出 `segments`。
 * @param partId 部件名字
 * @param space 顶点所在空间
 * @param segments 从近端到远端的段
 */
export function meshFromStrip(
  partId: string,
  space: MeshSpace,
  segments: readonly StripSegment[],
  fill: Fill,
): Mesh {
  if (segments.length === 0) throw new Error('segments')
  const intervals = segments.length * AXIAL_STEPS
  const stations = intervals + 1
  const positions = new Float32Array(stations * TUBE_SIDES * 3)
  const indices = new Uint16Array(intervals * TUBE_SIDES * 6)
  writeTube(positions, indices, segments)
  return { partId, space, positions, indices, ...createMeshTextures(indices, fill) }
}

/**
 * 把中心线段收成两端加盖的圆管。盖心排在环顶点之后：先起点，再终点。
 * 空段列表抛出 `segments`。
 * @param partId 部件名字
 * @param space 顶点所在空间
 * @param segments 从近端到远端的段
 */
export function meshFromCappedTube(
  partId: string,
  space: MeshSpace,
  segments: readonly StripSegment[],
  fill: Fill,
): Mesh {
  if (segments.length === 0) throw new Error('segments')
  const intervals = segments.length * AXIAL_STEPS
  const stations = intervals + 1
  const ring = stations * TUBE_SIDES
  const positions = new Float32Array((ring + 2) * 3)
  const sides = intervals * TUBE_SIDES * 6
  const indices = new Uint16Array(sides + TUBE_SIDES * 6)
  writeTube(positions, indices, segments)

  const first = segments[0]!
  const last = segments[segments.length - 1]!
  const start = ring
  const end = ring + 1
  positions[start * 3] = first.x0
  positions[start * 3 + 1] = first.y0
  positions[start * 3 + 2] = first.z0
  positions[end * 3] = last.x1
  positions[end * 3 + 1] = last.y1
  positions[end * 3 + 2] = last.z1

  const tail = (stations - 1) * TUBE_SIDES
  for (let j = 0; j < TUBE_SIDES; j += 1) {
    const next = (j + 1) % TUBE_SIDES
    const t = sides + j * 6
    indices[t] = start
    indices[t + 1] = next
    indices[t + 2] = j
    indices[t + 3] = end
    indices[t + 4] = tail + j
    indices[t + 5] = tail + next
  }
  return { partId, space, positions, indices, ...createMeshTextures(indices, fill) }
}

function writeTube(
  positions: Float32Array,
  indices: Uint16Array,
  segments: readonly StripSegment[],
): void {
  const first = segments[0]!
  writeStation(positions, 0, first.x0, first.y0, first.z0, first.px, first.py, first.radius)

  let station = 0
  let radiusAtJoint = first.radius
  for (let b = 0; b < segments.length; b += 1) {
    const seg = segments[b]!
    const radiusStart = b === 0 ? seg.radius : radiusAtJoint
    const radiusEnd = seg.radius
    for (let k = 1; k <= AXIAL_STEPS; k += 1) {
      const t = k / AXIAL_STEPS
      writeStation(
        positions,
        station + k,
        seg.x0 + (seg.x1 - seg.x0) * t,
        seg.y0 + (seg.y1 - seg.y0) * t,
        seg.z0 + (seg.z1 - seg.z0) * t,
        seg.px,
        seg.py,
        radiusStart * (1 - t) + radiusEnd * t,
      )
    }
    station += AXIAL_STEPS
    radiusAtJoint = radiusEnd
  }

  const intervals = segments.length * AXIAL_STEPS
  for (let i = 0; i < intervals; i += 1) {
    const near = i * TUBE_SIDES
    const far = near + TUBE_SIDES
    for (let j = 0; j < TUBE_SIDES; j += 1) {
      const next = (j + 1) % TUBE_SIDES
      const t = (i * TUBE_SIDES + j) * 6
      indices[t] = near + j
      indices[t + 1] = near + next
      indices[t + 2] = far + j
      indices[t + 3] = near + next
      indices[t + 4] = far + next
      indices[t + 5] = far + j
    }
  }
}

function writeStation(
  positions: Float32Array,
  station: number,
  x: number,
  y: number,
  z: number,
  px: number,
  py: number,
  radius: number,
): void {
  for (let j = 0; j < TUBE_SIDES; j += 1) {
    const theta = (j * 2 * Math.PI) / TUBE_SIDES
    const side = radius * Math.cos(theta)
    const base = (station * TUBE_SIDES + j) * 3
    positions[base] = x + px * side
    positions[base + 1] = y + py * side
    positions[base + 2] = z + radius * Math.sin(theta)
  }
}

/**
 * 零件局部的平板。矢状面矩形上沿 `yTop`、下沿 `yBottom`、沿 `+X`，
 * 再沿局部 `z` 向两侧各伸出 `halfWidth`。
 * 顶点 0..3 在 `−halfWidth`，4..7 在 `+halfWidth`，各按矩形四角的顺序。
 * @param partId 部件名字
 * @param x0 起点
 * @param x1 终点
 * @param yTop 上沿
 * @param yBottom 下沿
 * @param halfWidth 横向半宽
 */
export function meshFromRectangle(
  partId: string,
  x0: number,
  x1: number,
  yTop: number,
  yBottom: number,
  halfWidth: number,
  fill: Fill,
): Mesh {
  const near = -halfWidth
  const far = halfWidth
  const positions = new Float32Array([
    x0, yTop, near,
    x0, yBottom, near,
    x1, yTop, near,
    x1, yBottom, near,
    x0, yTop, far,
    x0, yBottom, far,
    x1, yTop, far,
    x1, yBottom, far,
  ])
  const indices = new Uint16Array([
    0, 2, 3, 0, 3, 1,
    4, 5, 7, 4, 7, 6,
    0, 1, 5, 0, 5, 4,
    2, 6, 7, 2, 7, 3,
    0, 4, 6, 0, 6, 2,
    1, 3, 7, 1, 7, 5,
  ])
  return { partId, space: 'part', positions, indices, ...createMeshTextures(indices, fill) }
}
