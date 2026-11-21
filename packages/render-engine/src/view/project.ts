import {
  ARM_SHOULDER_DEPTH_BIAS,
  buildArmOutline,
  shoulderRoot,
  wristHalfWidth,
  type ArmOutlineBones,
} from '../outline/arm'

/** 绕身一圈的视角档数。 */
export const VIEW_COUNT = 360

/** 相邻两档之间的角度，度。 */
export const VIEW_STEP_DEG = 1

/** 深度相差不到这个量（米）的两个部件算同一深度，改用槽位次序。 */
export const DEPTH_EPSILON = 1e-4

/** 屏幕上的叉积低于负的这个量，才把三角形调回逆时针。 */
export const WINDING_EPSILON = 1e-8

/** 视角下标：`0..359` 的整数，角度是下标乘 1°。 */
export type ViewIndex = number

/** 投影的输入：一个部件在角色空间的顶点，步长 3。 */
export type ViewSource = {
  readonly partId: string
  readonly positions: Float32Array
  readonly indices: Uint16Array
  readonly seam: Uint8Array
  /** 2D 手臂：当前姿态的三维骨轴端点与宽度；投影时按视角重建屏幕轮廓。 */
  readonly arm?: ArmOutlineBones
}

/**
 * 一个部件投影后的平面三角形。
 * `positions` 交错存放屏幕横、屏幕竖；`indices` 已调成屏幕上的逆时针；
 * `depth` 是该部件顶点深度的平均值，较大的更远。
 */
export type ProjectedPart = {
  readonly partId: string
  readonly positions: Float32Array
  readonly indices: Uint16Array
  readonly depth: number
  readonly seam: Uint8Array
  /** 逐顶点深度；只有按屏幕轮廓重建的 2D 手臂提供。 */
  readonly depths?: Float32Array
}

const QUARTER = VIEW_COUNT / 4
const HALF = VIEW_COUNT / 2

const SIN = new Float64Array(VIEW_COUNT)
const COS = new Float64Array(VIEW_COUNT)

for (let k = 0; k < VIEW_COUNT; k += 1) {
  SIN[k] = sineOf(k)
  COS[k] = sineOf((k + QUARTER) % VIEW_COUNT)
}

/** 先折回第一象限再取正弦，四个正方位上得到精确的 0 和 ±1。 */
function sineOf(k: number): number {
  const half = k % HALF
  const base = half <= QUARTER ? half : HALF - half
  if (base === 0) return 0
  const value = base === QUARTER ? 1 : Math.sin((base * VIEW_STEP_DEG * Math.PI) / 180)
  return k < HALF ? value : -value
}

/**
 * 是否是合法的视角下标。
 * @param view 待判定值
 */
export function isViewIndex(view: unknown): view is ViewIndex {
  return typeof view === 'number' && Number.isInteger(view) && view >= 0 && view < VIEW_COUNT
}

/**
 * 该档视角的角度，弧度。非法下标抛出 `view`。
 * @param view 视角下标
 */
export function viewAngle(view: ViewIndex): number {
  if (!isViewIndex(view)) throw new Error('view')
  return (view * VIEW_STEP_DEG * Math.PI) / 180
}

/**
 * 把角色空间的点绕竖直轴正交投影。
 * `out` 交错写入屏幕横、屏幕竖；返回顶点深度的平均值。
 * 失败时抛出且不写 `out`：先 `view`，再 `positions`，再 `out`。
 * @param out 长度是顶点数的 2 倍
 * @param positions 角色空间顶点，步长 3
 * @param view 视角下标
 */
export function projectPositions(
  out: Float32Array,
  positions: Float32Array,
  view: ViewIndex,
): number {
  if (!isViewIndex(view)) throw new Error('view')
  if (positions.length === 0 || positions.length % 3 !== 0) throw new Error('positions')
  const count = positions.length / 3
  if (out.length !== count * 2) throw new Error('out')

  const sin = SIN[view]!
  const cos = COS[view]!
  let depth = 0
  for (let v = 0; v < count; v += 1) {
    const x = positions[v * 3]!
    const y = positions[v * 3 + 1]!
    const z = positions[v * 3 + 2]!
    out[v * 2] = x * cos + z * sin
    out[v * 2 + 1] = y
    depth += z * cos - x * sin
  }
  return depth / count
}

/**
 * 抄一份索引，并把屏幕上顺时针的三角形调回逆时针。
 * 侧对视线的三角形保持原样。
 * 失败时抛出且不写 `out`：`indices` 长度不是 3 的倍数或下标越界，`out` 长度不符。
 * @param out 与 `indices` 等长
 * @param indices 三角形索引
 * @param screen 投影后的平面点，步长 2
 */
export function windIndices(
  out: Uint16Array,
  indices: Uint16Array,
  screen: Float32Array,
): Uint16Array {
  if (indices.length % 3 !== 0) throw new Error('indices')
  const count = screen.length / 2
  for (let i = 0; i < indices.length; i += 1) {
    if (indices[i]! >= count) throw new Error('indices')
  }
  if (out.length !== indices.length) throw new Error('out')

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!
    const b = indices[t + 1]!
    const c = indices[t + 2]!
    const ax = screen[a * 2]!
    const ay = screen[a * 2 + 1]!
    const cross =
      (screen[b * 2]! - ax) * (screen[c * 2 + 1]! - ay) -
      (screen[b * 2 + 1]! - ay) * (screen[c * 2]! - ax)
    out[t] = a
    if (cross < -WINDING_EPSILON) {
      out[t + 1] = c
      out[t + 2] = b
    } else {
      out[t + 1] = b
      out[t + 2] = c
    }
  }
  return out
}

/**
 * 按一档视角投影全部部件。结果与输入按下标对齐。
 * 非法下标抛出 `view`，不返回任何投影。
 * @param parts 蒙皮后的角色空间顶点
 * @param view 视角下标
 */
export function projectParts(parts: readonly ViewSource[], view: ViewIndex): ProjectedPart[] {
  if (!isViewIndex(view)) throw new Error('view')
  const projected: ProjectedPart[] = []
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!
    if (part.arm !== undefined) {
      const outline = projectArm(part.arm, view)
      if (outline.positions.length / 2 !== part.positions.length / 3) throw new Error('arm')
      const indices = windIndices(new Uint16Array(part.indices.length), part.indices, outline.positions)
      let depth = 0
      for (let v = 0; v < outline.depths.length; v += 1) depth += outline.depths[v]!
      projected.push({
        partId: part.partId,
        positions: outline.positions,
        indices,
        depth: depth / outline.depths.length,
        seam: part.seam,
        depths: outline.depths,
      })
      continue
    }
    const positions = new Float32Array((part.positions.length / 3) * 2)
    const depth = projectPositions(positions, part.positions, view)
    const indices = windIndices(new Uint16Array(part.indices.length), part.indices, positions)
    projected.push({ partId: part.partId, positions, indices, depth, seam: part.seam })
  }
  return projected
}

/**
 * 按当前视角把一条 2D 手臂的三根骨轴投影到屏幕平面，再重建轮廓带。
 * 顶点仍然是 2D 的 (屏幕横, 屏幕竖)，深度单独给排序。
 * @param arm 三维骨轴端点与宽度曲线
 * @param view 视角下标
 */
function projectArm(arm: ArmOutlineBones, view: ViewIndex): ReturnType<typeof buildArmOutline> {
  const sin = SIN[view]!
  const cos = COS[view]!
  const root = shoulderRoot(
    { x: arm.shoulder.x * cos + arm.shoulder.z * sin, y: arm.shoulder.y },
    arm.height,
  )
  const wrist = { x: arm.wrist.x * cos + arm.wrist.z * sin, y: arm.wrist.y }
  const handTip = {
    x: arm.handTip.x * cos + arm.handTip.z * sin,
    y: arm.handTip.y,
  }
  const handDir = { x: handTip.x - wrist.x, y: handTip.y - wrist.y }
  const wristWidth = wristHalfWidth(
    handDir,
    {
      x: arm.handLateral.x * cos + arm.handLateral.z * sin,
      y: arm.handLateral.y,
    },
    {
      x: arm.handThicknessAxis.x * cos + arm.handThicknessAxis.z * sin,
      y: arm.handThicknessAxis.y,
    },
    arm.palmHalfWidth,
    arm.palmHalfThickness,
  )
  return buildArmOutline({
    shoulder: root,
    elbow: { x: arm.elbow.x * cos + arm.elbow.z * sin, y: arm.elbow.y },
    wrist,
    handDir,
    wristWidth,
    upperWidth: arm.upperWidth,
    lowerWidth: arm.lowerWidth,
    sections: arm.sections,
    shoulderDepth:
      arm.shoulder.z * cos - arm.shoulder.x * sin + ARM_SHOULDER_DEPTH_BIAS * arm.height,
    elbowDepth: arm.elbow.z * cos - arm.elbow.x * sin,
    wristDepth: arm.wrist.z * cos - arm.wrist.x * sin,
  })
}

/**
 * 从远到近把部件 id 写入 `out`。深度大的在前；深度相同按 `tie` 里的先后。
 * `tie` 是 07 给出的槽位次序。失败时抛出且不写 `out`：
 * `out` 长度不符抛出 `order`，部件不在 `tie` 里抛出 `slot`。
 * @param out 长度必须等于部件数
 * @param parts 已投影的部件
 * @param tie 深度相同时使用的槽位次序
 * @returns `out`
 */
export function depthOrder(
  out: string[],
  parts: readonly ProjectedPart[],
  tie: readonly string[],
): string[] {
  const count = parts.length
  if (out.length !== count) throw new Error('order')
  const rank = new Array<number>(count)
  const level = new Array<number>(count)
  const order = new Array<number>(count)
  for (let i = 0; i < count; i += 1) {
    const part = parts[i]!
    const found = tie.indexOf(part.partId)
    if (found < 0) throw new Error('slot')
    rank[i] = found
    level[i] = Math.round(part.depth / DEPTH_EPSILON)
    order[i] = i
  }
  order.sort((a, b) => {
    if (level[a]! !== level[b]!) return level[b]! - level[a]!
    if (rank[a]! !== rank[b]!) return rank[a]! - rank[b]!
    return a - b
  })
  for (let i = 0; i < count; i += 1) out[i] = parts[order[i]!]!.partId
  return out
}
