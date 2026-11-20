import type { Humanoid } from '../body/assemble'
import type { BodyProportions, RadiusProfile, RadiusSample } from '../body/proportions'
import { createMat3, multiplyMat3, type Mat3 } from '../math/mat3'
import type { Fill, PartSet, SkinnedPart } from '../part/set'
import { bindLength, boneName, type Skeleton } from '../skeleton/skeleton'
import { setBindParentFromBone } from '../skeleton/parent-from-bone'
import { createMeshTextures } from './texture'
import {
  meshFromCappedSection,
  meshFromCappedTube,
  meshFromStrip,
  type Mesh,
  type MeshSet,
  type StripSegment,
} from './strip'

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
  const lateral = writeBindLateral(humanoid.skeleton)
  const meshes: Mesh[] = []
  for (let i = 0; i < parts.parts.length; i += 1) {
    const part = parts.parts[i]!
    if (part.kind === 'skinned') {
      meshes.push(tubeMesh(part, humanoid.skeleton, humanoid.proportions, rig, lateral))
    } else {
      meshes.push(rigidMesh(part.id, part.bone, humanoid.skeleton, humanoid.proportions, part.fill))
    }
  }
  return { meshes }
}

function tubeMesh(
  part: SkinnedPart,
  skeleton: Skeleton,
  proportions: BodyProportions,
  rig: Float32Array,
  lateral: Float32Array,
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
    const z = lateral[bone]!
    segments.push(segment(ox, oy, z, x1, y1, z, profileOf(name, proportions)))
  }
  return meshFromStrip(part.id, 'character', segments, part.fill)
}

function segment(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  profile: RadiusProfile,
): StripSegment {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy)
  return { x0, y0, z0, x1, y1, z1, px: -dy / len, py: dx / len, profile }
}

function rigidMesh(
  partId: string,
  bone: number,
  skeleton: Skeleton,
  proportions: BodyProportions,
  fill: Fill,
): Mesh {
  const length = bindLength(skeleton, bone)
  const name = boneName(skeleton, bone)
  if (name === 'head') {
    return meshFromCappedTube(partId, 'part', [segment(0, 0, 0, length, 0, 0, proportions.headProfile)], fill)
  }
  if (name === 'handL' || name === 'handR') return handMesh(partId, name === 'handL' ? 1 : -1, length, proportions, fill)
  if (name === 'footL' || name === 'footR') return footMesh(partId, proportions, fill)
  throw new Error('part')
}

function handMesh(partId: string, side: number, length: number, proportions: BodyProportions, fill: Fill): Mesh {
  const palmEnd = proportions.palmFraction * length
  const pieces = [
    meshFromCappedTube(partId, 'part', [segment(0, 0, 0, palmEnd, 0, 0, constantProfile(proportions.palmRadius))], fill),
  ]
  for (const spread of [-proportions.fingerSpread[1], -proportions.fingerSpread[0], proportions.fingerSpread[0], proportions.fingerSpread[1]]) {
    pieces.push(
      meshFromCappedTube(
        partId,
        'part',
        [segment(palmEnd, 0, spread, length, 0, spread, constantProfile(proportions.fingerRadius))],
        fill,
      ),
    )
  }
  const thumbX = proportions.thumbAlong * length
  const thumbZ = side * proportions.thumbOffsetZ
  pieces.push(
    meshFromCappedTube(
      partId,
      'part',
      [
        segment(
          thumbX,
          -proportions.thumbDrop,
          thumbZ,
          thumbX + proportions.thumbFraction * length,
          -proportions.thumbDrop,
          thumbZ,
          constantProfile(proportions.thumbRadius),
        ),
      ],
      fill,
    ),
  )
  return concatenate(partId, pieces, fill)
}

function footMesh(partId: string, proportions: BodyProportions, fill: Fill): Mesh {
  return meshFromCappedSection(
    partId,
    'part',
    -proportions.heelBack,
    0,
    0,
    proportions.footLength,
    0,
    0,
    (t, theta) => {
      const lifted = Math.max(0, (Math.sin(theta) + 1) / 2)
      return {
        along: -proportions.ankleHeight + radiusAt(proportions.footInstep, t) * lifted,
        lateral: -radiusAt(proportions.footHalfWidth, t) * Math.cos(theta),
      }
    },
    fill,
  )
}

function concatenate(partId: string, pieces: readonly Mesh[], fill: Fill): Mesh {
  let floats = 0
  let indexCount = 0
  for (const piece of pieces) {
    floats += piece.positions.length
    indexCount += piece.indices.length
  }
  const positions = new Float32Array(floats)
  const indices = new Uint16Array(indexCount)
  let floatOffset = 0
  let indexOffset = 0
  let vertexBase = 0
  for (const piece of pieces) {
    positions.set(piece.positions, floatOffset)
    for (let i = 0; i < piece.indices.length; i += 1) indices[indexOffset + i] = piece.indices[i]! + vertexBase
    floatOffset += piece.positions.length
    indexOffset += piece.indices.length
    vertexBase += piece.positions.length / 3
  }
  return { partId, space: 'part', positions, indices, ...createMeshTextures(indices, fill) }
}

function constantProfile(radius: number): RadiusProfile {
  return [
    { t: 0, radius },
    { t: 1, radius },
  ]
}

function profileOf(name: string, proportions: BodyProportions): RadiusProfile {
  switch (name) {
    case 'pelvis':
    case 'spine':
      return proportions.spineProfile
    case 'chest':
      return proportions.chestProfile
    case 'neck':
      return proportions.neckProfile
    case 'upperArmL':
    case 'upperArmR':
      return proportions.upperArmProfile
    case 'lowerArmL':
    case 'lowerArmR':
      return proportions.lowerArmProfile
    case 'thighL':
    case 'thighR':
      return proportions.thighProfile
    case 'shinL':
    case 'shinR':
      return proportions.shinProfile
    default:
      throw new Error('bone')
  }
}

function radiusAt(profile: readonly RadiusSample[], t: number): number {
  for (let i = 0; i < profile.length - 1; i += 1) {
    const left = profile[i]!
    const right = profile[i + 1]!
    if (t < left.t || t > right.t) continue
    const span = right.t - left.t
    const u = span === 0 ? 0 : (t - left.t) / span
    return left.radius * (1 - u) + right.radius * u
  }
  throw new Error('radius')
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

function writeBindLateral(skeleton: Skeleton): Float32Array {
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
