import { parentOf } from '../skeleton/skeleton'
import {
  claimFill,
  type Fill,
  type PartSetBuilder,
  type SkinnedPart,
} from './set'

/** 追加蒙皮部件时的输入。`bones` 从近端排到远端。 */
export type SkinnedSpec = {
  readonly id: string
  readonly bones: readonly number[]
  readonly fill: Fill
}

/**
 * 追加蒙皮部件并返回其在集合中的下标。
 * 失败时抛出 `Error`，建造器保持失败前的内容。
 * @param builder 建造器
 * @param spec 父子骨链与纯色
 */
export function addSkinned(builder: PartSetBuilder, spec: SkinnedSpec): number {
  const fill = claimFill(builder, spec.id, spec.fill)
  const source = spec.bones
  if (source === undefined || source.length < 2) throw new Error('bones')

  const boneCount = builder.skeleton.boneCount
  const bones: number[] = []
  for (let i = 0; i < source.length; i += 1) {
    const bone = source[i]
    if (!Number.isInteger(bone) || bone! < 0 || bone! >= boneCount) {
      throw new Error('bones')
    }
    if (i > 0 && parentOf(builder.skeleton, bone!) !== source[i - 1]) {
      throw new Error('bones')
    }
    bones.push(bone!)
  }

  const part: SkinnedPart = {
    kind: 'skinned',
    id: spec.id,
    bones,
    fill,
  }
  const index = builder.parts.length
  builder.parts.push(part)
  return index
}
