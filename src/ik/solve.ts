import type { CompiledRig } from '../compile/compile'
import { evaluateFk } from '../fk/evaluate'
import { normalizeAngle } from '../math/angle'
import { createVec2 } from '../math/vec2'
import type { Pose } from '../skeleton/pose'
import { setPoseRotation } from '../skeleton/pose'
import {
  bindLength,
  bindRotation,
  bindTranslation,
  parentOf,
  type Skeleton,
} from '../skeleton/skeleton'

/** 与体型模块的二骨链同形。求解器不区分腿和臂。 */
export type IkChain = {
  readonly root: number
  readonly mid: number
  readonly end: number
  readonly bendSign: 1 | -1
  readonly romMin: number
  readonly romMax: number
}

/** 末端原点是否落在目标上。 */
export type TwoBoneSolve = {
  readonly reached: boolean
}

const HIT = 1e-4
const DIRECTIONLESS = 1e-8

/**
 * 把链根和中骨转到目标。只写这两根骨头的偏移旋转。
 * @param pose 当前偏移；骨架必须与编译结果相同
 * @param compiled 编译结果
 * @param chain 根、中、末端与弯曲符号、中骨活动范围
 * @param targetX 末端原点的目标 x（米，角色空间）
 * @param targetY 末端原点的目标 y（米，角色空间）
 */
export function solveTwoBone(
  pose: Pose,
  compiled: CompiledRig,
  chain: IkChain,
  targetX: number,
  targetY: number,
): TwoBoneSolve {
  if (pose.skeleton !== compiled.skeleton) throw new Error('pose')
  const skeleton = compiled.skeleton
  assertChain(skeleton, chain)
  const length1 = bindLength(skeleton, chain.root)
  const length2 = bindLength(skeleton, chain.mid)
  if (!(length1 > 0) || !(length2 > 0)) throw new Error('length')
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) throw new Error('target')

  const parent = parentOf(skeleton, chain.root)
  const fk = new Float32Array(skeleton.boneCount * 9)
  const parentMatrix = parentMatrixOf(fk, compiled, pose, parent)
  const bind = bindTranslation(createVec2(), skeleton, chain.root)
  const hipX = parentMatrix[0]! * bind[0]! + parentMatrix[3]! * bind[1]! + parentMatrix[6]!
  const hipY = parentMatrix[1]! * bind[0]! + parentMatrix[4]! * bind[1]! + parentMatrix[7]!
  const parentAngle = Math.atan2(parentMatrix[1]!, parentMatrix[0]!)
  const bindRoot = bindRotation(skeleton, chain.root)
  const bindMid = bindRotation(skeleton, chain.mid)

  const offsetX = targetX - hipX
  const offsetY = targetY - hipY
  const distance = Math.hypot(offsetX, offsetY)
  const targetAngle = distance < DIRECTIONLESS ? 0 : Math.atan2(offsetY, offsetX)
  const solved = choose(
    chain,
    distance,
    targetAngle,
    length1,
    length2,
    hipX,
    hipY,
    targetX,
    targetY,
    parentAngle,
    bindRoot,
    bindMid,
  )
  setPoseRotation(pose, chain.root, solved.root)
  setPoseRotation(pose, chain.mid, solved.mid)

  evaluateFk(fk, compiled, pose, skeleton.boneCount)
  const end = chain.end * 9
  const error = Math.hypot(fk[end + 6]! - targetX, fk[end + 7]! - targetY)
  return { reached: error <= HIT }
}

function assertChain(skeleton: Skeleton, chain: IkChain): void {
  const count = skeleton.boneCount
  const valid =
    Number.isInteger(chain.root) &&
    Number.isInteger(chain.mid) &&
    Number.isInteger(chain.end) &&
    chain.root >= 0 &&
    chain.mid >= 0 &&
    chain.end >= 0 &&
    chain.root < count &&
    chain.mid < count &&
    chain.end < count &&
    parentOf(skeleton, chain.mid) === chain.root &&
    parentOf(skeleton, chain.end) === chain.mid &&
    (chain.bendSign === 1 || chain.bendSign === -1) &&
    Number.isFinite(chain.romMin) &&
    Number.isFinite(chain.romMax) &&
    chain.romMin < chain.romMax
  if (!valid) throw new Error('chain')
}

function parentMatrixOf(
  fk: Float32Array,
  compiled: CompiledRig,
  pose: Pose,
  parent: number,
): Float32Array {
  if (parent < 0) {
    const identity = new Float32Array(9)
    identity[0] = 1
    identity[4] = 1
    identity[8] = 1
    return identity
  }
  const view = fk.subarray(0, (parent + 1) * 9)
  evaluateFk(view, compiled, pose, parent + 1)
  return view.subarray(parent * 9, parent * 9 + 9)
}

function choose(
  chain: IkChain,
  distance: number,
  targetAngle: number,
  length1: number,
  length2: number,
  hipX: number,
  hipY: number,
  targetX: number,
  targetY: number,
  parentAngle: number,
  bindRoot: number,
  bindMid: number,
): { root: number; mid: number } {
  const minDistance = Math.abs(length1 - length2)
  const maxDistance = length1 + length2
  if (distance >= minDistance && distance <= maxDistance && distance >= DIRECTIONLESS) {
    const alpha = angleAtRoot(length1, length2, distance)
    const preferred = placeSide(
      chain.bendSign,
      alpha,
      targetAngle,
      length1,
      hipX,
      hipY,
      targetX,
      targetY,
      parentAngle,
      bindRoot,
      bindMid,
    )
    if (inRom(preferred.mid, chain)) return preferred
    const opposite = placeSide(
      chain.bendSign === 1 ? -1 : 1,
      alpha,
      targetAngle,
      length1,
      hipX,
      hipY,
      targetX,
      targetY,
      parentAngle,
      bindRoot,
      bindMid,
    )
    if (inRom(opposite.mid, chain)) return opposite
    return aim(clamp(preferred.mid, chain), targetAngle, parentAngle, bindRoot, bindMid, length1, length2)
  }
  if (distance > maxDistance) {
    const straight = normalizeAngle(-bindMid)
    const mid = inRom(straight, chain) ? straight : clamp(straight, chain)
    return aim(mid, targetAngle, parentAngle, bindRoot, bindMid, length1, length2)
  }
  const folded = (chain.bendSign > 0 ? -Math.PI : Math.PI) - bindMid
  return aim(clamp(folded, chain), targetAngle, parentAngle, bindRoot, bindMid, length1, length2)
}

function placeSide(
  bendSign: 1 | -1,
  alpha: number,
  targetAngle: number,
  length1: number,
  hipX: number,
  hipY: number,
  targetX: number,
  targetY: number,
  parentAngle: number,
  bindRoot: number,
  bindMid: number,
): { root: number; mid: number } {
  const bone1 = targetAngle + bendSign * alpha
  const kneeX = hipX + length1 * Math.cos(bone1)
  const kneeY = hipY + length1 * Math.sin(bone1)
  const bone2 = Math.atan2(targetY - kneeY, targetX - kneeX)
  return {
    root: normalizeAngle(bone1 - parentAngle - bindRoot),
    mid: normalizeAngle(bone2 - bone1 - bindMid),
  }
}

function aim(
  mid: number,
  targetAngle: number,
  parentAngle: number,
  bindRoot: number,
  bindMid: number,
  length1: number,
  length2: number,
): { root: number; mid: number } {
  const turn = bindMid + mid
  const localX = length1 + length2 * Math.cos(turn)
  const localY = length2 * Math.sin(turn)
  const bone1 = targetAngle - Math.atan2(localY, localX)
  return {
    root: normalizeAngle(bone1 - parentAngle - bindRoot),
    mid: normalizeAngle(mid),
  }
}

function angleAtRoot(length1: number, length2: number, distance: number): number {
  const cosine =
    (length1 * length1 + distance * distance - length2 * length2) / (2 * length1 * distance)
  return Math.acos(Math.min(1, Math.max(-1, cosine)))
}

function inRom(angle: number, chain: IkChain): boolean {
  return angle >= chain.romMin && angle <= chain.romMax
}

function clamp(angle: number, chain: IkChain): number {
  if (angle < chain.romMin) return chain.romMin
  if (angle > chain.romMax) return chain.romMax
  return angle
}
