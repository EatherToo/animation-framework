import type { Humanoid } from '../body/assemble'
import type { RenderBinding, SceneLayer } from '../bind/bind'
import { createBinding, destroyBinding, updateBinding } from '../bind/bind'
import { readDiagnostics, type DiagnosticReadout } from '../diag/diag'
import { recordContacts, type ContactLog, createContactLog } from '../event/event'
import { evaluateFk } from '../fk/evaluate'
import { fillPose } from '../fill/fill'
import { createParams } from '../params/params'
import { clearRecovery } from '../recover/recover'
import { reachStance } from '../reach/reach'
import { captureRenderFrame, sampleRender } from '../render/sample'
import { captureSnapshot, restoreSnapshot, type RenderPair, type Snapshot } from '../snapshot/snapshot'
import { createSolver, stepSolver, type Solver } from '../solve/solve'
import { copyPose, poseRotation, type Pose } from '../skeleton/pose'
import { strokeContours } from '../stroke/stroke'
import { createVec2 } from '../math/vec2'
import { createWorldPoint, rigToWorldPoint } from '../space/world-point'

export type Engine = {
  solver: Solver
  log: ContactLog
  binding: RenderBinding
  pair: RenderPair
  destroyed: boolean
}

export function createEngine(humanoid: Humanoid, layer: SceneLayer): Engine {
  const solver = createSolver(humanoid)
  return {
    solver,
    log: createContactLog(),
    binding: createBinding(layer),
    pair: { before: captureRenderFrame(solver), after: captureRenderFrame(solver) },
    destroyed: false,
  }
}

export function stepEngine(engine: Engine, dt: number): void {
  live(engine)
  const previous = engine.solver.events
  stepSolver(engine.solver, dt)
  if (engine.solver.events !== previous) recordContacts(engine.log, engine.solver.events)
  engine.pair.before = engine.pair.after
  engine.pair.after = captureRenderFrame(engine.solver)
}

export function presentEngine(engine: Engine, alpha: number): void {
  live(engine)
  const sampled = sampleRender(engine.solver.compiled, engine.pair.before, engine.pair.after, alpha)
  const colors = fillPose(engine.solver.compiled, sampled.pose)
  updateBinding(
    engine.binding,
    sampled.parts.map((part) => ({
      partId: part.partId,
      positions: part.positions,
      indices: part.indices,
      fill: colors.find((item) => item.partId === part.partId)!.fill,
    })),
    strokeContours(sampled.parts, true),
    sampled.order,
  )
}

export function resetEngine(engine: Engine, stand: Pose): void {
  live(engine)
  if (!stanceHolds(engine.solver, stand)) throw new Error('stance')
  const solver = engine.solver
  copyPose(solver.pose, stand)
  copyPose(solver.scratch, stand)
  const fresh = createParams()
  solver.params.target = fresh.target
  solver.params.current = fresh.current
  solver.gait.mode = 'stand'
  solver.gait.sign = 0
  solver.gait.facing = 1
  const fk = rig(solver)
  const left = worldSole(solver, fk, solver.legL.end)
  const right = worldSole(solver, fk, solver.legR.end)
  solver.leftX = left.x
  solver.leftY = left.y
  solver.rightX = right.x
  solver.rightY = right.y
  solver.plan.suspended = false
  solver.plan.active = null
  solver.plan.stanceFoot = 'right'
  solver.plan.stanceX = right.x
  solver.plan.stanceY = right.y
  solver.plan.nextFoot = 'left'
  clearRecovery(solver.recovery)
  solver.stepTime = 0
  solver.recoveryTime = 0
  solver.generation = solver.placement.generation
  solver.events = []
  engine.log.pending = []
  engine.pair.before = captureRenderFrame(solver)
  engine.pair.after = captureRenderFrame(solver)
}

export function captureEngine(engine: Engine): Snapshot {
  live(engine)
  return captureSnapshot(engine.solver, engine.log, engine.pair)
}

export function restoreEngine(engine: Engine, snapshot: Snapshot): void {
  live(engine)
  restoreSnapshot(engine.solver, engine.log, engine.pair, snapshot)
}

export function diagnoseEngine(engine: Engine): DiagnosticReadout {
  live(engine)
  return readDiagnostics(engine.solver)
}

export function destroyEngine(engine: Engine): void {
  if (engine.destroyed) return
  destroyBinding(engine.binding)
  engine.destroyed = true
}

function live(engine: Engine): void {
  if (engine.destroyed) throw new Error('destroyed')
}

function stanceHolds(solver: Solver, stand: Pose): boolean {
  if (stand.skeleton !== solver.pose.skeleton) throw new Error('pose')
  const fk = new Float32Array(solver.compiled.skeleton.boneCount * 9)
  evaluateFk(fk, solver.compiled, stand, solver.compiled.skeleton.boneCount)
  const left = characterSole(solver, fk, solver.legL.end)
  const right = characterSole(solver, fk, solver.legR.end)
  const pelvis = joint(fk, 0)
  return reachStance(
    solver.compiled,
    solver.legL,
    solver.legR,
    pelvis.x,
    pelvis.y,
    poseRotation(stand, 0),
    left.x,
    left.y,
    right.x,
    right.y,
    0,
    -solver.compiled.foot.ankleHeight,
    0,
  )
}

function rig(solver: Solver): Float32Array {
  const fk = new Float32Array(solver.compiled.skeleton.boneCount * 9)
  evaluateFk(fk, solver.compiled, solver.pose, solver.compiled.skeleton.boneCount)
  return fk
}

function worldSole(solver: Solver, fk: Float32Array, bone: number): { x: number; y: number } {
  const point = characterSole(solver, fk, bone)
  const world = rigToWorldPoint(
    createWorldPoint(),
    setVec(createVec2(), point.x, point.y),
    solver.placement.origin,
    1,
  )
  return { x: world[0]!, y: world[1]! }
}

function characterSole(solver: Solver, fk: Float32Array, bone: number): { x: number; y: number } {
  const point = joint(fk, bone)
  return { x: point.x, y: point.y - solver.compiled.foot.ankleHeight }
}

function joint(fk: Float32Array, bone: number): { x: number; y: number } {
  return { x: fk[bone * 9 + 6]!, y: fk[bone * 9 + 7]! }
}

function setVec(out: ReturnType<typeof createVec2>, x: number, y: number) {
  out[0] = x
  out[1] = y
  return out
}
