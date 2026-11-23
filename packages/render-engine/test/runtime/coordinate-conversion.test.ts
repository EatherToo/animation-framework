import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { importSpine } from '@/asset/importer'
import { Engine, SpineBone } from '@/runtime/runtime'

const fixture = {
  skeleton: { spine: '4.3.13' },
  bones: [
    { name: 'root', x: 3, y: -4, rotation: 24, scaleX: 1.4, scaleY: 0.8, shearY: 12 },
    { name: 'arm', parent: 'root', x: 2, y: -1, rotation: -38, scaleX: 0.9, scaleY: 1.2, shearX: 7, shearY: -9 },
    { name: 'finger', parent: 'arm', x: -3, y: 4, rotation: 51, scaleX: 1.3, scaleY: 0.7, shearX: -11 },
  ],
  slots: [{ name: 'draw', bone: 'finger' }],
  skins: [{ name: 'default', attachments: {} }],
}
const transformations = [
  { x: 1.25, y: -1.5, scaleX: 2, scaleY: 0.5 },
  { x: -2.5, y: 1.5, scaleX: -1.5, scaleY: 2.25 },
  { x: 0.75, y: 2.25, scaleX: 1.25, scaleY: -0.75 },
]
const points = [{ x: 0, y: 0 }, { x: -1.25, y: 2.3 }, { x: 1.6, y: -0.5 }]
const degrees = [-170, -45.5, 0, 33.8, 179]

const oracle = `
const { createRequire } = require('node:module')
const core = createRequire(process.argv[1] + '/package.json')('@esotericsoftware/spine-core')
if (require(process.argv[1] + '/node_modules/@esotericsoftware/spine-core/package.json').version !== '4.3.13') throw new Error('Unexpected Spine core version')
const loader = { newRegionAttachment() {}, newMeshAttachment() {}, newBoundingBoxAttachment() {}, newPathAttachment() {}, newPointAttachment() {}, newClippingAttachment() {} }
const data = new core.SkeletonJson(loader).readSkeletonData(JSON.parse(process.argv[2]))
const skeleton = new core.Skeleton(data)
const output = []
for (const transform of JSON.parse(process.argv[3])) {
  Object.assign(skeleton, transform)
  skeleton.updateWorldTransform(core.Physics.update)
  output.push(skeleton.bones.map(bone => ({
    points: JSON.parse(process.argv[4]).map(point => ({
      world: bone.appliedPose.localToWorld({ ...point }),
      local: bone.appliedPose.worldToLocal({ ...point }),
    })),
    rotations: JSON.parse(process.argv[5]).map(degrees => ({
      world: bone.appliedPose.localToWorldRotation(degrees),
      local: bone.appliedPose.worldToLocalRotation(degrees),
    })),
  })))
}
process.stdout.write(JSON.stringify(output))
`
type OracleResult = { points: { world: { x: number; y: number }; local: { x: number; y: number } }[];
  rotations: { world: number; local: number }[] }[][]

function close(actual: number, expected: number): void {
  if (Math.abs(actual - expected) >= 1e-6) throw new Error(`coordinate mismatch: ${actual} vs ${expected}`)
}

describe('public bone coordinate conversions against Spine core 4.3.13', () => {
  it('exposes both compatible radian and explicit official degree conversion methods', () => {
    const methods = ['localToWorld', 'worldToLocal', 'localToWorldRotation', 'worldToLocalRotation',
      'localToWorldRotationDegrees', 'worldToLocalRotationDegrees'] as const
    for (const method of methods) expect(typeof SpineBone.prototype[method]).toBe('function')
    const engine = new Engine({ backend: 'cpu' })
    engine.load(importSpine(fixture, { unitScale: 1 }))
    for (const bone of engine.skeleton.bones) {
      for (const method of methods) expect(typeof bone[method]).toBe('function')
    }
    engine.dispose()
  })

  it('matches official points and degree rotations across several bones and reflected skeleton transforms', () => {
    const root = resolve(process.cwd(), '../..')
    const expected = JSON.parse(execFileSync(process.execPath,
      ['-e', oracle, root, JSON.stringify(fixture), JSON.stringify(transformations),
        JSON.stringify(points), JSON.stringify(degrees)],
      { cwd: root, encoding: 'utf8' })) as OracleResult
    const engine = new Engine({ backend: 'cpu' })
    engine.load(importSpine(fixture, { unitScale: 1 }))
    for (const [index, transform] of transformations.entries()) {
      engine.skeleton.x = transform.x
      engine.skeleton.y = transform.y
      engine.setScale(Math.abs(transform.scaleX), Math.abs(transform.scaleY))
      engine.setFlip(transform.scaleX < 0, transform.scaleY < 0)
      for (const [boneIndex, bone] of engine.skeleton.bones.entries()) {
        const official = expected[index]![boneIndex]!
        for (const [pointIndex, point] of points.entries()) {
          const local = { ...point }
          const world = bone.localToWorld(local)
          expect(local).toEqual(point)
          close(world.x, official.points[pointIndex]!.world.x)
          close(world.y, official.points[pointIndex]!.world.y)
          const inverse = bone.worldToLocal(point)
          close(inverse.x, official.points[pointIndex]!.local.x)
          close(inverse.y, official.points[pointIndex]!.local.y)
          const roundtrip = bone.worldToLocal(world)
          close(roundtrip.x, point.x)
          close(roundtrip.y, point.y)
        }
        for (const [angleIndex, angle] of degrees.entries()) {
          expect(Math.abs(bone.localToWorldRotationDegrees(angle) - official.rotations[angleIndex]!.world)).toBeLessThan(3e-5)
          expect(Math.abs(bone.worldToLocalRotationDegrees(angle) - official.rotations[angleIndex]!.local)).toBeLessThan(3e-5)
        }
      }
    }
    engine.dispose()
  })

  it('preserves radian conversion and fails predictably for a singular inverse', () => {
    const engine = new Engine({ backend: 'cpu' })
    engine.load(importSpine(fixture, { unitScale: 1 }))
    const bone = engine.skeleton.findBone('finger')!
    const angle = 0.6
    close(Math.atan2(Math.sin(bone.worldToLocalRotation(bone.localToWorldRotation(angle)) - angle),
      Math.cos(bone.worldToLocalRotation(bone.localToWorldRotation(angle)) - angle)), 0)
    engine.skeleton.findBone('root')!.scaleX = 0
    expect(() => bone.worldToLocal({ x: 2, y: 3 })).toThrow('singular')
    expect(() => bone.worldToLocalRotation(0.5)).toThrow('singular')
    expect(() => bone.worldToLocalRotationDegrees(30)).toThrow('singular')
    engine.dispose()
  })
})
