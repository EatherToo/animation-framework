/**
 * core2d Pose：7 通道局部值（权威）与 6 分量世界矩阵（派生缓存）。
 * 权威：docs/03-骨架/pose.md。世界约束使用 setWorldOverride，保留 applied local。
 */
import {
  CH_ROT, CH_X, CH_Y, POSE_STRIDE, WORLD_STRIDE,
  createAffine,
  multiplyAffine,
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
  world: Float64Array
  /** 世界约束写入的矩阵与有效标记，独立于 applied local。 */
  worldOverrides: Float64Array
  overrideActive: Uint8Array
  /** 1 = 该骨及子树需要重算。 */
  dirty: Uint8Array
  dirtyCount: number
  worldValid: boolean
  /** IK/约束的临时世界目标；不进快照。 */
  scratch: Float32Array
  version: number
  skeletonX: number
  skeletonY: number
  skeletonScaleX: number
  skeletonScaleY: number
}

export function createPose(skeleton: CompiledSkeleton): Pose {
  const pose: Pose = {
    skeleton,
    local: skeleton.setupLocal.slice(),
    world: new Float64Array(skeleton.count * WORLD_STRIDE),
    worldOverrides: new Float64Array(skeleton.count * WORLD_STRIDE),
    overrideActive: new Uint8Array(skeleton.count),
    dirty: new Uint8Array(skeleton.count),
    dirtyCount: 0,
    worldValid: false,
    scratch: new Float32Array(WORLD_STRIDE * 2),
    version: 0,
    skeletonX: 0, skeletonY: 0, skeletonScaleX: 1, skeletonScaleY: 1,
  }
  markAllDirty(pose)
  return pose
}

export function markAllDirty(pose: Pose): void {
  pose.overrideActive.fill(0)
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

/** 官方 world-only 约束：保留 applied local，重算时以此矩阵为子骨父矩阵。 */
export function setWorldOverride(pose: Pose, bone: BoneId, matrix: ArrayLike<number>): void {
  if (bone < 0 || bone >= pose.skeleton.count) throw new Error('pose.bone')
  updateWorld(pose)
  const offset = bone * WORLD_STRIDE
  for (let i = 0; i < WORLD_STRIDE; i += 1) {
    const value = matrix[i]
    if (value === undefined || !Number.isFinite(value)) throw new Error('pose.worldOverride')
    pose.worldOverrides[offset + i] = value
  }
  pose.overrideActive[bone] = 1
  markDirty(pose, bone)
  pose.version += 1
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
  pose.overrideActive[bone] = 0
  pose.version += 1
  markDirty(pose, bone)
}

/** 叠加旋转增量；约束/物理用，避免限位跨边界被折叠。 */
export function addRotation(pose: Pose, bone: BoneId, delta: number): void {
  if (!Number.isFinite(delta)) throw new Error('pose.value')
  if (bone < 0 || bone >= pose.skeleton.count) throw new Error('pose.bone')
  const i = bone * POSE_STRIDE + CH_ROT
  pose.local[i] = pose.local[i]! + delta
  pose.overrideActive[bone] = 0
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
  pose.overrideActive.fill(0)
  pose.scratch.fill(0)
  markAllDirty(pose)
  pose.version += 1
}

export function copyPose(out: Pose, src: Pose): Pose {
  if (out.skeleton !== src.skeleton) throw new Error('skeleton.mismatch')
  out.local.set(src.local)
  out.worldOverrides.set(src.worldOverrides)
  out.scratch.set(src.scratch)
  out.version = src.version
  out.skeletonX = src.skeletonX
  out.skeletonY = src.skeletonY
  out.skeletonScaleX = src.skeletonScaleX
  out.skeletonScaleY = src.skeletonScaleY
  markAllDirty(out)
  out.overrideActive.set(src.overrideActive)
  return out
}

const scratchLocal = createAffine()
const scratchParent = createAffine()

function composeSpineLocal(local: Float32Array, id: number, out: Affine): void {
  const i = id * POSE_STRIDE
  const rotation = local[i + CH_ROT]!
  const rx = rotation + local[i + 5]!
  const ry = rotation + local[i + 6]!
  const sx = local[i + 3]!, sy = local[i + 4]!
  out[0] = Math.cos(rx) * sx
  out[1] = Math.sin(rx) * sx
  out[2] = -Math.sin(ry) * sy
  out[3] = Math.cos(ry) * sy
  out[4] = local[i + CH_X]!
  out[5] = local[i + CH_Y]!
}

function inheritLinear(mode: string, parent: Affine, local: Affine, rotation: number, sx: number, sy: number): void {
  const pa = parent[0]!, pc = parent[1]!, pb = parent[2]!, pd = parent[3]!
  if (mode === 'onlyTranslation') {
    local[0] = local[0]! * sx; local[2] = local[2]! * sx
    local[1] = local[1]! * sy; local[3] = local[3]! * sy
    return
  }
  let a: number, b: number, c: number, d: number
  let angle = 0
  if (mode === 'noRotationOrReflection') {
    const pxa = pa / sx, pya = pc / sy, pxb = pb / sx, pyb = pd / sy
    const len2 = pxa * pxa + pya * pya
    if (len2 > 1e-12) {
      const s = Math.abs(pxa * pyb - pxb * pya) / len2
      a = pxa; b = pya; c = -pya * s; d = pxa * s
      angle = Math.atan2(pya, pxa)
    } else {
      a = 0; b = 0; c = -pxb; d = pyb
      angle = Math.PI / 2 - Math.atan2(pyb, pxb)
    }
  } else if (mode === 'noScale' || mode === 'noScaleOrReflection') {
    const cos = Math.cos(rotation), sin = Math.sin(rotation)
    let za = (pa * cos + pb * sin) / sx
    let zc = (pc * cos + pd * sin) / sy
    const invLength = 1 / Math.hypot(za, zc)
    za *= invLength; zc *= invLength
    const reflection = mode === 'noScale' && ((pa * pd - pb * pc < 0) !== ((sx < 0) !== (sy < 0))) ? -1 : 1
    a = za; b = zc; c = -zc * reflection; d = za * reflection
    angle = rotation
  } else {
    throw new Error(`inherit.mode: ${mode}`)
  }
  // The local affine includes rotation; Spine applies child shear and scale
  // after constructing a basis that depends on child rotation.
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const x0 = cos * local[0]! + sin * local[1]!
  const y0 = -sin * local[0]! + cos * local[1]!
  const x1 = cos * local[2]! + sin * local[3]!
  const y1 = -sin * local[2]! + cos * local[3]!
  local[0] = a * x0 + c * y0
  local[1] = b * x0 + d * y0
  local[2] = a * x1 + c * y1
  local[3] = b * x1 + d * y1
  local[0] = local[0]! * sx; local[2] = local[2]! * sx
  local[1] = local[1]! * sy; local[3] = local[3]! * sy
}

/** Skeleton transform changes invalidate world cache, never bone locals. */
export function setSkeletonTransform(pose: Pose, x: number, y: number, scaleX: number, scaleY: number): void {
  if (![x, y, scaleX, scaleY].every(Number.isFinite) || scaleX === 0 || scaleY === 0) throw new Error('pose.skeletonTransform')
  if (pose.skeletonX === x && pose.skeletonY === y && pose.skeletonScaleX === scaleX && pose.skeletonScaleY === scaleY) return
  pose.skeletonX = x; pose.skeletonY = y
  pose.skeletonScaleX = scaleX; pose.skeletonScaleY = scaleY
  markAllDirty(pose)
  pose.version += 1
}

/** 增量 FK：按拓扑序只重算 dirty 骨；dirty 必须是子树闭包。 */
export function updateWorld(pose: Pose): void {
  if (pose.worldValid && pose.dirtyCount === 0) return
  const { skeleton, local, world, dirty } = pose
  for (const id of skeleton.order) {
    if (dirty[id] === 0 && pose.worldValid) continue
    if (pose.overrideActive[id] !== 0) {
      const offset = id * WORLD_STRIDE
      for (let k = 0; k < WORLD_STRIDE; k += 1) world[offset + k] = pose.worldOverrides[offset + k]!
      dirty[id] = 0
      continue
    }
    composeSpineLocal(local, id, scratchLocal)
    const parent = skeleton.parent[id]!
    if (parent < 0) {
      scratchLocal[0] = scratchLocal[0]! * pose.skeletonScaleX; scratchLocal[2] = scratchLocal[2]! * pose.skeletonScaleX
      scratchLocal[1] = scratchLocal[1]! * pose.skeletonScaleY; scratchLocal[3] = scratchLocal[3]! * pose.skeletonScaleY
      scratchLocal[4] = scratchLocal[4]! * pose.skeletonScaleX + pose.skeletonX
      scratchLocal[5] = scratchLocal[5]! * pose.skeletonScaleY + pose.skeletonY
      for (let k = 0; k < WORLD_STRIDE; k += 1) world[id * WORLD_STRIDE + k] = scratchLocal[k]!
    } else {
      for (let k = 0; k < WORLD_STRIDE; k += 1) scratchParent[k] = world[parent * WORLD_STRIDE + k]!
      const tx = scratchParent[0]! * scratchLocal[4]! + scratchParent[2]! * scratchLocal[5]! + scratchParent[4]!
      const ty = scratchParent[1]! * scratchLocal[4]! + scratchParent[3]! * scratchLocal[5]! + scratchParent[5]!
      const mode = skeleton.inherit[id]!
      if (mode === 'normal') multiplyAffine(scratchParent, scratchLocal, scratchLocal)
      else inheritLinear(mode, scratchParent, scratchLocal, local[id * POSE_STRIDE + CH_ROT]!, pose.skeletonScaleX, pose.skeletonScaleY)
      scratchLocal[4] = tx
      scratchLocal[5] = ty
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

function boneMatrixOffset(pose: Pose, bone: BoneId): number {
  if (!Number.isInteger(bone) || bone < 0 || bone >= pose.skeleton.count) throw new Error('pose.bone')
  updateWorld(pose)
  return bone * WORLD_STRIDE
}

export function localToWorld(pose: Pose, bone: BoneId, x: number, y: number): [number, number] {
  const i = boneMatrixOffset(pose, bone)
  const m = pose.world
  return [m[i]! * x + m[i + 2]! * y + m[i + 4]!,
    m[i + 1]! * x + m[i + 3]! * y + m[i + 5]!]
}

export function worldToLocal(pose: Pose, bone: BoneId, x: number, y: number): [number, number] {
  const i = boneMatrixOffset(pose, bone)
  const m = pose.world
  const a = m[i]!, b = m[i + 1]!, c = m[i + 2]!, d = m[i + 3]!
  const determinant = a * d - b * c
  if (Math.abs(determinant) < 1e-12) throw new Error('pose.worldToLocal: singular')
  const dx = x - m[i + 4]!, dy = y - m[i + 5]!
  return [(d * dx - c * dy) / determinant, (a * dy - b * dx) / determinant]
}

export function localToWorldRotation(pose: Pose, bone: BoneId, angle: number): number {
  const i = boneMatrixOffset(pose, bone)
  const m = pose.world
  const x = Math.cos(angle), y = Math.sin(angle)
  return Math.atan2(m[i + 1]! * x + m[i + 3]! * y, m[i]! * x + m[i + 2]! * y)
}

export function worldToLocalRotation(pose: Pose, bone: BoneId, angle: number): number {
  const i = boneMatrixOffset(pose, bone)
  const m = pose.world
  const a = m[i]!, b = m[i + 1]!, c = m[i + 2]!, d = m[i + 3]!
  const determinant = a * d - b * c
  if (Math.abs(determinant) < 1e-12) throw new Error('pose.worldToLocal: singular')
  const x = Math.cos(angle), y = Math.sin(angle)
  return Math.atan2((a * y - b * x) / determinant, (d * x - c * y) / determinant)
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
  pose.overrideActive[bone] = 0
  markDirty(pose, bone)
}
