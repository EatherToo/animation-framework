import { normalizeAngle } from '../math/angle'
import type { Vec2 } from '../math/vec2'

/** 根骨的父下标：没有父骨，父空间即角色空间。 */
export const PARENT_NONE = -1

/** 单棵骨架允许的最大骨头数。 */
export const MAX_BONES = 256

/** 建造时写入一根骨头的绑定规格。 */
export type BoneSpec = {
  readonly name: string
  readonly parent: number
  readonly translationX: number
  readonly translationY: number
  /** 相对父骨的横向偏移，米。角色左侧为正。不进入 parentFromBone。 */
  readonly translationZ: number
  readonly rotation: number
  /** 绑定侧摆，弧度。与姿态侧摆同一通道，左右由关节符号决定。默认 0。 */
  readonly swing?: number
  readonly length: number
}

/**
 * 已完成、绑定不可再经本模块改写的骨骼树。
 * `bindTranslation` 步长 2：下标 `2i`、`2i+1` 为第 `i` 根在父空间矢状面里的 `(x, y)`。
 * `bindLateral[i]` 是第 `i` 根相对父骨的横向偏移。
 */
export type Skeleton = {
  readonly boneCount: number
  readonly name: readonly string[]
  readonly parent: Int16Array
  readonly bindTranslation: Float32Array
  readonly bindLateral: Float32Array
  /** 每根骨头的绑定侧摆，弧度；默认 0。只有三轴刚体路径会用到它。 */
  readonly bindSwing: Float32Array
  readonly bindRotation: Float32Array
  readonly bindLength: Float32Array
}

/**
 * 建造期草稿。字段仅供本模块写入；调用方不要读。
 */
export type SkeletonBuilder = {
  finished: boolean
  count: number
  names: string[]
  parent: number[]
  translationX: number[]
  translationY: number[]
  translationZ: number[]
  rotation: number[]
  swing: number[]
  length: number[]
}

/**
 * 创建空建造器。只在初始化时调用。
 */
export function createSkeletonBuilder(): SkeletonBuilder {
  return {
    finished: false,
    count: 0,
    names: [],
    parent: [],
    translationX: [],
    translationY: [],
    translationZ: [],
    rotation: [],
    swing: [],
    length: [],
  }
}

/**
 * 追加一根骨头并返回其下标。
 * 失败时抛出 `Error`，建造器保持失败前的内容。
 * @param builder 建造器
 * @param spec 绑定规格
 */
export function addBone(builder: SkeletonBuilder, spec: BoneSpec): number {
  if (builder.finished) throw new Error('skeleton already finished')
  if (builder.count >= MAX_BONES) throw new Error('too many bones')
  if (typeof spec.name !== 'string' || spec.name.length === 0) {
    throw new Error('bone name')
  }
  if (builder.names.includes(spec.name)) throw new Error('duplicate bone name')

  const index = builder.count
  if (index === 0) {
    if (spec.parent !== PARENT_NONE) throw new Error('root parent')
  } else if (
    !Number.isInteger(spec.parent) ||
    spec.parent < 0 ||
    spec.parent >= index
  ) {
    throw new Error('parent')
  }

  const { translationX: tx, translationY: ty, translationZ: tz, rotation, length } = spec
  const swing = spec.swing ?? 0
  if (
    !Number.isFinite(tx) ||
    !Number.isFinite(ty) ||
    !Number.isFinite(tz) ||
    !Number.isFinite(rotation) ||
    !Number.isFinite(swing) ||
    !Number.isFinite(length) ||
    length < 0
  ) {
    throw new Error('bind')
  }

  builder.names.push(spec.name)
  builder.parent.push(spec.parent)
  builder.translationX.push(tx)
  builder.translationY.push(ty)
  builder.translationZ.push(tz)
  builder.rotation.push(normalizeAngle(rotation))
  builder.swing.push(swing)
  builder.length.push(length === 0 ? 0 : length)
  builder.count = index + 1
  return index
}

/**
 * 复制出不可再增长的 {@link Skeleton}。
 * 空树或已经完成时抛出 `Error`。
 * @param builder 建造器
 */
export function finishSkeleton(builder: SkeletonBuilder): Skeleton {
  if (builder.finished) throw new Error('skeleton already finished')
  if (builder.count === 0) throw new Error('empty skeleton')

  const boneCount = builder.count
  const name = builder.names.slice()
  const parent = new Int16Array(boneCount)
  const bindTranslation = new Float32Array(boneCount * 2)
  const bindLateral = new Float32Array(boneCount)
  const bindSwing = new Float32Array(boneCount)
  const bindRotation = new Float32Array(boneCount)
  const bindLength = new Float32Array(boneCount)

  for (let i = 0; i < boneCount; i += 1) {
    parent[i] = builder.parent[i]!
    bindTranslation[i * 2] = builder.translationX[i]!
    bindTranslation[i * 2 + 1] = builder.translationY[i]!
    bindLateral[i] = builder.translationZ[i]!
    bindSwing[i] = builder.swing[i]!
    bindRotation[i] = builder.rotation[i]!
    bindLength[i] = builder.length[i]!
  }

  builder.finished = true

  return {
    boneCount,
    name,
    parent,
    bindTranslation,
    bindLateral,
    bindSwing,
    bindRotation,
    bindLength,
  }
}

/**
 * 父下标；根返回 {@link PARENT_NONE}。
 * @param skeleton 骨骼
 * @param bone 骨头下标
 */
export function parentOf(skeleton: Skeleton, bone: number): number {
  return skeleton.parent[bone]!
}

/**
 * 骨头名字。
 * @param skeleton 骨骼
 * @param bone 骨头下标
 */
export function boneName(skeleton: Skeleton, bone: number): string {
  return skeleton.name[bone]!
}

/**
 * 按名字精确查找骨头下标；找不到返回 {@link PARENT_NONE}。
 * @param skeleton 骨骼
 * @param name 名字
 */
export function findBone(skeleton: Skeleton, name: string): number {
  for (let i = 0; i < skeleton.boneCount; i += 1) {
    if (skeleton.name[i] === name) return i
  }
  return PARENT_NONE
}

/**
 * 写出绑定平移到 `out`。
 * @param out 输出缓冲
 * @param skeleton 骨骼
 * @param bone 骨头下标
 * @returns `out`
 */
export function bindTranslation(out: Vec2, skeleton: Skeleton, bone: number): Vec2 {
  const i = bone * 2
  out[0] = skeleton.bindTranslation[i]!
  out[1] = skeleton.bindTranslation[i + 1]!
  return out
}

/**
 * 相对父骨的绑定横向偏移（米）。
 * @param skeleton 骨骼
 * @param bone 骨头下标
 */
export function bindLateral(skeleton: Skeleton, bone: number): number {
  return skeleton.bindLateral[bone]!
}

/**
 * 绑定旋转（弧度）。
 * @param skeleton 骨骼
 * @param bone 骨头下标
 */
export function bindRotation(skeleton: Skeleton, bone: number): number {
  return skeleton.bindRotation[bone]!
}

/**
 * 绑定长度（米）。
 * @param skeleton 骨骼
 * @param bone 骨头下标
 */
export function bindLength(skeleton: Skeleton, bone: number): number {
  return skeleton.bindLength[bone]!
}
