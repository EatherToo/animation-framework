/** M4 相机：yaw/pitch 正交基、屏幕投影、视图矩阵与视相关深度键。 */

export type ViewMode = '2d' | '2.5d' | 'volume'

export type Camera = {
  kind: 'ortho' | 'perspective'
  yaw: number
  pitch: number
  roll: number
  target: readonly [number, number, number]
  distance: number
  orthoHeight: number
  zoom: number
  near: number
  far: number
  viewport: { width: number; height: number; dpr: number }
}

/** 默认正视正交相机；所有字段必填，前视只是 yaw=0 的一个实例。 */
export const DEFAULT_CAMERA: Camera = {
  kind: 'ortho',
  yaw: 0,
  pitch: 0,
  roll: 0,
  target: [0, 0, 0],
  distance: 5,
  orthoHeight: 2,
  zoom: 1,
  near: 0.1,
  far: 1000,
  viewport: { width: 800, height: 600, dpr: 1 },
}

/** 验收常用的 8 档 yaw（角度）。 */
export const FIXED_YAW_DEGREES: [0, 45, 90, 135, 180, 225, 270, 315] = [0, 45, 90, 135, 180, 225, 270, 315]

const MAX_PITCH = (75 * Math.PI) / 180
const EPS = 1e-6

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const finite = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback)

type Vec3 = [number, number, number]

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])
  if (len < EPS) return [0, 0, 0]
  return [v[0] / len, v[1] / len, v[2] / len]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
}

export interface CameraBasis {
  forward: Vec3
  right: Vec3
  up: Vec3
  eye: Vec3
}

/** forward = normalize(-sin(yaw)cos(pitch), -sin(pitch), -cos(yaw)cos(pitch))。 */
export function cameraBasis(camera: Camera): CameraBasis {
  const yaw = finite(camera.yaw, 0)
  const pitch = clamp(finite(camera.pitch, 0), -MAX_PITCH, MAX_PITCH)
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const forward = normalize([-sy * cp, -sp, -cy * cp])

  // worldUp=(0,1,0)；pitch 钳位后不会退化，仍保留文档约定的兜底。
  let right = normalize(cross(forward, [0, 1, 0]))
  if (Math.hypot(right[0], right[1], right[2]) < EPS) right = [1, 0, 0]
  let up = normalize(cross(right, forward))

  // roll 绕视轴旋转 right/up；默认 0 时与文档基向量完全一致。
  const roll = finite(camera.roll, 0)
  if (roll !== 0) {
    const c = Math.cos(roll)
    const s = Math.sin(roll)
    const r: Vec3 = [right[0]! * c + up[0]! * s, right[1]! * c + up[1]! * s, right[2]! * c + up[2]! * s]
    const u: Vec3 = [up[0]! * c - right[0]! * s, up[1]! * c - right[1]! * s, up[2]! * c - right[2]! * s]
    right = r
    up = u
  }

  const distance = finite(camera.distance, 0)
  const eye: Vec3 = [
    camera.target[0] - forward[0]! * distance,
    camera.target[1] - forward[1]! * distance,
    camera.target[2] - forward[2]! * distance,
  ]
  return { forward, right, up, eye }
}

function ppmOf(camera: Camera): number {
  const h = Math.max(1, finite(camera.viewport.height, 1))
  const orthoHeight = Math.max(EPS, finite(camera.orthoHeight, EPS))
  return (finite(camera.zoom, 1) * h) / orthoHeight
}

/** 世界点 → 设备像素（左上原点、y 向下）；y 只在最后翻转一次。 */
export function projectPoint(
  camera: Camera,
  p: readonly [number, number, number],
): { x: number; y: number; viewZ: number; depthKey: number } {
  const basis = cameraBasis(camera)
  const q: Vec3 = [p[0] - basis.eye[0]!, p[1] - basis.eye[1]!, p[2] - basis.eye[2]!]
  const viewX = dot(basis.right, q)
  const viewY = dot(basis.up, q)
  const viewZ = dot(basis.forward, q)

  const w = Math.max(1, finite(camera.viewport.width, 1))
  const h = Math.max(1, finite(camera.viewport.height, 1))
  let x: number
  let y: number
  if (camera.kind === 'perspective') {
    // 以 target 平面恰好奇高 orthoHeight 推导 fov，避免额外字段。
    const safeZ = Math.abs(viewZ) < EPS ? EPS : viewZ
    const aspect = w / h
    const f = finite(camera.distance, 1) / Math.max(EPS, finite(camera.orthoHeight, 1) / 2)
    const ndcX = (viewX / safeZ) * (f / aspect)
    const ndcY = (viewY / safeZ) * f
    x = (ndcX * 0.5 + 0.5) * w
    y = (0.5 - ndcY * 0.5) * h
  } else {
    const ppm = ppmOf(camera)
    x = w / 2 + viewX * ppm
    y = h / 2 - viewY * ppm
  }
  return { x, y, viewZ, depthKey: -viewZ }
}

/** 设备像素 + 给定 viewZ → 世界点；与 projectPoint 互逆（容差 <0.5px）。 */
export function unprojectPoint(
  camera: Camera,
  screenX: number,
  screenY: number,
  viewZ: number,
): [number, number, number] {
  const basis = cameraBasis(camera)
  const w = Math.max(1, finite(camera.viewport.width, 1))
  const h = Math.max(1, finite(camera.viewport.height, 1))
  let viewX: number
  let viewY: number
  if (camera.kind === 'perspective') {
    const safeZ = Math.abs(viewZ) < EPS ? EPS : viewZ
    const aspect = w / h
    const f = finite(camera.distance, 1) / Math.max(EPS, finite(camera.orthoHeight, 1) / 2)
    const ndcX = (screenX / w) * 2 - 1
    const ndcY = 1 - (screenY / h) * 2
    viewX = (ndcX * safeZ * aspect) / f
    viewY = (ndcY * safeZ) / f
  } else {
    const ppm = ppmOf(camera)
    viewX = (screenX - w / 2) / ppm
    viewY = (h / 2 - screenY) / ppm
  }
  return [
    basis.eye[0]! + basis.right[0]! * viewX + basis.up[0]! * viewY + basis.forward[0]! * viewZ,
    basis.eye[1]! + basis.right[1]! * viewX + basis.up[1]! * viewY + basis.forward[1]! * viewZ,
    basis.eye[2]! + basis.right[2]! * viewX + basis.up[2]! * viewY + basis.forward[2]! * viewZ,
  ]
}

/** 3x3 列主序、设备像素空间的 2D 视图矩阵；忽略 z（2D 核心不做透视除法）。 */
export function viewProjection2D(camera: Camera): Float32Array {
  const basis = cameraBasis(camera)
  const ppm = ppmOf(camera)
  const w = Math.max(1, finite(camera.viewport.width, 1))
  const h = Math.max(1, finite(camera.viewport.height, 1))
  const eyeDotRight = dot(basis.right, basis.eye)
  const eyeDotUp = dot(basis.up, basis.eye)
  return new Float32Array([
    ppm * basis.right[0]!, -ppm * basis.up[0]!, 0,
    ppm * basis.right[1]!, -ppm * basis.up[1]!, 0,
    w / 2 - ppm * eyeDotRight, h / 2 + ppm * eyeDotUp, 1,
  ])
}

/**
 * 排序深度键：2d 直接用作者给的无量纲 zOffset（不重算相机深度）；
 * 2.5d/volume 把 -viewZ 映射到层带 [-100,100] 并叠加细调偏移。
 */
export function depthKeyFor(mode: ViewMode, zOffset: number, viewZ: number): number {
  if (mode === '2d') return zOffset
  return clamp(-viewZ + zOffset, -100, 100)
}
