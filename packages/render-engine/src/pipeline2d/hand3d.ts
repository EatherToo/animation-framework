import type { CompiledRig } from '../compile/compile'
import { bindLength, findBone } from '../skeleton/skeleton'
import { projectPositions, windIndices, VIEW_COUNT, type ViewIndex } from '../view/project'
import type { ProjectedPart } from '../view/project'

type P3 = { x: number; y: number; z: number }

const SIDES = 6

/**
 * 360° 体积用的手代理：掌盒 + 每根指骨一个锥形柱。
 * 直接按当前 FK 指骨位置生成，因此与 2D 指骨手共用同一套骨。
 * @param compiled 编译结果
 * @param fk 当前 FK
 * @param view 视角
 * @param side 左/右
 */
export function buildHandVolumeParts(
  compiled: CompiledRig,
  fk: Float32Array,
  view: ViewIndex,
  side: 'L' | 'R',
): ProjectedPart[] {
  if (!Number.isInteger(view) || view < 0 || view >= VIEW_COUNT) throw new Error('view')
  const parts: ProjectedPart[] = []
  const hand = findBone(compiled.skeleton, `hand${side}`)
  if (hand < 0) throw new Error('bone')
  const handLength = bindLength(compiled.skeleton, hand)
  const palmLength = compiled.proportions.palmFraction * handLength
  const palm = buildPalm(compiled, fk, hand, side, palmLength)
  parts.push(projectPart(`hand${side}`, palm.positions, palm.indices, view))
  const fingers = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const
  for (const finger of fingers) {
    const count = finger === 'thumb' ? 2 : 3
    for (let s = 1; s <= count; s += 1) {
      const bone = findBone(compiled.skeleton, `${finger}${s}${side}`)
      if (bone < 0) continue
      const base = origin(fk, bone)
      const axis = normalize(axisOf(fk, bone))
      const length = bindLength(compiled.skeleton, bone)
      if (length <= 1e-6) continue
      const radius0 = finger === 'thumb' ? compiled.proportions.thumbRadius * 0.8 : compiled.proportions.fingerRadius
      const radius1 = finger === 'thumb' ? radius0 * 0.8 : compiled.proportions.fingerTipRadius
      const mesh = buildSegment(base, axis, length, radius0, radius1)
      parts.push(projectPart(`hand${side}`, mesh.positions, mesh.indices, view))
    }
  }
  return parts.filter((part) => part.positions.length > 0)
}

type Draft = { positions: number[]; indices: number[] }

function buildPalm(
  compiled: CompiledRig,
  fk: Float32Array,
  hand: number,
  side: 'L' | 'R',
  length: number,
): Draft {
  const o = origin(fk, hand)
  const a = normalize(axisOf(fk, hand))
  const u = perpendicular(a, { x: 0, y: 0, z: 1 })
  const n = cross(a, u)
  const wrist = compiled.proportions.palmWrist
  const knuckle = compiled.proportions.palmKnuckle
  const d = { positions: [], indices: [] }
  const rings: number[][] = []
  const widths = [wrist.halfWidth, knuckle.halfWidth]
  const thicks = [wrist.halfThickness, knuckle.halfThickness]
  for (let r = 0; r < 2; r += 1) {
    const center = add(o, scale(a, (length * r) / 1))
    const ring: number[] = []
    for (const [su, sn] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) {
      ring.push(addTo(d, add(center, add(scale(u, su * widths[r]!), scale(n, sn * thicks[r]!)))))
    }
    rings.push(ring)
  }
  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4
    quad(d, rings[0]![i]!, rings[0]![j]!, rings[1]![j]!, rings[1]![i]!)
  }
  // 掌根/掌指两端的封口
  tri(d, rings[0]![0]!, rings[0]![2]!, rings[0]![1]!)
  tri(d, rings[0]![0]!, rings[0]![3]!, rings[0]![2]!)
  tri(d, rings[1]![0]!, rings[1]![1]!, rings[1]![2]!)
  tri(d, rings[1]![0]!, rings[1]![2]!, rings[1]![3]!)
  void side
  return d
}

function buildSegment(base: P3, axis: P3, length: number, radius0: number, radius1: number): Draft {
  const u = perpendicular(axis, { x: 0, y: 0, z: 1 })
  const n = cross(axis, u)
  const d = { positions: [], indices: [] }
  const rings: number[][] = []
  for (let r = 0; r < 2; r += 1) {
    const radius = r === 0 ? radius0 : radius1
    const center = add(base, scale(axis, r === 0 ? 0 : length))
    const ring: number[] = []
    for (let i = 0; i < SIDES; i += 1) {
      const angle = (i / SIDES) * Math.PI * 2
      ring.push(addTo(d, add(center, add(scale(u, Math.cos(angle) * radius), scale(n, Math.sin(angle) * radius)))))
    }
    rings.push(ring)
  }
  for (let i = 0; i < SIDES; i += 1) {
    const j = (i + 1) % SIDES
    quad(d, rings[0]![i]!, rings[0]![j]!, rings[1]![j]!, rings[1]![i]!)
  }
  // 尖端封口
  for (let i = 1; i + 1 < SIDES; i += 1) tri(d, rings[1]![0]!, rings[1]![i]!, rings[1]![i + 1]!)
  return d
}

function projectPart(
  partId: string,
  positions3D: readonly number[],
  indices3D: readonly number[],
  view: ViewIndex,
): ProjectedPart {
  const source = Float32Array.from(positions3D)
  const screen = new Float32Array((source.length / 3) * 2)
  const depth = projectPositions(screen, source, view)
  const indices = windIndices(new Uint16Array(indices3D), Uint16Array.from(indices3D), screen)
  return {
    partId,
    positions: screen,
    indices,
    depth,
    seam: new Uint8Array(source.length / 3),
  }
}

function origin(fk: Float32Array, bone: number): P3 {
  const i = bone * 12
  return { x: fk[i + 9]!, y: fk[i + 10]!, z: fk[i + 11]! }
}

function axisOf(fk: Float32Array, bone: number): P3 {
  const i = bone * 12
  return { x: fk[i]!, y: fk[i + 1]!, z: fk[i + 2]! }
}

function addTo(d: Draft, p: P3): number {
  const index = d.positions.length / 3
  d.positions.push(p.x, p.y, p.z)
  return index
}

function tri(d: Draft, a: number, b: number, c: number): void {
  d.indices.push(a, b, c)
}

function quad(d: Draft, a: number, b: number, c: number, e: number): void {
  tri(d, a, b, c)
  tri(d, a, c, e)
}

function add(a: P3, b: P3): P3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function scale(a: P3, k: number): P3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k }
}

function cross(a: P3, b: P3): P3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

function normalize(a: P3): P3 {
  const length = Math.hypot(a.x, a.y, a.z)
  if (length <= 1e-9) return { x: 1, y: 0, z: 0 }
  return { x: a.x / length, y: a.y / length, z: a.z / length }
}

function perpendicular(a: P3, fallback: P3): P3 {
  const dot = a.x * fallback.x + a.y * fallback.y + a.z * fallback.z
  const candidate = add(fallback, scale(a, -dot))
  const length = Math.hypot(candidate.x, candidate.y, candidate.z)
  if (length > 1e-5) return normalize(candidate)
  return normalize(cross(a, { x: 1, y: 0, z: 0 }))
}
