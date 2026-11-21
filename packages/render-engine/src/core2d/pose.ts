/**
 * core2d Pose：7 通道局部值（权威）与 6 分量世界矩阵（派生缓存）。
 * 权威：docs/03-骨架/pose.md。任何模块不得只改 world 不回写 local。
 */
import {
  CH_ROT, CH_X, CH_Y, POSE_STRIDE, WORLD_STRIDE,
  composeAffineFromLocal,
  createAffine,
  multiplyAffine,
  parentBasis,
  type Affine,
} from './math'
import type { BoneId, CompiledSkeleton } from './skeleton'

export {
  CH_ROT, CH_SHX, CH_SHY, CH_SX, CH_SY, CH_X, CH_Y,
  POSE_STRIDE, WORLD_STRIDE,
} from './math'

export type Pose = {
  readonly skeleton: CompiledSkeleton
  /** 7 × N，动画/约束写的权威状态。 */
  local: Float32Array
  /** 6 × N，[a,b,c,d,tx,ty]，派生缓存。 */
  world: Float32Array
  /** 1 = 该骨及子树需要重算。 */
  dirty: Uint8Array
  dirtyCount: number
  worldValid: boolean
  /** IK/约束的临时世界目标；不进快照。 */
  scratch: Float32Array
  version: number
}

export function createPose(skeleton: CompiledSkeleton): Pose {
  const pose: Pose = {
    skeleton,
    local: skeleton.setupLocal.slice(),
    world: new Float32Array(skeleton.count * WORLD_STRIDE),
    dirty: new Uint8Array(skeleton.count),
    dirtyCount: 0,
    worldValid: false,
    scratch: new Float32Array(WORLD_STRIDE * 2),
    version: 0,
  }
  markAllDirty(pose)
  return pose
}

export function markAllDirty(pose: Pose): void {
  pose.dirty.fill(1)
  pose.dirtyCount = pose.skeleton.count
  pose.worldValid = false
}

/** 标脏骨及全部后代；重复标脏幂等。 */
export function markDirty(pose: Pose, bone: BoneId): void {
  const { skeleton, dirty } = pose
  if (bone < 0 || bone >= skeleton.count) throw new Error('pose.bone')
  if (dirty[bone] !== 0) return
  const stack: BoneId[] = [bone]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (dirty[id] !== 0) continue
    dirty[id] = 1
    pose.dirtyCount += 1
    for (const child of skeleton.children[id]!) stack.push(child)
  }
  pose.worldValid = false
}

function checkChannel(channel: number): void {
  if (!Number.isInteger(channel) || channel < 0 || channel >= POSE_STRIDE) {
    throw new Error('pose.channel')
  }
}

/** 覆盖写一个局部通道并标脏子树。旋转保持连续值，不做 ±π 折叠。 */
export function setLocal(pose: Pose, bone: BoneId, channel: number, value: number): void {
  if (!Number.isFinite(value)) throw new Error('pose.value')
  checkChannel(channel)
  if (bone < 0 || bone >= pose.skeleton.count) throw new Error('pose.bone')
  pose.local[bone * POSE_STRIDE + channel] = value
  pose.version += 1
  markDirty(pose, bone)
}

/** 叠加旋转增量；约束/物理用，避免限位跨边界被折叠。 */
export function addRotation(pose: Pose, bone: BoneId, delta: number): void {
  if (!Number.isFinite(delta)) throw new Error('pose.value')
  if (bone < 0 || bone >= pose.skeleton.count) throw new Error('pose.bone')
  const i = bone * POSE_STRIDE + CH_ROT
  pose.local[i] = pose.local[i]! + delta
  pose.version += 1
  markDirty(pose, bone)
}

export function setTranslation(pose: Pose, bone: BoneId, x: number, y: number): void {
  setLocal(pose, bone, CH_X, x)
  setLocal(pose, bone, CH_Y, y)
}

export function getLocal(pose: Pose, bone: BoneId, channel: number): number {
  checkChannel(channel)
  return pose.local[bone * POSE_STRIDE + channel]!
}

export function getRotation(pose: Pose, bone: BoneId): number {
  return pose.local[bone * POSE_STRIDE + CH_ROT]!
}

/** 回到动画基线（setup），同时丢弃世界缓存。 */
export function resetToSetup(pose: Pose): void {
  pose.local.set(pose.skeleton.setupLocal)
  pose.scratch.fill(0)
  markAllDirty(pose)
  pose.version += 1
}

export function copyPose(out: Pose, src: Pose): Pose {
  if (out.skeleton !== src.skeleton) throw new Error('skeleton.mismatch')
  out.local.set(src.local)
  out.scratch.set(src.scratch)
  out.version = src.version
  markAllDirty(out)
  return out
}

const scratchLocal = createAffine()
const scratchParent = createAffine()
const scratchBasis = createAffine()

/** 增量 FK：按拓扑序只重算 dirty 骨；dirty 必须是子树闭包。 */
export function updateWorld(pose: Pose): void {
  if (pose.worldValid && pose.dirtyCount === 0) return
  const { skeleton, local, world, dirty } = pose
  for (const id of skeleton.order) {
    if (dirty[id] === 0 && pose.worldValid) continue
    composeAffineFromLocal(local, id, scratchLocal)
    const parent = skeleton.parent[id]!
    if (parent < 0) {
      for (let k = 0; k < WORLD_STRIDE; k += 1) world[id * WORLD_STRIDE + k] = scratchLocal[k]!
    } else {
      for (let k = 0; k < WORLD_STRIDE; k += 1) scratchParent[k] = world[parent * WORLD_STRIDE + k]!
      parentBasis(skeleton.inherit[id]!, scratchParent, scratchBasis)
      multiplyAffine(scratchBasis, scratchLocal, scratchLocal)
      for (let k = 0; k < WORLD_STRIDE; k += 1) world[id * WORLD_STRIDE + k] = scratchLocal[k]!
    }
    dirty[id] = 0
  }
  pose.dirtyCount = 0
  pose.worldValid = true
}

/** 读取世界矩阵副本。热路径请使用 readWorldInto。 */
export function getWorld(pose: Pose, bone: BoneId): Affine {
  const out = createAffine()
  readWorldInto(out, pose, bone)
  return out
}

export function readWorldInto(out: Affine, pose: Pose, bone: BoneId): Affine {
  const off = bone * WORLD_STRIDE
  for (let i = 0; i < WORLD_STRIDE; i += 1) out[i] = pose.world[off + i]!
  return out
}

/** 把世界矩阵写回 local 的 7 通道（IK/约束写回），按固定分解顺序。 */
export function writeWorldToLocal(pose: Pose, bone: BoneId, m: Affine): void {
  const sx = Math.hypot(m[0]!, m[1]!)
  if (sx < 1e-12) throw new Error('pose.worldToLocal: singular')
  const c = m[0]! / sx
  const s = m[1]! / sx
  const sy = -s * m[2]! + c * m[3]!
  if (Math.abs(sy) < 1e-12) throw new Error('pose.worldToLocal: singular')
  const i = bone * POSE_STRIDE
  pose.local[i] = m[4]!
  pose.local[i + 1] = m[5]!
  pose.local[i + 2] = Math.atan2(s, c)
  pose.local[i + 3] = sx
  pose.local[i + 4] = sy
  pose.local[i + 5] = (c * m[2]! + s * m[3]!) / sx
  pose.local[i + 6] = 0
  markDirty(pose, bone)
}
