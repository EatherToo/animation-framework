import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { importSpine } from '@/asset/importer'
import { Engine } from '@/runtime/runtime'
import { CH_X, CH_Y, WORLD_STRIDE } from '@/core/math'
import { setLocal } from '@/core/pose'

const fixture = {
  skeleton: { spine: '4.3.0', referenceScale: 1 },
  bones: [{ name: 'root' }, { name: 'hair', parent: 'root', x: 3, y: 2, length: 12 }],
  slots: [{ name: 'draw', bone: 'hair' }],
  skins: [{ name: 'default', attachments: {} }],
  constraints: [{ name: 'hair-physics', type: 'physics', bone: 'hair', x: 0.8, y: 0.6,
    rotate: 0.7, limit: 500, fps: 60, inertia: 0.85, strength: 22,
    damping: 0.88, mass: 1.8, wind: 1.3, gravity: 2.1, mix: 0.75 }],
}

const oracle = `
const { createRequire } = require('node:module')
const core = createRequire(process.argv[1] + '/package.json')('@esotericsoftware/spine-core')
if (typeof core.SkeletonPhysicsMovement !== 'function') throw new Error('SkeletonPhysicsMovement unavailable')
const loader = { newRegionAttachment() {}, newMeshAttachment() {}, newBoundingBoxAttachment() {}, newPathAttachment() {}, newPointAttachment() {}, newClippingAttachment() {} }
const data = new core.SkeletonJson(loader).readSkeletonData(JSON.parse(process.argv[2]))
const s = new core.Skeleton(data), frames = JSON.parse(process.argv[3]), out = []
const scale = Number(process.argv[4]); s.scaleX = scale
let hostX = 0, hostY = 0
const tracker = new core.SkeletonPhysicsMovement(s, {
  readTransform(out) { out.x = hostX; out.y = hostY; out.z = 0; out.rotation = 0 },
  worldToSkeleton(point) { point.x = (point.x - hostX) / s.scaleX; point.y = (point.y - hostY) / s.scaleY },
}, { positionInheritanceX: 1, positionInheritanceY: 1 })
for (const frame of frames) {
  if (frame.reset) { s.physics.forEach(p => p.reset()); tracker.resetTransform() }
  hostX = frame.x * scale; hostY = frame.y
  s.x = hostX; s.y = hostY
  tracker.applyTransformMovement()
  s.setupPoseBones()
  s.update(frame.dt)
  s.updateWorldTransform(core.Physics.update)
  out.push(['root', 'hair'].map(name => {
    const b = s.findBone(name).appliedPose
    return [b.a, b.c, b.b, b.d, b.worldX, b.worldY]
  }))
}
process.stdout.write(JSON.stringify(out))
`

const frames = [
  { dt: 0, x: 0, y: 0 },
  { dt: 1 / 30, x: 1.1, y: -0.3 },
  { dt: 1 / 60, x: 2.7, y: -1.2 },
  { dt: 1 / 30, x: 3.2, y: -1.5 },
  { dt: 1 / 60, x: 3.2, y: -1.5 },
  { dt: 1 / 30, x: 5.1, y: -0.5 },
]

for (const { scale, flip } of [{ scale: 1, flip: false }, { scale: -1.25, flip: false }, { scale: -1.25, flip: true }]) {
  describe(`entity root movement with scale ${scale}${flip ? ' via flip' : ''}`, () => {
    it('matches official SkeletonPhysicsMovement constrained world frames', () => {
      const root = resolve(process.cwd(), '../..')
      const expected = JSON.parse(execFileSync(process.execPath,
        ['-e', oracle, root, JSON.stringify(fixture), JSON.stringify(frames), String(scale)],
        { cwd: root, encoding: 'utf8' })) as number[][][]
      const engine = new Engine({ backend: 'cpu', rootMotion: 'entity' })
      engine.load(importSpine(fixture, { unitScale: 1 }))
      if (flip) engine.setFlip(true, false)
      engine.scaleX = flip ? -scale : scale
      const errors: string[] = []
      frames.forEach((frame, i) => {
        setLocal(engine.pose, 0, CH_X, frame.x)
        setLocal(engine.pose, 0, CH_Y, frame.y)
        setLocal(engine.pose, 1, CH_X, 3)
        setLocal(engine.pose, 1, CH_Y, 2)
        const previousX = engine.x, previousY = engine.y
        engine.update(frame.dt)
        expect(engine.rootMotionDelta.x).toBeCloseTo(engine.x - previousX, 5)
        expect(engine.rootMotionDelta.y).toBeCloseTo(engine.y - previousY, 5)
        expect(engine.pose.local[CH_X]).toBe(0)
        expect(engine.pose.local[CH_Y]).toBe(0)
        for (let bone = 0; bone < 2; bone++) for (let component = 0; component < WORLD_STRIDE; component++) {
          const actual = engine.pose.world[bone * WORLD_STRIDE + component]!
          const official = expected[i]![bone]![component]!
          if (Math.abs(actual - official) > 0.0001) errors.push(`${i}/${bone}/${component}: ${actual} vs ${official}`)
        }
      })
      expect(errors).toEqual([])
      engine.dispose()
    })
  })
}

it('keeps bone mode unchanged and resets extraction baseline on setup/load', () => {
  const asset = importSpine(fixture, { unitScale: 1 })
  const engine = new Engine({ backend: 'cpu', rootMotion: 'entity' })
  engine.load(asset)
  setLocal(engine.pose, 0, CH_X, 4)
  engine.update(1 / 30)
  expect(engine.x).toBe(4)
  engine.setupPoseBones()
  engine.update(1 / 60)
  expect(engine.x).toBe(4)
  engine.load(asset)
  engine.update(1 / 30)
  expect(engine.rootMotionDelta).toEqual({ x: 0, y: 0 })
  engine.dispose()
  const bone = new Engine({ backend: 'cpu' })
  bone.load(asset)
  setLocal(bone.pose, 0, CH_X, 4)
  bone.update(1 / 30)
  expect(bone.x).toBe(0)
  expect(bone.pose.local[CH_X]).toBe(4)
  bone.dispose()
})
