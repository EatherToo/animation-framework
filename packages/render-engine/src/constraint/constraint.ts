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
  CH_ROT, CH_X, CH_Y, POSE_STRIDE, WORLD_STRIDE,
  angleDelta, createAffine, invertAffine, normalizeAngle,
} from '../core/math'
import { addRotation, getRotation, setLocal, updateWorld, type Pose } from '../core/pose'
import type { CompiledSkeleton } from '../core/skeleton'

/** 所有约束的公共头。order 小者先求值，order 相同按 id 字典序。 */
export type ConstraintBase = {
  readonly id: string
  readonly kind: 'transform' | 'path' | 'ik'
  readonly bone: number
  readonly weight: number
  readonly enabled: boolean
  readonly order: number
}

/** 让 bone 跟随 sourceBone 的局部平移 / 旋转，分别按 mix 混合。 */
export type TransformConstraint = ConstraintBase & {
  kind: 'transform'
  sourceBone: number
  mixRotation: number
  mixTranslation: number
}

/** 把 bone 拉向二维折线的首点；points 为扁平的 [x0,y0,x1,y1,...]，mix 为混合系数。 */
export type PathConstraint = ConstraintBase & {
  kind: 'path'
  points: Float32Array
  mix: number
}

/** 以 bone 为末端锚点、chainLength 为链节数的 IK 约束；目标取自 targetBone 的原点。 */
export type IkConstraint = ConstraintBase & {
  kind: 'ik'
  targetBone: number
  chainLength: number
  method: 'analytic' | 'ccd' | 'fabrik' | 'dls'
  maxIterations: number
  tolerance: number
  bendSign: 1 | -1
}

export type ConstraintData = TransformConstraint | PathConstraint | IkConstraint

/** IK 求解结果。reason 覆盖：命中 / 不可达 / 限位 / 迭代超限 / 退化。 */
export type IkResult = {
  readonly reached: boolean
  readonly residual: number
  readonly iterations: number
  readonly reason: 'ok' | 'unreachable' | 'limit' | 'maxIterations' | 'degenerate'
}

export type ConstraintSolver = {
  solve(pose: Pose, dt: number): void
  results: ReadonlyMap<string, IkResult>
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
  if (c.bendSign !== 1 && c.bendSign !== -1) throw new Error('ik.bendSign')
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

/** 二骨解析解：余弦定理 + bendSign 选边 + 限位候选筛选（先换边，后夹）。 */
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

  const preferred = makeCandidate(c.bendSign)
  const opposite = makeCandidate(c.bendSign === 1 ? -1 : 1)
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
  const target = targetOf(pose, c.targetBone)

  const bones = chainBoneIds(skel, c.bone, c.chainLength)
  if (!bones) return degenerateResult(pose, target, c.bone)
  const lengths = segmentLengths(skel, bones)
  if (!lengths) return degenerateResult(pose, target, c.bone)

  const origin = boneOrigin(pose, bones[0]!)
  const dx = target[0] - origin[0]
  const dy = target[1] - origin[1]
  const distance = Math.hypot(dx, dy)
  if (!Number.isFinite(distance) || distance < EPS_DIR) {
    return degenerateResult(pose, target, c.bone)
  }

  const total = lengths.reduce((sum, v) => sum + v, 0)
  const longest = lengths.reduce((max, v) => (v > max ? v : max), 0)
  const minimum = Math.max(0, 2 * longest - total)
  const targetAngle = Math.atan2(dy, dx)
  // 有限循环：所有迭代后端都不超过 ITERATION_CAP；分支最多三条。
  if (distance > total + c.tolerance) {
    straighten(pose, bones, targetAngle)
    return { reached: false, residual: residualOf(pose, target, bones), iterations: 0, reason: 'unreachable' }
  }
  if (distance < minimum - c.tolerance) {
    fold(pose, bones, targetAngle, c.bendSign)
    return { reached: false, residual: residualOf(pose, target, bones), iterations: 0, reason: 'unreachable' }
  }

  if (c.method === 'analytic') {
    return solveAnalytic(pose, c, bones, lengths, target, distance, targetAngle)
  }
  if (c.method === 'ccd') return solveCcd(pose, c, bones, target)
  if (c.method === 'dls') return solveDls(pose, c, bones, target)
  return solveFabrik(pose, c, bones, lengths, target)
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

/** 构建期检查：只依赖数据本身（transform 源/目标、IK 目标的连续索引区间）。 */
function checkCreationCycles(list: readonly ConstraintData[]): void {
  const graph = new Map<number, Set<number>>()
  for (const c of list) {
    if (!c.enabled || c.weight === 0) continue
    if (c.kind === 'transform') {
      addEdge(graph, c.bone, c.sourceBone)
    } else if (c.kind === 'ik') {
      // 构建期只能判自包含；祖先落在链内的情况在 solve 拿到骨架后判（checkSolveCycles）。
      if (c.targetBone === c.bone) throw new Error('constraint.cycle: ik target inside chain')
      addEdge(graph, c.bone, c.targetBone)
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
      addEdge(graph, c.bone, c.sourceBone)
    } else if (c.kind === 'ik') {
      const bones = chainBoneIds(skel, c.bone, c.chainLength)
      if (bones) {
        if (bones.includes(c.targetBone)) throw new Error('constraint.cycle: ik target inside chain')
        for (const bone of bones) addEdge(graph, bone, c.targetBone)
      }
    }
  }
  detectCycles(graph)
}

function applyTransform(pose: Pose, c: TransformConstraint): void {
  const src = c.sourceBone
  if (!Number.isInteger(src) || src < 0 || src >= pose.skeleton.count) throw new Error('constraint.sourceBone')
  const fr = clamp01(c.weight * c.mixRotation)
  const ft = clamp01(c.weight * c.mixTranslation)
  const si = src * POSE_STRIDE
  const di = c.bone * POSE_STRIDE
  if (fr > 0) {
    const delta = angleDelta(pose.local[di + CH_ROT]!, pose.local[si + CH_ROT]!)
    if (delta !== 0) addRotation(pose, c.bone, delta * fr)
  }
  if (ft > 0) {
    const x = pose.local[di + CH_X]! + (pose.local[si + CH_X]! - pose.local[di + CH_X]!) * ft
    const y = pose.local[di + CH_Y]! + (pose.local[si + CH_Y]! - pose.local[di + CH_Y]!) * ft
    setLocal(pose, c.bone, CH_X, x)
    setLocal(pose, c.bone, CH_Y, y)
  }
}

/** 把角色空间点换算为父骨局部平移（inherit=normal 的主路径）。 */
function applyPath(pose: Pose, c: PathConstraint): void {
  const factor = clamp01(c.weight * c.mix)
  if (factor === 0 || c.points.length < 2) return
  const px = c.points[0]!
  const py = c.points[1]!
  if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error('constraint.points')
  updateWorld(pose)
  let localX = px
  let localY = py
  const parent = pose.skeleton.parent[c.bone]!
  if (parent >= 0) {
    const matrix = createAffine()
    for (let k = 0; k < WORLD_STRIDE; k += 1) matrix[k] = pose.world[parent * WORLD_STRIDE + k]!
    const inverse = invertAffine(matrix)
    if (inverse) {
      localX = inverse[0]! * px + inverse[2]! * py + inverse[4]!
      localY = inverse[1]! * px + inverse[3]! * py + inverse[5]!
    }
  }
  const i = c.bone * POSE_STRIDE
  setLocal(pose, c.bone, CH_X, pose.local[i + CH_X]! + (localX - pose.local[i + CH_X]!) * factor)
  setLocal(pose, c.bone, CH_Y, pose.local[i + CH_Y]! + (localY - pose.local[i + CH_Y]!) * factor)
}

function applyIk(pose: Pose, c: IkConstraint, results: Map<string, IkResult>): void {
  const bones = chainBoneIds(pose.skeleton, c.bone, c.chainLength)
  if (!bones) {
    updateWorld(pose)
    results.set(c.id, degenerateResult(pose, targetOf(pose, c.targetBone), c.bone))
    return
  }
  const before = bones.map((bone) => getRotation(pose, bone))
  const result = solveIk(pose, c)
  if (c.weight < 1) {
    // 在偏移空间按 weight 混合：先取解，再线性回退到求解前的角度。
    const after = bones.map((bone) => getRotation(pose, bone))
    for (let k = 0; k < bones.length; k += 1) {
      setLocal(pose, bones[k]!, CH_ROT, before[k]! + (after[k]! - before[k]!) * c.weight)
    }
    updateWorld(pose)
    const target = targetOf(pose, c.targetBone)
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
 * 创建约束栈。构造时完成排序与静态循环检测；每次 solve 前要求 pose.world 最新，
 * 因此 solve 内部会先 updateWorld。dt 属于物理时钟，约束按帧求值，这里保留签名但不使用。
 */
export function createConstraintSolver(constraints: readonly ConstraintData[]): ConstraintSolver {
  const ordered = orderedConstraints(constraints)
  checkCreationCycles(ordered)
  const results = new Map<string, IkResult>()
  return {
    results: results as ReadonlyMap<string, IkResult>,
    solve(pose: Pose, dt: number): void {
      void dt
      checkSolveCycles(ordered, pose.skeleton)
      results.clear()
      updateWorld(pose)
      for (const c of ordered) {
        if (!c.enabled || c.weight === 0) continue
        if (c.kind === 'transform') applyTransform(pose, c)
        else if (c.kind === 'path') applyPath(pose, c)
        else applyIk(pose, c, results)
      }
    },
  }
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
