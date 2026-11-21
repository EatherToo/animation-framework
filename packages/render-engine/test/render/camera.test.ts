import { describe, expect, it } from '@jest/globals'
import {
  cameraBasis,
  DEFAULT_CAMERA,
  depthKeyFor,
  FIXED_YAW_DEGREES,
  projectPoint,
  unprojectPoint,
  viewProjection2D,
  type Camera,
} from '@/render/camera'

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)
const rad = (deg: number) => (deg * Math.PI) / 180

function makeCam(over: Partial<Camera> = {}): Camera {
  return {
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
    viewport: { width: 16, height: 16, dpr: 1 },
    ...over,
  }
}

/** 3x3 列主序矩阵作用于二维齐次点 (x, y, 1)。 */
function applyM3(m: Float32Array, x: number, y: number): [number, number] {
  return [m[0]! * x + m[3]! * y + m[6]!, m[1]! * x + m[4]! * y + m[7]!]
}

const dot3 = (a: readonly [number, number, number], b: readonly [number, number, number]) =>
  a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
const len3 = (a: readonly [number, number, number]) => Math.hypot(a[0]!, a[1]!, a[2]!)

describe('M4 camera: 默认契约与相机基', () => {
  it('DEFAULT_CAMERA 字段齐全，固定 yaw 档位精确', () => {
    const c = DEFAULT_CAMERA
    expect(c.kind === 'ortho' || c.kind === 'perspective').toBe(true)
    for (const v of [c.yaw, c.pitch, c.roll, c.distance, c.orthoHeight, c.zoom, c.near, c.far]) {
      expect(Number.isFinite(v)).toBe(true)
    }
    expect(c.target.length).toBe(3)
    expect(c.viewport.width).toBeGreaterThan(0)
    expect(c.viewport.height).toBeGreaterThan(0)
    expect(c.viewport.dpr).toBeGreaterThan(0)
    expect(FIXED_YAW_DEGREES).toEqual([0, 45, 90, 135, 180, 225, 270, 315])
  })

  it('正视相机基与文档一致', () => {
    const b = cameraBasis(makeCam())
    expect(b.forward[0]).toBeCloseTo(0, 10)
    expect(b.forward[1]).toBeCloseTo(0, 10)
    expect(b.forward[2]).toBeCloseTo(-1, 10)
    expect(b.right[0]).toBeCloseTo(1, 10)
    expect(b.up[1]).toBeCloseTo(1, 10)
    close(b.eye[2]!, 5)
  })

  it('8 档 yaw × 多档 pitch（含越界俯仰）无 NaN 且正交归一', () => {
    const pitches = [-80, -75, -45, 0, 45, 75, 80]
    for (const yaw of FIXED_YAW_DEGREES) {
      for (const pitch of pitches) {
        const b = cameraBasis(makeCam({ yaw: rad(yaw), pitch: rad(pitch) }))
        for (const v of [...b.forward, ...b.right, ...b.up, ...b.eye]) expect(Number.isFinite(v)).toBe(true)
        close(len3(b.forward), 1)
        close(len3(b.right), 1)
        close(len3(b.up), 1)
        close(dot3(b.forward, b.right), 0)
        close(dot3(b.forward, b.up), 0)
        close(dot3(b.right, b.up), 0)
        // pitch 被 clamp 到 ±75°，越界值与边界值得到同一组基。
        if (pitch === 80 || pitch === 75) {
          const ref = cameraBasis(makeCam({ yaw: rad(yaw), pitch: rad(75) }))
          for (let i = 0; i < 3; i += 1) close(b.forward[i]!, ref.forward[i]!)
        }
        if (pitch === -80 || pitch === -75) {
          const ref = cameraBasis(makeCam({ yaw: rad(yaw), pitch: rad(-75) }))
          for (let i = 0; i < 3; i += 1) close(b.forward[i]!, ref.forward[i]!)
        }
      }
    }
  })
})

describe('M4 camera: 屏幕映射与深度', () => {
  const cam = makeCam()

  it('目标投到视口中心，+X 在右、+Y 在上，y 只翻转一次', () => {
    const center = projectPoint(cam, [0, 0, 0])
    close(center.x, 8)
    close(center.y, 8)
    close(center.depthKey, -cam.distance)

    const right = projectPoint(cam, [1, 0, 0])
    const up = projectPoint(cam, [0, 1, 0])
    expect(right.x).toBeGreaterThan(center.x)
    close(right.y!, center.y!)
    expect(up.y).toBeLessThan(center.y)
    close(up.x!, center.x!)
  })

  it('正交缩放 ppm = zoom * h / orthoHeight，world 点不变', () => {
    const zoomed = makeCam({ zoom: 2 })
    const a = projectPoint(cam, [1, 0, 0])
    const b = projectPoint(zoomed, [1, 0, 0])
    close(b.x - 8, 2 * (a.x - 8))
    close(b.depthKey, a.depthKey)
  })

  it('viewProjection2D 是 3x3 列主序像素矩阵，与 projectPoint 一致', () => {
    const m = viewProjection2D(cam)
    expect(m.length).toBe(9)
    for (const [x, y] of [[0, 0], [1, 0], [0.25, -0.75], [-2, 3]] as const) {
      const [sx, sy] = applyM3(m, x, y)
      const p = projectPoint(cam, [x, y, 0])
      close(sx!, p.x)
      close(sy!, p.y)
    }
  })

  it('depthKeyFor：2d 用无量纲 zOffset，2.5d/volume 映射 [-100,100]', () => {
    close(depthKeyFor('2d', 0.3, -9999), 0.3)
    close(depthKeyFor('2d', -2, 42), -2)
    close(depthKeyFor('volume', 0, -5), 5)
    close(depthKeyFor('2.5d', 0, 5), -5)
    close(depthKeyFor('volume', 0, -500), 100)
    close(depthKeyFor('2.5d', 0, 500), -100)
  })

  it('透视模式与近平面退化点均不产生 NaN', () => {
    const perspective = makeCam({ kind: 'perspective' })
    for (const p of [[0, 0, 0], [1, 0.5, 0], [0, 0, 4], [0, 0, 5]] as const) {
      const q = projectPoint(perspective, p)
      for (const v of [q.x, q.y, q.viewZ, q.depthKey]) expect(Number.isFinite(v)).toBe(true)
    }
    const center = projectPoint(perspective, [0, 0, 0])
    close(center.x, 8)
    close(center.y, 8)
  })
})

describe('camera unproject', () => {
  it('round-trips ortho and perspective points within 0.5 px', () => {
    const ortho = { ...DEFAULT_CAMERA, kind: 'ortho' as const, yaw: 0.4, pitch: 0.3, target: [0, 1, 0] as const, distance: 5 }
    const persp = { ...ortho, kind: 'perspective' as const }
    for (const camera of [ortho, persp]) {
      const point: [number, number, number] = [0.3, 1.2, 0.4]
      const screen = projectPoint(camera, point)
      const back = unprojectPoint(camera, screen.x, screen.y, screen.viewZ)
      const again = projectPoint(camera, back)
      expect(Math.abs(again.x - screen.x)).toBeLessThan(0.5)
      expect(Math.abs(again.y - screen.y)).toBeLessThan(0.5)
    }
  })
})
