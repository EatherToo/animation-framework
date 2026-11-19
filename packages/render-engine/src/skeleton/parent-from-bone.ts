import type { Mat3 } from '../math/mat3'
import type { Pose } from './pose'
import { POSE_STRIDE } from './pose'
import type { Skeleton } from './skeleton'

/**
 * 写入 `parentFromBone = T(bt + R(br)·pt) · R(br + pr)`。
 */
function writeParentFromBone(
  out: Mat3,
  btx: number,
  bty: number,
  br: number,
  ptx: number,
  pty: number,
  pr: number,
): Mat3 {
  const cb = Math.cos(br)
  const sb = Math.sin(br)
  const rot = br + pr
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  out[0] = c
  out[1] = s
  out[2] = 0
  out[3] = -s
  out[4] = c
  out[5] = 0
  out[6] = btx + cb * ptx - sb * pty
  out[7] = bty + sb * ptx + cb * pty
  out[8] = 1
  return out
}

/**
 * 把一根骨头的绑定与当前偏移写成 `parentFromBone`。
 * @param out 输出矩阵
 * @param skeleton 骨骼
 * @param pose 姿态
 * @param bone 骨头下标
 * @returns `out`
 */
export function setParentFromBone(
  out: Mat3,
  skeleton: Skeleton,
  pose: Pose,
  bone: number,
): Mat3 {
  const i2 = bone * 2
  const i3 = bone * POSE_STRIDE
  return writeParentFromBone(
    out,
    skeleton.bindTranslation[i2]!,
    skeleton.bindTranslation[i2 + 1]!,
    skeleton.bindRotation[bone]!,
    pose.data[i3]!,
    pose.data[i3 + 1]!,
    pose.data[i3 + 2]!,
  )
}

/**
 * 只写绑定（偏移按全零）得到的 `parentFromBone`。
 * @param out 输出矩阵
 * @param skeleton 骨骼
 * @param bone 骨头下标
 * @returns `out`
 */
export function setBindParentFromBone(
  out: Mat3,
  skeleton: Skeleton,
  bone: number,
): Mat3 {
  const i2 = bone * 2
  return writeParentFromBone(
    out,
    skeleton.bindTranslation[i2]!,
    skeleton.bindTranslation[i2 + 1]!,
    skeleton.bindRotation[bone]!,
    0,
    0,
    0,
  )
}
