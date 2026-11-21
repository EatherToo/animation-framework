/**
 * core2d 数学基元：7 通道局部变换、6 分量 2D 仿射、父级继承、角度约定。
 * 权威公式：docs/03-骨架与姿态.md D1、docs/02-数学/transforms.md §3-6、
 * docs/03-骨架/inherit.md §3-4。
 *
 * 矩阵按列向量约定存为 [a, b, c, d, tx, ty]：
 *   X 轴 = (a, b)，Y 轴 = (c, d)，平移 = (tx, ty)。
 */

/** 局部变换 7 通道。角度恒为弧度，逆时针为正；角度内部保持连续值。 */
export type LocalTransform = {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
  shearX: number
  shearY: number
}

export type InheritMode =
  | 'normal'
  | 'onlyTranslation'
  | 'noRotationOrReflection'
  | 'noScale'
  | 'noScaleOrReflection'

/** 6 分量仿射矩阵。 */
export type Affine = Float64Array

export const CH_X = 0
export const CH_Y = 1
export const CH_ROT = 2
export const CH_SX = 3
export const CH_SY = 4
export const CH_SHX = 5
export const CH_SHY = 6
export const POSE_STRIDE = 7
export const WORLD_STRIDE = 6

const TAU = Math.PI * 2
const EPS = 1e-12

export function createAffine(): Affine {
  const out = new Float64Array(WORLD_STRIDE)
  out[0] = 1
  out[3] = 1
  return out
}

/** 把局部 7 通道按 T·R·Shear·S 展开成仿射矩阵。 */
export function composeAffine(t: LocalTransform, out: Affine = createAffine()): Affine {
  const c = Math.cos(t.rotation)
  const s = Math.sin(t.rotation)
  const sx = t.scaleX
  const sy = t.scaleY
  out[0] = sx * (c - s * t.shearY)
  out[1] = sx * (s + c * t.shearY)
  out[2] = sy * (c * t.shearX - s)
  out[3] = sy * (s * t.shearX + c)
  out[4] = t.x
  out[5] = t.y
  return out
}

/** 从 Pose.local 的 7 通道切片组合矩阵。 */
export function composeAffineFromLocal(
  local: ArrayLike<number>,
  bone: number,
  out: Affine = createAffine(),
): Affine {
  const i = bone * POSE_STRIDE
  const c = Math.cos(local[i + CH_ROT]!)
  const s = Math.sin(local[i + CH_ROT]!)
  const sx = local[i + CH_SX]!
  const sy = local[i + CH_SY]!
  const shx = local[i + CH_SHX]!
  const shy = local[i + CH_SHY]!
  out[0] = sx * (c - s * shy)
  out[1] = sx * (s + c * shy)
  out[2] = sy * (c * shx - s)
  out[3] = sy * (s * shx + c)
  out[4] = local[i + CH_X]!
  out[5] = local[i + CH_Y]!
  return out
}

/** out = a · b（列向量下 b 先作用）。支持 out 与输入共用缓冲。 */
export function multiplyAffine(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  out: Affine = createAffine(),
): Affine {
  const a0 = a[0]!, a1 = a[1]!, a2 = a[2]!, a3 = a[3]!, a4 = a[4]!, a5 = a[5]!
  const b0 = b[0]!, b1 = b[1]!, b2 = b[2]!, b3 = b[3]!, b4 = b[4]!, b5 = b[5]!
  out[0] = a0 * b0 + a2 * b1
  out[1] = a1 * b0 + a3 * b1
  out[2] = a0 * b2 + a2 * b3
  out[3] = a1 * b2 + a3 * b3
  out[4] = a0 * b4 + a2 * b5 + a4
  out[5] = a1 * b4 + a3 * b5 + a5
  return out
}

export function detAffine(m: ArrayLike<number>): number {
  return m[0]! * m[3]! - m[1]! * m[2]!
}

/** 不可逆（|det| < 1e-12 或非有限）时返回 null，且不写 out。 */
export function invertAffine(m: ArrayLike<number>, out: Affine = createAffine()): Affine | null {
  for (let i = 0; i < WORLD_STRIDE; i += 1) {
    if (!Number.isFinite(m[i]!)) return null
  }
  const det = detAffine(m)
  if (!Number.isFinite(det) || Math.abs(det) < EPS) return null
  const inv = 1 / det
  const a = m[0]!, b = m[1]!, c = m[2]!, d = m[3]!, tx = m[4]!, ty = m[5]!
  out[0] = d * inv
  out[1] = -b * inv
  out[2] = -c * inv
  out[3] = a * inv
  out[4] = (c * ty - d * tx) * inv
  out[5] = (b * tx - a * ty) * inv
  return out
}

export function transformAffinePoint(m: ArrayLike<number>, x: number, y: number): [number, number] {
  return [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!]
}

/** 把变换结果写入 Float32 缓冲的指定偏移，避免每顶点分配。 */
export function transformAffineInto(
  out: Float32Array,
  offset: number,
  m: ArrayLike<number>,
  x: number,
  y: number,
): void {
  out[offset] = m[0]! * x + m[2]! * y + m[4]!
  out[offset + 1] = m[1]! * x + m[3]! * y + m[5]!
}

/**
 * 按 inherit 模式从父世界矩阵构造 P'。P' 只依赖父矩阵与模式。
 * 零长度轴使用 (1,0)/(0,1) 回退。
 */
export function parentBasis(mode: InheritMode, p: ArrayLike<number>, out: Affine = createAffine()): Affine {
  const tx = p[4]!
  const ty = p[5]!
  if (mode === 'normal') {
    for (let i = 0; i < WORLD_STRIDE; i += 1) out[i] = p[i]!
    return out
  }
  if (mode === 'onlyTranslation') {
    out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 1
  } else if (mode === 'noRotationOrReflection') {
    out[0] = Math.hypot(p[0]!, p[1]!)
    out[1] = 0
    out[2] = 0
    out[3] = Math.hypot(p[2]!, p[3]!)
  } else if (mode === 'noScale' || mode === 'noScaleOrReflection') {
    const lx = Math.hypot(p[0]!, p[1]!)
    const ly = Math.hypot(p[2]!, p[3]!)
    const nx = lx <= EPS ? 1 : p[0]! / lx
    const ny = lx <= EPS ? 0 : p[1]! / lx
    let mx = ly <= EPS ? 0 : p[2]! / ly
    let my = ly <= EPS ? 1 : p[3]! / ly
    if (mode === 'noScaleOrReflection' && nx * my - ny * mx < 0) {
      mx = -mx
      my = -my
    }
    out[0] = nx; out[1] = ny; out[2] = mx; out[3] = my
  } else {
    throw new Error(`inherit.mode: ${String(mode)}`)
  }
  out[4] = tx
  out[5] = ty
  return out
}

/** 归一化到 [-π, π)；非有限值原样返回。 */
export function normalizeAngle(rad: number): number {
  if (!Number.isFinite(rad)) return rad
  const r = ((rad + Math.PI) % TAU + TAU) % TAU - Math.PI
  return r === -Math.PI ? -Math.PI : r
}

/** 最短有符号角差 `to - from`，落在 [-π, π)。 */
export function angleDelta(from: number, to: number): number {
  return normalizeAngle(to - from)
}

/**
 * 从仿射矩阵近似分解 7 通道。分解不唯一：当 shearY ≠ 0 时旋转角与 shearY
 * 无法仅由矩阵唯一确定；此实现固定 shearY = 0，导入器优先保留源字段。
 */
export function decomposeAffine(m: ArrayLike<number>): LocalTransform {
  const sx = Math.hypot(m[0]!, m[1]!)
  const rotation = Math.atan2(m[1]!, m[0]!)
  if (sx <= EPS) {
    throw new Error('affine.decompose: singular')
  }
  const c = Math.cos(rotation)
  const s = Math.sin(rotation)
  const sy = -s * m[2]! + c * m[3]!
  if (Math.abs(sy) <= EPS) {
    throw new Error('affine.decompose: singular')
  }
  return {
    x: m[4]!,
    y: m[5]!,
    rotation,
    scaleX: sx,
    scaleY: sy,
    shearX: (c * m[2]! + s * m[3]!) / sy,
    shearY: 0,
  }
}
