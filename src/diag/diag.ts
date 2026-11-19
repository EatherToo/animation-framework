import type { CompiledRig } from '../compile/compile'
import { evaluateFk } from '../fk/evaluate'
import { skinMesh } from '../skin/skin'
import { bindLength } from '../skeleton/skeleton'
import { speedCandidate } from '../speed/speed'
import type { Solver } from '../solve/solve'

export type DiagnosticReadout = {
  readonly plannedSpeed: number
  readonly contactResidual: number
  readonly reachMargin: number
}

export type DebugSegment = {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

export type DebugMark = {
  readonly x: number
  readonly y: number
}

export type DebugWire = {
  readonly partId: string
  readonly positions: Float32Array
  readonly indices: Uint16Array
}

export type DebugWeight = {
  readonly partId: string
  readonly positions: Float32Array
  readonly values: Float32Array
}

export type DebugView = {
  readonly bones: readonly DebugSegment[]
  readonly contacts: readonly DebugMark[]
  readonly footfalls: readonly DebugMark[]
  readonly prints: readonly DebugMark[]
  readonly envelope: readonly DebugSegment[]
  readonly wire: readonly DebugWire[]
  readonly weights: readonly DebugWeight[]
}

export function readDiagnostics(solver: Solver): DiagnosticReadout {
  const fk = rig(solver)
  const candidate = speedCandidate(
    solver.params.current.speed,
    solver.params.current.cadenceStyle,
    solver.compiled.proportions.legLength,
  )
  return {
    plannedSpeed: candidate.cadence * candidate.stepLength,
    contactResidual: residual(solver, fk),
    reachMargin: margin(solver, fk),
  }
}

export function debugView(solver: Solver): DebugView {
  const fk = rig(solver)
  const active = solver.plan.active
  return {
    bones: bones(solver, fk),
    contacts: [{ x: solver.plan.stanceX, y: solver.plan.stanceY }],
    footfalls: active === null ? [] : [{ x: active.contactX, y: active.contactY }],
    prints: [
      { x: solver.leftX, y: solver.leftY },
      { x: solver.rightX, y: solver.rightY },
    ],
    envelope: [...circle(solver, fk, solver.legL.root), ...circle(solver, fk, solver.legR.root)],
    wire: wire(solver, fk),
    weights: weights(solver, fk),
  }
}

function rig(solver: Solver): Float32Array {
  const fk = new Float32Array(solver.compiled.skeleton.boneCount * 9)
  evaluateFk(fk, solver.compiled, solver.pose, solver.compiled.skeleton.boneCount)
  return fk
}

function residual(solver: Solver, fk: Float32Array): number {
  const chain = solver.plan.stanceFoot === 'left' ? solver.legL : solver.legR
  const sole = footSole(solver.compiled, fk, chain.end)
  return Math.hypot(sole.x - solver.plan.stanceX, sole.y - solver.plan.stanceY)
}

function margin(solver: Solver, fk: Float32Array): number {
  const chain = solver.plan.stanceFoot === 'left' ? solver.legL : solver.legR
  const hip = joint(fk, chain.root)
  const ankle = joint(fk, chain.end)
  const span = bindLength(solver.compiled.skeleton, chain.root) + bindLength(solver.compiled.skeleton, chain.mid)
  return solver.compiled.proportions.reachMargin * span - Math.hypot(ankle.x - hip.x, ankle.y - hip.y)
}

function bones(solver: Solver, fk: Float32Array): DebugSegment[] {
  const segments: DebugSegment[] = []
  const parent = solver.compiled.skeleton.parent
  for (let bone = 0; bone < parent.length; bone += 1) {
    const from = parent[bone]!
    if (from < 0) continue
    const start = joint(fk, from)
    const end = joint(fk, bone)
    segments.push({ x0: start.x, y0: start.y, x1: end.x, y1: end.y })
  }
  return segments
}

function circle(solver: Solver, fk: Float32Array, bone: number): DebugSegment[] {
  const hip = joint(fk, bone)
  const radius = solver.compiled.proportions.legLength
  const steps = 8
  const segments: DebugSegment[] = []
  for (let i = 0; i < steps; i += 1) {
    const a0 = (i / steps) * Math.PI * 2
    const a1 = ((i + 1) / steps) * Math.PI * 2
    segments.push({
      x0: hip.x + Math.cos(a0) * radius,
      y0: hip.y + Math.sin(a0) * radius,
      x1: hip.x + Math.cos(a1) * radius,
      y1: hip.y + Math.sin(a1) * radius,
    })
  }
  return segments
}

function wire(solver: Solver, fk: Float32Array): DebugWire[] {
  return solver.compiled.meshes.meshes.map((mesh, index) => {
    const positions = new Float32Array(mesh.positions.length)
    skinMesh(positions, solver.compiled, fk, index)
    return { partId: mesh.partId, positions, indices: mesh.indices }
  })
}

function weights(solver: Solver, fk: Float32Array): DebugWeight[] {
  return solver.compiled.weights.weights.map((entry) => {
    const index = solver.compiled.meshes.meshes.findIndex((mesh) => mesh.partId === entry.partId)
    const mesh = solver.compiled.meshes.meshes[index]!
    const positions = new Float32Array(mesh.positions.length)
    skinMesh(positions, solver.compiled, fk, index)
    const values = new Float32Array(positions.length / 2)
    for (let vertex = 0; vertex < values.length; vertex += 1) {
      let best = 0
      for (let slot = 0; slot < entry.influences; slot += 1) {
        best = Math.max(best, entry.weights[vertex * entry.influences + slot]!)
      }
      values[vertex] = best
    }
    return { partId: entry.partId, positions, values }
  })
}

function joint(fk: Float32Array, bone: number): { x: number; y: number } {
  return { x: fk[bone * 9 + 6]!, y: fk[bone * 9 + 7]! }
}

function footSole(compiled: CompiledRig, fk: Float32Array, bone: number): { x: number; y: number } {
  const point = joint(fk, bone)
  return { x: point.x, y: point.y - compiled.foot.ankleHeight }
}
