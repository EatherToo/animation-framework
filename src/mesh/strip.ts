/** 顶点所在的空间。蒙皮网格在绑定角色空间，刚性零件在零件局部。 */
export type MeshSpace = 'character' | 'part'

/** 一份部件网格。`positions` 为 xyz 交错，步长 3。 */
export type Mesh = {
  readonly partId: string
  readonly space: MeshSpace
  readonly positions: Float32Array
  readonly indices: Uint16Array
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

/** 圆管截面的采样数。 */
export const TUBE_SIDES = 8

const S = Math.SQRT1_2

/** 第 `j` 个采样在矢状面侧向上的分量，`θ = j · π / 4`。 */
const RING_SIDE: readonly number[] = [1, S, 0, -S, -1, -S, 0, S]

/** 第 `j` 个采样在横向上的分量。 */
const RING_LATERAL: readonly number[] = [0, S, 1, S, 0, -S, -1, -S]

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
): Mesh {
  if (segments.length === 0) throw new Error('segments')
  const stations = segments.length + 1
  const positions = new Float32Array(stations * TUBE_SIDES * 3)
  const indices = new Uint16Array(segments.length * TUBE_SIDES * 6)
  writeTube(positions, indices, segments)
  return { partId, space, positions, indices }
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
): Mesh {
  if (segments.length === 0) throw new Error('segments')
  const stations = segments.length + 1
  const ring = stations * TUBE_SIDES
  const positions = new Float32Array((ring + 2) * 3)
  const sides = segments.length * TUBE_SIDES * 6
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
  return { partId, space, positions, indices }
}

function writeTube(
  positions: Float32Array,
  indices: Uint16Array,
  segments: readonly StripSegment[],
): void {
  const first = segments[0]!
  writeStation(positions, 0, first.x0, first.y0, first.z0, first)
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!
    writeStation(positions, i + 1, seg.x1, seg.y1, seg.z1, seg)
  }

  for (let i = 0; i < segments.length; i += 1) {
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
  seg: StripSegment,
): void {
  for (let j = 0; j < TUBE_SIDES; j += 1) {
    const side = seg.radius * RING_SIDE[j]!
    const base = (station * TUBE_SIDES + j) * 3
    positions[base] = x + seg.px * side
    positions[base + 1] = y + seg.py * side
    positions[base + 2] = z + seg.radius * RING_LATERAL[j]!
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
  return { partId, space: 'part', positions, indices }
}
