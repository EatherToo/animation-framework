/**
 * core2d 约束栈 / IK / 二级物理。
 * 权威：docs/07-约束IK物理.md、docs/07-约束/{constraints,ik,physics}.md。
 *
 * 三条硬约定：
 * 1. 求解器只写 local 的旋转通道（setLocal / addRotation），不碰 3D 自由度；
 * 2. 所有循环有显式上界（迭代预算、子步上限、有限 DFS），不会出现死循环；
 * 3. 同输入同调用序列按位确定：不使用随机数、不依赖 Map/Set 遍历顺序做决策。
 */
import {
  CH_ROT, CH_SHX, CH_SHY, CH_SX, CH_SY, CH_X, CH_Y, POSE_STRIDE, WORLD_STRIDE,
  angleDelta, createAffine, invertAffine, normalizeAngle,
} from '../core/math'
import { addRotation, getRotation, setLocal, updateWorld, type Pose } from '../core/pose'
import type { CompiledSkeleton } from '../core/skeleton'

export type ConstraintKind = 'transform' | 'path' | 'ik' | 'physics'

/** 所有约束的公共头。order 小者先求值，order 相同按 id 字典序。 */
export type ConstraintBase = {
  readonly id: string
  readonly kind: ConstraintKind
  readonly bone: number
  readonly weight: number
  readonly enabled: boolean
  readonly order: number
}

/**
 * 让 bone 跟随 sourceBone 的 transform。
 * 旧字段 mixRotation / mixTranslation 保留；新字段逐轴覆盖，缺省时回退到旧字段。
 */
export type TransformConstraint = ConstraintBase & {
  kind: 'transform'
  /** 旧字段；未提供时回退到 target。 */
  sourceBone?: number
  /** 与 sourceBone 等价的 Spine 命名。 */
  readonly target?: number
  /** 旧字段；未提供时默认为 1。 */
  mixRotation?: number
  mixTranslation?: number
  /** 逐轴 mix；未提供时分别回退到 mixRotation / mixTranslation。 */
  readonly mixRotate?: number
  readonly mixX?: number
  readonly mixY?: number
  readonly mixScaleX?: number
  readonly mixScaleY?: number
  readonly mixShearY?: number
  readonly offsetRotation?: number
  readonly offsetX?: number
  readonly offsetY?: number
  readonly offsetScaleX?: number
  readonly offsetScaleY?: number
  readonly offsetShearY?: number
  /** true（默认）：使用 target 的 local 通道；false：使用 target 的世界变换。 */
  readonly local?: boolean
  /** true：target 值叠加到 bone 当前值；false（默认）：直接替换。 */
  readonly relative?: boolean
}

/**
 * 把一条或多条骨沿二维折线分布。
 * 旧字段 points/mix/bone 保留；新字段全部可选，缺省时保持旧行为（position=0、仅平移）。
 */
export type PathConstraint = ConstraintBase & {
  kind: 'path'
  /** 扁平的 [x0,y0,x1,y1,...]，角色空间。 */
  points: Float32Array
  /** 旧的统一平移 mix；也是 mixX/mixY 的缺省值。 */
  mix: number
  /** 沿路径分布的骨，根在前；缺省为 [bone]。 */
  readonly bones?: readonly number[]
  /** 可选的目标骨，仅用于依赖图；路径几何仍来自 points。 */
  readonly targetBone?: number
  /** 0..1 归一化弧长位置。 */
  readonly position?: number
  /** 相邻骨的归一化间距。 */
  readonly spacing?: number
  readonly mixRotate?: number
  readonly mixX?: number
  readonly mixY?: number
  /** Spine 命名的别名；未提供 mixRotate 时使用。 */
  readonly rotateMix?: number
  /** Spine 命名的别名；未提供 mixX/mixY 时使用。 */
  readonly translateMix?: number
  /** 闭合路径：最后一段回到首点。 */
  readonly closed?: boolean
}

/** 以 bone 为末端锚点、chainLength 为链节数的 IK 约束；目标取自 targetBone 的原点。 */
export type IkConstraint = ConstraintBase & {
  kind: 'ik'
  /** 旧字段；未提供时回退到 target。 */
  targetBone?: number
  /** 与 targetBone 等价的 Spine 命名。 */
  readonly target?: number
  chainLength: number
  method: 'analytic' | 'ccd' | 'fabrik' | 'dls'
  maxIterations: number
  tolerance: number
  /** 旧字段；未提供时由 bendDirection 或 +1 决定。 */
  bendSign?: 1 | -1
  /** 0..1 边界软化；0 表示硬解。 */
  readonly softness?: number
  /** 0..1 允许链缩短；0 时过短目标按 fold 处理。 */
  readonly compress?: number
  /** 0..1 允许链伸长；0 时超长目标按 straighten 处理。 */
  readonly stretch?: number
  /** 伸缩时是否同时缩放 X/Y。 */
  readonly uniform?: boolean
  /** Spine 命名的弯曲方向；优先于 bendSign。 */
  readonly bendDirection?: 1 | -1
  /** 与 weight 相乘的 IK mix。 */
  readonly mix?: number
}

/**
 * 骨骼级惯性约束：只改变单根骨的 local 偏移，不复用二级物理粒子链。
 * 所有参数可选，未提供时取保守默认值。
 */
export type PhysicsConstraint = ConstraintBase & {
  kind: 'physics'
  /** 可选参考骨；缺省使用 bone 的父骨。 */
  readonly target?: number
  readonly inertia?: number
  readonly strength?: number
  readonly damping?: number
  readonly mass?: number
  readonly wind?: number
  readonly gravity?: number
  readonly mix?: number
  /** 瞬时事件：清零累积状态，当帧不再叠加旧偏移。 */
  readonly reset?: boolean
}

/** 单条骨骼惯性约束的可变状态；可导出供外部重置/诊断。 */
export type PhysicsConstraintState = {
  offsetX: number
  offsetY: number
  offsetRot: number
  velocityX: number
  velocityY: number
  velocityRot: number
  /** 上一帧实际写进 local 的偏移量，用于避免重复求解时累积。 */
  appliedX: number
  appliedY: number
  appliedRot: number
  /** 上一帧写后的 local 绝对值；检测动画是否覆盖过该通道。 */
  writtenX: number
  writtenY: number
  writtenRot: number
  lastX: number
  lastY: number
  lastRot: number
  accumulator: number
  initialized: boolean
}

export type ConstraintData = TransformConstraint | PathConstraint | IkConstraint | PhysicsConstraint

/** IK 求解结果。reason 覆盖：命中 / 不可达 / 限位 / 迭代超限 / 退化。 */
export type IkResult = {
  readonly reached: boolean
  readonly residual: number
  readonly iterations: number
  readonly reason: 'ok' | 'unreachable' | 'limit' | 'maxIterations' | 'degenerate'
}

export type ConstraintSolver = {
  solve(pose: Pose, dt: number, weights?: ReadonlyMap<string, number>): void
  results: ReadonlyMap<string, IkResult>
  /** 清空 IK 结果与所有 physics 累积状态（下一帧重新初始化）。 */
  reset(): void
}

/** 二级物理链：bones[0] 为钉住的根节点，restLengths[i] 是 bones[i]→bones[i+1] 的静止长度。 */
export type PhysicsChain = {
  readonly id: string
  readonly rootBone: number
  readonly bones: readonly number[]
  readonly restLengths: readonly number[]
  readonly gravity: readonly [number, number]
  readonly stiffness: number
  readonly damping: number
}

/** SoA 布局：positions / previous 均为 2 × 粒子数（x,y 交错）。 */
export type PhysicsState = {
  positions: Float32Array
  previous: Float32Array
  initialized: boolean
}

const EPS_DIR = 1e-8
const MAX_STEP = 0.25
const ITERATION_CAP = 64
const PHYSICS_DT = 1 / 120
const PHYSICS_MAX_SUBSTEPS = 4
const DISTANCE_ITERATIONS = 6

/** 带隐藏累加器的内部视图；对外 PhysicsState 的形状保持不变。 */
type PhysicsStateInternal = PhysicsState & { accumulator?: number }

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function smoothstep01(t: number): number {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}

function finiteOr(v: number | undefined, fallback: number): number {
  return v !== undefined && Number.isFinite(v) ? v : fallback
}

function bendDirectionOf(c: IkConstraint): 1 | -1 {
  const dir = c.bendDirection ?? c.bendSign ?? 1
  return dir === -1 ? -1 : 1
}

function ikTargetBone(c: IkConstraint): number {
  const target = c.targetBone ?? c.target
  if (target === undefined) throw new Error('ik.targetBone')
  return target
}

function transformSourceBone(c: TransformConstraint): number {
  const source = c.sourceBone ?? c.target
  if (source === undefined) throw new Error('constraint.sourceBone')
  return source
}

/** 当前姿态下整条链的实际长度（各段枢轴距离 + 末端尖端）。 */
function worldChainLength(pose: Pose, bones: readonly number[]): number {
  const last = bones[bones.length - 1]!
  let total = 0
  for (let k = 0; k < bones.length - 1; k += 1) {
    const a = boneOrigin(pose, bones[k]!)
    const b = boneOrigin(pose, bones[k + 1]!)
    total += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  const origin = boneOrigin(pose, last)
  const tip = tipPoint(pose, last, pose.skeleton.bones[last]!.length)
  total += Math.hypot(tip[0] - origin[0], tip[1] - origin[1])
  return total
}

/**
 * 缩放链根骨以改变整条链的有效长度。子骨的局部平移和末端尖端都会被统一缩放，
 * 因此只需改根骨 scaleX；uniform 时同时缩放 scaleY。
 */
function scaleChainRoot(pose: Pose, root: number, factor: number, uniform: boolean): void {
  if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 1e-9) return
  const i = root * POSE_STRIDE
  setLocal(pose, root, CH_SX, pose.local[i + CH_SX]! * factor)
  if (uniform) setLocal(pose, root, CH_SY, pose.local[i + CH_SY]! * factor)
  updateWorld(pose)
}

function cmpId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 世界矩阵中的骨原点。 */
function boneOrigin(pose: Pose, bone: number): [number, number] {
  const o = bone * WORLD_STRIDE
  return [pose.world[o + 4]!, pose.world[o + 5]!]
}

/** 世界线性部分的 X 轴方向角（2D 平面角）。 */
function boneAngle(pose: Pose, bone: number): number {
  const o = bone * WORLD_STRIDE
  return Math.atan2(pose.world[o + 1]!, pose.world[o]!)
}

/** 骨尖端：原点 + length × 世界 X 轴。末端点的权威定义。 */
function tipPoint(pose: Pose, bone: number, length: number): [number, number] {
  const o = bone * WORLD_STRIDE
  return [
    pose.world[o + 0]! * length + pose.world[o + 4]!,
    pose.world[o + 1]! * length + pose.world[o + 5]!,
  ]
}

function restAngle(skel: CompiledSkeleton, bone: number): number {
  return skel.restLocal[bone * POSE_STRIDE + CH_ROT]!
}

function parentAngleOf(pose: Pose, skel: CompiledSkeleton, bone: number): number {
  const parent = skel.parent[bone]!
  return parent < 0 ? 0 : boneAngle(pose, parent)
}

/** 关节限位（仅 dof=1 且无共枢轴的骨参与）。 */
function limitOf(skel: CompiledSkeleton, bone: number): readonly [number, number] | null {
  const joint = skel.bones[bone]!.joint
  if (!joint || joint.yoke !== null) return null
  return [joint.min, joint.max]
}

function offsetWithin(skel: CompiledSkeleton, bone: number, offset: number): boolean {
  const limit = limitOf(skel, bone)
  if (!limit) return true
  const a = normalizeAngle(offset)
  return a >= limit[0] && a <= limit[1]
}

function clampOffset(skel: CompiledSkeleton, bone: number, offset: number): number {
  const limit = limitOf(skel, bone)
  if (!limit) return offset
  const a = normalizeAngle(offset)
  return a < limit[0] ? limit[0] : a > limit[1] ? limit[1] : a
}

/** 把链上超限的偏移角夹回限位；返回是否发生过修改。 */
function clampChainLimits(pose: Pose, bones: readonly number[]): boolean {
  const skel = pose.skeleton
  let changed = false
  for (const bone of bones) {
    const limit = limitOf(skel, bone)
    if (!limit) continue
    const current = getRotation(pose, bone)
    const normalized = normalizeAngle(current)
    if (normalized < limit[0]) {
      setLocal(pose, bone, CH_ROT, current + (limit[0] - normalized))
      changed = true
    } else if (normalized > limit[1]) {
      setLocal(pose, bone, CH_ROT, current + (limit[1] - normalized))
      changed = true
    }
  }
  if (changed) updateWorld(pose)
  return changed
}

/** 从 bone 向上回溯 chainLength 节，得到根在前的链；不足长度返回 null（退化）。 */
function chainBoneIds(skel: CompiledSkeleton, bone: number, chainLength: number): number[] | null {
  if (!Number.isInteger(bone) || bone < 0 || bone >= skel.count) throw new Error('ik.bone')
  if (!Number.isFinite(chainLength)) throw new Error('ik.chainLength')
  const n = Math.floor(chainLength)
  if (n < 2) return null
  const bones: number[] = [bone]
  let cursor = bone
  for (let i = 1; i < n; i += 1) {
    const parent = skel.parent[cursor]!
    if (parent < 0) return null
    bones.unshift(parent)
    cursor = parent
  }
  return bones
}

/**
 * 每段长度：前 n-1 段取子节点静止平移的模；最后一段取末端骨自身长度（到尖端）。
 * 任一非正或非有限长度都视为退化链。
 */
function segmentLengths(skel: CompiledSkeleton, bones: readonly number[]): number[] | null {
  const lengths: number[] = []
  for (let k = 0; k < bones.length; k += 1) {
    let length: number
    if (k < bones.length - 1) {
      const child = skel.bones[bones[k + 1]!]!
      length = Math.hypot(child.rest.x, child.rest.y)
    } else {
      length = skel.bones[bones[k]!]!.length
    }
    if (!(length > 0) || !Number.isFinite(length)) return null
    lengths.push(length)
  }
  return lengths
}

function targetOf(pose: Pose, targetBone: number): [number, number] {
  if (!Number.isInteger(targetBone) || targetBone < 0 || targetBone >= pose.skeleton.count) {
    throw new Error('ik.targetBone')
  }
  const o = targetBone * WORLD_STRIDE
  const x = pose.world[o + 4]!
  const y = pose.world[o + 5]!
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('ik.target')
  return [x, y]
}

function tipOfChain(pose: Pose, bones: readonly number[]): [number, number] {
  const last = bones[bones.length - 1]!
  return tipPoint(pose, last, pose.skeleton.bones[last]!.length)
}

function residualOf(pose: Pose, target: readonly [number, number], bones: readonly number[]): number {
  const tip = tipOfChain(pose, bones)
  const residual = Math.hypot(tip[0] - target[0], tip[1] - target[1])
  return Number.isFinite(residual) ? residual : Number.MAX_VALUE
}

/**
 * 把每段的世界方向角写回对应骨。旋转从第 0 节向外施加，祖先的旋转增量会被
 * 累积到后代，因此用 acc 修正「写入前的世界角」，避免求解顺序引入一帧偏差。
 */
function aimSegments(pose: Pose, bones: readonly number[], angles: readonly number[]): void {
  updateWorld(pose)
  const before = bones.map((bone) => boneAngle(pose, bone))
  let accumulated = 0
  for (let k = 0; k < bones.length; k += 1) {
    const delta = angleDelta(before[k]! + accumulated, angles[k]!)
    if (delta !== 0) addRotation(pose, bones[k]!, delta)
    accumulated += delta
  }
  updateWorld(pose)
}

function validateIkConstraint(c: IkConstraint): void {
  if (!c || typeof c !== 'object') throw new Error('ik.constraint')
  if (!Number.isFinite(c.tolerance) || c.tolerance <= 0) throw new Error('ik.tolerance')
  if (!Number.isFinite(c.maxIterations) || c.maxIterations < 1) throw new Error('ik.maxIterations')
  if (c.method !== 'analytic' && c.method !== 'ccd' && c.method !== 'fabrik' && c.method !== 'dls') throw new Error('ik.method')
  if (c.bendSign !== undefined && c.bendSign !== 1 && c.bendSign !== -1) throw new Error('ik.bendSign')
  const dir = bendDirectionOf(c)
  if (dir !== 1 && dir !== -1) throw new Error('ik.bendDirection')
  ikTargetBone(c)
  for (const [name, value] of [
    ['softness', c.softness],
    ['compress', c.compress],
    ['stretch', c.stretch],
    ['mix', c.mix],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error(`ik.${name}`)
    }
  }
  if (c.uniform !== undefined && typeof c.uniform !== 'boolean') throw new Error('ik.uniform')
}

function degenerateResult(pose: Pose, target: readonly [number, number], bone: number): IkResult {
  const origin = boneOrigin(pose, bone)
  const residual = Math.hypot(origin[0] - target[0], origin[1] - target[1])
  return {
    reached: false,
    residual: Number.isFinite(residual) ? residual : Number.MAX_VALUE,
    iterations: 0,
    reason: 'degenerate',
  }
}

/** 直链指向目标：用于不可达时给出确定、有限的姿态。 */
function straighten(pose: Pose, bones: readonly number[], angle: number): void {
  aimSegments(pose, bones, bones.map(() => angle))
}

/** 折叠到最小半径：第 0 段指向目标，其后各段反向，用于「贴脸」目标。 */
function fold(pose: Pose, bones: readonly number[], angle: number, bendSign: 1 | -1): void {
  const angles = bones.map((_, k) => (k === 0 ? angle : angle + bendSign * Math.PI))
  aimSegments(pose, bones, angles)
}

/** 二骨解析解：余弦定理 + bendDirection 选边 + 限位候选筛选（先换边，后夹）。 */
function solveAnalytic(
  pose: Pose,
  c: IkConstraint,
  bones: readonly number[],
  lengths: readonly number[],
  target: readonly [number, number],
  distance: number,
  targetAngle: number,
): IkResult {
  if (bones.length !== 2) throw new Error('ik.analytic: chainLength must be 2')
  const skel = pose.skeleton
  const root = bones[0]!
  const mid = bones[1]!
  const l1 = lengths[0]!
  const l2 = lengths[1]!
  const origin = boneOrigin(pose, root)
  const parentAngle = parentAngleOf(pose, skel, root)
  const bindRoot = restAngle(skel, root)
  const bindMid = restAngle(skel, mid)

  const cosine = (l1 * l1 + distance * distance - l2 * l2) / (2 * l1 * distance)
  const alpha = Math.acos(cosine < -1 ? -1 : cosine > 1 ? 1 : cosine)

  type Candidate = { a1: number; a2: number; offRoot: number; offMid: number }
  const makeCandidate = (sign: 1 | -1): Candidate => {
    const a1 = targetAngle + sign * alpha
    const kneeX = origin[0] + l1 * Math.cos(a1)
    const kneeY = origin[1] + l1 * Math.sin(a1)
    const a2 = Math.atan2(target[1] - kneeY, target[0] - kneeX)
    return {
      a1,
      a2,
      offRoot: normalizeAngle(a1 - parentAngle - bindRoot),
      offMid: normalizeAngle(a2 - a1 - bindMid),
    }
  }

  const bend = bendDirectionOf(c)
  const preferred = makeCandidate(bend)
  const opposite = makeCandidate(bend === 1 ? -1 : 1)
  let chosen = preferred
  let forcedReason: 'ok' | 'limit' = 'ok'
  if (!offsetWithin(skel, root, preferred.offRoot) || !offsetWithin(skel, mid, preferred.offMid)) {
    if (offsetWithin(skel, root, opposite.offRoot) && offsetWithin(skel, mid, opposite.offMid)) {
      chosen = opposite
    } else {
      // 两侧都出界：夹到最近端点并整体瞄准，末端不再保证精确命中。
      const a1 = parentAngle + bindRoot + clampOffset(skel, root, preferred.offRoot)
      const a2 = a1 + bindMid + clampOffset(skel, mid, preferred.offMid)
      aimSegments(pose, bones, [a1, a2])
      forcedReason = 'limit'
    }
  }
  if (forcedReason === 'ok') aimSegments(pose, bones, [chosen.a1, chosen.a2])

  const residual = residualOf(pose, target, bones)
  return {
    reached: residual <= c.tolerance,
    residual,
    iterations: 1,
    reason: forcedReason === 'limit' ? 'limit' : 'ok',
  }
}

/** CCD：由外向内逐关节把「末端→关节」转到「目标→关节」，单次增量夹到 ±MAX_STEP。 */
function solveCcd(
  pose: Pose,
  c: IkConstraint,
  bones: readonly number[],
  target: readonly [number, number],
): IkResult {
  const last = bones[bones.length - 1]!
  const length = pose.skeleton.bones[last]!.length
  const cap = Math.min(Math.max(1, Math.floor(c.maxIterations)), ITERATION_CAP)
  let iterations = 0
  let converged = false
  for (let it = 0; it < cap; it += 1) {
    iterations = it + 1
    for (let j = bones.length - 1; j >= 0; j -= 1) {
      updateWorld(pose)
      const joint = boneOrigin(pose, bones[j]!)
      const tip = tipPoint(pose, last, length)
      const ax = tip[0] - joint[0]
      const ay = tip[1] - joint[1]
      const bx = target[0] - joint[0]
      const by = target[1] - joint[1]
      const la = Math.hypot(ax, ay)
      const lb = Math.hypot(bx, by)
      if (la < EPS_DIR || lb < EPS_DIR) continue
      let delta = Math.atan2(ax * by - ay * bx, ax * bx + ay * by)
      delta = delta > MAX_STEP ? MAX_STEP : delta < -MAX_STEP ? -MAX_STEP : delta
      if (delta !== 0) addRotation(pose, bones[j]!, delta)
      if (residualOf(pose, target, bones) <= c.tolerance) {
        converged = true
        break
      }
    }
    if (converged) break
  }
  const limited = clampChainLimits(pose, bones)
  const residual = residualOf(pose, target, bones)
  return {
    reached: residual <= c.tolerance,
    residual,
    iterations,
    reason: limited ? 'limit' : converged ? 'ok' : 'maxIterations',
  }
}

/**
 * FABRIK：直接移动关节位置再按保长重放，最后把每段方向写回旋转。
 * 2D 没有平面外翻转，但 bendSign 决定初始弯曲侧（通过当前姿态的方向延续）。
 */
function solveFabrik(
  pose: Pose,
  c: IkConstraint,
  bones: readonly number[],
  lengths: readonly number[],
  target: readonly [number, number],
): IkResult {
  const n = bones.length
  const last = bones[n - 1]!
  const length = pose.skeleton.bones[last]!.length
  updateWorld(pose)
  const points: number[] = []
  for (const bone of bones) points.push(...boneOrigin(pose, bone))
  points.push(...tipPoint(pose, last, length)) // n+1 个点
  const rootX = points[0]!
  const rootY = points[1]!

  const cap = Math.min(Math.max(1, Math.floor(c.maxIterations)), ITERATION_CAP)
  let iterations = 0
  let converged = false
  for (let it = 0; it < cap; it += 1) {
    iterations = it + 1
    // 后向：末端钉目标，反向按段长重放。
    points[n * 2] = target[0]
    points[n * 2 + 1] = target[1]
    for (let i = n - 1; i >= 0; i -= 1) {
      let dx = points[i * 2]! - points[(i + 1) * 2]!
      let dy = points[i * 2 + 1]! - points[(i + 1) * 2 + 1]!
      let d = Math.hypot(dx, dy)
      if (d < EPS_DIR) { dx = 1; dy = 0; d = 1 }
      const scale = lengths[i]! / d
      points[i * 2] = points[(i + 1) * 2]! + dx * scale
      points[i * 2 + 1] = points[(i + 1) * 2 + 1]! + dy * scale
    }
    // 前向：根钉回原位，正向按段长重放。
    points[0] = rootX
    points[1] = rootY
    for (let i = 1; i <= n; i += 1) {
      let dx = points[i * 2]! - points[(i - 1) * 2]!
      let dy = points[i * 2 + 1]! - points[(i - 1) * 2 + 1]!
      let d = Math.hypot(dx, dy)
      if (d < EPS_DIR) { dx = 1; dy = 0; d = 1 }
      const scale = lengths[i - 1]! / d
      points[i * 2] = points[(i - 1) * 2]! + dx * scale
      points[i * 2 + 1] = points[(i - 1) * 2 + 1]! + dy * scale
    }
    const dx = points[n * 2]! - target[0]
    const dy = points[n * 2 + 1]! - target[1]
    if (Math.hypot(dx, dy) <= c.tolerance) {
      converged = true
      break
    }
  }

  const angles: number[] = []
  for (let k = 0; k < n; k += 1) {
    angles.push(Math.atan2(
      points[(k + 1) * 2 + 1]! - points[k * 2 + 1]!,
      points[(k + 1) * 2]! - points[k * 2]!,
    ))
  }
  aimSegments(pose, bones, angles)
  const limited = clampChainLimits(pose, bones)
  const residual = residualOf(pose, target, bones)
  return {
    reached: residual <= c.tolerance,
    residual,
    iterations,
    reason: limited ? 'limit' : converged ? 'ok' : 'maxIterations',
  }
}

/**
 * 求解一条 2D 链的 IK。只写链上骨的 local.rotation；失败返回带 reason 的结果而不抛错。
 * 非法配置（骨下标、方法、容差、迭代数）在写入之前抛出。
 */
export function solveIk(pose: Pose, c: IkConstraint): IkResult {
  validateIkConstraint(c)
  const skel = pose.skeleton
  updateWorld(pose)
  let target = targetOf(pose, ikTargetBone(c))

  const bones = chainBoneIds(skel, c.bone, c.chainLength)
  if (!bones) return degenerateResult(pose, target, c.bone)
  const restLengths = segmentLengths(skel, bones)
  if (!restLengths) return degenerateResult(pose, target, c.bone)

  const mix = clamp01(c.mix ?? 1)
  const beforeRotations = mix < 1 ? bones.map((bone) => getRotation(pose, bone)) : null
  const rootIndex = bones[0]! * POSE_STRIDE
  const beforeSx = pose.local[rootIndex + CH_SX]!
  const beforeSy = pose.local[rootIndex + CH_SY]!

  let origin = boneOrigin(pose, bones[0]!)
  let dx = target[0] - origin[0]
  let dy = target[1] - origin[1]
  let distance = Math.hypot(dx, dy)
  if (!Number.isFinite(distance) || distance < EPS_DIR) {
    return degenerateResult(pose, target, c.bone)
  }

  const total = restLengths.reduce((sum, v) => sum + v, 0)
  const longest = restLengths.reduce((max, v) => (v > max ? v : max), 0)
  const minimum = Math.max(0, 2 * longest - total)
  const stretch = clamp01(c.stretch ?? 0)
  const compress = clamp01(c.compress ?? 0)
  const softness = clamp01(c.softness ?? 0)
  const tolerance = c.tolerance
  let targetAngle = Math.atan2(dy, dx)

  // 有效链长伸缩：以当前实际链长为基准求增量缩放，重复求解不会累积。
  let currentTotal = worldChainLength(pose, bones)
  let effectiveScale = total > EPS_DIR && currentTotal > EPS_DIR ? currentTotal / total : 1
  if (distance > total + tolerance) {
    if (stretch <= 0) {
      straighten(pose, bones, targetAngle)
      return { reached: false, residual: residualOf(pose, target, bones), iterations: 0, reason: 'unreachable' }
    }
    const desiredTotal = total + (distance - total) * stretch
    const increment = currentTotal > EPS_DIR ? desiredTotal / currentTotal : 1
    scaleChainRoot(pose, bones[0]!, increment, c.uniform === true)
    effectiveScale *= increment
  } else if (distance < minimum - tolerance) {
    if (compress <= 0 || minimum <= EPS_DIR) {
      fold(pose, bones, targetAngle, bendDirectionOf(c))
      return { reached: false, residual: residualOf(pose, target, bones), iterations: 0, reason: 'unreachable' }
    }
    const desiredMin = minimum + (distance - minimum) * compress
    const desiredTotal = total * (desiredMin / minimum)
    const increment = currentTotal > EPS_DIR ? desiredTotal / currentTotal : 1
    scaleChainRoot(pose, bones[0]!, increment, c.uniform === true)
    effectiveScale *= increment
  }

  if (Math.abs(effectiveScale - 1) > 1e-9) {
    updateWorld(pose)
    target = targetOf(pose, ikTargetBone(c))
    origin = boneOrigin(pose, bones[0]!)
    dx = target[0] - origin[0]
    dy = target[1] - origin[1]
    distance = Math.hypot(dx, dy)
    targetAngle = Math.atan2(dy, dx)
    if (!Number.isFinite(distance) || distance < EPS_DIR) {
      return degenerateResult(pose, target, c.bone)
    }
  }

  const effectiveLengths = restLengths.map((v) => v * effectiveScale)
  const effectiveTotal = total * effectiveScale
  const effectiveMin = minimum * effectiveScale
  if (distance > effectiveTotal + tolerance) {
    straighten(pose, bones, targetAngle)
    return { reached: false, residual: residualOf(pose, target, bones), iterations: 0, reason: 'unreachable' }
  }
  if (distance < effectiveMin - tolerance) {
    fold(pose, bones, targetAngle, bendDirectionOf(c))
    return { reached: false, residual: residualOf(pose, target, bones), iterations: 0, reason: 'unreachable' }
  }

  // softness：贴近可达边界时把目标点沿同一方向收短，软化伸展修正，方向保持连续。
  let aimDistance = distance
  if (softness > 0 && effectiveTotal > EPS_DIR) {
    const zone = Math.max(effectiveTotal * 0.1, 1e-9)
    const near = clamp01((distance - (effectiveTotal - zone)) / zone)
    aimDistance = distance - softness * zone * smoothstep01(near)
    if (aimDistance < effectiveMin) aimDistance = effectiveMin
    if (aimDistance > effectiveTotal) aimDistance = effectiveTotal
  }
  const inv = 1 / distance
  const aimTarget: [number, number] = [origin[0] + dx * inv * aimDistance, origin[1] + dy * inv * aimDistance]

  let result: IkResult
  if (c.method === 'analytic') {
    result = solveAnalytic(pose, c, bones, effectiveLengths, aimTarget, aimDistance, targetAngle)
  } else if (c.method === 'ccd') {
    result = solveCcd(pose, c, bones, aimTarget)
  } else if (c.method === 'dls') {
    result = solveDls(pose, c, bones, aimTarget)
  } else {
    result = solveFabrik(pose, c, bones, effectiveLengths, aimTarget)
  }
  if (mix < 1 && beforeRotations !== null) {
    // mix 在最终 local 空间插值：旋转按最短弧，链根缩放同步混合。
    for (let k = 0; k < bones.length; k += 1) {
      const after = getRotation(pose, bones[k]!)
      const before = beforeRotations[k]!
      setLocal(pose, bones[k]!, CH_ROT, before + angleDelta(before, after) * mix)
    }
    const afterSx = pose.local[rootIndex + CH_SX]!
    setLocal(pose, bones[0]!, CH_SX, beforeSx + (afterSx - beforeSx) * mix)
    if (c.uniform === true) {
      const afterSy = pose.local[rootIndex + CH_SY]!
      setLocal(pose, bones[0]!, CH_SY, beforeSy + (afterSy - beforeSy) * mix)
    }
    updateWorld(pose)
  }
  const residual = residualOf(pose, target, bones)
  return { ...result, residual, reached: residual <= tolerance }
}

/**
 * DLS（阻尼最小二乘）：数值 Jacobian + 2x2 正规方程，适合多节链的平滑收敛。
 * 阻尼项 λ²I 保证奇异位形下仍有有限步长；每步夹到 ±MAX_STEP。
 */
function solveDls(
  pose: Pose,
  c: IkConstraint,
  bones: readonly number[],
  target: readonly [number, number],
): IkResult {
  const n = bones.length
  const cap = Math.min(Math.max(1, Math.floor(c.maxIterations)), ITERATION_CAP)
  const h = 1e-3
  const lambda2 = 1e-4
  let iterations = 0
  let converged = false
  for (let it = 0; it < cap; it += 1) {
    iterations = it + 1
    updateWorld(pose)
    const tip = tipOfChain(pose, bones)
    const ex = target[0] - tip[0]
    const ey = target[1] - tip[1]
    if (Math.hypot(ex, ey) <= c.tolerance) { converged = true; break }
    const jac = new Float64Array(n * 2)
    for (let j = 0; j < n; j += 1) {
      addRotation(pose, bones[j]!, h)
      updateWorld(pose)
      const moved = tipOfChain(pose, bones)
      jac[j * 2] = (moved[0] - tip[0]) / h
      jac[j * 2 + 1] = (moved[1] - tip[1]) / h
      addRotation(pose, bones[j]!, -h)
      updateWorld(pose)
    }
    let a = lambda2
    let b = 0
    let d = lambda2
    for (let j = 0; j < n; j += 1) {
      const jx = jac[j * 2]!
      const jy = jac[j * 2 + 1]!
      a += jx * jx
      b += jx * jy
      d += jy * jy
    }
    const det = a * d - b * b
    if (!Number.isFinite(det) || Math.abs(det) < 1e-14) {
      // 奇异位形：退化为目标函数梯度步，仍保证有限步长与确定性。
      for (let j = 0; j < n; j += 1) {
        let delta = 0.25 * (jac[j * 2]! * ex + jac[j * 2 + 1]! * ey)
        delta = delta > MAX_STEP ? MAX_STEP : delta < -MAX_STEP ? -MAX_STEP : delta
        if (delta !== 0) addRotation(pose, bones[j]!, delta)
      }
      continue
    }
    const yx = (d * ex - b * ey) / det
    const yy = (-b * ex + a * ey) / det
    for (let j = 0; j < n; j += 1) {
      let delta = jac[j * 2]! * yx + jac[j * 2 + 1]! * yy
      delta = delta > MAX_STEP ? MAX_STEP : delta < -MAX_STEP ? -MAX_STEP : delta
      if (delta !== 0) addRotation(pose, bones[j]!, delta)
    }
  }
  const limited = clampChainLimits(pose, bones)
  const residual = residualOf(pose, target, bones)
  return {
    reached: residual <= c.tolerance,
    residual,
    iterations,
    reason: limited ? 'limit' : converged ? 'ok' : 'maxIterations',
  }
}

/** 按 (order, id) 确定性排序；不改入参数组。 */
function orderedConstraints(constraints: readonly ConstraintData[]): ConstraintData[] {
  return constraints.slice().sort((a, b) => a.order - b.order || cmpId(a.id, b.id))
}

/**
 * 构造写骨 → 读骨的有向图并做三色 DFS。发现环（含自环）立即抛含 'cycle' 的错误。
 * weight=0 / enabled=false 的约束视为未注册，不参与依赖图。
 */
function detectCycles(graph: Map<number, Set<number>>): void {
  const color = new Map<number, number>()
  const visit = (node: number): void => {
    color.set(node, 1)
    for (const next of graph.get(node) ?? []) {
      if (color.get(next) === 1) throw new Error(`constraint.cycle: bone ${node} -> ${next}`)
      if (!color.has(next)) visit(next)
    }
    color.set(node, 2)
  }
  for (const node of graph.keys()) {
    if (!color.has(node)) visit(node)
  }
}

function addEdge(graph: Map<number, Set<number>>, from: number, to: number): void {
  if (from === to) throw new Error(`constraint.cycle: self bone ${from}`)
  let edges = graph.get(from)
  if (!edges) {
    edges = new Set<number>()
    graph.set(from, edges)
  }
  edges.add(to)
}

/** 路径约束实际写入的骨；缺省只有 base.bone。 */
function pathBones(c: PathConstraint): readonly number[] {
  return c.bones !== undefined && c.bones.length > 0 ? c.bones : [c.bone]
}

/** 构建期检查：transform / path / IK / physics 的写→读边全部入图。 */
function checkCreationCycles(list: readonly ConstraintData[]): void {
  const graph = new Map<number, Set<number>>()
  for (const c of list) {
    if (!c.enabled || c.weight === 0) continue
    if (c.kind === 'transform') {
      addEdge(graph, c.bone, transformSourceBone(c))
    } else if (c.kind === 'ik') {
      // 构建期只能判自包含；祖先落在链内的情况在 solve 拿到骨架后判（checkSolveCycles）。
      const target = ikTargetBone(c)
      if (target === c.bone) throw new Error('constraint.cycle: ik target inside chain')
      addEdge(graph, c.bone, target)
    } else if (c.kind === 'path') {
      if (c.targetBone !== undefined) {
        for (const bone of pathBones(c)) addEdge(graph, bone, c.targetBone)
      }
    } else if (c.kind === 'physics') {
      if (c.target !== undefined) addEdge(graph, c.bone, c.target)
    }
  }
  detectCycles(graph)
}

/** 求值前检查：此时有骨架，可以按真实父子链验证 IK 目标是否落在被写链内。 */
function checkSolveCycles(list: readonly ConstraintData[], skel: CompiledSkeleton): void {
  const graph = new Map<number, Set<number>>()
  for (const c of list) {
    if (!c.enabled || c.weight === 0) continue
    if (c.kind === 'transform') {
      addEdge(graph, c.bone, transformSourceBone(c))
    } else if (c.kind === 'ik') {
      const bones = chainBoneIds(skel, c.bone, c.chainLength)
      const target = ikTargetBone(c)
      if (bones) {
        if (bones.includes(target)) throw new Error('constraint.cycle: ik target inside chain')
        for (const bone of bones) addEdge(graph, bone, target)
      }
    } else if (c.kind === 'path') {
      if (c.targetBone !== undefined) {
        if (pathBones(c).includes(c.targetBone)) throw new Error('constraint.cycle: path target inside bones')
        for (const bone of pathBones(c)) addEdge(graph, bone, c.targetBone)
      }
    } else if (c.kind === 'physics') {
      if (c.target !== undefined) addEdge(graph, c.bone, c.target)
    }
  }
  detectCycles(graph)
}

type TransformTargetValues = {
  rot: number
  x: number
  y: number
  sx: number
  sy: number
  shy: number
}

/** 把 target 换算到 bone 的父空间；local=true 时直接使用 target 的 local 通道。 */
function transformTargetValues(pose: Pose, c: TransformConstraint): TransformTargetValues {
  const skel = pose.skeleton
  const src = transformSourceBone(c)
  const si = src * POSE_STRIDE
  if (c.local !== false) {
    return {
      rot: pose.local[si + CH_ROT]!,
      x: pose.local[si + CH_X]!,
      y: pose.local[si + CH_Y]!,
      sx: pose.local[si + CH_SX]!,
      sy: pose.local[si + CH_SY]!,
      shy: pose.local[si + CH_SHY]!,
    }
  }
  updateWorld(pose)
  const parent = skel.parent[c.bone]!
  const worldAngle = boneAngle(pose, src)
  const parentAngle = parent < 0 ? 0 : boneAngle(pose, parent)
  let x = pose.world[src * WORLD_STRIDE + 4]!
  let y = pose.world[src * WORLD_STRIDE + 5]!
  if (parent >= 0) {
    const matrix = createAffine()
    for (let k = 0; k < WORLD_STRIDE; k += 1) matrix[k] = pose.world[parent * WORLD_STRIDE + k]!
    const inverse = invertAffine(matrix)
    if (inverse) {
      const wx = x
      const wy = y
      x = inverse[0]! * wx + inverse[2]! * wy + inverse[4]!
      y = inverse[1]! * wx + inverse[3]! * wy + inverse[5]!
    }
  }
  const parentSx = parent < 0 ? 1 : Math.hypot(
    pose.world[parent * WORLD_STRIDE]!,
    pose.world[parent * WORLD_STRIDE + 1]!,
  )
  const parentSy = parent < 0 ? 1 : Math.hypot(
    pose.world[parent * WORLD_STRIDE + 2]!,
    pose.world[parent * WORLD_STRIDE + 3]!,
  )
  const srcSx = Math.hypot(
    pose.world[src * WORLD_STRIDE]!,
    pose.world[src * WORLD_STRIDE + 1]!,
  )
  const srcSy = Math.hypot(
    pose.world[src * WORLD_STRIDE + 2]!,
    pose.world[src * WORLD_STRIDE + 3]!,
  )
  return {
    rot: worldAngle - parentAngle,
    x,
    y,
    sx: Math.abs(parentSx) > EPS_DIR ? srcSx / parentSx : 1,
    sy: Math.abs(parentSy) > EPS_DIR ? srcSy / parentSy : 1,
    shy: pose.local[si + CH_SHY]!,
  }
}

/**
 * 逐轴 transform 约束。每个通道独立 mix：rotation/translation/scale/shear 互不牵连。
 * 只写 Pose.local；世界模式在父空间比较，local 模式直接使用 target 的 local 值。
 */
function applyTransform(pose: Pose, c: TransformConstraint): void {
  const src = transformSourceBone(c)
  if (!Number.isInteger(src) || src < 0 || src >= pose.skeleton.count) throw new Error('constraint.sourceBone')
  const target = transformTargetValues(pose, c)
  const weight = clamp01(c.weight)
  const mixRotate = clamp01(finiteOr(c.mixRotate, finiteOr(c.mixRotation, 1)))
  const mixX = clamp01(finiteOr(c.mixX, finiteOr(c.mixTranslation, 1)))
  const mixY = clamp01(finiteOr(c.mixY, finiteOr(c.mixTranslation, 1)))
  const mixScaleX = clamp01(finiteOr(c.mixScaleX, 0))
  const mixScaleY = clamp01(finiteOr(c.mixScaleY, 0))
  const mixShearY = clamp01(finiteOr(c.mixShearY, 0))
  const offRot = finiteOr(c.offsetRotation, 0)
  const offX = finiteOr(c.offsetX, 0)
  const offY = finiteOr(c.offsetY, 0)
  const offSx = finiteOr(c.offsetScaleX, 0)
  const offSy = finiteOr(c.offsetScaleY, 0)
  const offShy = finiteOr(c.offsetShearY, 0)
  const relative = c.relative === true
  const di = c.bone * POSE_STRIDE
  const curX = pose.local[di + CH_X]!
  const curY = pose.local[di + CH_Y]!
  const curRot = pose.local[di + CH_ROT]!
  const curShy = pose.local[di + CH_SHY]!

  const fr = weight * mixRotate
  if (fr > 0) {
    const desired = relative ? curRot + target.rot + offRot : target.rot + offRot
    const delta = angleDelta(curRot, desired)
    if (delta !== 0) addRotation(pose, c.bone, delta * fr)
  }
  const fx = weight * mixX
  if (fx > 0) {
    const desired = relative ? curX + target.x + offX : target.x + offX
    setLocal(pose, c.bone, CH_X, curX + (desired - curX) * fx)
  }
  const fy = weight * mixY
  if (fy > 0) {
    const desired = relative ? curY + target.y + offY : target.y + offY
    setLocal(pose, c.bone, CH_Y, curY + (desired - curY) * fy)
  }
  const fsx = weight * mixScaleX
  if (fsx > 0) {
    const desired = target.sx + offSx
    setLocal(pose, c.bone, CH_SX, pose.local[di + CH_SX]! * lerp(1, desired, fsx))
  }
  const fsy = weight * mixScaleY
  if (fsy > 0) {
    const desired = target.sy + offSy
    setLocal(pose, c.bone, CH_SY, pose.local[di + CH_SY]! * lerp(1, desired, fsy))
  }
  const fshy = weight * mixShearY
  if (fshy > 0) {
    const desired = relative ? curShy + target.shy + offShy : target.shy + offShy
    setLocal(pose, c.bone, CH_SHY, curShy + (desired - curShy) * fshy)
  }
}

type PathSample = { x: number; y: number; tx: number; ty: number }

/** 按归一化弧长采样折线；closed 时最后一段回到首点。 */
function samplePath(points: Float32Array, closed: boolean, t: number): PathSample {
  const n = points.length / 2
  if (n < 2) throw new Error('constraint.points')
  const segmentCount = closed ? n : n - 1
  const lengths: number[] = []
  let total = 0
  for (let i = 0; i < segmentCount; i += 1) {
    const j = (i + 1) % n
    const dx = points[j * 2]! - points[i * 2]!
    const dy = points[j * 2 + 1]! - points[i * 2 + 1]!
    const len = Math.hypot(dx, dy)
    if (!Number.isFinite(len)) throw new Error('constraint.points')
    lengths.push(len)
    total += len
  }
  if (!(total > EPS_DIR)) throw new Error('constraint.path: zero length')
  let remaining = clamp01(t) * total
  for (let i = 0; i < segmentCount; i += 1) {
    const len = lengths[i]!
    if (len <= EPS_DIR) continue
    if (remaining <= len || i === segmentCount - 1) {
      const j = (i + 1) % n
      const u = len > EPS_DIR ? clamp01(remaining / len) : 0
      const ax = points[i * 2]!
      const ay = points[i * 2 + 1]!
      const bx = points[j * 2]!
      const by = points[j * 2 + 1]!
      const dx = bx - ax
      const dy = by - ay
      return { x: ax + dx * u, y: ay + dy * u, tx: dx, ty: dy }
    }
    remaining -= len
  }
  const last = (n - 1) * 2
  return {
    x: points[last]!,
    y: points[last + 1]!,
    tx: points[last]! - points[last - 2]!,
    ty: points[last + 1]! - points[last - 1]!,
  }
}

/** 世界点 → 指定父骨的局部平移；父为根时原样返回。 */
function toParentLocal(pose: Pose, bone: number, px: number, py: number): [number, number] {
  const parent = pose.skeleton.parent[bone]!
  if (parent < 0) return [px, py]
  const matrix = createAffine()
  for (let k = 0; k < WORLD_STRIDE; k += 1) matrix[k] = pose.world[parent * WORLD_STRIDE + k]!
  const inverse = invertAffine(matrix)
  if (!inverse) return [px, py]
  return [
    inverse[0]! * px + inverse[2]! * py + inverse[4]!,
    inverse[1]! * px + inverse[3]! * py + inverse[5]!,
  ]
}

/**
 * 把一条或多条骨沿路径分布：position 为归一化弧长，spacing 为相邻骨间距。
 * 平移与旋转各自 mix；闭合路径在首尾之间补最后一段。
 */
function applyPath(pose: Pose, c: PathConstraint): void {
  const bones = pathBones(c)
  const weight = clamp01(c.weight)
  const baseMix = finiteOr(c.mix, 1)
  const rotMix = clamp01(weight * finiteOr(c.mixRotate, finiteOr(c.rotateMix, 0)))
  const xMix = clamp01(weight * finiteOr(c.mixX, finiteOr(c.translateMix, baseMix)))
  const yMix = clamp01(weight * finiteOr(c.mixY, finiteOr(c.mixX, finiteOr(c.translateMix, baseMix))))
  if ((rotMix === 0 && xMix === 0 && yMix === 0) || c.points.length < 4) return
  const position = clamp01(finiteOr(c.position, 0))
  const spacing = clamp01(finiteOr(c.spacing, 0))
  const closed = c.closed === true

  for (let index = 0; index < bones.length; index += 1) {
    const bone = bones[index]!
    if (!Number.isInteger(bone) || bone < 0 || bone >= pose.skeleton.count) throw new Error('constraint.bone')
    const t = clamp01(position + index * spacing)
    const sample = samplePath(c.points, closed, t)
    updateWorld(pose)
    const [localX, localY] = toParentLocal(pose, bone, sample.x, sample.y)
    const i = bone * POSE_STRIDE
    if (xMix > 0) setLocal(pose, bone, CH_X, pose.local[i + CH_X]! + (localX - pose.local[i + CH_X]!) * xMix)
    if (yMix > 0) setLocal(pose, bone, CH_Y, pose.local[i + CH_Y]! + (localY - pose.local[i + CH_Y]!) * yMix)
    if (rotMix > 0) {
      const parent = pose.skeleton.parent[bone]!
      const parentAngle = parent < 0 ? 0 : boneAngle(pose, parent)
      const desired = Math.atan2(sample.ty, sample.tx) - parentAngle
      const delta = angleDelta(getRotation(pose, bone), desired)
      if (delta !== 0) addRotation(pose, bone, delta * rotMix)
    }
    updateWorld(pose)
  }
}

function applyIk(pose: Pose, c: IkConstraint, results: Map<string, IkResult>): void {
  const bones = chainBoneIds(pose.skeleton, c.bone, c.chainLength)
  if (!bones) {
    updateWorld(pose)
    results.set(c.id, degenerateResult(pose, targetOf(pose, ikTargetBone(c)), c.bone))
    return
  }
  const weight = clamp01(c.weight)
  const before = bones.map((bone) => getRotation(pose, bone))
  const result = solveIk(pose, c)
  if (weight < 1) {
    // solveIk 已处理 mix；这里只按 weight 线性回退到求解前的角度。
    const after = bones.map((bone) => getRotation(pose, bone))
    for (let k = 0; k < bones.length; k += 1) {
      setLocal(pose, bones[k]!, CH_ROT, before[k]! + (after[k]! - before[k]!) * weight)
    }
    updateWorld(pose)
    const target = targetOf(pose, ikTargetBone(c))
    const residual = residualOf(pose, target, bones)
    results.set(c.id, {
      ...result,
      residual,
      reached: residual <= c.tolerance,
    })
  } else {
    results.set(c.id, result)
  }
}

/**
 * 创建约束栈。构造时完成排序与静态循环检测；求解按 order 串行，每条约束后刷新世界，
 * 保证后一个约束读到前一个约束的写入。
 */
export function createConstraintSolver(constraints: readonly ConstraintData[]): ConstraintSolver {
  const ordered = orderedConstraints(constraints)
  checkCreationCycles(ordered)
  const results = new Map<string, IkResult>()
  const physicsStates = new Map<string, PhysicsConstraintState>()
  return {
    results: results as ReadonlyMap<string, IkResult>,
    reset(): void {
      results.clear()
      // 保留 applied/written，下一次求解据此把已写入 Pose 的偏移撤回，避免重复叠加。
      for (const state of physicsStates.values()) {
        state.offsetX = 0
        state.offsetY = 0
        state.offsetRot = 0
        state.velocityX = 0
        state.velocityY = 0
        state.velocityRot = 0
        state.accumulator = 0
        state.initialized = false
      }
    },
    solve(pose: Pose, dt: number, weights?: ReadonlyMap<string, number>): void {
      checkSolveCycles(ordered, pose.skeleton)
      results.clear()
      updateWorld(pose)
      for (const base of ordered) {
        const override = weights?.get(base.id)
        const c = override === undefined ? base : { ...base, weight: clamp01(override) }
        if (!c.enabled || c.weight === 0) continue
        if (c.kind === 'transform') {
          applyTransform(pose, c)
        } else if (c.kind === 'path') {
          applyPath(pose, c)
        } else if (c.kind === 'physics') {
          let state = physicsStates.get(c.id)
          if (state === undefined) {
            state = createPhysicsConstraintState()
            physicsStates.set(c.id, state)
          }
          stepPhysicsConstraint(pose, c, state, dt)
        } else {
          applyIk(pose, c, results)
        }
        // 顺序契约：每个约束解完立即刷新世界，下一个约束读取最新结果。
        updateWorld(pose)
      }
    },
  }
}

export function createPhysicsConstraintState(): PhysicsConstraintState {
  return {
    offsetX: 0,
    offsetY: 0,
    offsetRot: 0,
    velocityX: 0,
    velocityY: 0,
    velocityRot: 0,
    appliedX: 0,
    appliedY: 0,
    appliedRot: 0,
    writtenX: 0,
    writtenY: 0,
    writtenRot: 0,
    lastX: 0,
    lastY: 0,
    lastRot: 0,
    accumulator: 0,
    initialized: false,
  }
}

/** 清零累积状态；下一帧重新以当前姿态为基准，不产生跳变。 */
export function resetPhysicsConstraintState(state: PhysicsConstraintState): void {
  state.offsetX = 0
  state.offsetY = 0
  state.offsetRot = 0
  state.velocityX = 0
  state.velocityY = 0
  state.velocityRot = 0
  state.appliedX = 0
  state.appliedY = 0
  state.appliedRot = 0
  state.writtenX = 0
  state.writtenY = 0
  state.writtenRot = 0
  state.lastX = 0
  state.lastY = 0
  state.lastRot = 0
  state.accumulator = 0
  state.initialized = false
}

function validatePhysicsConstraint(pose: Pose, c: PhysicsConstraint): void {
  if (!Number.isInteger(c.bone) || c.bone < 0 || c.bone >= pose.skeleton.count) throw new Error('physics.bone')
  if (c.target !== undefined && (!Number.isInteger(c.target) || c.target < 0 || c.target >= pose.skeleton.count)) {
    throw new Error('physics.target')
  }
  if (c.target === c.bone) throw new Error('constraint.cycle: self bone')
  for (const [name, value] of [
    ['inertia', c.inertia],
    ['strength', c.strength],
    ['damping', c.damping],
    ['mass', c.mass],
    ['wind', c.wind],
    ['gravity', c.gravity],
    ['mix', c.mix],
  ] as const) {
    if (value !== undefined && !Number.isFinite(value)) throw new Error(`physics.${name}`)
  }
  if (c.mass !== undefined && !(c.mass > 0)) throw new Error('physics.mass')
  if (c.strength !== undefined && c.strength < 0) throw new Error('physics.strength')
  if (c.damping !== undefined && c.damping < 0) throw new Error('physics.damping')
}

/** 撤销上一帧写入的偏移，再叠加本帧期望偏移；外部动画覆盖时以新值为基线。 */
function applyPhysicsOffset(pose: Pose, c: PhysicsConstraint, state: PhysicsConstraintState): void {
  const factor = clamp01(c.weight * finiteOr(c.mix, 1))
  const i = c.bone * POSE_STRIDE
  const curX = pose.local[i + CH_X]!
  const curY = pose.local[i + CH_Y]!
  const curRot = pose.local[i + CH_ROT]!
  // local 是 Float32，写入的 double 会有量化误差；用宽松阈值判断通道是否被外部改写。
  const sameX = Math.abs(curX - state.writtenX) <= 1e-5
  const sameY = Math.abs(curY - state.writtenY) <= 1e-5
  const sameRot = Math.abs(curRot - state.writtenRot) <= 1e-5
  const baseX = sameX ? curX - state.appliedX : curX
  const baseY = sameY ? curY - state.appliedY : curY
  const baseRot = sameRot ? curRot - state.appliedRot : curRot
  const desiredX = state.offsetX * factor
  const desiredY = state.offsetY * factor
  const desiredRot = state.offsetRot * factor
  const nextX = baseX + desiredX
  const nextY = baseY + desiredY
  const nextRot = baseRot + desiredRot
  if (nextX !== curX) setLocal(pose, c.bone, CH_X, nextX)
  if (nextY !== curY) setLocal(pose, c.bone, CH_Y, nextY)
  if (nextRot !== curRot) setLocal(pose, c.bone, CH_ROT, nextRot)
  state.appliedX = desiredX
  state.appliedY = desiredY
  state.appliedRot = desiredRot
  state.writtenX = nextX
  state.writtenY = nextY
  state.writtenRot = nextRot
}

/**
 * 推进骨骼级惯性约束。固定 1/120 子步、最多 4 子步；每轴的阻尼弹簧彼此独立。
 * 只写 local 的 x/y/rotation，不产生粒子或额外骨。
 */
export function stepPhysicsConstraint(
  pose: Pose,
  c: PhysicsConstraint,
  state: PhysicsConstraintState,
  dt: number,
): void {
  validatePhysicsConstraint(pose, c)
  updateWorld(pose)
  const parent = pose.skeleton.parent[c.bone]!
  const reference = c.target ?? parent

  if (c.reset === true) {
    applyPhysicsOffset(pose, c, { ...state, offsetX: 0, offsetY: 0, offsetRot: 0 })
    resetPhysicsConstraintState(state)
    updateWorld(pose)
    if (reference >= 0) {
      state.lastX = boneOrigin(pose, reference)[0]
      state.lastY = boneOrigin(pose, reference)[1]
      state.lastRot = boneAngle(pose, reference)
    }
    state.initialized = true
    return
  }

  const refX = reference < 0 ? 0 : boneOrigin(pose, reference)[0]
  const refY = reference < 0 ? 0 : boneOrigin(pose, reference)[1]
  const refRot = reference < 0 ? 0 : boneAngle(pose, reference)
  if (!state.initialized) {
    state.lastX = refX
    state.lastY = refY
    state.lastRot = refRot
    state.initialized = true
  }

  const frameDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_STEP) : 0
  if (frameDt === 0) return
  state.accumulator = Math.min(state.accumulator + frameDt, PHYSICS_MAX_SUBSTEPS * PHYSICS_DT)
  let substeps = Math.floor(state.accumulator / PHYSICS_DT + 1e-12)
  if (substeps > PHYSICS_MAX_SUBSTEPS) substeps = PHYSICS_MAX_SUBSTEPS
  if (substeps <= 0) return
  state.accumulator -= substeps * PHYSICS_DT

  const inertia = Math.max(0, finiteOr(c.inertia, 1))
  const strength = Math.max(0, finiteOr(c.strength, 10))
  const damping = Math.max(0, finiteOr(c.damping, 2))
  const mass = Math.max(EPS_DIR, finiteOr(c.mass, 1))
  const wind = finiteOr(c.wind, 0)
  const gravity = finiteOr(c.gravity, 0)
  const parentDx = refX - state.lastX
  const parentDy = refY - state.lastY
  const parentDr = angleDelta(state.lastRot, refRot)
  const spring = strength / mass
  const targetX = -parentDx * inertia / mass + (strength > EPS_DIR ? wind / strength : wind)
  const targetY = -parentDy * inertia / mass + (strength > EPS_DIR ? gravity / strength : gravity)
  const targetRot = -parentDr * inertia / mass
  const h = PHYSICS_DT
  const damp = Math.exp(-damping * h)

  for (let step = 0; step < substeps; step += 1) {
    state.velocityX += (targetX - state.offsetX) * spring * h
    state.velocityY += (targetY - state.offsetY) * spring * h
    state.velocityRot += (targetRot - state.offsetRot) * spring * h
    state.velocityX *= damp
    state.velocityY *= damp
    state.velocityRot *= damp
    state.offsetX += state.velocityX * h
    state.offsetY += state.velocityY * h
    state.offsetRot += state.velocityRot * h
  }

  // 数值保护：极端参数下也不把 NaN/Infinity 写进 Pose。
  if (!Number.isFinite(state.offsetX)) { state.offsetX = 0; state.velocityX = 0 }
  if (!Number.isFinite(state.offsetY)) { state.offsetY = 0; state.velocityY = 0 }
  if (!Number.isFinite(state.offsetRot)) { state.offsetRot = 0; state.velocityRot = 0 }
  state.lastX = refX
  state.lastY = refY
  state.lastRot = refRot
  applyPhysicsOffset(pose, c, state)
  updateWorld(pose)
}

function validateChain(chain: PhysicsChain): void {
  if (!chain || !Number.isInteger(chain.rootBone)) throw new Error('physics.rootBone')
  if (!Array.isArray(chain.bones) || chain.bones.length < 2) throw new Error('physics.bones')
  if (!Array.isArray(chain.restLengths) || chain.restLengths.length !== chain.bones.length - 1) {
    throw new Error('physics.restLengths')
  }
  for (const length of chain.restLengths) {
    if (!(length > 0) || !Number.isFinite(length)) throw new Error('physics.restLength')
  }
  if (!Number.isFinite(chain.gravity[0]) || !Number.isFinite(chain.gravity[1])) throw new Error('physics.gravity')
  if (!Number.isFinite(chain.stiffness) || !Number.isFinite(chain.damping)) throw new Error('physics.material')
}

/** 按链尺寸分配 SoA 缓冲。初始位置留给第一次 stepPhysics，从 Pose 枢轴填充。 */
export function createPhysicsState(chain: PhysicsChain): PhysicsState {
  validateChain(chain)
  const size = chain.bones.length * 2
  return {
    positions: new Float32Array(size),
    previous: new Float32Array(size),
    initialized: false,
  }
}

function initializeState(pose: Pose, chain: PhysicsChain, state: PhysicsState): void {
  const size = chain.bones.length * 2
  if (state.positions.length !== size || state.previous.length !== size) {
    state.positions = new Float32Array(size)
    state.previous = new Float32Array(size)
  }
  updateWorld(pose)
  for (let i = 0; i < chain.bones.length; i += 1) {
    const origin = boneOrigin(pose, chain.bones[i]!)
    state.positions[i * 2] = origin[0]
    state.positions[i * 2 + 1] = origin[1]
    state.previous[i * 2] = origin[0]
    state.previous[i * 2 + 1] = origin[1]
  }
  state.initialized = true
}

/**
 * 推进二级物理：固定 1/120 子步，最多 4 子步/帧；Verlet 积分 + 距离约束投影 +
 * 根节点钉住，最后只把每段方向写回骨的 rotation。同初值同 dt 序列按位确定。
 */
export function stepPhysics(pose: Pose, chain: PhysicsChain, state: PhysicsState, dt: number): void {
  validateChain(chain)
  for (const bone of chain.bones) {
    if (bone !== chain.rootBone && (!Number.isInteger(bone) || bone < 0 || bone >= pose.skeleton.count)) {
      throw new Error('physics.bone')
    }
  }
  if (!state.initialized) initializeState(pose, chain, state)

  const internal = state as PhysicsStateInternal
  const frameDt = Number.isFinite(dt) && dt > 0 ? dt : 0
  // 累加器封顶：掉帧时宁可慢放也不追帧（防螺旋死亡）。
  let accumulator = Math.min((internal.accumulator ?? 0) + frameDt, PHYSICS_MAX_SUBSTEPS * PHYSICS_DT)
  let substeps = Math.floor(accumulator / PHYSICS_DT + 1e-12)
  if (substeps > PHYSICS_MAX_SUBSTEPS) substeps = PHYSICS_MAX_SUBSTEPS
  if (substeps < 0) substeps = 0
  accumulator -= substeps * PHYSICS_DT
  internal.accumulator = accumulator < 0 ? 0 : accumulator
  if (substeps === 0) return

  // 根在整帧内钉在 FK 求得的枢轴上；中间子步不读取被物理写回的姿态。
  updateWorld(pose)
  const rootOrigin = boneOrigin(pose, chain.rootBone)
  const rootIndex = chain.bones.indexOf(chain.rootBone)
  const x = state.positions
  const px = state.previous
  const n = chain.bones.length
  if (rootIndex < 0) throw new Error('physics.rootBone: not in bones')
  const damping = clamp01(chain.damping)
  const stiffness = clamp01(chain.stiffness)
  const h2 = PHYSICS_DT * PHYSICS_DT

  for (let step = 0; step < substeps; step += 1) {
    // Verlet：速度编码在 x - px 中，阻尼必须缩放位移差而不是写成力。
    for (let i = 0; i < n; i += 1) {
      if (i === rootIndex) continue
      const ox = x[i * 2]!
      const oy = x[i * 2 + 1]!
      let nx = ox + (ox - px[i * 2]!) * damping + chain.gravity[0] * h2
      let ny = oy + (oy - px[i * 2 + 1]!) * damping + chain.gravity[1] * h2
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
        nx = ox
        ny = oy
      }
      px[i * 2] = ox
      px[i * 2 + 1] = oy
      x[i * 2] = nx
      x[i * 2 + 1] = ny
    }

    // 距离约束：投影保长；钉根 invMass=0，不参与投影。
    for (let it = 0; it < DISTANCE_ITERATIONS; it += 1) {
      for (let s = 0; s < chain.restLengths.length; s += 1) {
        const a = s
        const b = s + 1
        const dx = x[b * 2]! - x[a * 2]!
        const dy = x[b * 2 + 1]! - x[a * 2 + 1]!
        const d = Math.hypot(dx, dy)
        if (d < EPS_DIR) continue
        const wa = a === rootIndex ? 0 : 0.5
        const wb = b === rootIndex ? 0 : (wa === 0 ? 1 : 0.5)
        const sum = wa + wb
        if (sum === 0) continue
        const correction = (((d - chain.restLengths[s]!) / d) * stiffness) / sum
        x[a * 2] = x[a * 2]! + correction * wa * dx
        x[a * 2 + 1] = x[a * 2 + 1]! + correction * wa * dy
        x[b * 2] = x[b * 2]! - correction * wb * dx
        x[b * 2 + 1] = x[b * 2 + 1]! - correction * wb * dy
        for (const i of [a, b]) {
          if (!Number.isFinite(x[i * 2]!) || !Number.isFinite(x[i * 2 + 1]!)) {
            x[i * 2] = px[i * 2]!
            x[i * 2 + 1] = px[i * 2 + 1]!
          }
        }
      }
      x[rootIndex * 2] = rootOrigin[0]
      x[rootIndex * 2 + 1] = rootOrigin[1]
    }
    px[rootIndex * 2] = x[rootIndex * 2]!
    px[rootIndex * 2 + 1] = x[rootIndex * 2 + 1]!
  }

  // 写回姿态：每段方向 → 该骨的 world 角；仍沿用 aimSegments 的累积修正。
  updateWorld(pose)
  const angles: number[] = []
  for (let s = 0; s < chain.restLengths.length; s += 1) {
    angles.push(Math.atan2(
      x[(s + 1) * 2 + 1]! - x[s * 2 + 1]!,
      x[(s + 1) * 2]! - x[s * 2]!,
    ))
  }
  aimSegments(pose, chain.bones.slice(0, chain.restLengths.length), angles)
}
