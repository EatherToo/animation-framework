import type { Humanoid } from '../body/assemble'
import type { JointDof } from '../body/joints'
import type { BodyProportions } from '../body/proportions'
import { createHumanoidMeshes } from '../mesh/humanoid'
import { validateMeshTextures } from '../mesh/texture'
import type { MeshSet } from '../mesh/strip'
import { createHumanoidParts } from '../part/humanoid'
import type { PartSet } from '../part/set'
import { createFootShape, type FootShape } from '../foot/shape'
import { createVec2 } from '../math/vec2'
import { createCorrection, type Correction } from '../correction/correction'
import { createHumanoidSlots } from '../slot/humanoid'
import { findSlot, type SlotSet } from '../slot/slot'
import { LENGTH_EPSILON } from '../space/tolerance'
import { createPose } from '../skeleton/pose'
import { multiplyRigid, RIGID_STRIDE, setRigidParentFromBone } from '../skeleton/rigid'
import { bindLength, bindTranslation, type Skeleton } from '../skeleton/skeleton'
import { validateMesh } from '../topology/validate'
import { createHumanoidWeights, type WeightSet } from '../weight/humanoid'
import { isArmPart } from '../outline/arm'

/** 编译后的只读角色。运行时只读这份结果。 */
export type CompiledRig = {
  readonly skeleton: Skeleton
  readonly proportions: BodyProportions
  readonly foot: FootShape
  readonly parts: PartSet
  readonly slots: SlotSet
  readonly meshes: MeshSet
  readonly weights: WeightSet
  readonly correction: Correction
  readonly bindRig: Float32Array
  readonly inverseBind: Float32Array
  readonly joints: readonly JointDof[]
}

/** `compileRig` 的源数据。 */
export type CompileInput = {
  readonly humanoid: Humanoid
  readonly parts: PartSet
  readonly slots: SlotSet
  readonly meshes: MeshSet
  readonly weights: WeightSet
  readonly correction: Correction
}

/**
 * 装好人形源数据并编译。
 * @param humanoid 已装配的人形
 */
export function compileHumanoid(humanoid: Humanoid): CompiledRig {
  const parts = createHumanoidParts(humanoid.skeleton)
  const slots = createHumanoidSlots()
  const meshes = createHumanoidMeshes(humanoid, parts)
  const weights = createHumanoidWeights(humanoid, parts, meshes)
  return compileRig({
    humanoid,
    parts,
    slots,
    meshes,
    weights,
    correction: createCorrection(),
  })
}

/**
 * 核对源数据并冻结。失败时不返回结果。
 * @param input 骨架、部件、槽位、网格、权重与修正
 */
export function compileRig(input: CompileInput): CompiledRig {
  const { humanoid, parts, slots, meshes, weights, correction } = input
  if (parts.skeleton !== humanoid.skeleton) throw new Error('skeleton')
  assertSlots(parts, slots)
  assertMeshes(parts, meshes)
  assertWeights(parts, meshes, weights)
  assertChains(humanoid)
  assertBindSwing(humanoid)
  const bindRig = writeBindRig(humanoid)
  const inverseBind = invertAll(bindRig, humanoid.skeleton.boneCount)
  const foot = createFootShape(humanoid.proportions.footLength, humanoid.proportions.ankleHeight)
  return {
    skeleton: humanoid.skeleton,
    proportions: humanoid.proportions,
    foot,
    parts,
    slots,
    meshes,
    weights,
    correction,
    bindRig,
    inverseBind,
    joints: humanoid.joints,
  }
}

function assertSlots(parts: PartSet, slots: SlotSet): void {
  if (slots.slots.length !== parts.parts.length) throw new Error('slot')
  for (let i = 0; i < parts.parts.length; i += 1) {
    if (findSlot(slots, parts.parts[i]!.id) < 0) throw new Error('slot')
  }
}

function assertMeshes(parts: PartSet, meshes: MeshSet): void {
  if (meshes.meshes.length !== parts.parts.length) throw new Error('mesh')
  for (let i = 0; i < parts.parts.length; i += 1) {
    const mesh = meshes.meshes[i]!
    const part = parts.parts[i]!
    if (mesh.partId !== part.id) throw new Error('mesh')
    const vertexCount = mesh.positions.length / 3
    if (mesh.seam.length !== vertexCount) throw new Error('mesh')
    const shareLength = part.kind === 'skinned' ? vertexCount * 2 : 0
    if (mesh.endShare.length !== shareLength) throw new Error('mesh')
    validateMesh(mesh)
    validateMeshTextures(mesh.indices, mesh.textures, mesh.triangleTexture, mesh.uvs)
  }
}

function assertWeights(parts: PartSet, meshes: MeshSet, weights: WeightSet): void {
  for (let i = 0; i < parts.parts.length; i += 1) {
    const part = parts.parts[i]!
    const found = weights.weights.find((item) => item.partId === part.id)
    if (part.kind === 'rigid' || isArmPart(part.id)) {
      // 2D 手臂不走蒙皮，没有权重记录。
      if (found !== undefined) throw new Error('weight')
      continue
    }
    const mesh = meshes.meshes[i]!
    const vertexCount = mesh.positions.length / 3
    if (
      found === undefined ||
      found.influences !== part.bones.length ||
      found.weights.length !== vertexCount * part.bones.length ||
      found.twistU.length !== vertexCount
    ) {
      throw new Error('weight')
    }
  }
}

function assertBindSwing(humanoid: Humanoid): void {
  const skeleton = humanoid.skeleton
  for (let bone = 0; bone < skeleton.boneCount; bone += 1) {
    const swing = skeleton.bindSwing[bone]!
    // 上臂外展只有 6°，但锁骨要用 90° 的绑定侧摆把骨轴指向 ±Z，因此上限放到 90°。
    if (!Number.isFinite(swing) || Math.abs(swing) > Math.PI / 2 + 1e-6) {
      throw new Error('bindSwing')
    }
  }
}

function assertChains(humanoid: Humanoid): void {
  const chains = [
    humanoid.chains.legL,
    humanoid.chains.legR,
    humanoid.chains.armL,
    humanoid.chains.armR,
  ]
  for (let i = 0; i < chains.length; i += 1) {
    const chain = chains[i]!
    assertLink(humanoid.skeleton, chain.root, chain.mid)
    assertLink(humanoid.skeleton, chain.mid, chain.end)
  }
}

function assertLink(skeleton: Skeleton, parent: number, child: number): void {
  const length = bindLength(skeleton, parent)
  const translation = bindTranslation(createVec2(), skeleton, child)
  if (
    Math.abs(translation[0]! - length) > LENGTH_EPSILON ||
    Math.abs(translation[1]!) > LENGTH_EPSILON
  ) {
    throw new Error('chain')
  }
}

function writeBindRig(humanoid: Humanoid): Float32Array {
  const skeleton = humanoid.skeleton
  const pose = createPose(skeleton)
  const rig = new Float32Array(skeleton.boneCount * RIGID_STRIDE)
  const local = new Float32Array(RIGID_STRIDE)
  const parent = new Float32Array(RIGID_STRIDE)
  const combined = new Float32Array(RIGID_STRIDE)
  for (let bone = 0; bone < skeleton.boneCount; bone += 1) {
    const joint = humanoid.joints[bone]!
    setRigidParentFromBone(local, skeleton, pose, bone, joint.swingSign, joint.twistSign)
    const parentIndex = skeleton.parent[bone]!
    const dst = bone * RIGID_STRIDE
    if (parentIndex < 0) {
      rig.set(local, dst)
      continue
    }
    parent.set(rig.subarray(parentIndex * RIGID_STRIDE, parentIndex * RIGID_STRIDE + RIGID_STRIDE))
    multiplyRigid(combined, parent, local)
    rig.set(combined, dst)
  }
  return rig
}

function invertAll(bindRig: Float32Array, boneCount: number): Float32Array {
  const inverse = new Float32Array(bindRig.length)
  const source = new Float32Array(RIGID_STRIDE)
  const inv = new Float32Array(RIGID_STRIDE)
  for (let bone = 0; bone < boneCount; bone += 1) {
    const dst = bone * RIGID_STRIDE
    source.set(bindRig.subarray(dst, dst + RIGID_STRIDE))
    if (!invertRigid(inv, source)) throw new Error('bind')
    inverse.set(inv, dst)
  }
  return inverse
}

function invertRigid(out: Float32Array, src: Float32Array): boolean {
  for (let i = 0; i < RIGID_STRIDE; i += 1) {
    if (!Number.isFinite(src[i])) return false
  }
  out[0] = src[0]!
  out[1] = src[3]!
  out[2] = src[6]!
  out[3] = src[1]!
  out[4] = src[4]!
  out[5] = src[7]!
  out[6] = src[2]!
  out[7] = src[5]!
  out[8] = src[8]!
  const tx = src[9]!
  const ty = src[10]!
  const tz = src[11]!
  out[9] = -(out[0]! * tx + out[3]! * ty + out[6]! * tz)
  out[10] = -(out[1]! * tx + out[4]! * ty + out[7]! * tz)
  out[11] = -(out[2]! * tx + out[5]! * ty + out[8]! * tz)
  let error = 0
  for (let col = 0; col < 3; col += 1) {
    for (let row = 0; row < 3; row += 1) {
      let sum = 0
      for (let k = 0; k < 3; k += 1) sum += src[k * 3 + row]! * out[col * 3 + k]!
      error = Math.max(error, Math.abs(sum - (row === col ? 1 : 0)))
    }
  }
  return error <= 1e-4
}
