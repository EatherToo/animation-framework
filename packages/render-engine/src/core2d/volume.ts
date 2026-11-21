/**
 * M6 Volume / 多视角扩展（只写本文件，不改动 2D 核心）。
 * 权威：docs/10-多视角与360.md、docs/10-多视角/{camera,volume,occlusion}.md。
 *
 * 数据边界：2D Pose 是权威，本模块只读 pose.local / pose.world；
 * 视角只改变代理的投影、深度键与附件选择，不写回任何 2D 骨通道。
 */
import { depthKeyFor, projectPoint, type Camera } from './camera'
import { normalizeAngle } from './math'
import { WORLD_STRIDE, type Pose } from './pose'
import { buildMeshPacket, type BlendMode, type RenderPacket } from './render'
import type { CompiledSkeleton } from './skeleton'

/** 角色镜像侧：'any' 表示正视或不区分左右。 */
export type Side = 'left' | 'right' | 'any'

/** 视图依赖附件规则：角度为弧度，区间闭合并支持跨 ±π 的 wrap。 */
export type ViewRule = {
  slot: number
  attachment: string
  skin?: string
  yaw: [number, number] | 'any'
  pitch: [number, number] | 'any'
  side?: Side
  priority: number
  hysteresisDeg: number
  fadeSec: number
  fallback?: string
}

/**
 * 体积代理。local 为相对骨骼的 4x4 列主序矩阵（16 个 float）；
 * kind='convex' 时退化为打包顶点数组，见 localVertices 的注释。
 */
export type VolumeProxy = {
  id: string
  bone: number
  kind: 'capsule' | 'ellipsoid' | 'box' | 'convex'
  local: Float32Array /* 16 */
  radius: readonly [number, number, number]
  height: number
  lod: 0 | 1 | 2 | 3
}

/** Volume 装配：2D 编译骨架 + 绑定在骨上的代理集合。 */
export type VolumeRig = {
  readonly skeleton: CompiledSkeleton
  readonly proxies: readonly VolumeProxy[]
}

/** 验收用 8 档 yaw（度），与 docs/10-多视角/volume.md §9 固定视角一致。 */
export const FIXED_VIEW_ANGLES: [0, 45, 90, 135, 180, 225, 270, 315] = [
  0, 45, 90, 135, 180, 225, 270, 315,
]

const TAU = Math.PI * 2
const DEG_TO_RAD = Math.PI / 180
const EPS = 1e-9
/** 屏幕误差的像素容差：screenError = 投影半径(px) / 容差。 */
const PIXEL_TOLERANCE = 2
/** 骨世界旋转派生出的 z 微调幅度（米），远小于代理半径，避免侧视完全塌陷。 */
const ROTATION_DEPTH_SCALE = 0.02
/**
 * 本模块的预算约定：lod 数值越小越省预算（0 最省，3 最精细）。
 * 因此 selectLod 在误差增大时返回更小的数值；周向顶点数与之对应为 8/10/12/16。
 */
const SEGMENTS_BY_LOD: readonly [number, number, number, number] = [8, 10, 12, 16]
const DEFAULT_COLOR: readonly [number, number, number, number] = [1, 1, 1, 1]
const VOLUME_MATERIAL_ID = 0
const IDENTITY_MAT4: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

const finite = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback)

// ---------------------------------------------------------------------------
// resolveViewRule：规则求值、滞回、淡入与 fallback
// ---------------------------------------------------------------------------

/** 从 from 到 to 的正向角弧，落在 [0, 2π)；用于跨 ±π 的区间判断。 */
function positiveArc(from: number, to: number): number {
  const d = normalizeAngle(to - from)
  return d < 0 ? d + TAU : d
}

/** 闭区间命中；跨 ±π 的 [a,b]（a>b）按 wrap 后的正向弧判断。 */
function inAngleRange(value: number, range: [number, number] | 'any', extraRad: number): boolean {
  if (range === 'any') return true
  if (!Number.isFinite(value)) return false
  const start = normalizeAngle(range[0])
  const span = positiveArc(start, normalizeAngle(range[1]))
  // [a,a] 视作整圈，避免零宽区间导致规则完全不可用。
  if (span <= EPS) return true
  return positiveArc(start, normalizeAngle(value)) <= span + extraRad
}

/**
 * 侧别由相机 yaw 符号近似：yaw>0 看到角色右侧，yaw<0 看到左侧；
 * yaw≈0 视为 'any'，此时不启用 left/right 专属附件（正视不该露出单侧件）。
 * 真正的镜像/facing 由上层给出时，可在传入相机前把 yaw 归一化。
 */
function cameraSide(camera: Camera): Side {
  const yaw = normalizeAngle(camera.yaw)
  if (!Number.isFinite(yaw) || Math.abs(yaw) < EPS) return 'any'
  return yaw > 0 ? 'right' : 'left'
}

function sideMatches(rule: ViewRule, current: Side): boolean {
  const wanted: Side = rule.side ?? 'any'
  if (wanted === 'any') return true
  return current !== 'any' && wanted === current
}

function hysteresisRad(rule: ViewRule): number {
  const h = rule.hysteresisDeg
  return Number.isFinite(h) && h > 0 ? h * DEG_TO_RAD : 0
}

function selected(
  rule: ViewRule,
  elapsed: number,
): { attachment: string; fadeAlpha: number; rule: ViewRule } {
  let fadeAlpha = 1
  if (Number.isFinite(rule.fadeSec) && rule.fadeSec > 0) {
    const t = Number.isFinite(elapsed) ? elapsed : 0
    fadeAlpha = Math.min(1, Math.max(0, t / rule.fadeSec))
  }
  return { attachment: rule.attachment, fadeAlpha, rule }
}

/**
 * 解析某槽位在当前视角下的附件。
 * 顺序：① prev 对应规则在 hysteresisDeg 扩展区间内仍成立则保持（防抖）；
 * ② 否则取严格命中规则中 priority 最大者（同优先级按规则下标稳定）；
 * ③ 未命中时用 fallback，再退回 null。elapsed 为距切换到该规则的秒数。
 */
export function resolveViewRule(
  rules: readonly ViewRule[],
  camera: Camera,
  slot: number,
  prev: string | null,
  elapsed: number,
): { attachment: string | null; fadeAlpha: number; rule: ViewRule | null } {
  const entries = rules
    .map((rule, index) => ({ rule, index }))
    .filter((entry) => entry.rule.slot === slot)
  entries.sort((a, b) => b.rule.priority - a.rule.priority || a.index - b.index)

  const side = cameraSide(camera)
  const fits = (rule: ViewRule, extraRad: number): boolean =>
    inAngleRange(camera.yaw, rule.yaw, extraRad) &&
    inAngleRange(camera.pitch, rule.pitch, extraRad) &&
    sideMatches(rule, side)

  if (prev !== null) {
    const keep = entries.find((entry) => entry.rule.attachment === prev && fits(entry.rule, hysteresisRad(entry.rule)))
    if (keep !== undefined) return selected(keep.rule, elapsed)
  }
  const best = entries.find((entry) => fits(entry.rule, 0))
  if (best !== undefined) return selected(best.rule, elapsed)
  const fallback = entries.find((entry) => entry.rule.fallback !== undefined)
  if (fallback !== undefined && fallback.rule.fallback !== undefined) {
    return { attachment: fallback.rule.fallback, fadeAlpha: 1, rule: null }
  }
  return { attachment: null, fadeAlpha: 1, rule: null }
}

// ---------------------------------------------------------------------------
// projectProxy：代理低模 → 骨世界 → 相机屏幕
// ---------------------------------------------------------------------------

/** 内部投影结果：depths/centerViewZ 供 packet 的逐顶点 z 与 depthKey 使用。 */
type ProxyProjection = {
  vertices: Float32Array
  indices: Uint16Array
  depthKey: number
  screenError: number
  depths: Float32Array
  centerViewZ: number
}

/** 2D 骨世界仿射 [a,b,c,d,tx,ty]，以及由旋转 atan2(b,a) 派生的微小 z 偏移。 */
type BoneWorld = {
  a: number; b: number; c: number; d: number; tx: number; ty: number; nudge: number
}

function readBoneWorld(pose: Pose, bone: number): BoneWorld {
  const at = (i: number, fallback: number): number => {
    const off = bone * WORLD_STRIDE
    const v = off >= 0 && off + i < pose.world.length ? pose.world[off + i] : undefined
    return finite(v ?? fallback, fallback)
  }
  const a = at(0, 1)
  const b = at(1, 0)
  const c = at(2, 0)
  const d = at(3, 1)
  const rotation = Math.atan2(b, a)
  return {
    a, b, c, d,
    tx: at(4, 0),
    ty: at(5, 0),
    nudge: ROTATION_DEPTH_SCALE * Math.sin(finite(rotation, 0)),
  }
}

/** 列主序 4x4 的左乘：out = M · (x,y,z,1)，缺失/非有限元素回退为单位矩阵。 */
function applyLocalMatrix(m: Float32Array, x: number, y: number, z: number): [number, number, number] {
  const at = (i: number): number => finite(m[i] ?? IDENTITY_MAT4[i]!, IDENTITY_MAT4[i]!)
  return [
    at(0) * x + at(4) * y + at(8) * z + at(12),
    at(1) * x + at(5) * y + at(9) * z + at(13),
    at(2) * x + at(6) * y + at(10) * z + at(14),
  ]
}

/** 代理局部顶点（x,y,z 交错）。ellipsoid/capsule/box 共用 8–16 顶点的环形近似。 */
function localVertices(proxy: VolumeProxy): Float32Array {
  if (proxy.kind === 'convex') {
    // 退化处理：convex 的 local 直接当作打包顶点数组 [x,y,z]×N（N≤5），不再二次应用矩阵。
    const count = Math.max(3, Math.min(5, Math.floor(proxy.local.length / 3)))
    const out = new Float32Array(count * 3)
    for (let i = 0; i < count; i += 1) {
      out[i * 3] = finite(proxy.local[i * 3] ?? 0, 0)
      out[i * 3 + 1] = finite(proxy.local[i * 3 + 1] ?? 0, 0)
      out[i * 3 + 2] = finite(proxy.local[i * 3 + 2] ?? 0, 0)
    }
    return out
  }
  const count = SEGMENTS_BY_LOD[proxy.lod] ?? SEGMENTS_BY_LOD[0]!
  const out = new Float32Array(count * 3)
  const rx = Math.abs(finite(proxy.radius[0], 0.1))
  const ry = Math.abs(finite(proxy.radius[1], 0.1))
  const baseZ = Math.abs(finite(proxy.radius[2], 0.1))
  // capsule/box 让轴向高度也贡献厚度，避免从侧面投影成一条线。
  const rz = proxy.kind === 'ellipsoid' ? baseZ : Math.max(baseZ, Math.abs(finite(proxy.height, 0)) * 0.25)
  for (let i = 0; i < count; i += 1) {
    const theta = (TAU * i) / count
    out[i * 3] = rx * Math.cos(theta)
    out[i * 3 + 1] = ry * Math.sin(theta)
    // sin(2θ) 让 x 与 z 不同相，保证 0/90/180/270 四视角都非退化。
    out[i * 3 + 2] = rz * Math.sin(2 * theta)
  }
  return out
}

/** 扇形三角化：0 为锚点，输出全为合法 Uint16 索引。 */
function fanIndices(vertexCount: number): Uint16Array {
  const out = new Uint16Array(Math.max(0, vertexCount - 2) * 3)
  let cursor = 0
  for (let i = 1; i + 1 < vertexCount; i += 1) {
    out[cursor++] = 0
    out[cursor++] = i
    out[cursor++] = i + 1
  }
  return out
}

function projectDetail(proxy: VolumeProxy, pose: Pose, camera: Camera): ProxyProjection {
  const shape = localVertices(proxy)
  const count = shape.length / 3
  const bone = readBoneWorld(pose, proxy.bone)
  const viewportW = finite(camera.viewport.width, 1)
  const viewportH = finite(camera.viewport.height, 1)

  // 中心：取 local 原点（convex 的打包顶点以原点为参考）。
  const centerLocal: [number, number, number] = proxy.kind === 'convex'
    ? [0, 0, 0]
    : applyLocalMatrix(proxy.local, 0, 0, 0)
  const center = projectPoint(camera, [
    bone.a * centerLocal[0] + bone.c * centerLocal[1] + bone.tx,
    bone.b * centerLocal[0] + bone.d * centerLocal[1] + bone.ty,
    centerLocal[2] + bone.nudge,
  ])

  const vertices = new Float32Array(count * 2)
  const depths = new Float32Array(count)
  let maxRadius = 0
  for (let i = 0; i < count; i += 1) {
    let lx = shape[i * 3]!
    let ly = shape[i * 3 + 1]!
    let lz = shape[i * 3 + 2]!
    if (proxy.kind !== 'convex') {
      const transformed = applyLocalMatrix(proxy.local, lx, ly, lz)
      lx = transformed[0]
      ly = transformed[1]
      lz = transformed[2]
    }
    // 3D 位置取骨 world 的 (tx,ty)；z 取 local.z + 骨旋转派生的小量，不写回 2D pose。
    const projected = projectPoint(camera, [
      bone.a * lx + bone.c * ly + bone.tx,
      bone.b * lx + bone.d * ly + bone.ty,
      lz + bone.nudge,
    ])
    vertices[i * 2] = finite(projected.x, viewportW / 2)
    vertices[i * 2 + 1] = finite(projected.y, viewportH / 2)
    depths[i] = finite(projected.viewZ, 0)
    const dx = finite(projected.x - center.x, 0)
    const dy = finite(projected.y - center.y, 0)
    maxRadius = Math.max(maxRadius, Math.hypot(dx, dy))
  }

  const centerViewZ = finite(center.viewZ, 0)
  return {
    vertices,
    indices: fanIndices(count),
    depthKey: depthKeyFor('volume', 0, centerViewZ),
    screenError: Math.max(0, finite(maxRadius / PIXEL_TOLERANCE, 0)),
    depths,
    centerViewZ,
  }
}

/**
 * 把代理投到屏幕：vertices 为设备像素的 (x,y) 交错顶点，indices 为扇形三角形。
 * depthKey 由相机 viewZ 经 depthKeyFor('volume',...) 得到；screenError 为投影半径/像素容差。
 */
export function projectProxy(
  proxy: VolumeProxy,
  pose: Pose,
  camera: Camera,
): { vertices: Float32Array; indices: Uint16Array; depthKey: number; screenError: number } {
  const detail = projectDetail(proxy, pose, camera)
  return {
    vertices: detail.vertices,
    indices: detail.indices,
    depthKey: detail.depthKey,
    screenError: detail.screenError,
  }
}

// ---------------------------------------------------------------------------
// LOD / packet / 排序
// ---------------------------------------------------------------------------

/**
 * 按屏幕误差选 LOD。阈值：e>=4 → 0，e>=2 → 1，e>=1 → 2，其余 → 3。
 * 误差增大意味着近似代价过高，返回更小的 lod 数值以省预算（见 SEGMENTS_BY_LOD 注释）。
 * proxy 供后续按形状微调阈值，当前各形状共用同一张阈值表。
 */
export function selectLod(proxy: VolumeProxy, screenError: number): 0 | 1 | 2 | 3 {
  void proxy
  const e = Number.isFinite(screenError) ? Math.max(0, screenError) : Number.POSITIVE_INFINITY
  if (e >= 4) return 0
  if (e >= 2) return 1
  if (e >= 1) return 2
  return 3
}

/**
 * 为每个代理产出一个 mesh packet。positions 是屏幕像素顶点，depth 是逐顶点 viewZ
 * （世界深度），二者合起来表达 world/screen 顶点；depthKey 统一走 depthKeyFor。
 * 前置条件：调用方已对 pose 执行 updateWorld；本函数只读 pose，不触发 FK、不写回。
 */
export function buildVolumePackets(
  rig: VolumeRig,
  pose: Pose,
  camera: Camera,
  opts?: { startId?: number; blend?: BlendMode; color?: readonly [number, number, number, number] },
): RenderPacket[] {
  const startId = opts?.startId ?? 0
  const blend: BlendMode = opts?.blend ?? 'normal'
  const color = opts?.color ?? DEFAULT_COLOR
  return rig.proxies.map((proxy, index) => {
    const detail = projectDetail(proxy, pose, camera)
    return buildMeshPacket({
      id: startId + index,
      kind: 'mesh',
      positions: detail.vertices,
      indices: detail.indices,
      depth: detail.depths,
      color,
      materialId: VOLUME_MATERIAL_ID,
      order: index,
      depthKey: depthKeyFor('volume', 0, detail.centerViewZ),
      subOrder: 0,
      seq: index,
      blend,
    })
  })
}

/**
 * 三种模式的明确排序：
 * - 2d：order → depthKey → subOrder → seq 全升序（画家算法，远先画）。
 * - 2.5d：depthKey 主序升序 → order → subOrder → seq；深度翻转的阈值滞回由调用方提供。
 * - volume：depthKey 降序（近→远），服务不透明 z-buffer 的 early-z 提交；
 *   不透明几何顺序无关，透明代理需调用方另行按 depthKey 升序（远→近）且不写深度。
 * 不修改输入数组或 packet；同键按原始下标稳定。
 */
export function sortByMode(packets: readonly RenderPacket[], mode: '2d' | '2.5d' | 'volume'): RenderPacket[] {
  const decorated = packets.map((packet, index) => ({ packet, index }))
  decorated.sort((x, y) => {
    const a = x.packet
    const b = y.packet
    let cmp = 0
    if (mode === '2d') {
      cmp = a.order - b.order
      if (cmp === 0) cmp = a.depthKey - b.depthKey
    } else if (mode === '2.5d') {
      cmp = a.depthKey - b.depthKey
      if (cmp === 0) cmp = a.order - b.order
    } else {
      cmp = b.depthKey - a.depthKey
      if (cmp === 0) cmp = a.order - b.order
    }
    if (cmp === 0) cmp = a.subOrder - b.subOrder
    if (cmp === 0) cmp = a.seq - b.seq
    return cmp || x.index - y.index
  })
  return decorated.map((entry) => entry.packet)
}
