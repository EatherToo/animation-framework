import { createVec2 } from '../math/vec2'
import {
  poseTranslation,
  setPoseRotation,
  setPoseTranslation,
  type Pose,
} from '../skeleton/pose'
import { findBone, PARENT_NONE } from '../skeleton/skeleton'

export const CROUCH_DROP_RATIO = 0.25
export const BOB_RATIO = 0.01
export const ARM_SWING_ARC = 0.4

export type PelvisGait = 'stand' | 'walk' | 'run'

function unit(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(name)
}

function bone(pose: Pose, name: string): number {
  const index = findBone(pose.skeleton, name)
  if (index === PARENT_NONE) throw new Error('bone')
  return index
}

export function writePelvis(
  pose: Pose,
  legLength: number,
  crouch: number,
  lean: number,
  phase: number,
  gait: PelvisGait,
): void {
  unit('crouch', crouch)
  if (!Number.isFinite(lean)) throw new Error('lean')
  if (!Number.isFinite(phase)) throw new Error('phase')
  if (!Number.isFinite(legLength) || legLength <= 0) throw new Error('legLength')
  if (gait !== 'stand' && gait !== 'walk' && gait !== 'run') throw new Error('gait')
  const pelvis = bone(pose, 'pelvis')
  const sign = gait === 'walk' ? 1 : gait === 'run' ? -1 : 0
  const bob = sign * Math.sin(phase) * BOB_RATIO * legLength
  const kept = poseTranslation(createVec2(), pose, pelvis)
  setPoseTranslation(pose, pelvis, kept[0]!, -crouch * CROUCH_DROP_RATIO * legLength + bob)
  setPoseRotation(pose, pelvis, lean)
}

export function writeUpper(
  pose: Pose,
  armSwing: number,
  spineBend: number,
  breath: number,
  phase: number,
): void {
  unit('armSwing', armSwing)
  unit('spineBend', spineBend)
  unit('breath', breath)
  if (!Number.isFinite(phase)) throw new Error('phase')
  const spine = bone(pose, 'spine')
  const head = bone(pose, 'head')
  const armL = bone(pose, 'upperArmL')
  const armR = bone(pose, 'upperArmR')
  const swing = Math.sin(phase)
  setPoseRotation(pose, spine, spineBend * 0.15 + breath * 0.02 * swing)
  setPoseRotation(pose, armL, -armSwing * ARM_SWING_ARC * swing)
  setPoseRotation(pose, armR, armSwing * ARM_SWING_ARC * swing)
  setPoseRotation(pose, head, breath * 0.05 * swing)
}
