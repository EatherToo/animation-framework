import type { Humanoid } from '../body/assemble'
import { createMat3, multiplyMat3, type Mat3 } from '../math/mat3'
import type { Mesh, MeshSet } from '../mesh/strip'
import { isArmPart } from '../outline/arm'
import type { PartSet, SkinnedPart } from '../part/set'
import { createPose } from '../skeleton/pose'
import { multiplyRigid, RIGID_STRIDE, setRigidParentFromBone } from '../skeleton/rigid'
import { bindLength, boneName, type Skeleton } from '../skeleton/skeleton'

const BAND_RATIO = 0.25

/** 一个蒙皮部件的顶点权重。按顶点主序。 */
export type SkinWeights = {
  readonly partId: string
  readonly influences: number
  readonly weights: Float32Array
  /** 每个顶点一项，大腿等 3D 蒙皮部件的轴向扭转份额；2D 手臂不再生成权重。 */
  readonly twistU: Float32Array
}

/** 只含蒙皮部件，顺序与部件登记一致。 */
export type WeightSet = {
  readonly weights: readonly SkinWeights[]
}

type Segment = {
  readonly slot: number
  readonly x0: number
  readonly y0: number
  readonly z0: number
  readonly x1: number
  readonly y1: number
  readonly z1: number
  readonly length: number
}

/**
 * 按骨轴过渡带为蒙皮网格写权重。链端两列取网格上的 `endShare`。
 * @param humanoid 体型与骨架
 * @param parts 部件
 * @param meshes 与部件对齐的网格
 */
export function createHumanoidWeights(
  humanoid: Humanoid,
  parts: PartSet,
  meshes: MeshSet,
): WeightSet {
  if (parts.skeleton !== humanoid.skeleton) throw new Error('skeleton')
  if (meshes.meshes.length !== parts.parts.length) throw new Error('mesh')
  const rig = writeBindRig(humanoid)
  const weights: SkinWeights[] = []
  for (let i = 0; i < parts.parts.length; i += 1) {
    const part = parts.parts[i]!
    const mesh = meshes.meshes[i]!
    if (mesh.partId !== part.id) throw new Error('mesh')
    // 2D 手臂由轮廓生成器直接给顶点，不再需要蒙皮权重。
    if (part.kind !== 'skinned' || isArmPart(part.id)) continue
    weights.push(weightPart(part, mesh, rig, humanoid.skeleton))
  }
  return { weights }
}

/** 把臂件 rim 的权重按骨名抄到躯干上与之重合的顶点，保证两侧同步。 */
function matchShoulderRims(
  meshes: MeshSet,
  parts: PartSet,
  weights: SkinWeights[],
  skeleton: Skeleton,
): void {
  for (const armId of ['armL', 'armR']) {
    const arm = meshes.meshes.find((mesh) => mesh.partId === armId)
    const torso = meshes.meshes.find((mesh) => mesh.partId === 'torso')
    const armPart = parts.parts.find((item) => item.id === armId)
    const torsoPart = parts.parts.find((item) => item.id === 'torso')
    const armWeights = weights.find((item) => item.partId === armId)
    const torsoWeights = weights.find((item) => item.partId === 'torso')
    if (
      arm === undefined || torso === undefined ||
      armPart === undefined || torsoPart === undefined ||
      armPart.kind !== 'skinned' || torsoPart.kind !== 'skinned' ||
      armWeights === undefined || torsoWeights === undefined
    ) continue
    for (let source = 0; source < arm.positions.length / 3; source += 1) {
      if (arm.seam[source] !== 1 || arm.endShare[source * 2]! <= 0.99) continue
      const x = arm.positions[source * 3]!
      const y = arm.positions[source * 3 + 1]!
      const z = arm.positions[source * 3 + 2]!
      for (let v = 0; v < torso.positions.length / 3; v += 1) {
        const d = Math.hypot(
          torso.positions[v * 3]! - x,
          torso.positions[v * 3 + 1]! - y,
          torso.positions[v * 3 + 2]! - z,
        )
        if (d > 1e-4) continue
        const row = new Array<number>(torsoWeights.influences).fill(0)
        let any = false
        for (let i = 0; i < armWeights.influences; i += 1) {
          const weight = armWeights.weights[source * armWeights.influences + i]!
          if (weight === 0) continue
          const name = boneName(skeleton, armPart.bones[i]!)
          const slot = torsoPart.bones.findIndex((bone) => boneName(skeleton, bone) === name)
          if (slot < 0) continue
          row[slot] = weight
          any = true
        }
        if (!any) continue
        for (let i = 0; i < torsoWeights.influences; i += 1) {
          torsoWeights.weights[v * torsoWeights.influences + i] = row[i]!
        }
      }
    }
  }
}


function weightPart(
  part: SkinnedPart,
  mesh: Mesh,
  rig: Float32Array,
  skeleton: Skeleton,
): SkinWeights {
  const positions = mesh.positions
  const endShare = mesh.endShare
  const segments: Segment[] = []
  for (let i = 0; i < part.bones.length; i += 1) {
    const bone = part.bones[i]!
    const length = bindLength(skeleton, bone)
    if (length <= 1e-5 || borrowed(part.id, boneName(skeleton, bone))) continue
    const base = bone * RIGID_STRIDE
    const x0 = rig[base + 9]!
    const y0 = rig[base + 10]!
    const z0 = rig[base + 11]!
    segments.push({
      slot: i,
      x0,
      y0,
      z0,
      x1: x0 + rig[base]! * length,
      y1: y0 + rig[base + 1]! * length,
      z1: z0 + rig[base + 2]! * length,
      length,
    })
  }
  const influences = part.bones.length
  const vertexCount = positions.length / 3
  const weights = new Float32Array(vertexCount * influences)
  const twistU = new Float32Array(vertexCount)
  const headSlot = 0
  const tailSlot = influences - 1
  const names = part.bones.map((bone) => boneName(skeleton, bone))
  const clavicleSlot = part.id.startsWith('arm') ? 1 : names.indexOf('clavicleL')
  const clavicles = names.indexOf('clavicleR')
  const originOf = (slot: number) => {
    const base = part.bones[slot]! * RIGID_STRIDE
    return { x: rig[base + 9]!, y: rig[base + 10]!, z: rig[base + 11]! }
  }
  const clavicle0 = clavicleSlot >= 0 ? originOf(clavicleSlot) : { x: 0, y: 0, z: 0 }
  const pelvisSlot = names.indexOf('pelvis')
  const pelvis0 = pelvisSlot >= 0 ? originOf(pelvisSlot) : { x: 0, y: 0, z: 0 }
  for (let v = 0; v < vertexCount; v += 1) {
    const x = positions[v * 3]!
    const y = positions[v * 3 + 1]!
    const z = positions[v * 3 + 2]!
    let best = 0
    let bestDist = Number.POSITIVE_INFINITY
    let bestT = 0
    for (let s = 0; s < segments.length; s += 1) {
      const proj = project(x, y, z, segments[s]!)
      if (proj.dist < bestDist) {
        best = s
        bestDist = proj.dist
        bestT = proj.t
      }
    }
    const column = weights.subarray(v * influences, (v + 1) * influences)
    blend(column, segments, best, bestT)
    const head = endShare[v * 2]!
    const tail = endShare[v * 2 + 1]!
    const e = head > 0 ? head : tail
    const endSlot = head > 0 ? headSlot : tail > 0 ? tailSlot : -1
    if (endSlot >= 0 && e > 0) {
      for (let i = 0; i < influences; i += 1) column[i]! *= 1 - e
      if (endSlot === headSlot && clavicleSlot >= 0 && part.id.startsWith('arm')) {
        // 接缝处（e=1）完全跟胸，与躯干那侧一致，缝不会裂；
        // 越往肩下，锁骨份额越大，三角肌才跟着抬肩走。
        const clavicleShare = 0.5 * (1 - e)
        column[0]! += e * (1 - clavicleShare)
        column[clavicleSlot]! += e * clavicleShare
      } else {
        column[endSlot]! += e
      }
    }
    const seg = segments[best]!
    const name = boneName(skeleton, part.bones[seg.slot]!)
    if (name.startsWith('lowerArm')) {
      twistU[v] = bestT
    } else if (name.startsWith('upperArm') || name.startsWith('thigh')) {
      // 肩/髋接缝不在骨原点：用 (1−head) 把接缝映到 0，肘/膝仍为 1。
      twistU[v] = bestT * (1 - head)
    }
  }
  return { partId: part.id, influences, weights, twistU }
}

function borrowed(partId: string, name: string): boolean {
  if (partId === 'torso') return name === 'pelvis' || name === 'head'
  if (partId === 'armL') return name === 'chest' || name === 'handL'
  if (partId === 'armR') return name === 'chest' || name === 'handR'
  if (partId === 'legL') return name === 'pelvis' || name === 'footL'
  if (partId === 'legR') return name === 'pelvis' || name === 'footR'
  return false
}

function blend(column: Float32Array, segments: Segment[], best: number, t: number): void {
  const seg = segments[best]!
  column[seg.slot] = 1
  const fromStart = t * seg.length
  const fromEnd = (1 - t) * seg.length
  if (best > 0) {
    const prev = segments[best - 1]!
    const band = BAND_RATIO * Math.min(seg.length, prev.length)
    if (fromStart <= band) {
      const u = band === 0 ? 0 : fromStart / band
      const wPrev = 0.5 * (1 - u)
      column[seg.slot] = 1 - wPrev
      column[prev.slot] = wPrev
      return
    }
  }
  if (best + 1 < segments.length) {
    const next = segments[best + 1]!
    const band = BAND_RATIO * Math.min(seg.length, next.length)
    if (fromEnd <= band) {
      const u = band === 0 ? 0 : fromEnd / band
      const wNext = 0.5 * (1 - u)
      column[seg.slot] = 1 - wNext
      column[next.slot] = wNext
    }
  }
}

function project(x: number, y: number, z: number, seg: Segment): { t: number; dist: number } {
  const dx = seg.x1 - seg.x0
  const dy = seg.y1 - seg.y0
  const dz = seg.z1 - seg.z0
  const len2 = dx * dx + dy * dy + dz * dz
  let t = ((x - seg.x0) * dx + (y - seg.y0) * dy + (z - seg.z0) * dz) / len2
  if (t < 0) t = 0
  if (t > 1) t = 1
  const cx = seg.x0 + dx * t
  const cy = seg.y0 + dy * t
  const cz = seg.z0 + dz * t
  return { t, dist: Math.hypot(x - cx, y - cy, z - cz) }
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
    parent.set(rig.subarray(parentIndex * RIGID_STRIDE, (parentIndex + 1) * RIGID_STRIDE))
    multiplyRigid(combined, parent, local)
    rig.set(combined, dst)
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
