import {
  poseRotation,
  poseSwing,
  poseTwist,
  type Pose,
} from '../skeleton/pose'
import { RIGID_STRIDE } from '../skeleton/rigid'
import { boneName } from '../skeleton/skeleton'

/** 关节外形补偿参数。 */
export type Correction = {
  readonly enabled: boolean
  /** 扭转糖纸补偿增益。关闭时忽略。 */
  readonly twistGain: number
  /** 大摆 / 大屈糖纸补偿增益。关闭时忽略。 */
  readonly bendGain: number
}

/** 开启求值时需要的绑定与姿态上下文。 */
export type CorrectionContext = {
  readonly bones: readonly number[]
  readonly weights: Float32Array
  readonly influences: number
  readonly bindRig: Float32Array
  readonly pose: Pose
}

export type CorrectionOptions = {
  readonly enabled?: boolean
  readonly twistGain?: number
  readonly bendGain?: number
}

/**
 * 创建修正数据。默认开启扭转与弯曲补偿。
 */
export function createCorrection(options: CorrectionOptions = {}): Correction {
  return {
    enabled: options.enabled ?? true,
    twistGain: options.twistGain ?? 0.35,
    bendGain: options.bendGain ?? 0.35,
  }
}

/**
 * 把 `positions` 抄到 `out`；开启时再做扭转与弯曲径向外推。
 * @param out 输出
 * @param positions 绑定顶点
 * @param correction 修正数据
 * @param context 开启时必填
 * @returns `out`
 */
export function applyCorrection(
  out: Float32Array,
  positions: Float32Array,
  correction: Correction,
  context?: CorrectionContext,
): Float32Array {
  if (out.length !== positions.length) throw new Error('out')
  out.set(positions)
  if (!correction.enabled) return out
  if (context === undefined) throw new Error('correction')
  pushRadial(out, positions, correction.twistGain, context, twistAngle)
  pushRadial(out, positions, correction.bendGain, context, bendAngle)
  return out
}

function twistAngle(pose: Pose, bone: number): number {
  return Math.abs(poseTwist(pose, bone))
}

function bendAngle(pose: Pose, bone: number): number {
  return Math.hypot(poseSwing(pose, bone), poseRotation(pose, bone))
}

function pushRadial(
  out: Float32Array,
  positions: Float32Array,
  gain: number,
  context: CorrectionContext,
  angleOf: (pose: Pose, bone: number) => number,
): void {
  if (gain === 0) return
  const { bones, weights, influences, bindRig, pose } = context
  const skeleton = pose.skeleton
  const vertexCount = positions.length / 3
  for (let v = 0; v < vertexCount; v += 1) {
    let bestBone = -1
    let bestWeight = 0
    let bestPhi = 0
    for (let i = 0; i < influences; i += 1) {
      const bone = bones[i]!
      if (!isCorrectionBone(boneName(skeleton, bone))) continue
      const w = weights[v * influences + i]!
      if (w <= 0 || w >= 1) continue
      const phi = angleOf(pose, bone)
      if (phi > bestPhi) {
        bestPhi = phi
        bestBone = bone
        bestWeight = w
      }
    }
    if (bestBone < 0 || bestPhi === 0) continue
    const x = positions[v * 3]!
    const y = positions[v * 3 + 1]!
    const z = positions[v * 3 + 2]!
    const axis = bindAxis(bindRig, bestBone)
    const dx = x - axis.ox
    const dy = y - axis.oy
    const dz = z - axis.oz
    const along = dx * axis.ax + dy * axis.ay + dz * axis.az
    const px = dx - axis.ax * along
    const py = dy - axis.ay * along
    const pz = dz - axis.az * along
    const r = Math.hypot(px, py, pz)
    if (r < 1e-12) continue
    const blend = 4 * bestWeight * (1 - bestWeight)
    const push = r * gain * (1 - Math.cos(bestPhi)) * blend
    const inv = 1 / r
    out[v * 3] = out[v * 3]! + px * inv * push
    out[v * 3 + 1] = out[v * 3 + 1]! + py * inv * push
    out[v * 3 + 2] = out[v * 3 + 2]! + pz * inv * push
  }
}

function isCorrectionBone(name: string): boolean {
  return (
    name.startsWith('upperArm') ||
    name.startsWith('lowerArm') ||
    name.startsWith('thigh') ||
    name.startsWith('shin')
  )
}

function bindAxis(
  bindRig: Float32Array,
  bone: number,
): { ox: number; oy: number; oz: number; ax: number; ay: number; az: number } {
  const base = bone * RIGID_STRIDE
  return {
    ox: bindRig[base + 9]!,
    oy: bindRig[base + 10]!,
    oz: bindRig[base + 11]!,
    ax: bindRig[base]!,
    ay: bindRig[base + 1]!,
    az: bindRig[base + 2]!,
  }
}
