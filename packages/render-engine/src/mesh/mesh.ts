/**
 * core2d 网格 / 2D 蒙皮 / 拓扑校验。权威：docs/05-网格与蒙皮.md。
 * 求值顺序固定：FFD deform → skin → packet。顶点世界坐标不写入资产。
 */
import { invertAffine, multiplyAffine, createAffine, WORLD_STRIDE, type Affine } from '../core/math'
import { createPose, updateWorld, type Pose } from '../core/pose'
import type { BoneId } from '../core/skeleton'

export type MeshData = {
  readonly id: string
  readonly positions: Float32Array
  readonly uvs: Float32Array
  readonly indices: Uint16Array
  readonly bone: BoneId
  readonly vertexSpace: 'boneLocal' | 'bindWorld'
  readonly colors?: Uint8Array
}

export type WeightedMeshData = MeshData & {
  readonly boneIndices: Uint16Array
  readonly weights: Float32Array
  /** Number of influence slots per vertex; legacy meshes use four. */
  readonly influencesPerVertex?: number
  /** Spine source local x/y for each retained influence. */
  readonly influencePositions?: Float32Array
  /** Source deform x-component index per influence; -1 for padding/fallback. */
  readonly influenceSourceIndices?: Int32Array
}

/** FFD：offsets 是存储空间绝对偏移（非增量）。 */
export type VertexDeform = {
  readonly version: number
  readonly offsets: Float32Array
}

export type TopologyReport = { errors: string[]; warnings: string[] }

export function deformPositions(
  base: Float32Array,
  deform: VertexDeform | null,
  out: Float32Array = new Float32Array(base.length),
): Float32Array {
  if (deform === null) return base
  if (deform.offsets.length !== base.length) throw new Error('mesh.deform.length')
  if (out !== base) out.set(base)
  for (let i = 0; i < base.length; i += 1) out[i] = base[i]! + deform.offsets[i]!
  return out
}

/** bind inverse 从 setup 姿态计算（而不是当前动画姿态）。 */
export function buildInverseBind(pose: Pose): Float32Array {
  const setupPose = createPose(pose.skeleton)
  updateWorld(setupPose)
  const out = new Float32Array(pose.skeleton.count * WORLD_STRIDE)
  const m = createAffine()
  const inv = createAffine()
  for (let i = 0; i < pose.skeleton.count; i += 1) {
    for (let k = 0; k < WORLD_STRIDE; k += 1) m[k] = setupPose.world[i * WORLD_STRIDE + k]!
    const result = invertAffine(m, inv)
    if (result === null) throw new Error(`mesh.inverseBind: bone ${i}`)
    out.set(result, i * WORLD_STRIDE)
  }
  return out
}

const delta = createAffine()
const temp = createAffine()

/** 把网格顶点变换到 world 空间；旧资产缺省每顶点 4 影响。 */
export function skinMesh2D(
  mesh: MeshData | WeightedMeshData,
  pose: Pose,
  inverseBind: Float32Array,
  out: Float32Array = new Float32Array(mesh.positions.length),
  deform?: Float32Array,
): Float32Array {
  const positions = mesh.positions
  if (out.length !== positions.length) throw new Error('mesh.output.length')
  const weighted = 'boneIndices' in mesh && 'weights' in mesh
  const stride = weighted ? (mesh as WeightedMeshData).influencesPerVertex ?? 4 : 0
  const invOff = (bone: number) => bone * WORLD_STRIDE

  for (let v = 0; v < positions.length / 2; v += 1) {
    const px = positions[v * 2]!
    const py = positions[v * 2 + 1]!
    if (!weighted) {
      const bone = (mesh as MeshData).bone
      const off = bone * WORLD_STRIDE
      for (let k = 0; k < WORLD_STRIDE; k += 1) temp[k] = pose.world[off + k]!
      if (mesh.vertexSpace === 'boneLocal') {
        out[v * 2] = temp[0]! * px + temp[2]! * py + temp[4]!
        out[v * 2 + 1] = temp[1]! * px + temp[3]! * py + temp[5]!
      } else {
        for (let k = 0; k < WORLD_STRIDE; k += 1) delta[k] = inverseBind[invOff(bone) + k]!
        multiplyAffine(temp, delta, delta)
        out[v * 2] = delta[0]! * px + delta[2]! * py + delta[4]!
        out[v * 2 + 1] = delta[1]! * px + delta[3]! * py + delta[5]!
      }
      continue
    }
    const influencePositions = (mesh as WeightedMeshData).influencePositions
    if (influencePositions !== undefined) {
      let wx = 0
      let wy = 0
      for (let j = 0; j < stride; j += 1) {
        const influence = v * stride + j
        const w = (mesh as WeightedMeshData).weights[influence]!
        if (w === 0) continue
        const bone = (mesh as WeightedMeshData).boneIndices[influence]!
        if (bone >= pose.skeleton.count) throw new Error('mesh.boneIndex')
        const off = bone * WORLD_STRIDE
        const local = influence * 2
        const x = influencePositions[local]! + (deform?.[local] ?? 0)
        const y = influencePositions[local + 1]! + (deform?.[local + 1] ?? 0)
        wx += w * (pose.world[off]! * x + pose.world[off + 2]! * y + pose.world[off + 4]!)
        wy += w * (pose.world[off + 1]! * x + pose.world[off + 3]! * y + pose.world[off + 5]!)
      }
      out[v * 2] = wx
      out[v * 2 + 1] = wy
      continue
    }
    if (mesh.vertexSpace === 'boneLocal') {
      const bone = (mesh as WeightedMeshData).boneIndices[v * stride]!
      const off = bone * WORLD_STRIDE
      for (let k = 0; k < WORLD_STRIDE; k += 1) temp[k] = pose.world[off + k]!
      out[v * 2] = temp[0]! * px + temp[2]! * py + temp[4]!
      out[v * 2 + 1] = temp[1]! * px + temp[3]! * py + temp[5]!
      continue
    }
    let wx = 0
    let wy = 0
    for (let j = 0; j < stride; j += 1) {
      const w = (mesh as WeightedMeshData).weights[v * stride + j]!
      if (w === 0) continue
      const bone = (mesh as WeightedMeshData).boneIndices[v * stride + j]!
      if (bone < 0 || bone >= pose.skeleton.count) throw new Error('mesh.boneIndex')
      const off = bone * WORLD_STRIDE
      for (let k = 0; k < WORLD_STRIDE; k += 1) temp[k] = pose.world[off + k]!
      for (let k = 0; k < WORLD_STRIDE; k += 1) delta[k] = inverseBind[invOff(bone) + k]!
      multiplyAffine(temp, delta, delta)
      wx += w * (delta[0]! * px + delta[2]! * py + delta[4]!)
      wy += w * (delta[1]! * px + delta[3]! * py + delta[5]!)
    }
    out[v * 2] = wx
    out[v * 2 + 1] = wy
  }
  return out
}

/** 硬约束为 error，软约束为 warn；导入器可据此决定 reject / fallback。 */
export function validateTopology(mesh: MeshData | WeightedMeshData): TopologyReport {
  const errors: string[] = []
  const warnings: string[] = []
  const vertexCount = mesh.positions.length / 2
  if (!Number.isInteger(vertexCount) || vertexCount < 3) errors.push('vertexCount')
  if (mesh.indices.length % 3 !== 0) errors.push('indexMultiple')
  if (mesh.uvs.length !== vertexCount * 2) errors.push('uvLength')

  for (let i = 0; i < mesh.indices.length; i += 1) {
    if (mesh.indices[i]! >= vertexCount) errors.push('indexOutOfRange')
  }

  const area = (ia: number, ib: number, ic: number) => {
    const ax = mesh.positions[ia * 2]!, ay = mesh.positions[ia * 2 + 1]!
    const bx = mesh.positions[ib * 2]!, by = mesh.positions[ib * 2 + 1]!
    const cx = mesh.positions[ic * 2]!, cy = mesh.positions[ic * 2 + 1]!
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  }
  let positive = 0
  let negative = 0
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const a = area(mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!)
    if (Math.abs(a) < 1e-12) errors.push('degenerateTriangle')
    else if (a > 0) positive += 1
    else negative += 1
  }
  if (positive > 0 && negative > 0) warnings.push('windingMixed')
  else if (negative > positive) warnings.push('windingReversed')

  const uvSeen = new Set<string>()
  for (let v = 0; v < vertexCount; v += 1) {
    const key = `${mesh.uvs[v * 2]},${mesh.uvs[v * 2 + 1]}`
    if (uvSeen.has(key)) warnings.push('uvSeam')
    uvSeen.add(key)
  }

  if ('boneIndices' in mesh && 'weights' in mesh) {
    const weighted = mesh as WeightedMeshData
    const stride = weighted.influencesPerVertex ?? 4
    if (!Number.isInteger(stride) || stride < 1 ||
        weighted.boneIndices.length !== vertexCount * stride || weighted.weights.length !== vertexCount * stride ||
        (weighted.influencePositions !== undefined && weighted.influencePositions.length !== vertexCount * stride * 2) ||
        (weighted.influenceSourceIndices !== undefined && weighted.influenceSourceIndices.length !== vertexCount * stride)) {
      errors.push('weightLength')
    }
    for (let v = 0; v < vertexCount; v += 1) {
      let sum = 0
      for (let j = 0; j < stride; j += 1) {
        const w = weighted.weights[v * stride + j]!
        if (!Number.isFinite(w) || w < 0) errors.push('weightInvalid')
        if (w > 0) {
          sum += w
          const bone = weighted.boneIndices[v * stride + j]!
          if (!Number.isInteger(bone) || bone < 0) errors.push('weightBoneIndex')
        }
      }
      if (Math.abs(sum - 1) > 1e-3) errors.push('weightSum')
    }
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] }
}
