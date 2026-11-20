export const STROKE_WIDTH = 0.012
export const SEAM = 1e-4

/** 屏幕上比这更短的边不描：它正对着视线。 */
const MIN_EDGE = 1e-9

/** 描边的输入：投影后的平面点（步长 2）和三角形。 */
export type StrokeSource = {
  readonly partId: string
  readonly positions: Float32Array
  readonly indices: Uint16Array
  /** 每个顶点一项；两端都是 1 的开口边不描。 */
  readonly seam?: Uint8Array
}

export type StrokeQuad = {
  readonly positions: Float32Array
  readonly indices: Uint16Array
}

export type StrokePart = {
  readonly partId: string
  readonly quads: readonly StrokeQuad[]
}

type Edge = {
  part: number
  x0: number
  y0: number
  x1: number
  y1: number
}

export function strokeContours(
  parts: readonly StrokeSource[],
  enabled: boolean,
  width: number = STROKE_WIDTH,
): StrokePart[] {
  if (!enabled) return []
  if (!Number.isFinite(width) || width <= 0) throw new Error('width')
  const edges: Edge[] = []
  for (let part = 0; part < parts.length; part += 1) {
    edges.push(...boundary(part, parts[part]!))
  }
  const keep = edges.filter((edge, index) => !edges.some((other, otherIndex) => otherIndex !== index && edge.part !== other.part && seam(edge, other)))
  const grouped = new Map<number, Edge[]>()
  for (const edge of keep) {
    const list = grouped.get(edge.part) ?? []
    list.push(edge)
    grouped.set(edge.part, list)
  }
  return parts.map((part, index) => ({
    partId: part.partId,
    quads: (grouped.get(index) ?? []).map((edge) => quad(edge, width)),
  }))
}

/**
 * 取出一个部件的轮廓边。每条边按所在三角形的逆时针走向记 +1 或 −1，
 * 两次走向相反的共享边抵消，留下的就是轮廓。
 * 平面网格里它等于只被一个三角形使用的边；
 * 投影后正面与背面相接的边两次走向相同，也留下。
 * 留下的边按净走向写出端点，部件的内侧在它的左边。
 */
function boundary(part: number, source: StrokeSource): Edge[] {
  const nets = new Map<string, { lo: number; hi: number; net: number }>()
  const indices = source.indices
  const positions = source.positions
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!
    const b = indices[i + 1]!
    const c = indices[i + 2]!
    const ax = positions[a * 2]!
    const ay = positions[a * 2 + 1]!
    const cross =
      (positions[b * 2]! - ax) * (positions[c * 2 + 1]! - ay) -
      (positions[b * 2 + 1]! - ay) * (positions[c * 2]! - ax)
    const turn = cross < 0 ? -1 : 1
    add(nets, a, b, turn)
    add(nets, b, c, turn)
    add(nets, c, a, turn)
  }
  const seam = source.seam
  const edges: Edge[] = []
  for (const item of nets.values()) {
    if (item.net === 0) continue
    const from = item.net > 0 ? item.lo : item.hi
    const to = item.net > 0 ? item.hi : item.lo
    if (seam !== undefined && seam[from] === 1 && seam[to] === 1) continue
    const x0 = positions[from * 2]!
    const y0 = positions[from * 2 + 1]!
    const x1 = positions[to * 2]!
    const y1 = positions[to * 2 + 1]!
    if (Math.hypot(x1 - x0, y1 - y0) <= MIN_EDGE) continue
    edges.push({ part, x0, y0, x1, y1 })
  }
  return edges
}

function add(
  nets: Map<string, { lo: number; hi: number; net: number }>,
  from: number,
  to: number,
  turn: number,
): void {
  const lo = from < to ? from : to
  const hi = from < to ? to : from
  const key = `${lo}:${hi}`
  const dir = from === lo ? turn : -turn
  const found = nets.get(key)
  if (found) {
    found.net += dir
    return
  }
  nets.set(key, { lo, hi, net: dir })
}

function near(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.hypot(ax - bx, ay - by) <= SEAM
}

/**
 * 两个部件隔着同一条边相接：端点重合，走向相反。
 * 走向相同的两条边属于在屏幕上叠在一起的两件，各自保留。
 */
function seam(a: Edge, b: Edge): boolean {
  return near(a.x0, a.y0, b.x1, b.y1) && near(a.x1, a.y1, b.x0, b.y0)
}

function quad(edge: Edge, width: number): StrokeQuad {
  const dx = edge.x1 - edge.x0
  const dy = edge.y1 - edge.y0
  const length = Math.hypot(dx, dy) || 1
  const nx = dy / length
  const ny = -dx / length
  const half = width / 2
  const positions = new Float32Array(8)
  write(positions, 0, edge.x0 + nx * half, edge.y0 + ny * half)
  write(positions, 2, edge.x1 + nx * half, edge.y1 + ny * half)
  write(positions, 4, edge.x1 - nx * half, edge.y1 - ny * half)
  write(positions, 6, edge.x0 - nx * half, edge.y0 - ny * half)
  return { positions, indices: Uint16Array.of(0, 1, 2, 0, 2, 3) }
}

function write(out: Float32Array, index: number, x: number, y: number): void {
  out[index] = x
  out[index + 1] = y
}
