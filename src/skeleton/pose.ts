import { normalizeAngle } from '../math/angle'
import type { Vec2 } from '../math/vec2'
import type { Skeleton } from './skeleton'

/** 每根骨头在姿态缓冲中占用的分量数：`tx, ty, rotation`。 */
export const POSE_STRIDE = 3

/**
 * 一份实例上、相对绑定的当前偏移。
 * `data` 步长 {@link POSE_STRIDE}。
 */
export type Pose = {
  readonly skeleton: Skeleton
  readonly data: Float32Array
}

/**
 * 分配全零姿态缓冲。只在初始化时调用。
 * @param skeleton 所属骨骼
 */
export function createPose(skeleton: Skeleton): Pose {
  return {
    skeleton,
    data: new Float32Array(skeleton.boneCount * POSE_STRIDE),
  }
}

/**
 * 写入偏移平移，不改旋转。
 * @param pose 姿态
 * @param bone 骨头下标
 * @param x 沿绑定骨轴的平移 x（米）
 * @param y 沿绑定骨轴的平移 y（米）
 */
export function setPoseTranslation(
  pose: Pose,
  bone: number,
  x: number,
  y: number,
): void {
  const i = bone * POSE_STRIDE
  pose.data[i] = x
  pose.data[i + 1] = y
}

/**
 * 写入偏移旋转（折到 (-π, π]），不改平移。
 * @param pose 姿态
 * @param bone 骨头下标
 * @param rotation 旋转角（弧度）
 */
export function setPoseRotation(pose: Pose, bone: number, rotation: number): void {
  pose.data[bone * POSE_STRIDE + 2] = normalizeAngle(rotation)
}

/**
 * 写出偏移平移到 `out`。
 * @param out 输出缓冲
 * @param pose 姿态
 * @param bone 骨头下标
 * @returns `out`
 */
export function poseTranslation(out: Vec2, pose: Pose, bone: number): Vec2 {
  const i = bone * POSE_STRIDE
  out[0] = pose.data[i]!
  out[1] = pose.data[i + 1]!
  return out
}

/**
 * 读出偏移旋转（弧度）。
 * @param pose 姿态
 * @param bone 骨头下标
 */
export function poseRotation(pose: Pose, bone: number): number {
  return pose.data[bone * POSE_STRIDE + 2]!
}

/**
 * 全部分量填精确 `0`。
 * @param pose 姿态
 */
export function zeroPose(pose: Pose): void {
  pose.data.fill(0)
}

/**
 * 把 `src.data` 整段复制到 `out.data`。
 * 要求两份 `Pose` 的 `skeleton` 是同一个对象。
 * @param out 目标姿态
 * @param src 源姿态
 * @returns `out`
 */
export function copyPose(out: Pose, src: Pose): Pose {
  out.data.set(src.data)
  return out
}
