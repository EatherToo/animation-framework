import { normalizeAngle } from '../math/angle'
import type { Mat3 } from '../math/mat3'
import {
  claimFill,
  type Fill,
  type Part,
  type PartSetBuilder,
  type RigidPart,
} from './set'

/** 追加刚性零件时的输入。 */
export type RigidSpec = {
  readonly id: string
  readonly bone: number
  readonly translationX: number
  readonly translationY: number
  readonly rotation: number
  readonly fill: Fill
}

/**
 * 追加刚性零件并返回其在集合中的下标。
 * 失败时抛出 `Error`，建造器保持失败前的内容。
 * @param builder 建造器
 * @param spec 骨头下标、局部平移与旋转、纯色
 */
export function addRigid(builder: PartSetBuilder, spec: RigidSpec): number {
  const fill = claimFill(builder, spec.id, spec.fill)
  const { bone, translationX, translationY, rotation } = spec
  const boneCount = builder.skeleton.boneCount
  if (!Number.isInteger(bone) || bone < 0 || bone >= boneCount) {
    throw new Error('bone')
  }
  if (!Number.isFinite(translationX) || !Number.isFinite(translationY)) {
    throw new Error('translation')
  }
  if (!Number.isFinite(rotation)) throw new Error('rotation')

  const part: RigidPart = {
    kind: 'rigid',
    id: spec.id,
    bone,
    translationX,
    translationY,
    rotation: normalizeAngle(rotation),
    fill,
  }
  const index = builder.parts.length
  builder.parts.push(part)
  return index
}

/**
 * 写出 `boneFromPart = T(translation) · R(rotation)`。
 * 只接受刚性零件；种类不符时抛出 `Error` 且不写 `out`。
 * @param out 输出矩阵
 * @param part 刚性零件
 * @returns `out`
 */
export function setBoneFromPart(out: Mat3, part: Part): Mat3 {
  if (part.kind !== 'rigid') throw new Error('kind')
  const c = Math.cos(part.rotation)
  const s = Math.sin(part.rotation)
  out[0] = c
  out[1] = s
  out[2] = 0
  out[3] = -s
  out[4] = c
  out[5] = 0
  out[6] = part.translationX
  out[7] = part.translationY
  out[8] = 1
  return out
}
