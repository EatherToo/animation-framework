import type { Humanoid } from '../body/assemble'
import { createMat3, multiplyMat3, type Mat3 } from '../math/mat3'
import type { Mesh, MeshSet } from '../mesh/strip'
import type { PartSet, SkinnedPart } from '../part/set'
import { setBindParentFromBone } from '../skeleton/parent-from-bone'
import { bindLength, boneName, type Skeleton } from '../skeleton/skeleton'

const BAND_RATIO = 0.25

/** 一个蒙皮部件的顶点权重。按顶点主序。 */
export type SkinWeights = {
  readonly partId: string
  readonly influences: number
  readonly weights: Float32Array
}

/** 只含蒙皮部件，顺序与部件登记一致。 */
export type WeightSet = {
  readonly weights: readonly SkinWeights[]
}

type Segment = {
  readonly slot: number
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
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
  const rig = writeBindRig(humanoid.skeleton)
  const weights: SkinWeights[] = []
  for (let i = 0; i < parts.parts.length; i += 1) {
    const part = parts.parts[i]!
    const mesh = meshes.meshes[i]!
    if (mesh.partId !== part.id) throw new Error('mesh')
    if (part.kind !== 'skinned') continue
    weights.push(weightPart(part, mesh, rig, humanoid.skeleton))
  }
  return { weights }
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
    const base = bone * 9
    const x0 = rig[base + 6]!
    const y0 = rig[base + 7]!
    segments.push({
      slot: i,
      x0,
      y0,
      x1: x0 + rig[base]! * length,
      y1: y0 + rig[base + 1]! * length,
      length,
    })
  }
  const influences = part.bones.length
  const vertexCount = positions.length / 3
  const weights = new Float32Array(vertexCount * influences)
  const headSlot = 0
  const tailSlot = influences - 1
  for (let v = 0; v < vertexCount; v += 1) {
    const x = positions[v * 3]!
    const y = positions[v * 3 + 1]!
    let best = 0
    let bestDist = Number.POSITIVE_INFINITY
    let bestT = 0
    for (let s = 0; s < segments.length; s += 1) {
      const proj = project(x, y, segments[s]!)
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
    if (endSlot < 0 || e <= 0) continue
    for (let i = 0; i < influences; i += 1) column[i]! *= 1 - e
    column[endSlot]! += e
  }
  return { partId: part.id, influences, weights }
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
  if (best > 0 && segments[best - 1]!.slot === seg.slot - 1) {
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
  if (best + 1 < segments.length && segments[best + 1]!.slot === seg.slot + 1) {
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

function project(x: number, y: number, seg: Segment): { t: number; dist: number } {
  const dx = seg.x1 - seg.x0
  const dy = seg.y1 - seg.y0
  const len2 = dx * dx + dy * dy
  let t = ((x - seg.x0) * dx + (y - seg.y0) * dy) / len2
  if (t < 0) t = 0
  if (t > 1) t = 1
  const cx = seg.x0 + dx * t
  const cy = seg.y0 + dy * t
  return { t, dist: Math.hypot(x - cx, y - cy) }
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
