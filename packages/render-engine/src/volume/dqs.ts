/**
 * M14 DQS：对偶四元数（Dual Quaternion Skinning）。
 * 权威：docs/05-网格/skinning.md §6.4、docs/10-多视角/volume.md。
 *
 * 边界：
 * - 只服务 Volume 3D 路径；2D 核心不 import 本模块、不存四元数。
 * - 布局：Float64Array(8) = 实部 (qx,qy,qz,qw) + 对偶部 (dx,dy,dz,dw)。
 * - 矩阵一律按列主序 4x4 解释（与 gl-matrix / VolumeProxy.local 一致）。
 */

/** 对偶四元数：8 个分量，实部在前、对偶部在后。 */
export type DualQuat = Float64Array

const EPS = 1e-12

function identityDualQuat(): DualQuat {
  const d = new Float64Array(8)
  d[3] = 1 // 实部 w = 1
  return d
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

// ---------------------------------------------------------------------------
// 四元数小工具
// ---------------------------------------------------------------------------

/** 归一化四元数分量；零/非有限时退化为单位旋转。 */
function normalizeQuat(
  x: number,
  y: number,
  z: number,
  w: number,
): [number, number, number, number] {
  const len = Math.hypot(x, y, z, w)
  if (!Number.isFinite(len) || len < EPS) return [0, 0, 0, 1]
  const inv = 1 / len
  return [x * inv, y * inv, z * inv, w * inv]
}

/** 归一化三维向量；零/非有限时返回 null。 */
function normalizeVec3(x: number, y: number, z: number): [number, number, number] | null {
  const len = Math.hypot(x, y, z)
  if (!Number.isFinite(len) || len < EPS) return null
  const inv = 1 / len
  return [x * inv, y * inv, z * inv]
}

// ---------------------------------------------------------------------------
// 矩阵 → 对偶四元数
// ---------------------------------------------------------------------------

/**
 * 从列主序 4x4 矩阵构造刚体对偶四元数。
 * 含缩放/斜切时先做 Gram–Schmidt 正交化，返回近似刚体（不包含缩放）。
 */
export function dualQuatFromMat4(m: ArrayLike<number>): DualQuat {
  if (!m || m.length < 16) return identityDualQuat()

  // 列主序：m[0..2] 是局部 X 轴，m[4..6] 是 Y，m[8..10] 是 Z。
  let c0 = normalizeVec3(m[0]!, m[1]!, m[2]!)
  if (!c0) return identityDualQuat()
  let c1 = normalizeVec3(m[4]!, m[5]!, m[6]!)
  if (!c1) return identityDualQuat()

  // 去掉 c1 在 c0 上的投影，保证正交。
  const d01 = c0[0] * c1[0] + c0[1] * c1[1] + c0[2] * c1[2]
  c1 = normalizeVec3(
    c1[0] - c0[0] * d01,
    c1[1] - c0[1] * d01,
    c1[2] - c0[2] * d01,
  )
  if (!c1) return identityDualQuat()

  // c2 用叉积重建，保证右手系；缩放/剪切在这一步被丢弃。
  const c2: [number, number, number] = [
    c0[1] * c1[2] - c0[2] * c1[1],
    c0[2] * c1[0] - c0[0] * c1[2],
    c0[0] * c1[1] - c0[1] * c1[0],
  ]

  const m00 = c0[0]
  const m10 = c0[1]
  const m20 = c0[2]
  const m01 = c1[0]
  const m11 = c1[1]
  const m21 = c1[2]
  const m02 = c2[0]
  const m12 = c2[1]
  const m22 = c2[2]

  // 标准矩阵→四元数分支（这里索引是行/列展开后的 mRC）。
  const trace = m00 + m11 + m22
  let qx = 0
  let qy = 0
  let qz = 0
  let qw = 1
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2
    qw = 0.25 * s
    qx = (m21 - m12) / s
    qy = (m02 - m20) / s
    qz = (m10 - m01) / s
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    qw = (m21 - m12) / s
    qx = 0.25 * s
    qy = (m01 + m10) / s
    qz = (m02 + m20) / s
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    qw = (m02 - m20) / s
    qx = (m01 + m10) / s
    qy = 0.25 * s
    qz = (m12 + m21) / s
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2
    qw = (m10 - m01) / s
    qx = (m02 + m20) / s
    qy = (m12 + m21) / s
    qz = 0.25 * s
  }

  const [rx, ry, rz, rw] = normalizeQuat(qx, qy, qz, qw)
  const tx = finiteOr(m[12]!, 0)
  const ty = finiteOr(m[13]!, 0)
  const tz = finiteOr(m[14]!, 0)

  // 对偶部 d = 0.5 · t_quat · q，其中 t_quat = (tx,ty,tz,0)。
  const d = new Float64Array(8)
  d[0] = rx
  d[1] = ry
  d[2] = rz
  d[3] = rw
  d[4] = 0.5 * (tx * rw + ty * rz - tz * ry)
  d[5] = 0.5 * (-tx * rz + ty * rw + tz * rx)
  d[6] = 0.5 * (tx * ry - ty * rx + tz * rw)
  d[7] = 0.5 * (-tx * rx - ty * ry - tz * rz)
  return normalizeDualQuat(d)
}

/**
 * 归一化对偶四元数：先归一化实部，再让对偶部与实部正交。
 * 输入非法时返回单位对偶四元数（不抛异常，保证蒙皮不产生 NaN）。
 */
export function normalizeDualQuat(d: DualQuat): DualQuat {
  const out = new Float64Array(8)
  if (!d || d.length < 8) return identityDualQuat()
  const realLength = Math.hypot(d[0]!, d[1]!, d[2]!, d[3]!)
  if (!Number.isFinite(realLength) || realLength < EPS) return identityDualQuat()

  const inv = 1 / realLength
  for (let i = 0; i < 4; i += 1) out[i] = d[i]! * inv
  for (let i = 4; i < 8; i += 1) out[i] = d[i]! * inv

  // 单位实部下，对偶部应与实部正交。
  const dot =
    out[0]! * out[4]! + out[1]! * out[5]! + out[2]! * out[6]! + out[3]! * out[7]!
  for (let i = 4; i < 8; i += 1) out[i] = out[i]! - dot * out[i - 4]!

  if (!Array.from(out).every(Number.isFinite)) return identityDualQuat()
  return out
}

// ---------------------------------------------------------------------------
// 混合与变换
// ---------------------------------------------------------------------------

/**
 * 按权重线性混合对偶四元数，然后归一化。
 * 先处理半球符号，避免 q 与 −q 相互抵消（§6.4 的示意式）。
 */
export function blendDualQuats(items: readonly { q: DualQuat; w: number }[]): DualQuat {
  if (items.length === 0) return identityDualQuat()

  let totalWeight = 0
  let reference: DualQuat | null = null
  for (const item of items) {
    const w = item.w
    if (!Number.isFinite(w) || w <= 0 || !item.q || item.q.length < 8) continue
    totalWeight += w
    if (!reference) reference = item.q
  }
  if (!(totalWeight > EPS) || !reference) return identityDualQuat()

  const refX = reference[0]!
  const refY = reference[1]!
  const refZ = reference[2]!
  const refW = reference[3]!
  const acc = new Float64Array(8)
  for (const item of items) {
    const w = item.w
    if (!Number.isFinite(w) || w <= 0 || !item.q || item.q.length < 8) continue
    const dot =
      item.q[0]! * refX + item.q[1]! * refY + item.q[2]! * refZ + item.q[3]! * refW
    const sign = dot < 0 ? -1 : 1
    const scale = w * sign
    for (let i = 0; i < 8; i += 1) acc[i] = (acc[i] ?? 0) + (item.q[i] ?? 0) * scale
  }
  return normalizeDualQuat(acc)
}

/** 用实部四元数旋转向量：p' = p + 2·qw·(q×p) + 2·q×(q×p)。 */
function rotateVec3(
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  px: number,
  py: number,
  pz: number,
): [number, number, number] {
  const tx = 2 * (qy * pz - qz * py)
  const ty = 2 * (qz * px - qx * pz)
  const tz = 2 * (qx * py - qy * px)
  return [
    px + qw * tx + (qy * tz - qz * ty),
    py + qw * ty + (qz * tx - qx * tz),
    pz + qw * tz + (qx * ty - qy * tx),
  ]
}

/**
 * 用对偶四元数变换点：
 * t = 2·(qw·d_vec − dw·q_vec + q_vec×d_vec)，p' = rotate(q, p) + t。
 */
export function transformPointDqs(
  d: DualQuat,
  p: readonly [number, number, number],
): [number, number, number] {
  const qx = d[0]!
  const qy = d[1]!
  const qz = d[2]!
  const qw = d[3]!
  const dx = d[4]!
  const dy = d[5]!
  const dz = d[6]!
  const dw = d[7]!

  const tx = 2 * (qw * dx - dw * qx + (qy * dz - qz * dy))
  const ty = 2 * (qw * dy - dw * qy + (qz * dx - qx * dz))
  const tz = 2 * (qw * dz - dw * qz + (qx * dy - qy * dx))

  const rotated = rotateVec3(qx, qy, qz, qw, p[0], p[1], p[2])
  return [rotated[0] + tx, rotated[1] + ty, rotated[2] + tz]
}

// ---------------------------------------------------------------------------
// DQS 蒙皮
// ---------------------------------------------------------------------------

/**
 * 每顶点 4 影响的 DQS 蒙皮。
 * - points: 顶点位置 [x,y,z]×n
 * - boneMatrices: 骨矩阵 [16]×B（列主序）
 * - boneIndices: 每顶点 4 个骨下标
 * - weights: 每顶点 4 个权重（和≈1；无需严格归一，混合时按总权重归一）
 *
 * 只做 3D；权重全零或索引越界时保持原点，不产生 NaN。
 */
export function skinDqs(
  points: Float32Array,
  boneMatrices: Float32Array,
  boneIndices: Uint16Array,
  weights: Float32Array,
): Float32Array {
  const vertexCount = Math.floor(points.length / 3)
  const out = new Float32Array(points.length)
  const boneCount = Math.floor(boneMatrices.length / 16)

  const dualQuats: DualQuat[] = []
  for (let b = 0; b < boneCount; b += 1) {
    const offset = b * 16
    dualQuats.push(dualQuatFromMat4(boneMatrices.subarray(offset, offset + 16)))
  }

  for (let v = 0; v < vertexCount; v += 1) {
    const pOffset = v * 3
    const px = points[pOffset]!
    const py = points[pOffset + 1]!
    const pz = points[pOffset + 2]!
    const iOffset = v * 4

    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
      out[pOffset] = 0
      out[pOffset + 1] = 0
      out[pOffset + 2] = 0
      continue
    }

    const items: { q: DualQuat; w: number }[] = []
    for (let k = 0; k < 4; k += 1) {
      const bone = boneIndices[iOffset + k]
      const weight = weights[iOffset + k]
      if (bone === undefined || weight === undefined) continue
      if (bone < 0 || bone >= boneCount) continue
      if (!Number.isFinite(weight) || weight <= 0) continue
      items.push({ q: dualQuats[bone]!, w: weight })
    }

    if (items.length === 0) {
      out[pOffset] = px
      out[pOffset + 1] = py
      out[pOffset + 2] = pz
      continue
    }

    const blended = blendDualQuats(items)
    const [x, y, z] = transformPointDqs(blended, [px, py, pz])
    out[pOffset] = Number.isFinite(x) ? x : 0
    out[pOffset + 1] = Number.isFinite(y) ? y : 0
    out[pOffset + 2] = Number.isFinite(z) ? z : 0
  }

  return out
}
