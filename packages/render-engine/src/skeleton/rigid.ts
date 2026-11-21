import type { Skeleton } from './skeleton'
import { POSE_STRIDE, type Pose } from './pose'

/** 一根骨头的刚体：列主序 3×3 旋转，然后是平移 `x, y, z`。 */
export const RIGID_STRIDE = 12

/**
 * 把绑定和三轴偏移写成父空间刚体。
 * `swing`、`twist` 先乘符号。符号为 0 时该轴不转。
 * `twistScale` 把通道扭转角缩到 `[0, 1]` 份额（蒙皮沿骨分布用）。
 * 两个角都是 0 时，旋转退回绕 `+Z`，平移 `x, y` 与矢状公式一致，`z` 是绑定横向。
 * @param out 长度 {@link RIGID_STRIDE}
 * @param skeleton 绑定
 * @param pose 当前偏移
 * @param bone 骨头下标
 * @param swingSign 乘到 `swing` 上
 * @param twistSign 乘到 `twist` 上
 * @param twistScale 乘到已带符号的扭转角上，默认 `1`
 */
export function setRigidParentFromBone(
  out: Float32Array,
  skeleton: Skeleton,
  pose: Pose,
  bone: number,
  swingSign: -1 | 0 | 1,
  twistSign: -1 | 0 | 1,
  twistScale = 1,
): void {
  const poseIndex = bone * POSE_STRIDE
  const translation = bone * 2
  const ptx = pose.data[poseIndex]!
  const pty = pose.data[poseIndex + 1]!
  const rotation = pose.data[poseIndex + 2]!
  const swing = pose.data[poseIndex + 3]!
  const twist = pose.data[poseIndex + 4]!
  const bindRotation = skeleton.bindRotation[bone]!
  const btx = skeleton.bindTranslation[translation]!
  const bty = skeleton.bindTranslation[translation + 1]!
  const a = swingSign * (skeleton.bindSwing[bone]! + swing)
  const b = twistSign * twist * twistScale
  const g = bindRotation + rotation
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const cb = Math.cos(b)
  const sb = Math.sin(b)
  const cg = Math.cos(g)
  const sg = Math.sin(g)
  const bindCos = Math.cos(bindRotation)
  const bindSin = Math.sin(bindRotation)
  out[0] = cg * ca
  out[1] = sg * ca
  out[2] = -sa
  out[3] = cg * sa * sb - sg * cb
  out[4] = sg * sa * sb + cg * cb
  out[5] = ca * sb
  out[6] = cg * sa * cb + sg * sb
  out[7] = sg * sa * cb - cg * sb
  out[8] = ca * cb
  out[9] = btx + bindCos * ptx - bindSin * pty
  out[10] = bty + bindSin * ptx + bindCos * pty
  out[11] = skeleton.bindLateral[bone]!
}

/**
 * `out = parent · local`。`out` 可以与其中一个输入是同一块缓冲。
 * @param out 长度 {@link RIGID_STRIDE}
 * @param parent 父刚体
 * @param local 子刚体
 */
export function multiplyRigid(out: Float32Array, parent: Float32Array, local: Float32Array): void {
  const p0 = parent[0]!
  const p1 = parent[1]!
  const p2 = parent[2]!
  const p3 = parent[3]!
  const p4 = parent[4]!
  const p5 = parent[5]!
  const p6 = parent[6]!
  const p7 = parent[7]!
  const p8 = parent[8]!
  const ptx = parent[9]!
  const pty = parent[10]!
  const ptz = parent[11]!
  const l0 = local[0]!
  const l1 = local[1]!
  const l2 = local[2]!
  const l3 = local[3]!
  const l4 = local[4]!
  const l5 = local[5]!
  const l6 = local[6]!
  const l7 = local[7]!
  const l8 = local[8]!
  const lx = local[9]!
  const ly = local[10]!
  const lz = local[11]!
  out[0] = p0 * l0 + p3 * l1 + p6 * l2
  out[1] = p1 * l0 + p4 * l1 + p7 * l2
  out[2] = p2 * l0 + p5 * l1 + p8 * l2
  out[3] = p0 * l3 + p3 * l4 + p6 * l5
  out[4] = p1 * l3 + p4 * l4 + p7 * l5
  out[5] = p2 * l3 + p5 * l4 + p8 * l5
  out[6] = p0 * l6 + p3 * l7 + p6 * l8
  out[7] = p1 * l6 + p4 * l7 + p7 * l8
  out[8] = p2 * l6 + p5 * l7 + p8 * l8
  out[9] = p0 * lx + p3 * ly + p6 * lz + ptx
  out[10] = p1 * lx + p4 * ly + p7 * lz + pty
  out[11] = p2 * lx + p5 * ly + p8 * lz + ptz
}
