import type { CompiledRig } from '../compile/compile'
import { evaluateFk } from '../fk/evaluate'
import { ankleFromContact } from '../foot/contact'
import { solveTwoBone, type IkChain } from '../ik/solve'
import { createVec2, setVec2 } from '../math/vec2'
import { copyPose, createPose, setPoseRotation, setPoseTranslation, type Pose } from '../skeleton/pose'
import {
  bindLength,
  bindRotation,
  bindTranslation,
  PARENT_NONE,
  parentOf,
  type Skeleton,
} from '../skeleton/skeleton'

/** 一次够得着判断。 */
export type ReachResult = {
  readonly reached: boolean
  readonly withinMargin: boolean
  readonly distance: number
}

/**
 * 髋到踝是否够得到，以及是否留在规划余量内。
 * @param compiled 编译结果
 * @param chain 腿链
 * @param hipX 链根原点 x
 * @param hipY 链根原点 y
 * @param ankleX 踝 x
 * @param ankleY 踝 y
 */
export function reachAnkle(
  compiled: CompiledRig,
  chain: IkChain,
  hipX: number,
  hipY: number,
  ankleX: number,
  ankleY: number,
): ReachResult {
  assertPoint(hipX, hipY, ankleX, ankleY)
  const pose = createPose(compiled.skeleton)
  placeHip(pose, compiled.skeleton, chain, hipX, hipY)
  const solved = solveTwoBone(pose, compiled, chain, ankleX, ankleY)
  return pack(compiled, chain, hipX, hipY, ankleX, ankleY, solved.reached)
}

/**
 * 按当前骨盆姿态判断一个落点。不修改 `pose`。
 * @param compiled 编译结果
 * @param pose 已写好骨盆的姿态
 * @param chain 腿链
 * @param contactX 落点 x
 * @param contactY 落点 y
 * @param soleX 脚底局部点 x
 * @param soleY 脚底局部点 y
 * @param pitch 脚的俯仰（弧度）
 */
export function reachFootfall(
  compiled: CompiledRig,
  pose: Pose,
  chain: IkChain,
  contactX: number,
  contactY: number,
  soleX: number,
  soleY: number,
  pitch: number,
): ReachResult {
  if (pose.skeleton !== compiled.skeleton) throw new Error('pose')
  assertPoint(contactX, contactY, soleX, soleY)
  const scratch = createPose(pose.skeleton)
  copyPose(scratch, pose)
  const ankle = ankleFromContact(
    createVec2(),
    setVec2(createVec2(), contactX, contactY),
    setVec2(createVec2(), soleX, soleY),
    pitch,
  )
  const hip = chainRoot(compiled, scratch, chain)
  const solved = solveTwoBone(scratch, compiled, chain, ankle[0]!, ankle[1]!)
  return pack(compiled, chain, hip.x, hip.y, ankle[0]!, ankle[1]!, solved.reached)
}

/**
 * 左右落点在给定骨盆下是否都能够到。
 * 骨盆坐标是角色空间里的根原点，旋转是根的偏移旋转。
 */
export function reachStance(
  compiled: CompiledRig,
  left: IkChain,
  right: IkChain,
  pelvisX: number,
  pelvisY: number,
  pelvisRotation: number,
  leftX: number,
  leftY: number,
  rightX: number,
  rightY: number,
  soleX: number,
  soleY: number,
  pitch: number,
): boolean {
  if (!Number.isFinite(pelvisX) || !Number.isFinite(pelvisY) || !Number.isFinite(pelvisRotation)) {
    throw new Error('target')
  }
  const pose = createPose(compiled.skeleton)
  placeRoot(pose, compiled.skeleton, pelvisX, pelvisY, pelvisRotation)
  const leftReach = reachFootfall(compiled, pose, left, leftX, leftY, soleX, soleY, pitch)
  const rightReach = reachFootfall(compiled, pose, right, rightX, rightY, soleX, soleY, pitch)
  return leftReach.reached && rightReach.reached
}

function pack(
  compiled: CompiledRig,
  chain: IkChain,
  hipX: number,
  hipY: number,
  ankleX: number,
  ankleY: number,
  reached: boolean,
): ReachResult {
  const distance = Math.hypot(ankleX - hipX, ankleY - hipY)
  const span = bindLength(compiled.skeleton, chain.root) + bindLength(compiled.skeleton, chain.mid)
  return {
    reached,
    withinMargin: distance <= compiled.proportions.reachMargin * span,
    distance,
  }
}

function placeHip(pose: Pose, skeleton: Skeleton, chain: IkChain, hipX: number, hipY: number): void {
  const parent = parentOf(skeleton, chain.root)
  if (parent < 0 || parentOf(skeleton, parent) !== PARENT_NONE) throw new Error('hip')
  const child = bindTranslation(createVec2(), skeleton, chain.root)
  const parentRotation = bindRotation(skeleton, parent)
  const cosine = Math.cos(parentRotation)
  const sine = Math.sin(parentRotation)
  const offsetX = cosine * child[0]! - sine * child[1]!
  const offsetY = sine * child[0]! + cosine * child[1]!
  placeRoot(pose, skeleton, hipX - offsetX, hipY - offsetY, 0)
}

function placeRoot(pose: Pose, skeleton: Skeleton, x: number, y: number, rotation: number): void {
  const bone = 0
  const bind = bindTranslation(createVec2(), skeleton, bone)
  const bindAngle = bindRotation(skeleton, bone)
  const cosine = Math.cos(bindAngle)
  const sine = Math.sin(bindAngle)
  const dx = x - bind[0]!
  const dy = y - bind[1]!
  setPoseTranslation(pose, bone, cosine * dx + sine * dy, -sine * dx + cosine * dy)
  setPoseRotation(pose, bone, rotation)
}

function chainRoot(
  compiled: CompiledRig,
  pose: Pose,
  chain: IkChain,
): { x: number; y: number } {
  const fk = new Float32Array(compiled.skeleton.boneCount * 9)
  evaluateFk(fk, new Float32Array(compiled.skeleton.boneCount), compiled, pose, compiled.skeleton.boneCount)
  const index = chain.root * 9
  return { x: fk[index + 6]!, y: fk[index + 7]! }
}

function assertPoint(a: number, b: number, c: number, d: number): void {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) {
    throw new Error('target')
  }
}
