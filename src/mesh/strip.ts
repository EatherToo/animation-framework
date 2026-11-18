/** 顶点所在的空间。蒙皮网格在绑定角色空间，刚性零件在零件局部。 */
export type MeshSpace = 'character' | 'part'

/** 一份部件网格。`positions` 为 xy 交错。 */
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

/** 条带的一段中心线。`px, py` 是侧向单位向量。 */
export type StripSegment = {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly px: number
  readonly py: number
  readonly radius: number
}

/**
 * 把中心线段收成相连条带。空段列表抛出 `segments`。
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
  const positions = new Float32Array(stations * 4)
  writeStation(positions, 0, segments[0]!.x0, segments[0]!.y0, segments[0]!)
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!
    writeStation(positions, i + 1, seg.x1, seg.y1, seg)
  }

  const indices = new Uint16Array(segments.length * 6)
  for (let i = 0; i < segments.length; i += 1) {
    const a = i * 2
    const b = a + 1
    const c = a + 2
    const d = a + 3
    const t = i * 6
    indices[t] = a
    indices[t + 1] = d
    indices[t + 2] = c
    indices[t + 3] = a
    indices[t + 4] = b
    indices[t + 5] = d
  }
  return { partId, space, positions, indices }
}

function writeStation(
  positions: Float32Array,
  station: number,
  x: number,
  y: number,
  seg: StripSegment,
): void {
  const plus = station * 2
  positions[plus * 2] = x + seg.px * seg.radius
  positions[plus * 2 + 1] = y + seg.py * seg.radius
  positions[(plus + 1) * 2] = x - seg.px * seg.radius
  positions[(plus + 1) * 2 + 1] = y - seg.py * seg.radius
}

/**
 * 零件局部的矩形。上沿 `yTop`，下沿 `yBottom`，沿 `+X`。
 * @param partId 部件名字
 * @param x0 起点
 * @param x1 终点
 * @param yTop 上沿
 * @param yBottom 下沿
 */
export function meshFromRectangle(
  partId: string,
  x0: number,
  x1: number,
  yTop: number,
  yBottom: number,
): Mesh {
  const positions = new Float32Array([x0, yTop, x0, yBottom, x1, yTop, x1, yBottom])
  const indices = new Uint16Array([0, 3, 2, 0, 1, 3])
  return { partId, space: 'part', positions, indices }
}
