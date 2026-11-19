import type { CompiledRig } from '../compile/compile'
import { ankleFromContact, lowestSoleOffset } from '../foot/contact'
import { soleLocal } from '../foot/shape'
import { createVec2 } from '../math/vec2'
import type { LatchedStep } from '../plan/plan'
import { characterGroundY, type Placement } from '../place/place'
import { isFacing, type Facing } from '../space/facing'
import { createWorldPoint, setWorldPoint, worldToRigPoint } from '../space/world-point'

export const SWING_CLEARANCE = 0.05
export const ROLL_PITCH = 0.35

export type FootTarget = {
  readonly ankleX: number
  readonly ankleY: number
  readonly pitch: number
}

function smoothstep(u: number): number {
  return u * u * (3 - 2 * u)
}

function bump(u: number): number {
  return 16 * u * u * (1 - u) * (1 - u)
}

function ankleAt(
  compiled: CompiledRig,
  placement: Placement,
  facing: Facing,
  contactX: number,
  contactY: number,
  soleU: number,
  pitch: number,
): FootTarget {
  const contact = worldToRigPoint(
    createVec2(),
    setWorldPoint(createWorldPoint(), contactX, contactY),
    placement.origin,
    facing,
  )
  const sole = soleLocal(createVec2(), compiled.foot, soleU)
  const ankle = ankleFromContact(createVec2(), contact, sole, pitch)
  return { ankleX: ankle[0]!, ankleY: ankle[1]!, pitch }
}

function raise(compiled: CompiledRig, placement: Placement, target: FootTarget): FootTarget {
  const lowest = lowestSoleOffset(createVec2(), compiled.foot, target.pitch)
  const floor = characterGroundY(placement)
  const gap = floor - (target.ankleY + lowest[1]!)
  if (gap > 0) return { ...target, ankleY: target.ankleY + gap }
  return target
}

export function footTarget(
  compiled: CompiledRig,
  placement: Placement,
  facing: Facing,
  step: LatchedStep,
  fromX: number,
  fromY: number,
  time: number,
): FootTarget {
  if (step.generation !== placement.generation) throw new Error('generation')
  if (!isFacing(facing)) throw new Error('facing')
  if (!Number.isFinite(fromX) || !Number.isFinite(fromY)) throw new Error('from')
  if (!Number.isFinite(time) || time < 0 || time > step.duration) throw new Error('time')
  const forward = step.stepLength >= 0
  const liftoff = step.duty * step.duration
  if (time < liftoff || liftoff >= step.duration) {
    const u = liftoff === 0 ? 1 : Math.min(time / liftoff, 1)
    const pitch = (forward ? 1 : -1) * ROLL_PITCH * (1 - 2 * u)
    const soleU = forward ? u : 1 - u
    return ankleAt(compiled, placement, facing, fromX, fromY, soleU, pitch)
  }
  const u = (time - liftoff) / (step.duration - liftoff)
  const start = ankleAt(compiled, placement, facing, fromX, fromY, forward ? 1 : 0, (forward ? -1 : 1) * ROLL_PITCH)
  const end = ankleAt(
    compiled,
    placement,
    facing,
    step.contactX,
    step.contactY,
    forward ? 0 : 1,
    (forward ? 1 : -1) * ROLL_PITCH,
  )
  const s = smoothstep(u)
  const blended: FootTarget = {
    ankleX: start.ankleX + (end.ankleX - start.ankleX) * s,
    ankleY: start.ankleY + (end.ankleY - start.ankleY) * s + SWING_CLEARANCE * bump(u),
    pitch: start.pitch + (end.pitch - start.pitch) * s,
  }
  return raise(compiled, placement, blended)
}
