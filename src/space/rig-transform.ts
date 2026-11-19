import type { Mat3 } from '../math/mat3'
import { determinantMat3 } from '../math/mat3'
import type { WorldPoint } from './world-point'

/**
 * 写入角色→世界实例矩阵：`T(origin)`，只有平移。
 * 绕身视角和行走朝向都不进这张矩阵；解算换点走 `world-point`。
 * @param out 输出矩阵（float32）
 * @param origin 放置原点（世界，float64；写入时自然舍入）
 * @returns `out`
 */
export function setWorldFromRig(out: Mat3, origin: WorldPoint): Mat3 {
  out[0] = 1
  out[1] = 0
  out[2] = 0
  out[3] = 0
  out[4] = 1
  out[5] = 0
  out[6] = origin[0]!
  out[7] = origin[1]!
  out[8] = 1
  return out
}

/**
 * 写入世界→角色逆矩阵（闭式，不调用 `invertMat3`）：`T(−origin)`。
 * @param out 输出矩阵（float32）
 * @param origin 放置原点（世界，float64）
 * @returns `out`
 */
export function setRigFromWorld(out: Mat3, origin: WorldPoint): Mat3 {
  const ox = origin[0]!
  const oy = origin[1]!
  out[0] = 1
  out[1] = 0
  out[2] = 0
  out[3] = 0
  out[4] = 1
  out[5] = 0
  out[6] = -ox
  out[7] = -oy
  out[8] = 1
  return out
}

/**
 * 线性部分行列式符号：`1 | -1`；行列式为 0 或非有限时返回 `0`。
 * 用于读任意矩阵的绕向，包括宿主相机。
 * @param m 仿射矩阵
 * @returns `sign(det(m))`，退化时为 `0`
 */
export function orientationSign(m: Mat3): 1 | -1 | 0 {
  const d = determinantMat3(m)
  if (!Number.isFinite(d) || d === 0) return 0
  return d > 0 ? 1 : -1
}
