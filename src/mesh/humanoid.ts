import type { Humanoid } from '../body/assemble'
import type { BodyProportions } from '../body/proportions'
import { createMat3, multiplyMat3, type Mat3 } from '../math/mat3'
import type { PartSet, SkinnedPart } from '../part/set'
import { bindLength, boneName, type Skeleton } from '../skeleton/skeleton'
import { setBindParentFromBone } from '../skeleton/parent-from-bone'
import { meshFromRectangle, meshFromStrip, type Mesh, type MeshSet, type StripSegment } from './strip'

export type { Mesh } from './strip'

const MIN_LENGTH = 1e-5
const JOIN_DISTANCE_SQ = 1e-8

/**
 * 按绑定姿态为每个人形部件生成网格。
 * @param humanoid 已装配的人形
 * @param parts 同一棵骨架上的部件
 */
export function createHumanoidMeshes(humanoid: Humanoid, parts: PartSet): MeshSet {
  if (parts.skeleton !== humanoid.skeleton) throw new Error('skeleton')
  const rig = writeBindRig(humanoid.skeleton)
  const meshes: Mesh[] = []
  for (let i = 0; i < parts.parts.length; i += 1) {
    const part = parts.parts[i]!
    if (part.kind === 'skinned') {
      meshes.push(skinMesh(part, humanoid.skeleton, humanoid.proportions, rig))
    } else {
      meshes.push(rigidMesh(part.id, part.bone, humanoid.skeleton, humanoid.proportions))
    }
  }
  return { meshes }
}

function skinMesh(
  part: SkinnedPart,
  skeleton: Skeleton,
  proportions: BodyProportions,
  rig: Float32Array,
): Mesh {
  const segments: StripSegment[] = []
  for (let i = 0; i < part.bones.length; i += 1) {
    const bone = part.bones[i]!
    const length = bindLength(skeleton, bone)
    if (length <= MIN_LENGTH) continue
    const name = boneName(skeleton, bone)
    const base = bone * 9
    const ox = rig[base + 6]!
    const oy = rig[base + 7]!
    const ax = rig[base]!
    const ay = rig[base + 1]!
    const radius = radiusOf(name, proportions)
    const x1 = ox + ax * length
    const y1 = oy + ay * length
    const next = i + 1 < part.bones.length ? part.bones[i + 1]! : -1
    if (next >= 0) {
      const nx = rig[next * 9 + 6]!
      const ny = rig[next * 9 + 7]!
      const dx = nx - x1
      const dy = ny - y1
      if (dx * dx + dy * dy > JOIN_DISTANCE_SQ) continue
    }
    segments.push(segment(ox, oy, x1, y1, radius))
  }
  return meshFromStrip(part.id, 'character', segments)
}

function segment(x0: number, y0: number, x1: number, y1: number, radius: number): StripSegment {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy)
  return { x0, y0, x1, y1, px: -dy / len, py: dx / len, radius }
}

function rigidMesh(
  partId: string,
  bone: number,
  skeleton: Skeleton,
  proportions: BodyProportions,
): Mesh {
  const length = bindLength(skeleton, bone)
  const name = boneName(skeleton, bone)
  if (name === 'head') {
    return meshFromRectangle(partId, 0, length, proportions.headRadius, -proportions.headRadius)
  }
  if (name === 'handL' || name === 'handR') {
    return meshFromRectangle(partId, 0, length, proportions.handRadius, -proportions.handRadius)
  }
  if (name === 'footL' || name === 'footR') {
    return meshFromRectangle(partId, 0, length, proportions.footRadius, -proportions.ankleHeight)
  }
  throw new Error('part')
}

function radiusOf(name: string, proportions: BodyProportions): number {
  switch (name) {
    case 'pelvis':
    case 'spine':
      return proportions.spineRadius
    case 'chest':
      return proportions.chestRadius
    case 'neck':
      return proportions.neckRadius
    case 'upperArmL':
    case 'upperArmR':
      return proportions.upperArmRadius
    case 'lowerArmL':
    case 'lowerArmR':
      return proportions.lowerArmRadius
    case 'thighL':
    case 'thighR':
      return proportions.thighRadius
    case 'shinL':
    case 'shinR':
      return proportions.shinRadius
    default:
      throw new Error('bone')
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
    const dst = bone * 9
    const source = parentIndex < 0 ? local : combine(combined, parent, rig, parentIndex, local)
    for (let k = 0; k < 9; k += 1) rig[dst + k] = source[k]!
  }
  return rig
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
