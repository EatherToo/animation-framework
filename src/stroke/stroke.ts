export const STROKE_WIDTH = 0.012
export const SEAM = 1e-4

export type StrokeSource = {
  readonly partId: string
  readonly positions: Float32Array
  readonly indices: Uint16Array
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

function boundary(part: number, source: StrokeSource): Edge[] {
  const counts = new Map<string, { count: number; edge: Edge }>()
  const indices = source.indices
  const positions = source.positions
  for (let i = 0; i < indices.length; i += 3) {
    add(counts, part, positions, indices[i]!, indices[i + 1]!)
    add(counts, part, positions, indices[i + 1]!, indices[i + 2]!)
    add(counts, part, positions, indices[i + 2]!, indices[i]!)
  }
  const edges: Edge[] = []
  for (const item of counts.values()) {
    if (item.count === 1) edges.push(item.edge)
  }
  return edges
}

function add(
  counts: Map<string, { count: number; edge: Edge }>,
  part: number,
  positions: Float32Array,
  a: number,
  b: number,
): void {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`
  const found = counts.get(key)
  if (found) {
    found.count += 1
    return
  }
  counts.set(key, {
    count: 1,
    edge: {
      part,
      x0: positions[a * 2]!,
      y0: positions[a * 2 + 1]!,
      x1: positions[b * 2]!,
      y1: positions[b * 2 + 1]!,
    },
  })
}

function near(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.hypot(ax - bx, ay - by) <= SEAM
}

function seam(a: Edge, b: Edge): boolean {
  return (
    (near(a.x0, a.y0, b.x0, b.y0) && near(a.x1, a.y1, b.x1, b.y1)) ||
    (near(a.x0, a.y0, b.x1, b.y1) && near(a.x1, a.y1, b.x0, b.y0))
  )
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
