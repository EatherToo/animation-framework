/**
 * core2d 骨架数据模型与编译。
 * 权威：docs/03-骨架/skeleton.md。编译产物只读、按拓扑序、id = 下标。
 * 2D 骨只有 7 通道；3D 数据只允许出现在 volume3d 的 VolumeBinding 中。
 */
import {
  CH_ROT, CH_SX, CH_SY, CH_SHX, CH_SHY,
  POSE_STRIDE,
  type InheritMode,
  type LocalTransform,
  normalizeAngle,
} from './math'

export type BoneId = number
export type RigProfile = 'simple2d' | 'full2d' | 'volume3d'

export const PROFILE_BONE_LIMITS: Record<RigProfile, number> = {
  simple2d: 19,
  // 官方 Spine 样例可到 76 骨；导入资产需要高于人形模板的 64 骨预算。
  full2d: 128,
  volume3d: 128,
}

export type JointSpec = {
  dof: 1 | 2
  min: number
  max: number
  rest: number
  bendSign: 1 | -1
  /** dof=2 时共枢轴的第二段骨；dof=1 必须为 null。 */
  yoke: BoneId | null
  planar2dof?: boolean
}

/** 唯一允许出现 3D 数据的挂载点；2D 路径不读它。 */
export type VolumeBinding = {
  proxyId: string
  restOffset: readonly [number, number, number]
  restRotation: readonly [number, number, number, number]
}

export type Bone = {
  id: BoneId
  name: string
  parent: BoneId | -1
  length: number
  rest: LocalTransform
  setup: LocalTransform
  inherit: InheritMode
  joint: JointSpec | null
  volume: VolumeBinding | null
  tags: readonly string[]
}

/** 作者/导入器输入。parent 是 bones 数组中的原始下标，-1 表示根。 */
export type BoneSpec = {
  readonly name: string
  readonly parent: number
  readonly length?: number
  readonly rest?: Partial<LocalTransform>
  readonly setup?: Partial<LocalTransform>
  readonly inherit?: InheritMode
  readonly joint?: JointSpec | null
  readonly volume?: VolumeBinding | null
  readonly tags?: readonly string[]
}

export type SkeletonSpec = {
  name: string
  profile: RigProfile
  bones: readonly BoneSpec[]
  rootMotion?: 'bone' | 'entity'
}

export type CompiledSkeleton = {
  readonly name: string
  readonly profile: RigProfile
  readonly rootMotion: 'bone' | 'entity'
  readonly count: number
  readonly bones: readonly Bone[]
  readonly order: readonly BoneId[]
  readonly roots: readonly BoneId[]
  readonly parent: Int16Array
  readonly inherit: readonly InheritMode[]
  readonly children: readonly (readonly BoneId[])[]
  readonly boneIdByName: ReadonlyMap<string, BoneId>
  /** 7 × N，动画基线。 */
  readonly setupLocal: Float32Array
  /** 7 × N，绑定姿态。 */
  readonly restLocal: Float32Array
}

const DEFAULT_TRANSFORM: LocalTransform = {
  x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0,
}
const INHERITS: readonly InheritMode[] = [
  'normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection',
]

function transformOf(partial: Partial<LocalTransform> | undefined, from?: Partial<LocalTransform>): LocalTransform {
  const base = { ...DEFAULT_TRANSFORM, ...(from ?? {}) }
  const out = { ...base, ...(partial ?? {}) }
  for (const key of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'] as const) {
    if (!Number.isFinite(out[key])) throw new Error(`skeleton.transform: ${key}`)
  }
  out.rotation = normalizeAngle(out.rotation)
  return out
}

function writeTransform(out: Float32Array, id: number, t: LocalTransform): void {
  const i = id * POSE_STRIDE
  out[i] = t.x
  out[i + 1] = t.y
  out[i + 2] = t.rotation
  out[i + 3] = t.scaleX
  out[i + 4] = t.scaleY
  out[i + 5] = t.shearX
  out[i + 6] = t.shearY
}

/** 编译骨架：校验 → 拓扑排序 → 生成不可变 Sandy 数组视图。 */
export function compileSkeleton(spec: SkeletonSpec): CompiledSkeleton {
  if (!spec || typeof spec.name !== 'string' || spec.name.length === 0) throw new Error('skeleton.name')
  const profile = spec.profile
  const limit = PROFILE_BONE_LIMITS[profile]
  if (limit === undefined) throw new Error('skeleton.profile')
  const input = spec.bones
  if (!Array.isArray(input) || input.length === 0 || input.length > limit) {
    throw new Error('skeleton.boneCount')
  }

  const names = new Set<string>()
  for (const b of input) {
    if (!b || typeof b.name !== 'string' || b.name.length === 0) throw new Error('skeleton.boneName')
    if (names.has(b.name)) throw new Error('duplicate bone name')
    names.add(b.name)
    if (!Number.isInteger(b.parent) || b.parent < -1 || b.parent >= input.length) throw new Error('skeleton.parent')
    if ('swing' in b || 'twist' in b || 'quaternion' in b) {
      throw new Error('skeleton.3d-fields: 2D bones cannot carry swing/twist/quaternion')
    }
    if (b.inherit !== undefined && !INHERITS.includes(b.inherit)) throw new Error('skeleton.inherit')
    if (b.volume && profile !== 'volume3d') throw new Error('skeleton.volume: only volume3d')
    const tags = b.tags ?? []
    if (profile === 'simple2d' && (tags.includes('finger') || (b.joint?.dof === 2))) {
      throw new Error('skeleton.profile: simple2d forbids fingers and 2-DOF yokes')
    }
    if (b.joint) {
      const j = b.joint
      if (j.dof === 1 && j.yoke !== null) throw new Error('skeleton.joint: dof=1 requires null yoke')
      if (j.dof === 2 && j.yoke === null) throw new Error('skeleton.joint: dof=2 requires yoke')
      if (!Number.isFinite(j.min) || !Number.isFinite(j.max) || j.min > j.max) throw new Error('skeleton.joint.range')
      if (j.rest < j.min || j.rest > j.max) throw new Error('skeleton.joint.rest')
      if (j.bendSign !== 1 && j.bendSign !== -1) throw new Error('skeleton.joint.bendSign')
    }
    if (!Number.isFinite(b.length ?? 0) || (b.length ?? 0) < 0) throw new Error('skeleton.length')
  }

  // Kahn 拓扑排序：输入顺序任意，父必须先于子。
  const indegree = input.map((b) => (b.parent === -1 ? 0 : 1))
  const childrenOfInput: number[][] = input.map(() => [])
  for (let i = 0; i < input.length; i += 1) {
    if (input[i]!.parent >= 0) childrenOfInput[input[i]!.parent]!.push(i)
  }
  const queue: number[] = []
  for (let i = 0; i < input.length; i += 1) if (indegree[i] === 0) queue.push(i)
  const order: number[] = []
  const remap = new Int32Array(input.length).fill(-1)
  while (queue.length > 0) {
    const cur = queue.shift()!
    remap[cur] = order.length
    order.push(cur)
    for (const child of childrenOfInput[cur]!) {
      indegree[child]! -= 1
      if (indegree[child] === 0) queue.push(child)
    }
  }
  if (order.length !== input.length) throw new Error('skeleton.cycle')

  const count = input.length
  const bones: Bone[] = new Array(count)
  const parent = new Int16Array(count)
  const inherit: InheritMode[] = new Array(count)
  const children: BoneId[][] = Array.from({ length: count }, () => [])
  const boneIdByName = new Map<string, BoneId>()
  const setupLocal = new Float32Array(count * POSE_STRIDE)
  const restLocal = new Float32Array(count * POSE_STRIDE)

  for (let id = 0; id < count; id += 1) {
    const src = input[order[id]!]!
    const rest = transformOf(src.rest)
    const setup = transformOf(src.setup, rest)
    const joint = src.joint ? { ...src.joint, yoke: src.joint.yoke === null ? null : remap[src.joint.yoke]! } : null
    const p = src.parent === -1 ? -1 : remap[src.parent]!
    if (p >= id) throw new Error('skeleton.topology')
    const bone: Bone = {
      id,
      name: src.name,
      parent: p,
      length: src.length ?? 0,
      rest,
      setup,
      inherit: src.inherit ?? 'normal',
      joint,
      volume: src.volume ?? null,
      tags: src.tags ?? [],
    }
    bones[id] = bone
    parent[id] = p
    inherit[id] = bone.inherit
    boneIdByName.set(bone.name, id)
    writeTransform(restLocal, id, rest)
    writeTransform(setupLocal, id, setup)
    if (p >= 0) children[p]!.push(id)
  }

  return {
    name: spec.name,
    profile,
    rootMotion: spec.rootMotion ?? 'entity',
    count,
    bones,
    order: Array.from({ length: count }, (_, i) => i),
    roots: children.flatMap((_, i) => (parent[i] === -1 ? [i] : [])),
    parent,
    inherit,
    children,
    boneIdByName,
    setupLocal,
    restLocal,
  }
}

export function findBoneId(skeleton: CompiledSkeleton, name: string): BoneId {
  return skeleton.boneIdByName.get(name) ?? -1
}

/** 骨骼的旋转通道索引（便于动画/约束层使用）。 */
export function rotationChannel(bone: BoneId): number {
  return bone * POSE_STRIDE + CH_ROT
}

/** 缩放通道索引；负缩放表示镜像。 */
export function scaleChannels(bone: BoneId): readonly [number, number] {
  const i = bone * POSE_STRIDE
  return [i + CH_SX, i + CH_SY]
}

/** 斜切通道索引。 */
export function shearChannels(bone: BoneId): readonly [number, number] {
  const i = bone * POSE_STRIDE
  return [i + CH_SHX, i + CH_SHY]
}
