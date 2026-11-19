import type { CompiledRig } from '../compile/compile'
import type { IkChain } from '../ik/solve'
import { createVec2 } from '../math/vec2'
import type { FootId, LatchedStep } from '../plan/plan'
import type { Placement } from '../place/place'
import { reachFootfall } from '../reach/reach'
import { copyPose, createPose, type Pose } from '../skeleton/pose'
import { bindTranslation } from '../skeleton/skeleton'
import { isFacing, type Facing } from '../space/facing'
import { createWorldPoint, setWorldPoint, worldToRigPoint } from '../space/world-point'
import { footTarget, type FootTarget } from '../trajectory/trajectory'

export const RECOVER_STEP = 0.05
export const RECOVER_DURATION = 0.3

export type Recovery = {
  active: boolean
  foot: FootId
  fromX: number
  fromY: number
  contactX: number
  contactY: number
  duration: number
  generation: number
}

export function createRecovery(): Recovery {
  return {
    active: false,
    foot: 'left',
    fromX: 0,
    fromY: 0,
    contactX: 0,
    contactY: 0,
    duration: RECOVER_DURATION,
    generation: 0,
  }
}

function footOf(foot: FootId): FootId {
  if (foot !== 'left' && foot !== 'right') throw new Error('foot')
  return foot
}

function reachedAt(
  compiled: CompiledRig,
  pose: Pose,
  placement: Placement,
  facing: Facing,
  chain: IkChain,
  x: number,
  y: number,
): boolean {
  const rig = worldToRigPoint(
    createVec2(),
    setWorldPoint(createWorldPoint(), x, y),
    placement.origin,
    facing,
  )
  const scratch = createPose(pose.skeleton)
  copyPose(scratch, pose)
  return reachFootfall(
    compiled,
    scratch,
    chain,
    rig[0]!,
    rig[1]!,
    0,
    -compiled.foot.ankleHeight,
    0,
  ).reached
}

function underHip(
  compiled: CompiledRig,
  placement: Placement,
  facing: Facing,
  chain: IkChain,
): { x: number; y: number } {
  const pelvis = bindTranslation(createVec2(), compiled.skeleton, 0)
  const hip = bindTranslation(createVec2(), compiled.skeleton, chain.root)
  return {
    x: placement.origin[0]! + facing * (pelvis[0]! + hip[0]!),
    y: placement.groundY,
  }
}

export function beginRecovery(
  recovery: Recovery,
  compiled: CompiledRig,
  pose: Pose,
  placement: Placement,
  facing: Facing,
  chain: IkChain,
  foot: FootId,
  fromX: number,
  fromY: number,
  failedX: number,
  failedY: number,
  approachX: number,
  approachY: number,
): void {
  if (pose.skeleton !== compiled.skeleton) throw new Error('pose')
  if (!isFacing(facing)) throw new Error('facing')
  const which = footOf(foot)
  const points = [fromX, fromY, failedX, failedY, approachX, approachY]
  if (points.some((value) => !Number.isFinite(value))) throw new Error('contact')
  const dx = approachX - failedX
  const dy = approachY - failedY
  const length = Math.hypot(dx, dy)
  let foundX = Number.NaN
  let foundY = Number.NaN
  const count = length === 0 ? 1 : Math.ceil(length / RECOVER_STEP)
  for (let i = 1; i <= count; i += 1) {
    const t = length === 0 ? 1 : Math.min(1, (i * RECOVER_STEP) / length)
    const x = failedX + dx * t
    const y = failedY + dy * t
    if (reachedAt(compiled, pose, placement, facing, chain, x, y)) {
      foundX = x
      foundY = y
      break
    }
  }
  if (!Number.isFinite(foundX)) {
    const hip = underHip(compiled, placement, facing, chain)
    foundX = hip.x
    foundY = hip.y
  }
  recovery.foot = which
  recovery.fromX = fromX
  recovery.fromY = fromY
  recovery.contactX = foundX
  recovery.contactY = foundY
  recovery.duration = RECOVER_DURATION
  recovery.generation = placement.generation
  recovery.active = true
}

export function recoveryTarget(
  recovery: Recovery,
  compiled: CompiledRig,
  placement: Placement,
  facing: Facing,
  time: number,
): FootTarget {
  if (!recovery.active) throw new Error('active')
  const step: LatchedStep = {
    foot: recovery.foot,
    duration: recovery.duration,
    stepLength: recovery.contactX - recovery.fromX,
    duty: 0.2,
    contactX: recovery.contactX,
    contactY: recovery.contactY,
    generation: recovery.generation,
  }
  return footTarget(compiled, placement, facing, step, recovery.fromX, recovery.fromY, time)
}

export function clearRecovery(recovery: Recovery): void {
  recovery.active = false
}
