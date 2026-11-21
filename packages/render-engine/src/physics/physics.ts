/**
 * M14 二级物理：头发 / 裙摆 / 尾巴的 2D 粒子系统。
 * 权威：docs/07-约束/physics.md（§2 数据模型、§3 固定步长、§4 Verlet、
 * §5 约束投影、§8 碰撞、§9.3 快照、§14 验收）。
 *
 * 边界：
 * - 只做 2D 粒子 + 位置约束，不做刚体、布料三角网格与自碰撞。
 * - 不读 Pose / Skeleton；根的位置由调用方在每帧写入。
 * - 所有时间推进使用 fixedDt 子步，accumulator 可外部持有以支持回放。
 */

// ---------------------------------------------------------------------------
// 数据模型（严格对应 docs/07-约束/physics.md §2）
// ---------------------------------------------------------------------------

/** 单个粒子。x/px 表示当前位置与上一子步位置（Verlet 用位移差表示速度）。 */
export type Particle = {
  x: number
  y: number
  px: number
  py: number
  /** 逆质量：0 = 钉死，1 = 正常，>1 更轻。 */
  invMass: number
  /** 参与碰撞与约束的权重；0 的粒子被跳过。 */
  weight: number
  /** 仅调试：本子步是否发生过碰撞。 */
  hit: boolean
}

/** 一条粒子链（头发 / 尾巴）。particles[0] 是根。 */
export type Strand = {
  readonly id: string
  readonly particles: readonly Particle[]
  /** 静止段长，长度 = particles.length − 1。 */
  readonly restLengths: readonly number[]
  /** 0..1：投影时按此比例修正。 */
  readonly stiffness: number
  /** 每子步速度保留系数 (0,1]。 */
  readonly damping: number
  /** 弯曲刚度：相邻两段夹角偏离静止角时的回位强度。 */
  readonly bendStiffness: number
  /** 弯曲静止角（弧度），通常 0（伸直）。 */
  readonly restAngles: readonly number[]
  /** 是否与碰撞体求交。 */
  readonly collide: boolean
  /** 可选：结果写回该骨链时使用（本模块不写 Pose）。 */
  readonly bone?: number
}

/** 裙摆相邻垂链之间的环向约束；a/b 是裙摆内展平的粒子下标。 */
export type RingLink = {
  a: number
  b: number
  rest: number
  stiffness: number
}

/** 裙摆：一圈垂链 + 环向约束。 */
export type Skirt = {
  readonly id: string
  readonly strands: readonly Strand[]
  readonly ringLinks: readonly RingLink[]
  /** 腰环基准半径（米）。 */
  readonly waistRadius: number
  /** 是否与腿、地面碰撞。 */
  readonly collide: boolean
}

export type CircleCollider = { kind: 'circle'; x: number; y: number; radius: number }
export type CapsuleCollider = {
  kind: 'capsule'
  ax: number
  ay: number
  bx: number
  by: number
  radius: number
}
/** 凸多边形：points 为 [x0,y0,x1,y1,...]，顶点顺序可顺可逆。 */
export type ConvexCollider = { kind: 'convex'; points: Float32Array }
export type Collider = CircleCollider | CapsuleCollider | ConvexCollider

/** 物理世界；不含累计时间，accumulator 由 stepWorld 的 state 持有。 */
export type PhysicsWorld = {
  readonly strands: readonly Strand[]
  readonly skirts: readonly Skirt[]
  readonly colliders: readonly Collider[]
  readonly gravity: readonly [number, number]
  readonly wind: readonly [number, number]
  readonly damping: number
  readonly iterations: number
  readonly fixedDt: number
  readonly maxSubSteps: number
}

/** 快照：每条链一份 Float32Array，布局 [x,y,px,py] × 粒子数。 */
export type WorldSnapshot = {
  strands: Float32Array[]
  skirts: Float32Array[]
}

// ---------------------------------------------------------------------------
// 常量与小工具
// ---------------------------------------------------------------------------

/** 碰撞表面偏移，避免相邻子步反复穿透/推出造成抖动（§8.2）。 */
const SLOP = 1e-3
/** 单子步最大位移，超过直接截断（§8.3、§11）。 */
const MAX_STEP_DISPLACEMENT = 0.5
const EPS = 1e-12
const DEFAULT_DAMPING = 0.98
const DEFAULT_BEND_STIFFNESS = 0.1
const DEFAULT_FIXED_DT = 1 / 120
const DEFAULT_ITERATIONS = 8
const DEFAULT_MAX_SUBSTEPS = 4

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback

const clamp = (value: number, lo: number, hi: number): number =>
  value < lo ? lo : value > hi ? hi : value

/** 有符号转向角：seg(a→b) 到 seg(b→c) 的夹角，逆时针为正。 */
function signedTurn(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const ux = bx - ax
  const uy = by - ay
  const vx = cx - bx
  const vy = cy - by
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
}

/** 把角度包到 (-π, π]，避免 restAngle 跨圈时产生一次巨大修正。 */
function wrapAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0
  let a = angle % (Math.PI * 2)
  if (a <= -Math.PI) a += Math.PI * 2
  if (a > Math.PI) a -= Math.PI * 2
  return a
}

/** 由点位计算默认段长（长度 = n−1）。 */
function defaultRestLengths(points: readonly [number, number][]): number[] {
  const out: number[] = []
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!
    const b = points[i]!
    out.push(Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  return out
}

/** 由点位计算默认弯曲静止角（长度 = max(0, n−2)）。 */
function defaultRestAngles(points: readonly [number, number][]): number[] {
  const out: number[] = []
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1]!
    const b = points[i]!
    const c = points[i + 1]!
    out.push(wrapAngle(signedTurn(a[0], a[1], b[0], b[1], c[0], c[1])))
  }
  return out
}

// ---------------------------------------------------------------------------
// 构造
// ---------------------------------------------------------------------------

type ChainOptions = {
  rootInvMass?: number
  invMass?: number
  restLengths?: readonly number[]
  stiffness?: number
  damping?: number
  bendStiffness?: number
  restAngles?: readonly number[]
  collide?: boolean
  bone?: number
}

/**
 * 创建粒子链。默认根钉死（rootInvMass = 0），其余粒子 invMass = 1。
 * restLengths / restAngles 缺省时从初始点位量出，保证创建时不产生初始弹跳。
 */
export function createParticleChain(
  points: readonly [number, number][],
  options: ChainOptions = {},
): Strand {
  const rootInvMass = options.rootInvMass ?? 0
  const bodyInvMass = options.invMass ?? 1
  const particles: Particle[] = points.map(([rawX, rawY], index) => {
    const x = finiteOr(rawX, 0)
    const y = finiteOr(rawY, 0)
    return {
      x,
      y,
      px: x,
      py: y,
      invMass: index === 0 ? rootInvMass : bodyInvMass,
      weight: 1,
      hit: false,
    }
  })
  const restLengths = options.restLengths ?? defaultRestLengths(points)
  const restAngles = options.restAngles ?? defaultRestAngles(points)
  const strand: Strand = {
    id: 'strand',
    particles,
    restLengths,
    stiffness: clamp(finiteOr(options.stiffness ?? 1, 1), 0, 1),
    damping: clamp(finiteOr(options.damping ?? DEFAULT_DAMPING, DEFAULT_DAMPING), 0, 1),
    bendStiffness: clamp(
      finiteOr(options.bendStiffness ?? DEFAULT_BEND_STIFFNESS, DEFAULT_BEND_STIFFNESS),
      0,
      1,
    ),
    restAngles,
    collide: options.collide ?? true,
  }
  // exactOptionalPropertyTypes：bone 未给出时不能显式写 undefined。
  return options.bone === undefined ? strand : { ...strand, bone: options.bone }
}

/** 同义构造器，带显式 id（方便快照/调试与骨链写回）。 */
export function createStrand(
  id: string,
  points: readonly [number, number][],
  options: ChainOptions = {},
): Strand {
  return { ...createParticleChain(points, options), id }
}

/** 创建裙摆。ringLinks 使用裙摆内展平的粒子下标（strand 依次拼接）。 */
export function createSkirt(
  id: string,
  strands: readonly Strand[],
  ringLinks: readonly RingLink[],
  waistRadius: number,
  collide = true,
): Skirt {
  return {
    id,
    strands,
    ringLinks,
    waistRadius: Math.max(0, finiteOr(waistRadius, 0)),
    collide,
  }
}

// ---------------------------------------------------------------------------
// 步进调度（§3 固定步长）
// ---------------------------------------------------------------------------

function eachStrand(world: PhysicsWorld): Strand[] {
  const out: Strand[] = []
  for (const strand of world.strands) out.push(strand)
  for (const skirt of world.skirts) {
    for (const strand of skirt.strands) out.push(strand)
  }
  return out
}

function countParticles(world: PhysicsWorld): number {
  let count = 0
  for (const strand of world.strands) count += strand.particles.length
  for (const skirt of world.skirts) {
    for (const strand of skirt.strands) count += strand.particles.length
  }
  return count
}

/**
 * 推进世界：固定 fixedDt 子步，最多 maxSubSteps 步；超出部分丢弃（防螺旋死亡）。
 * 返回本帧子步数、剩余 accumulator 与粒子总数。
 */
export function stepWorld(
  world: PhysicsWorld,
  dt: number,
  state?: { accumulator: number },
): { substeps: number; accumulator: number; particles: number } {
  const fixedDt =
    Number.isFinite(world.fixedDt) && world.fixedDt > 0 ? world.fixedDt : DEFAULT_FIXED_DT
  const rawMax = Number.isFinite(world.maxSubSteps) ? Math.floor(world.maxSubSteps) : 1
  const maxSubSteps = Math.max(1, rawMax)
  const frameDt = Number.isFinite(dt) && dt > 0 ? dt : 0

  let accumulator = state && Number.isFinite(state.accumulator) ? state.accumulator : 0
  accumulator = Math.min(accumulator + frameDt, fixedDt * maxSubSteps)

  let substeps = 0
  while (accumulator >= fixedDt && substeps < maxSubSteps) {
    substep(world, fixedDt)
    accumulator -= fixedDt
    substeps += 1
  }
  // 浮点减法可能留下极小负数；归零保证下一帧从干净状态开始。
  if (accumulator < 0 && accumulator > -1e-9) accumulator = 0
  if (state) state.accumulator = accumulator

  return { substeps, accumulator, particles: countParticles(world) }
}

function substep(world: PhysicsWorld, h: number): void {
  const gx = finiteOr(world.gravity[0], 0)
  const gy = finiteOr(world.gravity[1], 0)
  const wx = finiteOr(world.wind[0], 0)
  const wy = finiteOr(world.wind[1], 0)
  const globalDamping = clamp(finiteOr(world.damping, 1), 0, 1)
  const h2 = h * h
  const ax = gx + wx
  const ay = gy + wy
  const strands = eachStrand(world)
  const iterations = Math.max(0, Math.floor(finiteOr(world.iterations, DEFAULT_ITERATIONS)))

  // 1) Verlet 积分：阻尼乘在位移差上（§4.1），再加重力/风。
  for (const strand of strands) {
    const strandDamping = clamp(finiteOr(strand.damping, DEFAULT_DAMPING), 0, 1)
    const damping = strandDamping * globalDamping
    for (const p of strand.particles) {
      p.hit = false
      if (p.invMass <= 0 || p.weight <= 0) continue

      // NaN 回退：优先回上一有效位置（px/py）。
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        p.x = finiteOr(p.px, 0)
        p.y = finiteOr(p.py, 0)
        p.px = p.x
        p.py = p.y
      }
      if (!Number.isFinite(p.px) || !Number.isFinite(p.py)) {
        p.px = p.x
        p.py = p.y
      }

      let dx = (p.x - p.px) * damping + ax * h2
      let dy = (p.y - p.py) * damping + ay * h2

      // 单子步位移上限，避免异常力把粒子甩飞（§8.3）。
      const stepLength = Math.hypot(dx, dy)
      if (!Number.isFinite(stepLength)) {
        dx = 0
        dy = 0
      } else if (stepLength > MAX_STEP_DISPLACEMENT) {
        const scale = MAX_STEP_DISPLACEMENT / stepLength
        dx *= scale
        dy *= scale
      }

      const nx = p.x + dx
      const ny = p.y + dy
      p.px = p.x
      p.py = p.y
      p.x = finiteOr(nx, p.px)
      p.y = finiteOr(ny, p.py)
    }
  }

  // 2) 迭代约束：先距离，再弯曲，再环向，最后碰撞（§5.4）。
  for (let iter = 0; iter < iterations; iter += 1) {
    for (const strand of strands) solveDistanceConstraints(strand)
    for (const strand of strands) solveBendConstraints(strand)
    for (const skirt of world.skirts) solveRingConstraints(skirt)
    for (const strand of strands) {
      if (strand.collide) collideStrand(strand, world.colliders)
    }
  }

  // 收尾松弛：弯曲/环向投影会轻微改变段长，Gauss–Seidel 单次正向扫描
  // 在长链上仍有残差。这里只重复距离/环向投影，不影响碰撞的最终裁决。
  for (let k = 0; k < iterations + 4; k += 1) {
    for (const strand of strands) solveDistanceConstraints(strand)
    for (const skirt of world.skirts) solveRingConstraints(skirt)
  }
  for (const strand of strands) solveDistanceConstraints(strand)
  for (const strand of strands) {
    if (strand.collide) collideStrand(strand, world.colliders)
  }

  // 3) 最后再做一次数值保护：约束/碰撞若产生非有限值，回退到上一有效位置。
  for (const strand of strands) {
    for (const p of strand.particles) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        p.x = finiteOr(p.px, 0)
        p.y = finiteOr(p.py, 0)
        p.px = p.x
        p.py = p.y
      }
      if (!Number.isFinite(p.px) || !Number.isFinite(p.py)) {
        p.px = p.x
        p.py = p.y
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 约束投影（§5）
// ---------------------------------------------------------------------------

function effectiveWeight(p: Particle): number {
  if (!(p.invMass > 0) || !(p.weight > 0)) return 0
  return p.invMass * p.weight
}

/** 距离约束：对拉长和压缩都生效（裙摆不塌陷，§7.1）。 */
function solveDistance(pa: Particle, pb: Particle, rest: number, stiffness: number): void {
  if (!(rest > 0) || !(stiffness > 0)) return
  const dx = pb.x - pa.x
  const dy = pb.y - pa.y
  const d = Math.hypot(dx, dy)
  if (!(d > EPS)) return
  const wa = effectiveWeight(pa)
  const wb = effectiveWeight(pb)
  const wsum = wa + wb
  if (!(wsum > 0)) return

  const k = clamp(stiffness, 0, 1)
  const diff = ((d - rest) / d) * k
  const cx = dx * diff
  const cy = dy * diff
  pa.x += (cx * wa) / wsum
  pa.y += (cy * wa) / wsum
  pb.x -= (cx * wb) / wsum
  pb.y -= (cy * wb) / wsum
}

function solveDistanceConstraints(strand: Strand): void {
  const particles = strand.particles
  const count = Math.min(strand.restLengths.length, particles.length - 1)
  for (let i = 0; i < count; i += 1) {
    const rest = strand.restLengths[i]
    if (rest === undefined) continue
    solveDistance(particles[i]!, particles[i + 1]!, rest, strand.stiffness)
  }
}

/**
 * 弯曲约束：用「a 与 c 的弦长」表达 b 处转角（§5.2 推荐简化）。
 * 静止弦长由两段当前长度与 restAngle 推出：|ac|² = l1² + l2² + 2·l1·l2·cos(rest)。
 */
function solveBendConstraints(strand: Strand): void {
  const particles = strand.particles
  const k = clamp(strand.bendStiffness, 0, 1)
  if (!(k > 0) || particles.length < 3) return
  for (let i = 1; i < particles.length - 1; i += 1) {
    const a = particles[i - 1]!
    const b = particles[i]!
    const c = particles[i + 1]!
    const l1 = Math.hypot(b.x - a.x, b.y - a.y)
    const l2 = Math.hypot(c.x - b.x, c.y - b.y)
    if (!(l1 > EPS) || !(l2 > EPS)) continue
    const rest = wrapAngle(strand.restAngles[i - 1] ?? 0)
    const targetSq = l1 * l1 + l2 * l2 + 2 * l1 * l2 * Math.cos(rest)
    if (!(targetSq >= 0)) continue
    solveDistance(a, c, Math.sqrt(targetSq), k)
  }
}

function solveRingConstraints(skirt: Skirt): void {
  const flat: Particle[] = []
  for (const strand of skirt.strands) {
    for (const p of strand.particles) flat.push(p)
  }
  for (const link of skirt.ringLinks) {
    if (!Number.isInteger(link.a) || !Number.isInteger(link.b)) continue
    if (link.a < 0 || link.b < 0 || link.a >= flat.length || link.b >= flat.length) continue
    const stiffness = clamp(finiteOr(link.stiffness, 0), 0, 1)
    const rest = finiteOr(link.rest, 0)
    solveDistance(flat[link.a]!, flat[link.b]!, rest, stiffness)
  }
}

// ---------------------------------------------------------------------------
// 碰撞（§8 位置投影 + 法向速度衰减）
// ---------------------------------------------------------------------------

/** 把粒子沿单位外法线推出，并去掉指向碰撞体内的法向速度。 */
function projectOut(p: Particle, nx: number, ny: number, penetration: number): void {
  if (!(penetration > 0)) return
  p.x += nx * penetration
  p.y += ny * penetration

  // 位置已改，速度用新位置与 px 的差表示；vn<0 表示仍在向内。
  const vn = (p.x - p.px) * nx + (p.y - p.py) * ny
  if (vn < 0) {
    p.px += nx * vn
    p.py += ny * vn
  }
  p.hit = true
}

function collideStrand(strand: Strand, colliders: readonly Collider[]): void {
  if (colliders.length === 0) return
  for (const p of strand.particles) {
    if (p.invMass <= 0 || p.weight <= 0) continue
    for (const collider of colliders) {
      if (collider.kind === 'circle') {
        collideCircle(p, collider.x, collider.y, collider.radius)
      } else if (collider.kind === 'capsule') {
        collideCapsule(p, collider)
      } else {
        collideConvex(p, collider.points)
      }
    }
  }
}

function collideCircle(p: Particle, cx: number, cy: number, radius: number): void {
  if (!(radius > 0)) return
  let dx = p.x - cx
  let dy = p.y - cy
  let d = Math.hypot(dx, dy)
  if (!(d > EPS)) {
    // 正好在圆心：任取一个外法线，保证能推出去。
    dx = 1
    dy = 0
    d = 0
  } else {
    dx /= d
    dy /= d
  }
  const penetration = radius + SLOP - d
  projectOut(p, dx, dy, penetration)
}

function collideCapsule(p: Particle, capsule: CapsuleCollider): void {
  const abx = capsule.bx - capsule.ax
  const aby = capsule.by - capsule.ay
  const len2 = abx * abx + aby * aby
  let qx = capsule.ax
  let qy = capsule.ay
  if (len2 > EPS) {
    const t = clamp(
      ((p.x - capsule.ax) * abx + (p.y - capsule.ay) * aby) / len2,
      0,
      1,
    )
    qx = capsule.ax + abx * t
    qy = capsule.ay + aby * t
  }
  collideCircle(p, qx, qy, capsule.radius)
}

/**
 * 凸多边形：按有向面积确定外法线方向，取最深的边把粒子推出。
 * 顶点顺序任意；只做「点在内侧则推向最近边」，不做连续碰撞。
 */
function collideConvex(p: Particle, points: Float32Array): void {
  const vertexCount = Math.floor(points.length / 2)
  if (vertexCount < 3) return

  let area2 = 0
  for (let i = 0; i < vertexCount; i += 1) {
    const j = (i + 1) % vertexCount
    const ax = points[i * 2]!
    const ay = points[i * 2 + 1]!
    const bx = points[j * 2]!
    const by = points[j * 2 + 1]!
    area2 += ax * by - bx * ay
  }
  // area2 > 0 为逆时针；顺时针时外法线整体取反。
  const orientation = area2 >= 0 ? 1 : -1

  let deepest = -Infinity
  let bestNx = 0
  let bestNy = 0
  for (let i = 0; i < vertexCount; i += 1) {
    const j = (i + 1) % vertexCount
    const ax = points[i * 2]!
    const ay = points[i * 2 + 1]!
    const bx = points[j * 2]!
    const by = points[j * 2 + 1]!
    const ex = bx - ax
    const ey = by - ay
    const len = Math.hypot(ex, ey)
    if (!(len > EPS)) continue
    const nx = (orientation * ey) / len
    const ny = (-orientation * ex) / len
    // 点在边内侧时 dot(n, p−a) < 0，穿透深度取负值。
    const depth = -(nx * (p.x - ax) + ny * (p.y - ay))
    if (depth > deepest) {
      deepest = depth
      bestNx = nx
      bestNy = ny
    }
  }
  if (!(deepest > 0)) return
  projectOut(p, bestNx, bestNy, deepest + SLOP)
}

// ---------------------------------------------------------------------------
// 写回与诊断（§9.4、§10）
// ---------------------------------------------------------------------------

/** 每段方向角（atan2），长度 = particles.length − 1；由调用方决定是否写回骨骼。 */
export function strandBoneRotations(strand: Strand): number[] {
  const out: number[] = []
  for (let i = 1; i < strand.particles.length; i += 1) {
    const a = strand.particles[i - 1]!
    const b = strand.particles[i]!
    out.push(Math.atan2(b.y - a.y, b.x - a.x))
  }
  return out
}

/** 把每条链写进 Float32Array（[x,y,px,py] × n），不包含 colliders。 */
function encodeStrands(strands: readonly Strand[]): Float32Array[] {
  const out: Float32Array[] = []
  for (const strand of strands) {
    const data = new Float32Array(strand.particles.length * 4)
    for (let i = 0; i < strand.particles.length; i += 1) {
      const p = strand.particles[i]!
      const o = i * 4
      data[o] = p.x
      data[o + 1] = p.y
      data[o + 2] = p.px
      data[o + 3] = p.py
    }
    out.push(data)
  }
  return out
}

export function snapshotWorld(
  strands: readonly Strand[],
  skirts: readonly Skirt[],
): WorldSnapshot {
  return {
    strands: encodeStrands(strands),
    skirts: skirts.map((skirt) => {
      const flat = encodeStrands(skirt.strands)
      const total = flat.reduce((sum, data) => sum + data.length, 0)
      const merged = new Float32Array(total)
      let offset = 0
      for (const data of flat) {
        merged.set(data, offset)
        offset += data.length
      }
      return merged
    }),
  }
}

/** 快照尺寸不符时返回 false 且完全不改动世界；尺寸一致才写回。 */
export function restoreWorld(
  strands: readonly Strand[],
  skirts: readonly Skirt[],
  snapshot: WorldSnapshot,
): boolean {
  if (!snapshot || snapshot.strands.length !== strands.length) return false
  if (snapshot.skirts.length !== skirts.length) return false

  for (let i = 0; i < strands.length; i += 1) {
    const data = snapshot.strands[i]
    if (!data || data.length !== strands[i]!.particles.length * 4) return false
  }
  for (let i = 0; i < skirts.length; i += 1) {
    const data = snapshot.skirts[i]
    let expected = 0
    for (const strand of skirts[i]!.strands) expected += strand.particles.length * 4
    if (!data || data.length !== expected) return false
  }

  for (let i = 0; i < strands.length; i += 1) {
    writeStrand(strands[i]!, snapshot.strands[i]!)
  }
  for (let i = 0; i < skirts.length; i += 1) {
    const data = snapshot.skirts[i]!
    let offset = 0
    for (const strand of skirts[i]!.strands) {
      const length = strand.particles.length * 4
      writeStrand(strand, data.subarray(offset, offset + length))
      offset += length
    }
  }
  return true
}

function writeStrand(strand: Strand, data: Float32Array): void {
  for (let i = 0; i < strand.particles.length; i += 1) {
    const p = strand.particles[i]!
    const o = i * 4
    p.x = data[o] ?? p.x
    p.y = data[o + 1] ?? p.y
    p.px = data[o + 2] ?? p.px
    p.py = data[o + 3] ?? p.py
  }
}

/** 诊断：返回错误描述数组；空数组表示世界合法。 */
export function validatePhysicsWorld(world: PhysicsWorld): string[] {
  const errors: string[] = []

  if (!Number.isFinite(world.fixedDt) || world.fixedDt <= 0) {
    errors.push('fixedDt 必须是有限正数')
  }
  if (!Number.isInteger(world.maxSubSteps) || world.maxSubSteps < 1) {
    errors.push('maxSubSteps 必须是 ≥1 的整数')
  }
  if (!Number.isInteger(world.iterations) || world.iterations < 0) {
    errors.push('iterations 必须是 ≥0 的整数')
  }
  if (!Number.isFinite(world.damping) || world.damping < 0 || world.damping > 1) {
    errors.push('damping 必须在 [0,1]')
  }
  if (!Number.isFinite(world.gravity[0]) || !Number.isFinite(world.gravity[1])) {
    errors.push('gravity 必须是有限数值')
  }
  if (!Number.isFinite(world.wind[0]) || !Number.isFinite(world.wind[1])) {
    errors.push('wind 必须是有限数值')
  }

  world.strands.forEach((strand, index) => validateStrand(strand, `strands[${index}]`, errors))
  world.skirts.forEach((skirt, index) => {
    const label = `skirts[${index}]`
    if (!Number.isFinite(skirt.waistRadius) || skirt.waistRadius < 0) {
      errors.push(`${label}: waistRadius 必须是非负有限数`)
    }
    skirt.strands.forEach((strand, s) => validateStrand(strand, `${label}.strands[${s}]`, errors))
    let total = 0
    for (const strand of skirt.strands) total += strand.particles.length
    skirt.ringLinks.forEach((link, l) => {
      const tag = `${label}.ringLinks[${l}]`
      if (!Number.isInteger(link.a) || link.a < 0 || link.a >= total) {
        errors.push(`${tag}: a 越界`)
      }
      if (!Number.isInteger(link.b) || link.b < 0 || link.b >= total) {
        errors.push(`${tag}: b 越界`)
      }
      if (!Number.isFinite(link.rest) || link.rest <= 0) {
        errors.push(`${tag}: rest 必须是有限正数`)
      }
      if (!Number.isFinite(link.stiffness) || link.stiffness < 0 || link.stiffness > 1) {
        errors.push(`${tag}: stiffness 必须在 [0,1]`)
      }
    })
  })

  world.colliders.forEach((collider, index) => validateCollider(collider, index, errors))
  return errors
}

function validateStrand(strand: Strand, label: string, errors: string[]): void {
  if (strand.particles.length === 0) {
    errors.push(`${label}: 至少需要 1 个粒子`)
  }
  if (strand.restLengths.length !== Math.max(0, strand.particles.length - 1)) {
    errors.push(`${label}: restLengths 长度应为 particles.length−1`)
  }
  if (strand.restAngles.length > Math.max(0, strand.particles.length - 2)) {
    errors.push(`${label}: restAngles 过长`)
  }
  if (!Number.isFinite(strand.stiffness) || strand.stiffness < 0 || strand.stiffness > 1) {
    errors.push(`${label}: stiffness 必须在 [0,1]`)
  }
  if (!Number.isFinite(strand.damping) || strand.damping <= 0 || strand.damping > 1) {
    errors.push(`${label}: damping 必须在 (0,1]`)
  }
  if (
    !Number.isFinite(strand.bendStiffness) ||
    strand.bendStiffness < 0 ||
    strand.bendStiffness > 1
  ) {
    errors.push(`${label}: bendStiffness 必须在 [0,1]`)
  }
  strand.particles.forEach((p, i) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      errors.push(`${label}.particles[${i}]: 位置非有限`)
    }
    if (!Number.isFinite(p.px) || !Number.isFinite(p.py)) {
      errors.push(`${label}.particles[${i}]: 上一位置非有限`)
    }
    if (!Number.isFinite(p.invMass) || p.invMass < 0) {
      errors.push(`${label}.particles[${i}]: invMass 必须是非负有限数`)
    }
    if (!Number.isFinite(p.weight) || p.weight < 0) {
      errors.push(`${label}.particles[${i}]: weight 必须是非负有限数`)
    }
  })
}

function validateCollider(collider: Collider, index: number, errors: string[]): void {
  const label = `colliders[${index}]`
  if (collider.kind === 'convex') {
    if (collider.points.length < 6 || collider.points.length % 2 !== 0) {
      errors.push(`${label}: convex 至少需要 3 个二维顶点`)
      return
    }
    for (let i = 0; i < collider.points.length; i += 1) {
      if (!Number.isFinite(collider.points[i]!)) {
        errors.push(`${label}: convex 顶点非有限`)
        return
      }
    }
    return
  }
  if (!Number.isFinite(collider.radius) || collider.radius <= 0) {
    errors.push(`${label}: radius 必须是有限正数`)
  }
  const coords =
    collider.kind === 'circle'
      ? [collider.x, collider.y]
      : [collider.ax, collider.ay, collider.bx, collider.by]
  if (coords.some((value) => !Number.isFinite(value))) {
    errors.push(`${label}: 坐标必须是有限数值`)
  }
}
