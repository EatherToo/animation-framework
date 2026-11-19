import type { Humanoid } from '../body/assemble'
import type { BodyProportions } from '../body/proportions'
import { createHumanoidMeshes } from '../mesh/humanoid'
import type { MeshSet } from '../mesh/strip'
import { createHumanoidParts } from '../part/humanoid'
import type { PartSet } from '../part/set'
import { createFootShape, type FootShape } from '../foot/shape'
import { createMat3, invertMat3, multiplyMat3, type Mat3 } from '../math/mat3'
import { createVec2 } from '../math/vec2'
import { createCorrection, type Correction } from '../correction/correction'
import { createHumanoidSlots } from '../slot/humanoid'
import { findSlot, type SlotSet } from '../slot/slot'
import { LENGTH_EPSILON } from '../space/tolerance'
import { setBindParentFromBone } from '../skeleton/parent-from-bone'
import { bindLength, bindTranslation, type Skeleton } from '../skeleton/skeleton'
import { validateMesh } from '../topology/validate'
import { createHumanoidWeights, type WeightSet } from '../weight/humanoid'

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
  /** 各骨在绑定姿态下的角色空间横向位置：`bindLateral` 沿父链加总。 */
  readonly lateralBind: Float32Array
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
  const bindRig = writeBindRig(humanoid.skeleton)
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
    lateralBind: writeLateralBind(humanoid.skeleton),
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
    if (mesh.partId !== parts.parts[i]!.id) throw new Error('mesh')
    validateMesh(mesh)
  }
}

function assertWeights(parts: PartSet, meshes: MeshSet, weights: WeightSet): void {
  for (let i = 0; i < parts.parts.length; i += 1) {
    const part = parts.parts[i]!
    const found = weights.weights.find((item) => item.partId === part.id)
    if (part.kind === 'rigid') {
      if (found !== undefined) throw new Error('weight')
      continue
    }
    const mesh = meshes.meshes[i]!
    const vertexCount = mesh.positions.length / 3
    if (
      found === undefined ||
      found.influences !== part.bones.length ||
      found.weights.length !== vertexCount * part.bones.length
    ) {
      throw new Error('weight')
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

function writeBindRig(skeleton: Skeleton): Float32Array {
  const rig = new Float32Array(skeleton.boneCount * 9)
  const local = createMat3()
  const parent = createMat3()
  const combined = createMat3()
  for (let bone = 0; bone < skeleton.boneCount; bone += 1) {
    setBindParentFromBone(local, skeleton, bone)
    const parentIndex = skeleton.parent[bone]!
    const source = parentIndex < 0 ? local : combine(combined, parent, rig, parentIndex, local)
    const dst = bone * 9
    for (let k = 0; k < 9; k += 1) rig[dst + k] = source[k]!
  }
  return rig
}

function writeLateralBind(skeleton: Skeleton): Float32Array {
  const lateral = new Float32Array(skeleton.boneCount)
  for (let bone = 0; bone < skeleton.boneCount; bone += 1) {
    const parentIndex = skeleton.parent[bone]!
    const own = skeleton.bindLateral[bone]!
    lateral[bone] = parentIndex < 0 ? own : lateral[parentIndex]! + own
  }
  return lateral
}

function combine(
  combined: Mat3,
  parent: Mat3,
  rig: Float32Array,
  parentIndex: number,
  local: Mat3,
): Mat3 {
  const src = parentIndex * 9
  for (let k = 0; k < 9; k += 1) parent[k] = rig[src + k]!
  return multiplyMat3(combined, parent, local)
}

function invertAll(bindRig: Float32Array, boneCount: number): Float32Array {
  const inverse = new Float32Array(bindRig.length)
  const source = createMat3()
  const inv = createMat3()
  for (let bone = 0; bone < boneCount; bone += 1) {
    const dst = bone * 9
    for (let k = 0; k < 9; k += 1) source[k] = bindRig[dst + k]!
    if (!invertMat3(inv, source)) throw new Error('bind')
    for (let k = 0; k < 9; k += 1) inverse[dst + k] = inv[k]!
  }
  return inverse
}
