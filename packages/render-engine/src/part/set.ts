import type { Skeleton } from '../skeleton/skeleton'

/** `findPart` 找不到时的下标。 */
export const PART_NONE = -1

/** 一份部件集合的最大件数。 */
export const MAX_PARTS = 256

/** 不透明纯色，三个分量都在 [0, 1]。 */
export type Fill = {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** 部件种类：跟一根骨头，或沿一条父子骨链。 */
export type PartKind = 'rigid' | 'skinned'

/**
 * 刚性零件。`translation` 与 `rotation` 是零件相对骨头的局部变换。
 */
export type RigidPart = {
  readonly kind: 'rigid'
  readonly id: string
  readonly bone: number
  readonly translationX: number
  readonly translationY: number
  readonly rotation: number
  readonly fill: Fill
}

/**
 * 蒙皮部件。`bones` 从近端排到远端，后一根的父下标是前一根。
 */
export type SkinnedPart = {
  readonly kind: 'skinned'
  readonly id: string
  readonly bones: readonly number[]
  readonly fill: Fill
}

/** 集合中的一件可画物体。 */
export type Part = RigidPart | SkinnedPart

/**
 * 已完成、不可再增长的部件集合。
 * `skeleton` 与建造时传入的是同一引用。
 */
export type PartSet = {
  readonly skeleton: Skeleton
  readonly parts: readonly Part[]
}

/**
 * 建造期草稿。字段仅供本模块写入；调用方不要读。
 */
export type PartSetBuilder = {
  finished: boolean
  skeleton: Skeleton
  parts: Part[]
}

/**
 * 创建空建造器，绑定到一棵已完成的骨架。不复制骨架。
 * @param skeleton 骨头下标所参照的骨架
 */
export function createPartSetBuilder(skeleton: Skeleton): PartSetBuilder {
  return {
    finished: false,
    skeleton,
    parts: [],
  }
}

/**
 * 复制出不可再增长的 {@link PartSet}。
 * 空集合或已经完成时抛出 `Error`。
 * @param builder 建造器
 */
export function finishPartSet(builder: PartSetBuilder): PartSet {
  if (builder.finished) throw new Error('part set already finished')
  if (builder.parts.length === 0) throw new Error('empty part set')
  builder.finished = true
  return {
    skeleton: builder.skeleton,
    parts: builder.parts.slice(),
  }
}

/**
 * 件数。
 * @param set 部件集合
 */
export function partCount(set: PartSet): number {
  return set.parts.length
}

/**
 * 按下标读取。下标非法时抛出 `Error`，消息为 `part`。
 * @param set 部件集合
 * @param index 登记顺序中的下标
 */
export function partAt(set: PartSet, index: number): Part {
  if (!Number.isInteger(index) || index < 0 || index >= set.parts.length) {
    throw new Error('part')
  }
  return set.parts[index]!
}

/**
 * 按 `id` 精确查找下标；找不到返回 {@link PART_NONE}。
 * @param set 部件集合
 * @param id 部件名字
 */
export function findPart(set: PartSet, id: string): number {
  for (let i = 0; i < set.parts.length; i += 1) {
    if (set.parts[i]!.id === id) return i
  }
  return PART_NONE
}

/**
 * 追加前的集合层检查，并复制 `fill`。
 * 失败时不修改建造器。供同目录的追加函数使用，不从模块入口再导出。
 * @param builder 建造器
 * @param id 部件名字
 * @param fill 纯色
 */
export function claimFill(builder: PartSetBuilder, id: string, fill: Fill): Fill {
  if (builder.finished) throw new Error('part set already finished')
  if (builder.parts.length >= MAX_PARTS) throw new Error('too many parts')
  if (typeof id !== 'string' || id.length === 0) throw new Error('id')
  for (let i = 0; i < builder.parts.length; i += 1) {
    if (builder.parts[i]!.id === id) throw new Error('duplicate part id')
  }
  if (
    fill === undefined ||
    fill === null ||
    typeof fill !== 'object' ||
    !inUnit(fill.r) ||
    !inUnit(fill.g) ||
    !inUnit(fill.b)
  ) {
    throw new Error('fill')
  }
  return { r: fill.r, g: fill.g, b: fill.b }
}

function inUnit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1
}
