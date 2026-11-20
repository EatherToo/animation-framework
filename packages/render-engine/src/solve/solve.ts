import type { Humanoid } from '../body/assemble'
import { compileHumanoid, type CompiledRig } from '../compile/compile'
import { evaluateFk } from '../fk/evaluate'
import { ankleFromContact } from '../foot/contact'
import { stationLocal } from '../foot/shape'
import { createGait, stepGait, type Gait } from '../gait/gait'
import type { IkChain } from '../ik/solve'
import { solveTwoBone } from '../ik/solve'
import { createVec2 } from '../math/vec2'
import { writePelvis, writeUpper } from '../modulate/modulate'
import { createParams, stepParams, type Params } from '../params/params'
import { createPlacement, movedGeneration, type Placement } from '../place/place'
import {
  beginStep,
  createStepPlan,
  finishStep,
  PLAN_HIP_DROP_RATIO,
  resumePlan,
  suspendPlan,
  type FootId,
  type LatchedStep,
  type StepPlan,
} from '../plan/plan'
import { beginRecovery, clearRecovery, createRecovery, recoveryTarget, type Recovery } from '../recover/recover'
import { contactMarks, crossings } from '../schedule/schedule'
import { copyPose, createPose, poseTranslation, setPoseRotation, setPoseTranslation, type Pose } from '../skeleton/pose'
import { bindTranslation } from '../skeleton/skeleton'
import type { Facing } from '../space/facing'
import { createWorldPoint, rigToWorldPoint, setWorldPoint, worldToRigPoint } from '../space/world-point'
import { speedCandidate, STAND_SPEED, type SpeedCandidate } from '../speed/speed'
import { footTarget, type FootTarget } from '../trajectory/trajectory'

export type ContactEvent = {
  readonly kind: 'liftoff' | 'landing'
  readonly foot: FootId
}

export type Solver = {
  compiled: CompiledRig
  legL: IkChain
  legR: IkChain
  params: Params
  placement: Placement
  gait: Gait
  plan: StepPlan
  pose: Pose
  scratch: Pose
  recovery: Recovery
  events: ContactEvent[]
  stepTime: number
  recoveryTime: number
  generation: number
  leftX: number
  leftY: number
  rightX: number
  rightY: number
  bindLeftX: number
  bindLeftY: number
  bindRightX: number
  bindRightY: number
}

function footWorld(compiled: CompiledRig, pose: Pose, bone: number): { x: number; y: number } {
  const fk = new Float32Array(compiled.skeleton.boneCount * 12)
  evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
  return {
    x: fk[bone * 12 + 9]!,
    y: fk[bone * 12 + 10]! - compiled.foot.ankleHeight,
  }
}

export function createSolver(humanoid: Humanoid): Solver {
  const compiled = compileHumanoid(humanoid)
  const pose = createPose(compiled.skeleton)
  const left = footWorld(compiled, pose, humanoid.chains.legL.end)
  const right = footWorld(compiled, pose, humanoid.chains.legR.end)
  return {
    compiled,
    legL: humanoid.chains.legL,
    legR: humanoid.chains.legR,
    params: createParams(),
    placement: createPlacement(),
    gait: createGait(),
    plan: createStepPlan('right', right.x, right.y),
    pose,
    scratch: createPose(compiled.skeleton),
    recovery: createRecovery(),
    events: [],
    stepTime: 0,
    recoveryTime: 0,
    generation: 0,
    leftX: left.x,
    leftY: left.y,
    rightX: right.x,
    rightY: right.y,
    bindLeftX: left.x,
    bindLeftY: left.y,
    bindRightX: right.x,
    bindRightY: right.y,
  }
}

function chain(solver: Solver, foot: FootId): IkChain {
  return foot === 'left' ? solver.legL : solver.legR
}

function plant(solver: Solver, foot: FootId): { x: number; y: number } {
  return foot === 'left'
    ? { x: solver.leftX, y: solver.leftY }
    : { x: solver.rightX, y: solver.rightY }
}

function setPlant(solver: Solver, foot: FootId, x: number, y: number): void {
  if (foot === 'left') {
    solver.leftX = x
    solver.leftY = y
  } else {
    solver.rightX = x
    solver.rightY = y
  }
}

function facingOf(solver: Solver): Facing {
  return solver.params.current.facing
}

function plantedAnkle(solver: Solver, x: number, y: number): FootTarget {
  const contact = worldToRigPoint(
    createVec2(),
    setWorldPoint(createWorldPoint(), x, y),
    solver.placement.origin,
    facingOf(solver),
  )
  const sole = stationLocal(createVec2(), solver.compiled.foot, 'flat')
  const ankle = ankleFromContact(createVec2(), contact, sole, 0)
  return { ankleX: ankle[0]!, ankleY: ankle[1]!, pitch: 0 }
}

function swingAt(solver: Solver, step: LatchedStep, time: number): FootTarget {
  const from = plant(solver, step.foot)
  return footTarget(
    solver.compiled,
    solver.placement,
    facingOf(solver),
    step,
    from.x,
    from.y,
    time,
  )
}

function otherFoot(foot: FootId): FootId {
  return foot === 'left' ? 'right' : 'left'
}

function inputOf(
  solver: Solver,
  candidate: SpeedCandidate,
  stepFinished: boolean,
  requestRecover: boolean,
  contactHeld: boolean,
) {
  return {
    speed: solver.params.current.speed,
    facing: facingOf(solver),
    contactHeld,
    stepFinished,
    requestRecover,
    froude: candidate.froude,
  }
}

function snap(solver: Solver): void {
  const facing = facingOf(solver)
  const left = rigToWorldPoint(
    createWorldPoint(),
    setVec2(createVec2(), solver.bindLeftX, solver.bindLeftY),
    solver.placement.origin,
    facing,
  )
  const right = rigToWorldPoint(
    createWorldPoint(),
    setVec2(createVec2(), solver.bindRightX, solver.bindRightY),
    solver.placement.origin,
    facing,
  )
  solver.leftX = left[0]!
  solver.leftY = left[1]!
  solver.rightX = right[0]!
  solver.rightY = right[1]!
  solver.plan.active = null
  solver.plan.suspended = false
  solver.plan.stanceFoot = 'right'
  solver.plan.stanceX = solver.rightX
  solver.plan.stanceY = solver.rightY
  solver.plan.nextFoot = 'left'
  solver.stepTime = 0
  solver.recoveryTime = 0
  clearRecovery(solver.recovery)
  solver.generation = solver.placement.generation
  solver.events = []
}

function setVec2(out: ReturnType<typeof createVec2>, x: number, y: number) {
  out[0] = x
  out[1] = y
  return out
}

function placePelvis(solver: Solver, pose: Pose, pelvisX: number, phase: number): void {
  const bind = bindTranslation(createVec2(), solver.compiled.skeleton, 0)
  setPoseTranslation(pose, 0, pelvisX - bind[0]!, 0)
  const mode = solver.gait.mode
  const gait = mode === 'run' ? 'run' : mode === 'stand' ? 'stand' : 'walk'
  writePelvis(
    pose,
    solver.compiled.proportions.legLength,
    solver.params.current.crouch,
    solver.params.current.lean,
    phase,
    gait,
  )
  const kept = poseTranslation(createVec2(), pose, 0)
  setPoseTranslation(
    pose,
    0,
    kept[0]!,
    kept[1]! - PLAN_HIP_DROP_RATIO * solver.compiled.proportions.legLength,
  )
}

function reached(solver: Solver, pose: Pose, foot: FootId, ankleX: number, ankleY: number): boolean {
  return solveTwoBone(pose, solver.compiled, chain(solver, foot), ankleX, ankleY).reached
}

function fail(solver: Solver, step: LatchedStep, candidate: SpeedCandidate): void {
  const from = plant(solver, step.foot)
  beginRecovery(
    solver.recovery,
    solver.compiled,
    solver.pose,
    solver.placement,
    facingOf(solver),
    chain(solver, step.foot),
    step.foot,
    from.x,
    from.y,
    step.contactX,
    step.contactY,
    solver.plan.stanceX,
    solver.plan.stanceY,
  )
  suspendPlan(solver.plan)
  solver.recoveryTime = 0
  stepGait(solver.gait, inputOf(solver, candidate, false, true, false))
}

function poseFeet(solver: Solver, step: LatchedStep, time: number): boolean {
  const swing = swingAt(solver, step, time)
  const stanceFoot = otherFoot(step.foot)
  const stance = plantedAnkle(solver, solver.plan.stanceX, solver.plan.stanceY)
  const landing = swingAt(solver, step, step.duration)
  const probe = createPose(solver.compiled.skeleton)
  placePelvis(solver, probe, (landing.ankleX + stance.ankleX) / 2, 0)
  if (!reached(solver, probe, step.foot, landing.ankleX, landing.ankleY)) return false
  if (!reached(solver, probe, stanceFoot, stance.ankleX, stance.ankleY)) return false

  const phase = (Math.PI * 2 * time) / step.duration
  copyPose(solver.scratch, solver.pose)
  placePelvis(solver, solver.scratch, (swing.ankleX + stance.ankleX) / 2, phase)
  evaluateFk(new Float32Array(12), solver.compiled, solver.scratch, 1)
  if (!reached(solver, solver.scratch, step.foot, swing.ankleX, swing.ankleY)) return false
  if (!reached(solver, solver.scratch, stanceFoot, stance.ankleX, stance.ankleY)) return false
  setPoseRotation(solver.scratch, chain(solver, step.foot).end, swing.pitch)
  setPoseRotation(solver.scratch, chain(solver, stanceFoot).end, stance.pitch)
  const full = new Float32Array(solver.compiled.skeleton.boneCount * 12)
  evaluateFk(full, solver.compiled, solver.scratch, solver.compiled.skeleton.boneCount)
  writeUpper(
    solver.scratch,
    solver.params.current.armSwing,
    solver.params.current.spineBend,
    solver.params.current.breath,
    phase,
  )
  copyPose(solver.pose, solver.scratch)
  return true
}

function recoverTick(solver: Solver, dt: number, candidate: SpeedCandidate): void {
  const time = Math.min(solver.recoveryTime + dt, solver.recovery.duration)
  const swing = recoveryTarget(solver.recovery, solver.compiled, solver.placement, facingOf(solver), time)
  const stanceFoot = otherFoot(solver.recovery.foot)
  const stancePlant = plant(solver, stanceFoot)
  const stance = plantedAnkle(solver, stancePlant.x, stancePlant.y)
  copyPose(solver.scratch, solver.pose)
  placePelvis(solver, solver.scratch, (swing.ankleX + stance.ankleX) / 2, 0)
  evaluateFk(new Float32Array(12), solver.compiled, solver.scratch, 1)
  const swingOk = reached(solver, solver.scratch, solver.recovery.foot, swing.ankleX, swing.ankleY)
  const stanceOk = reached(solver, solver.scratch, stanceFoot, stance.ankleX, stance.ankleY)
  if (!swingOk || !stanceOk) return
  setPoseRotation(solver.scratch, chain(solver, solver.recovery.foot).end, swing.pitch)
  setPoseRotation(solver.scratch, chain(solver, stanceFoot).end, 0)
  const full = new Float32Array(solver.compiled.skeleton.boneCount * 12)
  evaluateFk(full, solver.compiled, solver.scratch, solver.compiled.skeleton.boneCount)
  writeUpper(solver.scratch, solver.params.current.armSwing, solver.params.current.spineBend, solver.params.current.breath, 0)
  copyPose(solver.pose, solver.scratch)
  solver.recoveryTime = time
  if (time >= solver.recovery.duration) {
    setPlant(solver, solver.recovery.foot, solver.recovery.contactX, solver.recovery.contactY)
    clearRecovery(solver.recovery)
    resumePlan(solver.plan)
    solver.plan.active = null
    solver.stepTime = 0
    stepGait(solver.gait, inputOf(solver, candidate, true, false, true))
  }
}

export function stepSolver(solver: Solver, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('dt')
  stepParams(solver.params, dt)
  if (movedGeneration(solver.generation, solver.placement.generation)) snap(solver)
  const candidate = speedCandidate(
    solver.params.current.speed,
    solver.params.current.cadenceStyle,
    solver.compiled.proportions.legLength,
  )
  if (solver.recovery.active) {
    recoverTick(solver, dt, candidate)
    return
  }
  stepGait(solver.gait, inputOf(solver, candidate, false, false, true))
  const mode = solver.gait.mode
  if (
    !solver.plan.active &&
    !solver.plan.suspended &&
    (mode === 'start' || mode === 'walk' || mode === 'run') &&
    Math.abs(solver.params.current.speed) >= STAND_SPEED
  ) {
    beginStep(
      solver.plan,
      solver.compiled,
      solver.pose,
      solver.placement,
      facingOf(solver),
      candidate,
      chain(solver, solver.plan.nextFoot),
    )
  }
  const step = solver.plan.active
  if (!step) return
  const nextTime = Math.min(solver.stepTime + dt, step.duration)
  if (!poseFeet(solver, step, nextTime)) {
    fail(solver, step, candidate)
    return
  }
  const marks = contactMarks(step)
  const events: ContactEvent[] = []
  for (const mark of crossings(solver.stepTime, nextTime, marks)) {
    if (mark.name === 'liftoff' || mark.name === 'landing') {
      events.push({ kind: mark.name, foot: step.foot })
    }
  }
  solver.events = events
  if (nextTime >= step.duration) {
    setPlant(solver, step.foot, step.contactX, step.contactY)
    finishStep(solver.plan)
    stepGait(solver.gait, inputOf(solver, candidate, true, false, true))
    solver.stepTime = 0
    const next = solver.gait.mode
    if (
      (next === 'start' || next === 'walk' || next === 'run') &&
      !solver.plan.suspended &&
      Math.abs(solver.params.current.speed) >= STAND_SPEED
    ) {
      beginStep(
        solver.plan,
        solver.compiled,
        solver.pose,
        solver.placement,
        facingOf(solver),
        candidate,
        chain(solver, solver.plan.nextFoot),
      )
    }
    return
  }
  solver.stepTime = nextTime
}
