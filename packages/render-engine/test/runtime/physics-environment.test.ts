import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { importSpine } from '@/asset/importer'
import { Engine } from '@/runtime/runtime'
import { CH_ROT, CH_X, CH_Y, WORLD_STRIDE } from '@/core/math'
import { setLocal, updateWorld } from '@/core/pose'

const fixture = {
  skeleton: { spine: '4.3.0', referenceScale: 2 },
  bones: [
    { name: 'root' },
    { name: 'hair', parent: 'root', x: 3, y: 2, length: 12, rotation: 14, shearX: 6, shearY: -8, scaleX: 1.2, scaleY: 0.9 },
    { name: 'tip', parent: 'hair', x: 12, y: 0 },
  ],
  slots: [{ name: 'draw', bone: 'tip' }], skins: [{ name: 'default', attachments: {} }],
  constraints: [{ name: 'hair-physics', type: 'physics', bone: 'hair', x: 0.8, y: 0.6,
    rotate: 0.7, shearX: 0.25, scaleX: 0.45, scaleY: 'Volume',
    limit: 500, fps: 60, inertia: 0.85, strength: 22, damping: 0.88,
    mass: 1.8, wind: 1.3, gravity: 2.1, mix: 0.75 }],
}
const frames = [
  { dt: 0, x: 0, y: 0, angle: 0 },
  { dt: 1 / 30, x: 1.1, y: -0.3, angle: 9 },
  { dt: 1 / 60, x: 2.7, y: -1.2, angle: 17 },
  { dt: 1 / 30, x: 3.2, y: -1.5, angle: 21 },
  { dt: 1 / 60, x: 5.1, y: -0.5, angle: 27 },
  { dt: 1 / 30, x: 7.7, y: 1.1, angle: 40 },
]
const oracleScript = `
const { createRequire } = require('node:module')
const core = createRequire(process.argv[1] + '/package.json')('@esotericsoftware/spine-core')
const data = new core.SkeletonJson({ newRegionAttachment() {}, newMeshAttachment() {}, newBoundingBoxAttachment() {}, newPathAttachment() {}, newPointAttachment() {}, newClippingAttachment() {} }).readSkeletonData(JSON.parse(process.argv[2]))
const s = new core.Skeleton(data), config = JSON.parse(process.argv[4]), out = []
s.windX = config.windX; s.windY = config.windY; s.gravityX = config.gravityX; s.gravityY = config.gravityY
s.scaleX = config.scaleX; s.scaleY = config.scaleY
for (const [i, frame] of JSON.parse(process.argv[3]).entries()) {
  if (i === 4) { s.windX = config.changedWindX; s.gravityY = config.changedGravityY }
  s.setupPoseBones()
  const root = s.findBone('root').pose
  root.x = frame.x; root.y = frame.y; root.rotation = frame.angle
  s.update(frame.dt)
  s.updateWorldTransform(core.Physics.update)
  out.push(['root','hair','tip'].map(name => {
    const b = s.findBone(name).appliedPose
    return [b.a,b.c,b.b,b.d,b.worldX,b.worldY]
  }))
}
process.stdout.write(JSON.stringify(out))
`

describe('skeleton-level physics environment', () => {
  it('imports referenceScale in engine units with official defaults', () => {
    const asset = importSpine(fixture, { unitScale: 0.25 })
    const physics = asset.constraints!.find(c => c.kind === 'physics')!
    expect(physics.environment).toEqual({ referenceScale: 0.5, windX: 1, windY: 0, gravityX: 0, gravityY: 1 })
    expect(importSpine({ ...fixture, skeleton: { spine: '4.3.0' } }, { unitScale: 0.01 })
      .constraints!.find(c => c.kind === 'physics')!.environment!.referenceScale).toBe(1)
  })

  it('keeps scale and forces instance-local without resetting the solver', () => {
    const asset = importSpine(fixture, { unitScale: 1 })
    const first = new Engine({ backend: 'cpu' })
    const second = new Engine({ backend: 'cpu' })
    first.load(asset)
    second.load(asset)
    first.skeleton.scaleX = 1.25
    first.skeleton.scaleY = 0.8
    first.skeleton.windX = -0.7
    expect(first.scaleX).toBe(1.25)
    expect(first.scaleY).toBe(0.8)
    expect(second.scaleX).toBe(1)
    expect(second.scaleY).toBe(1)
    expect(second.windX).toBe(1)
    first.update(1 / 30)
    first.skeleton.setupPoseBones()
    first.update(1 / 60)
    expect(Number.isFinite(first.skeleton.findBone('hair')!.worldX)).toBe(true)
    expect(asset.constraints!.find(c => c.kind === 'physics')!.environment!.scaleX).toBeUndefined()
    expect(() => { first.skeleton.scaleY = 0 }).toThrow('E_CONFIG')
    first.dispose()
    second.dispose()
  })

  for (const config of [
    { windX: 1, windY: 0, gravityX: 0, gravityY: 1, changedWindX: 1, changedGravityY: 1, scaleX: 1, scaleY: 1 },
    { windX: 0.6, windY: -0.3, gravityX: 0.25, gravityY: 1.1, changedWindX: -0.8, changedGravityY: 0.4, scaleX: 1, scaleY: 1 },
  ]) {
    it(`matches official world frames and preserves solver history (${config.windX})`, () => {
      const root = resolve(process.cwd(), '../..')
      const expected = JSON.parse(execFileSync(process.execPath,
        ['-e', oracleScript, root, JSON.stringify(fixture), JSON.stringify(frames), JSON.stringify(config)],
        { cwd: root, encoding: 'utf8' })) as number[][][]
      const asset = importSpine(fixture, { unitScale: 1 })
      const engine = new Engine({ backend: 'cpu' })
      engine.load(asset)
      const other = new Engine({ backend: 'cpu' })
      other.load(asset)
      expect(engine.skeleton.windX).toBe(1)
      expect(engine.skeleton.gravityY).toBe(1)
      engine.skeleton.windX = config.windX
      engine.windY = config.windY
      engine.gravityX = config.gravityX
      engine.skeleton.gravityY = config.gravityY
      engine.skeleton.scaleX = config.scaleX
      engine.skeleton.scaleY = config.scaleY
      expect(other.windX).toBe(1)
      expect(other.gravityY).toBe(1)
      expect(asset.constraints!.find(c => c.kind === 'physics')!.environment!.windX).toBe(1)
      const errors: string[] = []
      frames.forEach((frame, i) => {
        if (i === 4) {
          engine.windX = config.changedWindX
          engine.skeleton.gravityY = config.changedGravityY
        }
        engine.skeleton.setupPoseBones()
        setLocal(engine.pose, 0, CH_X, frame.x)
        setLocal(engine.pose, 0, CH_Y, frame.y)
        setLocal(engine.pose, 0, CH_ROT, frame.angle * Math.PI / 180)
        engine.update(frame.dt)
        updateWorld(engine.pose)
        for (let bone = 0; bone < 3; bone++) for (let component = 0; component < WORLD_STRIDE; component++) {
          const actual = engine.pose.world[bone * WORLD_STRIDE + component]!
          const official = expected[i]![bone]![component]!
          if (Math.abs(actual - official) > 0.00005) errors.push(`${i}/${bone}/${component}: ${actual} vs ${official}`)
        }
      })
      expect(errors).toEqual([])
      expect(other.windX).toBe(1)
      expect(() => { engine.windX = Infinity }).toThrow('E_CONFIG')
      const stale = engine.skeleton
      engine.load(asset)
      expect(() => stale.windX).toThrow('E_STATE')
      engine.dispose()
      other.dispose()
    })
  }
})
