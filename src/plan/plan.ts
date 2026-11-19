import type { CompiledRig } from '../compile/compile'
import type { IkChain } from '../ik/solve'
import { createVec2 } from '../math/vec2'
import type { Placement } from '../place/place'
import { reachFootfall } from '../reach/reach'
import { copyPose, createPose, setPoseTranslation, type Pose } from '../skeleton/pose'
import { bindTranslation } from '../skeleton/skeleton'
import type { Facing } from '../space/facing'
import { isFacing } from '../space/facing'
import { createWorldPoint, setWorldPoint, worldToRigPoint } from '../space/world-point'
import type { SpeedCandidate } from '../speed/speed'

export const PLAN_HIP_DROP_RATIO = 0.12

export type FootId = 'left' | 'right'

export type LatchedStep = {
  readonly foot: FootId
  readonly duration: number
  readonly stepLength: number
  readonly duty: number
  readonly contactX: number
  readonly contactY: number
  readonly generation: number
}

export type StepPlan = {
  suspended: boolean
  nextFoot: FootId
  active: LatchedStep | null
  stanceFoot: FootId
  stanceX: number
  stanceY: number
}

function footId(foot: FootId): FootId {
  if (foot !== 'left' && foot !== 'right') throw new Error('foot')
  return foot
}

export function createStepPlan(stanceFoot: FootId, stanceX: number, stanceY: number): StepPlan {
  const foot = footId(stanceFoot)
  if (!Number.isFinite(stanceX)) throw new Error('stanceX')
  if (!Number.isFinite(stanceY)) throw new Error('stanceY')
  return {
    suspended: false,
    nextFoot: foot === 'left' ? 'right' : 'left',
    active: null,
    stanceFoot: foot,
    stanceX,
    stanceY,
  }
}

function assertCandidate(candidate: SpeedCandidate): void {
  if (!Number.isFinite(candidate.cadence) || candidate.cadence < 0) throw new Error('cadence')
  if (!Number.isFinite(candidate.stepLength)) throw new Error('stepLength')
  if (!Number.isFinite(candidate.duty) || candidate.duty <= 0 || candidate.duty > 1) throw new Error('duty')
}

function reachable(
  compiled: CompiledRig,
  pose: Pose,
  placement: Placement,
  facing: Facing,
  chain: IkChain,
  stanceX: number,
  stanceY: number,
  length: number,
  groundY: number,
): boolean {
  const world = setWorldPoint(createWorldPoint(), stanceX + facing * length, groundY)
  const contact = worldToRigPoint(createVec2(), world, placement.origin, facing)
  const stanceWorld = setWorldPoint(createWorldPoint(), stanceX, stanceY)
  const stanceRig = worldToRigPoint(createVec2(), stanceWorld, placement.origin, facing)
  const scratch = createPose(pose.skeleton)
  copyPose(scratch, pose)
  const bind = bindTranslation(createVec2(), compiled.skeleton, 0)
  const drop = PLAN_HIP_DROP_RATIO * compiled.proportions.legLength
  setPoseTranslation(scratch, 0, (stanceRig[0]! + contact[0]!) / 2 - bind[0]!, -drop)
  const result = reachFootfall(
    compiled,
    scratch,
    chain,
    contact[0]!,
    contact[1]!,
    0,
    -compiled.foot.ankleHeight,
    0,
  )
  return result.reached && result.withinMargin
}

function underHip(
  compiled: CompiledRig,
  chain: IkChain,
  placement: Placement,
  facing: Facing,
  stanceX: number,
): number {
  const pelvis = bindTranslation(createVec2(), compiled.skeleton, 0)
  const hip = bindTranslation(createVec2(), compiled.skeleton, chain.root)
  const rigX = pelvis[0]! + hip[0]!
  const world = setWorldPoint(createWorldPoint(), 0, 0)
  world[0] = placement.origin[0]! + facing * rigX
  return facing * (world[0] - stanceX)
}

export function beginStep(
  plan: StepPlan,
  compiled: CompiledRig,
  pose: Pose,
  placement: Placement,
  facing: Facing,
  candidate: SpeedCandidate,
  chain: IkChain,
): boolean {
  if (pose.skeleton !== compiled.skeleton) throw new Error('pose')
  if (!isFacing(facing)) throw new Error('facing')
  assertCandidate(candidate)
  if (plan.suspended || plan.active) return false
  if (candidate.cadence === 0 || candidate.stepLength === 0) return false

  const sign = candidate.stepLength > 0 ? 1 : -1
  let lo = 0
  let hi = Math.abs(candidate.stepLength)
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2
    if (
      reachable(compiled, pose, placement, facing, chain, plan.stanceX, plan.stanceY, sign * mid, placement.groundY)
    ) {
      lo = mid
    } else {
      hi = mid
    }
  }
  let stepLength = sign * lo
  if (
    !reachable(
      compiled,
      pose,
      placement,
      facing,
      chain,
      plan.stanceX,
      plan.stanceY,
      stepLength,
      placement.groundY,
    )
  ) {
    stepLength = underHip(compiled, chain, placement, facing, plan.stanceX)
  }
  const contactX = plan.stanceX + facing * stepLength
  plan.active = {
    foot: plan.nextFoot,
    duration: 1 / candidate.cadence,
    stepLength,
    duty: candidate.duty,
    contactX,
    contactY: placement.groundY,
    generation: placement.generation,
  }
  return true
}

export function finishStep(plan: StepPlan): void {
  if (!plan.active) throw new Error('active')
  plan.stanceFoot = plan.active.foot
  plan.stanceX = plan.active.contactX
  plan.stanceY = plan.active.contactY
  plan.nextFoot = plan.active.foot === 'left' ? 'right' : 'left'
  plan.active = null
}

export function suspendPlan(plan: StepPlan): void {
  plan.suspended = true
}

export function resumePlan(plan: StepPlan): void {
  plan.suspended = false
}
