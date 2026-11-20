import type { CompiledRig } from '../compile/compile'
import { evaluateFk } from '../fk/evaluate'
import { ankleFromContact } from '../foot/contact'
import { stationLocal } from '../foot/shape'
import type { GaitMode } from '../gait/gait'
import type { IkChain } from '../ik/solve'
import { solveTwoBone } from '../ik/solve'
import { createVec2 } from '../math/vec2'
import type { PelvisGait } from '../modulate/modulate'
import { writePelvis, writeUpper } from '../modulate/modulate'
import { createPlacement, setPlacement, type Placement } from '../place/place'
import { PLAN_HIP_DROP_RATIO, type FootId, type LatchedStep } from '../plan/plan'
import { skinMesh } from '../skin/skin'
import { drawOrder } from '../slot/slot'
import { copyPose, createPose, poseTranslation, setPoseRotation, setPoseTranslation, type Pose } from '../skeleton/pose'
import { bindTranslation } from '../skeleton/skeleton'
import type { Facing } from '../space/facing'
import { createWorldPoint, setWorldPoint, worldToRigPoint } from '../space/world-point'
import type { Solver } from '../solve/solve'
import { footTarget, type FootTarget } from '../trajectory/trajectory'

export type RenderStep = {
  readonly foot: FootId
  readonly duration: number
  readonly stepLength: number
  readonly duty: number
  readonly contactX: number
  readonly contactY: number
  readonly generation: number
}

export type RenderFrame = {
  readonly pose: Pose
  readonly originX: number
  readonly originY: number
  readonly groundY: number
  readonly generation: number
  readonly facing: Facing
  readonly crouch: number
  readonly lean: number
  readonly armSwing: number
  readonly spineBend: number
  readonly breath: number
  readonly gait: GaitMode
  readonly stepTime: number
  readonly step: RenderStep | null
  readonly stanceX: number
  readonly stanceY: number
  readonly leftX: number
  readonly leftY: number
  readonly rightX: number
  readonly rightY: number
  readonly recovering: boolean
  readonly legL: IkChain
  readonly legR: IkChain
}

/** 一个部件在当前姿态下的角色空间顶点。`positions` 步长 3：`x, y, z`。 */
export type SampledPart = {
  readonly partId: string
  readonly positions: Float32Array
  readonly indices: Uint16Array
  readonly seam: Uint8Array
}

export type SampledView = {
  readonly snapped: boolean
  readonly pose: Pose
  readonly parts: readonly SampledPart[]
  readonly order: readonly string[]
}

export function captureRenderFrame(solver: Solver): RenderFrame {
  const pose = createPose(solver.pose.skeleton)
  copyPose(pose, solver.pose)
  const active = solver.plan.active
  return {
    pose,
    originX: solver.placement.origin[0]!,
    originY: solver.placement.origin[1]!,
    groundY: solver.placement.groundY,
    generation: solver.placement.generation,
    facing: solver.params.current.facing,
    crouch: solver.params.current.crouch,
    lean: solver.params.current.lean,
    armSwing: solver.params.current.armSwing,
    spineBend: solver.params.current.spineBend,
    breath: solver.params.current.breath,
    gait: solver.gait.mode,
    stepTime: solver.stepTime,
    step: active
      ? {
          foot: active.foot,
          duration: active.duration,
          stepLength: active.stepLength,
          duty: active.duty,
          contactX: active.contactX,
          contactY: active.contactY,
          generation: active.generation,
        }
      : null,
    stanceX: solver.plan.stanceX,
    stanceY: solver.plan.stanceY,
    leftX: solver.leftX,
    leftY: solver.leftY,
    rightX: solver.rightX,
    rightY: solver.rightY,
    recovering: solver.recovery.active,
    legL: solver.legL,
    legR: solver.legR,
  }
}

function sameStep(before: RenderFrame, after: RenderFrame): boolean {
  if (before.step === null || after.step === null) return false
  return (
    before.step.foot === after.step.foot &&
    before.step.contactX === after.step.contactX &&
    before.step.contactY === after.step.contactY &&
    before.step.duration === after.step.duration
  )
}

function discontinuous(before: RenderFrame, after: RenderFrame): boolean {
  if (before.facing !== after.facing) return true
  if (after.generation > before.generation) return true
  if (!before.recovering && after.recovering) return true
  if ((before.step !== null || after.step !== null) && !sameStep(before, after)) return true
  return false
}

function placementOf(frame: RenderFrame): Placement {
  const placement = createPlacement()
  setPlacement(placement, frame.originX, frame.originY, frame.groundY, frame.generation)
  return placement
}

function planted(compiled: CompiledRig, placement: Placement, facing: Facing, x: number, y: number): FootTarget {
  const contact = worldToRigPoint(
    createVec2(),
    setWorldPoint(createWorldPoint(), x, y),
    placement.origin,
    facing,
  )
  const sole = stationLocal(createVec2(), compiled.foot, 'flat')
  const ankle = ankleFromContact(createVec2(), contact, sole, 0)
  return { ankleX: ankle[0]!, ankleY: ankle[1]!, pitch: 0 }
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha
}

function pelvisGait(mode: GaitMode): PelvisGait {
  if (mode === 'run') return 'run'
  if (mode === 'stand') return 'stand'
  return 'walk'
}

function chain(frame: RenderFrame, foot: FootId): IkChain {
  return foot === 'left' ? frame.legL : frame.legR
}

function reSolve(compiled: CompiledRig, before: RenderFrame, after: RenderFrame, alpha: number): Pose {
  const step = after.step!
  const time = before.stepTime + (after.stepTime - before.stepTime) * alpha
  const placement = placementOf(after)
  const latched: LatchedStep = {
    foot: step.foot,
    duration: step.duration,
    stepLength: step.stepLength,
    duty: step.duty,
    contactX: step.contactX,
    contactY: step.contactY,
    generation: step.generation,
  }
  const from = step.foot === 'left' ? { x: after.leftX, y: after.leftY } : { x: after.rightX, y: after.rightY }
  const swing = footTarget(compiled, placement, after.facing, latched, from.x, from.y, time)
  const stanceFoot: FootId = step.foot === 'left' ? 'right' : 'left'
  const stance = planted(compiled, placement, after.facing, after.stanceX, after.stanceY)
  const pose = createPose(compiled.skeleton)
  const phase = (Math.PI * 2 * time) / step.duration
  const bind = bindTranslation(createVec2(), compiled.skeleton, 0)
  const pelvisX = (swing.ankleX + stance.ankleX) / 2
  setPoseTranslation(pose, 0, pelvisX - bind[0]!, 0)
  writePelvis(
    pose,
    compiled.proportions.legLength,
    lerp(before.crouch, after.crouch, alpha),
    lerp(before.lean, after.lean, alpha),
    phase,
    pelvisGait(after.gait),
  )
  const kept = poseTranslation(createVec2(), pose, 0)
  setPoseTranslation(pose, 0, kept[0]!, kept[1]! - PLAN_HIP_DROP_RATIO * compiled.proportions.legLength)
  solveTwoBone(pose, compiled, chain(after, step.foot), swing.ankleX, swing.ankleY)
  solveTwoBone(pose, compiled, chain(after, stanceFoot), stance.ankleX, stance.ankleY)
  setPoseRotation(pose, chain(after, step.foot).end, swing.pitch)
  setPoseRotation(pose, chain(after, stanceFoot).end, stance.pitch)
  writeUpper(
    pose,
    lerp(before.armSwing, after.armSwing, alpha),
    lerp(before.spineBend, after.spineBend, alpha),
    lerp(before.breath, after.breath, alpha),
    phase,
  )
  return pose
}

function present(compiled: CompiledRig, pose: Pose, facing: Facing, snapped: boolean): SampledView {
  const fk = new Float32Array(compiled.skeleton.boneCount * 12)
  evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
  const parts = compiled.meshes.meshes.map((mesh, index) => {
    const positions = new Float32Array(mesh.positions.length)
    skinMesh(positions, compiled, fk, index, pose)
    return { partId: mesh.partId, positions, indices: mesh.indices, seam: mesh.seam }
  })
  const order = drawOrder(new Array<string>(compiled.slots.slots.length), compiled.slots, facing)
  return { snapped, pose, parts, order }
}

function clonePose(pose: Pose): Pose {
  const copy = createPose(pose.skeleton)
  copyPose(copy, pose)
  return copy
}

export function sampleRender(
  compiled: CompiledRig,
  before: RenderFrame,
  after: RenderFrame,
  alpha: number,
): SampledView {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error('alpha')
  if (alpha === 0) return present(compiled, clonePose(before.pose), before.facing, false)
  const jump = discontinuous(before, after)
  if (alpha === 1 || jump || before.step === null) {
    return present(compiled, clonePose(after.pose), after.facing, jump && alpha < 1)
  }
  return present(compiled, reSolve(compiled, before, after, alpha), after.facing, false)
}
