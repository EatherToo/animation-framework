/**
 * 2D 手臂轮廓带。
 *
 * 引擎是 2D 平面 + 正交投影：`z` 只决定遮挡顺序，画面是一张二维图。
 * 所以手臂在这里直接按 2D 轮廓生成——中线 + 两侧宽度曲线，顶点全部落在 (x, y)，
 * 不存在「3D 筒被投影压扁又甩开」的退化。
 *
 * 绑定网格与采样用矢状面 (x, y)；投影时 `view/project.ts` 会把肩、肘、腕
 * 按当前视角重新投到屏幕平面，再调用这里生成同一拓扑的轮廓。
 */

/** 一个 2D 点。`z` 只用于排序，不参与轮廓计算。 */
export type Point2 = { readonly x: number; readonly y: number }

/** 一个 3D 点，只在生成轮廓前用来投影到当前视角平面。 */
export type Point3 = { readonly x: number; readonly y: number; readonly z: number }

/** 一段的宽度曲线：`t ∈ [0, 1]` 沿该段中线。 */
export type WidthProfile = (t: number) => number

/** 一条手臂的三维骨轴端点。投影时按当前视角重算 2D 轮廓。 */
export type ArmOutlineBones = {
  readonly shoulder: Point3
  readonly elbow: Point3
  readonly wrist: Point3
  /** 手腕末端（hand 骨沿自身 +X 的末端），用来定手腕轮廓方向。 */
  readonly handTip: Point3
  /** hand 骨局部 +Z（掌宽方向）在世界空间的方向。 */
  readonly handLateral: Point3
  /** hand 骨局部 +Y（掌厚方向）在世界空间的方向。 */
  readonly handThicknessAxis: Point3
  readonly palmHalfWidth: number
  readonly palmHalfThickness: number
  readonly upperWidth: WidthProfile
  readonly lowerWidth: WidthProfile
  readonly sections: number
  /** 身高，用来把肩根往躯干里收。 */
  readonly height: number
}

export type ArmOutlineInput = {
  readonly shoulder: Point2
  readonly elbow: Point2
  readonly wrist: Point2
  readonly upperWidth: WidthProfile
  /** 屏幕平面里从腕指向手末端的方向；省略时与同前臂同向。 */
  readonly handDir?: Point2
  /** 屏幕平面里的腕口半宽；省略时取前臂末端的半宽。 */
  readonly wristWidth?: number
  readonly lowerWidth: WidthProfile
  /** 每段的截面试数，至少 2。 */
  readonly sections?: number
  /** 肘部圆弧的中间截面数，至少 0；省略时用 {@link ARM_JOINT_RINGS}。 */
  readonly jointRings?: number
  /** 手腕圆弧的中间截面数，至少 0；省略时用 {@link ARM_WRIST_RINGS}。 */
  readonly wristRings?: number
  /** 三个关节在视线方向上的深度，用于逐顶点排序；省略时全为 0。 */
  readonly shoulderDepth?: number
  readonly elbowDepth?: number
  readonly wristDepth?: number
}

export type OutlineMesh = {
  readonly positions: Float32Array
  /** 三角形索引，两段共用一套顶点。 */
  readonly indices: Uint16Array
  /** 每个顶点的深度，段内沿中线插值，用于 2D 排序。 */
  readonly depths: Float32Array
}

const DEFAULT_SECTIONS = 8

/** 接入渲染时每段的截面试数。 */
export const ARM_SECTIONS = 16

/** 肘部圆弧的中间截面数；0 时退化成一条斜接带。 */
export const ARM_JOINT_RINGS = 3

/** 肘部圆弧半径相对截面半宽的倍数。 */
export const ARM_JOINT_RADIUS_RATIO = 2

/** 手腕圆弧的中间截面数；0 时退化成一条斜接带。 */
export const ARM_WRIST_RINGS = 2

/** 手腕圆弧半径相对腕口半宽的倍数。 */
export const ARM_WRIST_RADIUS_RATIO = 1.5

/** 一条手臂的三角形张数，供网格与贴图契约使用。 */
export function armOutlineTriangles(): number {
  return 4 * ARM_SECTIONS + 2 * ARM_JOINT_RINGS + 2 * ARM_WRIST_RINGS + 4
}

/** 2D 手臂的肩根横向内收的量，占身高。 */
export const ARM_SHOULDER_INSET_X = 0.02

/** 2D 手臂的肩根向下挪的量，占身高；让第一圈落进躯干肩窝。 */
export const ARM_SHOULDER_INSET_Y = 0.035

/** 肩根在深度上再往后退的量，占身高；让躯干盖住伸进身体里的那一截。 */
export const ARM_SHOULDER_DEPTH_BIAS = 0.08

/**
 * 把肩点从关节原点挪到躯干肩窝里：横向朝中线收、纵向略降。
 * 这样轮廓带的第一圈被躯干盖住，手臂从躯干轮廓里长出来，不会留一条灰缝。
 * @param shoulder 肩关节在屏幕平面上的点
 * @param height 身高（米）
 */
export function shoulderRoot(shoulder: Point2, height: number): Point2 {
  const insetX = ARM_SHOULDER_INSET_X * height
  const insetY = ARM_SHOULDER_INSET_Y * height
  const inward = Math.abs(shoulder.x) < 1e-6 ? 0 : shoulder.x > 0 ? -insetX : insetX
  return { x: shoulder.x + inward, y: shoulder.y - insetY }
}

/** 是否是走 2D 轮廓生成的手臂部件。 */
export function isArmPart(partId: string): boolean {
  return partId === 'armL' || partId === 'armR'
}

/**
 * 按截面试数取顶点数：上臂 `sections + 1` 个、肘部圆弧 `jointRings` 个、前臂 `sections + 1` 个截面。
 * @param sections 每段截面试数
 * @param jointRings 肘部中间截面数
 * @param wristRings 手腕中间截面数
 */
export function armOutlineVertexCount(
  sections = ARM_SECTIONS,
  jointRings = ARM_JOINT_RINGS,
  wristRings = ARM_WRIST_RINGS,
): number {
  return 2 * (2 * sections + jointRings + wristRings + 3)
}

/**
 * 从体型截面表取 `t` 处的半宽。手臂在屏幕上的宽度就是这一列。
 * @param profile 截面表
 * @param t 沿该段的参数，0 到 1
 */
export function halfWidthAt(profile: readonly { readonly t: number; readonly halfWidth: number }[], t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t
  for (let i = 0; i < profile.length - 1; i += 1) {
    const left = profile[i]!
    const right = profile[i + 1]!
    if (clamped < left.t || clamped > right.t) continue
    const span = right.t - left.t
    const u = span === 0 ? 0 : (clamped - left.t) / span
    return left.halfWidth * (1 - u) + right.halfWidth * u
  }
  throw new Error('profile')
}

/**
 * 把截面表包成 {@link WidthProfile}。
 * @param profile 截面表
 */
export function widthProfile(profile: readonly { readonly t: number; readonly halfWidth: number }[]): WidthProfile {
  return (t) => halfWidthAt(profile, t)
}

/**
 * 把掌根椭圆投影到屏幕后，沿腕口法线方向的半宽。
 * @param handDir 屏幕平面里的手方向
 * @param lateral 掌宽轴在屏幕上的投影
 * @param thickness 掌厚轴在屏幕上的投影
 * @param halfWidth 掌根半宽
 * @param halfThickness 掌根半厚
 */
export function wristHalfWidth(
  handDir: Point2,
  lateral: Point2,
  thickness: Point2,
  halfWidth: number,
  halfThickness: number,
): number {
  const dir = normalize(handDir)
  const nx = -dir.y
  const ny = dir.x
  const across = halfWidth * (lateral.x * nx + lateral.y * ny)
  const deep = halfThickness * (thickness.x * nx + thickness.y * ny)
  return Math.hypot(across, deep)
}

/**
 * 生成一条手臂的 2D 轮廓带。
 *
 * 两侧轮廓 = 中线 ± 法线 × 半宽；肘部用二次贝塞尔圆弧把两段接起来，
 * 直臂时圆弧退化成直线，不会产生零面积三角形。半宽为负时夹到 0，避免轮廓自交。
 * @param input 肩、肘、腕三个点与两段的宽度曲线
 */
export function buildArmOutline(input: ArmOutlineInput): OutlineMesh {
  const sections = Math.max(2, Math.floor(input.sections ?? DEFAULT_SECTIONS))
  const { shoulder, elbow, wrist } = input
  const shoulderDepth = input.shoulderDepth ?? 0
  const elbowDepth = input.elbowDepth ?? 0
  const wristDepth = input.wristDepth ?? 0
  const positions: number[] = []
  const depths: number[] = []
  const upperDir = direction(shoulder, elbow)
  const lowerDir = direction(elbow, wrist)
  const upperNormal = perpendicular(upperDir)
  const lowerNormal = perpendicular(lowerDir)
  const jointRings = Math.max(0, Math.floor(input.jointRings ?? ARM_JOINT_RINGS))
  const jointWidth = Math.min(input.upperWidth(1), input.lowerWidth(0))
  // 肘部用一段二次贝塞尔圆弧把两段接起来：控制点就是肘关节。
  // 直臂时 A、B、肘三点共线，圆弧退化成直线，不会产生零面积三角形。
  const radius = Math.max(1e-4, jointWidth * ARM_JOINT_RADIUS_RATIO)
  const start = { x: elbow.x - upperDir.x * radius, y: elbow.y - upperDir.y * radius }
  const end = { x: elbow.x + lowerDir.x * radius, y: elbow.y + lowerDir.y * radius }
  const handDir = normalize(input.handDir ?? lowerDir)
  const wristRings = Math.max(0, Math.floor(input.wristRings ?? ARM_WRIST_RINGS))
  const wristStartWidth = input.lowerWidth(1)
  const wristWidth = Math.max(0, input.wristWidth ?? wristStartWidth)
  const wristRadius = Math.max(1e-4, wristStartWidth * ARM_WRIST_RADIUS_RATIO)
  const wristStart = {
    x: wrist.x - lowerDir.x * wristRadius,
    y: wrist.y - lowerDir.y * wristRadius,
  }
  for (let s = 0; s <= sections; s += 1) {
    const t = s / sections
    const center = s === sections ? start : lerpPoint(shoulder, start, t)
    emit(center, upperNormal, input.upperWidth(t), lerp(shoulderDepth, elbowDepth, t), positions, depths)
  }
  for (let j = 1; j <= jointRings; j += 1) {
    const u = j / (jointRings + 1)
    const center = bezier(start, elbow, end, u)
    const tangent = bezierTangent(start, elbow, end, u)
    emit(center, perpendicular(tangent), jointWidth, elbowDepth, positions, depths)
  }
  for (let s = 0; s <= sections; s += 1) {
    const t = s / sections
    const center = s === 0 ? end : lerpPoint(end, wristStart, t)
    emit(center, lowerNormal, input.lowerWidth(t), lerp(elbowDepth, wristDepth, t), positions, depths)
  }
  // 腕部也用二次/三次曲线过渡：最后两圈跟着 hand 骨的方向走，手才不会从腕口脱开。
  const control1 = { x: wristStart.x + lowerDir.x * (wristRadius / 3), y: wristStart.y + lowerDir.y * (wristRadius / 3) }
  const control2 = { x: wrist.x - handDir.x * (wristRadius / 3), y: wrist.y - handDir.y * (wristRadius / 3) }
  for (let j = 1; j <= wristRings; j += 1) {
    const u = j / (wristRings + 1)
    const center = cubic(wristStart, control1, control2, wrist, u)
    const tangent = cubicTangent(wristStart, control1, control2, wrist, u)
    const half = wristStartWidth + (wristWidth - wristStartWidth) * u
    emit(center, perpendicular(tangent), half, wristDepth, positions, depths)
  }
  emit(wrist, perpendicular(handDir), wristWidth, wristDepth, positions, depths)
  const indices: number[] = []
  const ring = 2
  const total = 2 * sections + jointRings + wristRings + 3
  for (let r = 0; r + 1 < total; r += 1) {
    const a = r * ring
    const b = a + 1
    const c = a + ring
    const d = c + 1
    indices.push(a, b, c, b, d, c)
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint16Array(indices),
    depths: new Float32Array(depths),
  }
}

function emit(
  center: Point2,
  normal: Point2,
  half: number,
  depth: number,
  positions: number[],
  depths: number[],
): void {
  const w = Math.max(0, half)
  positions.push(center.x + normal.x * w, center.y + normal.y * w)
  positions.push(center.x - normal.x * w, center.y - normal.y * w)
  depths.push(depth, depth)
}

function bezier(a: Point2, control: Point2, b: Point2, t: number): Point2 {
  const u = 1 - t
  return {
    x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
  }
}

function bezierTangent(a: Point2, control: Point2, b: Point2, t: number): Point2 {
  const u = 1 - t
  const x = 2 * u * (control.x - a.x) + 2 * t * (b.x - control.x)
  const y = 2 * u * (control.y - a.y) + 2 * t * (b.y - control.y)
  const length = Math.hypot(x, y)
  if (length < 1e-9) return { x: 1, y: 0 }
  return { x: x / length, y: y / length }
}

function normalize(d: Point2): Point2 {
  const length = Math.hypot(d.x, d.y)
  if (length < 1e-9) return { x: 0, y: -1 }
  return { x: d.x / length, y: d.y / length }
}

function cubic(a: Point2, c1: Point2, c2: Point2, b: Point2, t: number): Point2 {
  const u = 1 - t
  const uu = u * u
  const tt = t * t
  return {
    x: uu * u * a.x + 3 * uu * t * c1.x + 3 * u * tt * c2.x + tt * t * b.x,
    y: uu * u * a.y + 3 * uu * t * c1.y + 3 * u * tt * c2.y + tt * t * b.y,
  }
}

function cubicTangent(a: Point2, c1: Point2, c2: Point2, b: Point2, t: number): Point2 {
  const u = 1 - t
  return normalize({
    x: 3 * u * u * (c1.x - a.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (b.x - c2.x),
    y: 3 * u * u * (c1.y - a.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (b.y - c2.y),
  })
}

function direction(a: Point2, b: Point2): Point2 {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-9) return { x: 0, y: -1 }
  return { x: dx / length, y: dy / length }
}

function perpendicular(d: Point2): Point2 {
  return { x: -d.y, y: d.x }
}

function lerpPoint(a: Point2, b: Point2, t: number): Point2 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
