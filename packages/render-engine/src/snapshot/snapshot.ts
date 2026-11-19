import type { ContactEvent } from '../solve/solve'
import type { ContactLog } from '../event/event'
import type { GaitMode } from '../gait/gait'
import type { ParamValues } from '../params/params'
import type { FootId, LatchedStep } from '../plan/plan'
import type { Recovery } from '../recover/recover'
import type { RenderFrame } from '../render/sample'
import { copyPose, createPose } from '../skeleton/pose'
import { isFacing, type Facing } from '../space/facing'
import type { Solver } from '../solve/solve'

export type RenderPair = {
  before: RenderFrame
  after: RenderFrame
}

export type Snapshot = {
  pose: Float32Array
  target: ParamValues
  current: ParamValues
  originX: number
  originY: number
  groundY: number
  generation: number
  solverGeneration: number
  gaitMode: GaitMode
  gaitSign: -1 | 0 | 1
  gaitFacing: Facing
  suspended: boolean
  nextFoot: FootId
  active: LatchedStep | null
  stanceFoot: FootId
  stanceX: number
  stanceY: number
  leftX: number
  leftY: number
  rightX: number
  rightY: number
  bindLeftX: number
  bindLeftY: number
  bindRightX: number
  bindRightY: number
  recovery: Recovery
  stepTime: number
  recoveryTime: number
  events: ContactEvent[]
  before: RenderFrame
  after: RenderFrame
}

const GAITS: readonly GaitMode[] = ['stand', 'start', 'walk', 'run', 'stop', 'recover']

export function captureSnapshot(solver: Solver, log: ContactLog, pair: RenderPair): Snapshot {
  const active = solver.plan.active
  return {
    pose: solver.pose.data.slice(),
    target: copyValues(solver.params.target),
    current: copyValues(solver.params.current),
    originX: solver.placement.origin[0]!,
    originY: solver.placement.origin[1]!,
    groundY: solver.placement.groundY,
    generation: solver.placement.generation,
    solverGeneration: solver.generation,
    gaitMode: solver.gait.mode,
    gaitSign: solver.gait.sign,
    gaitFacing: solver.gait.facing,
    suspended: solver.plan.suspended,
    nextFoot: solver.plan.nextFoot,
    active: active === null ? null : { ...active },
    stanceFoot: solver.plan.stanceFoot,
    stanceX: solver.plan.stanceX,
    stanceY: solver.plan.stanceY,
    leftX: solver.leftX,
    leftY: solver.leftY,
    rightX: solver.rightX,
    rightY: solver.rightY,
    bindLeftX: solver.bindLeftX,
    bindLeftY: solver.bindLeftY,
    bindRightX: solver.bindRightX,
    bindRightY: solver.bindRightY,
    recovery: { ...solver.recovery },
    stepTime: solver.stepTime,
    recoveryTime: solver.recoveryTime,
    events: log.pending.map((event) => ({ ...event })),
    before: cloneFrame(pair.before),
    after: cloneFrame(pair.after),
  }
}

export function restoreSnapshot(
  solver: Solver,
  log: ContactLog,
  pair: RenderPair,
  snapshot: Snapshot,
): void {
  const length = solver.pose.data.length
  if (snapshot.pose.length !== length) throw new Error('pose')
  assertValues(snapshot.target)
  assertValues(snapshot.current)
  assertFrame(snapshot.before, length)
  assertFrame(snapshot.after, length)
  if (!GAITS.includes(snapshot.gaitMode)) throw new Error('gait')
  if (snapshot.gaitSign !== -1 && snapshot.gaitSign !== 0 && snapshot.gaitSign !== 1) throw new Error('sign')
  if (!isFacing(snapshot.gaitFacing)) throw new Error('facing')
  foot(snapshot.nextFoot)
  foot(snapshot.stanceFoot)
  if (snapshot.active !== null) assertStep(snapshot.active)
  foot(snapshot.recovery.foot)
  if (typeof snapshot.recovery.active !== 'boolean') throw new Error('recovery')
  if (!Number.isFinite(snapshot.stepTime) || !Number.isFinite(snapshot.recoveryTime)) throw new Error('time')
  if (!Number.isInteger(snapshot.generation) || !Number.isInteger(snapshot.solverGeneration)) {
    throw new Error('generation')
  }
  for (const event of snapshot.events) {
    if (event.kind !== 'liftoff' && event.kind !== 'landing') throw new Error('event')
    foot(event.foot)
  }

  solver.pose.data.set(snapshot.pose)
  solver.scratch.data.set(snapshot.pose)
  writeValues(solver.params.target, snapshot.target)
  writeValues(solver.params.current, snapshot.current)
  solver.placement.origin[0] = snapshot.originX
  solver.placement.origin[1] = snapshot.originY
  solver.placement.groundY = snapshot.groundY
  solver.placement.generation = snapshot.generation
  solver.generation = snapshot.solverGeneration
  solver.gait.mode = snapshot.gaitMode
  solver.gait.sign = snapshot.gaitSign
  solver.gait.facing = snapshot.gaitFacing
  solver.plan.suspended = snapshot.suspended
  solver.plan.nextFoot = snapshot.nextFoot
  solver.plan.active = snapshot.active === null ? null : { ...snapshot.active }
  solver.plan.stanceFoot = snapshot.stanceFoot
  solver.plan.stanceX = snapshot.stanceX
  solver.plan.stanceY = snapshot.stanceY
  solver.leftX = snapshot.leftX
  solver.leftY = snapshot.leftY
  solver.rightX = snapshot.rightX
  solver.rightY = snapshot.rightY
  solver.bindLeftX = snapshot.bindLeftX
  solver.bindLeftY = snapshot.bindLeftY
  solver.bindRightX = snapshot.bindRightX
  solver.bindRightY = snapshot.bindRightY
  writeRecovery(solver.recovery, snapshot.recovery)
  solver.stepTime = snapshot.stepTime
  solver.recoveryTime = snapshot.recoveryTime
  log.pending = snapshot.events.map((event) => ({ ...event }))
  pair.before = cloneFrame(snapshot.before)
  pair.after = cloneFrame(snapshot.after)
}

function copyValues(values: ParamValues): ParamValues {
  return {
    speed: values.speed,
    cadenceStyle: values.cadenceStyle,
    crouch: values.crouch,
    lean: values.lean,
    facing: values.facing,
    armSwing: values.armSwing,
    spineBend: values.spineBend,
    breath: values.breath,
  }
}

function writeValues(out: ParamValues, values: ParamValues): void {
  out.speed = values.speed
  out.cadenceStyle = values.cadenceStyle
  out.crouch = values.crouch
  out.lean = values.lean
  out.facing = values.facing
  out.armSwing = values.armSwing
  out.spineBend = values.spineBend
  out.breath = values.breath
}

function writeRecovery(out: Recovery, recovery: Recovery): void {
  out.active = recovery.active
  out.foot = recovery.foot
  out.fromX = recovery.fromX
  out.fromY = recovery.fromY
  out.contactX = recovery.contactX
  out.contactY = recovery.contactY
  out.duration = recovery.duration
  out.generation = recovery.generation
}

function cloneFrame(frame: RenderFrame): RenderFrame {
  const pose = createPose(frame.pose.skeleton)
  copyPose(pose, frame.pose)
  return {
    ...frame,
    pose,
    step: frame.step === null ? null : { ...frame.step },
  }
}

function assertValues(values: ParamValues): void {
  if (!isFacing(values.facing)) throw new Error('facing')
  const numbers = [
    values.speed,
    values.cadenceStyle,
    values.crouch,
    values.lean,
    values.armSwing,
    values.spineBend,
    values.breath,
  ]
  if (numbers.some((value) => !Number.isFinite(value))) throw new Error('params')
}

function assertFrame(frame: RenderFrame, length: number): void {
  if (frame.pose.data.length !== length) throw new Error('frame')
  if (!isFacing(frame.facing)) throw new Error('facing')
  if (frame.step !== null) assertStep(frame.step)
}

function assertStep(step: LatchedStep): void {
  foot(step.foot)
  if (!Number.isFinite(step.duration) || !Number.isFinite(step.contactX) || !Number.isFinite(step.contactY)) {
    throw new Error('plan')
  }
}

function foot(value: FootId): FootId {
  if (value !== 'left' && value !== 'right') throw new Error('foot')
  return value
}
