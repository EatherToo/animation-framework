import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { compileSkeleton } from '@/core/skeleton'
import { updateWorld, WORLD_STRIDE } from '@/core/pose'
import { importSpine, type SkeletonAsset } from '@/asset/importer'
import type { Attachment, SlotData } from '@/slot/slot'
import { Engine } from '@/runtime/runtime'

const root = resolve(process.cwd(), '../..')
const fixture = {
  skeleton: { spine: '4.3.13' },
  bones: [
    { name: 'root', x: 3, y: -4, rotation: 24, scaleX: 1.4, scaleY: 0.8, shearY: 12 },
    ...['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection']
      .map((inherit, index) => ({ name: `child${index}`, parent: 'root', x: 2 + index, y: -1,
        rotation: 18, scaleX: 0.9, scaleY: 1.2, shearX: 7, shearY: -9, inherit })),
  ],
  slots: [{ name: 'draw', bone: 'child0' }],
  skins: [{ name: 'default', attachments: {} }],
}
const oracle = `
const { createRequire } = require('node:module')
const core = createRequire(process.argv[1] + '/package.json')('@esotericsoftware/spine-core')
const data = new core.SkeletonJson({ newRegionAttachment() {}, newMeshAttachment() {}, newBoundingBoxAttachment() {}, newPathAttachment() {}, newPointAttachment() {}, newClippingAttachment() {} }).readSkeletonData(JSON.parse(process.argv[2]))
const skeleton = new core.Skeleton(data)
const output = []
for (const [x, y, scaleX, scaleY] of JSON.parse(process.argv[3])) {
  skeleton.x = x; skeleton.y = y; skeleton.scaleX = scaleX; skeleton.scaleY = scaleY
  skeleton.updateWorldTransform(core.Physics.update)
  output.push(skeleton.bones.map(b => {
    const p = b.appliedPose
    return [p.a, p.c, p.b, p.d, p.worldX, p.worldY]
  }))
}
process.stdout.write(JSON.stringify(output))
`
const setups = [
  { x: 3, y: -4, rotation: 24, scaleX: 1.4, scaleY: 0.8, shearX: 0, shearY: 12 },
  ...['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection']
    .map((_, index) => ({ x: 2 + index, y: -1, rotation: 18, scaleX: 0.9, scaleY: 1.2, shearX: 7, shearY: -9 })),
]
const radians = Math.PI / 180
const skeleton = compileSkeleton({ name: 'scale', profile: 'full2d', bones: setups.map((setup, index) => ({
  name: index === 0 ? 'root' : `child${index - 1}`, parent: index === 0 ? -1 : 0,
  inherit: (['normal', 'normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection'] as const)[index]!,
  setup: { ...setup, rotation: setup.rotation * radians, shearX: (setup.shearX ?? 0) * radians, shearY: setup.shearY * radians },
})) })
const color = { r: 1, g: 1, b: 1, a: 1 }
const slot: SlotData = { id: 'draw', bone: 1, order: 0, color, blend: 'normal', attachment: 'box', mask: null, zOffset: 0 }
const attachment: Attachment = { kind: 'region', id: 'box', color, region: { atlasKey: 'box', uvs: null, width: 4, height: 2 } }
const asset: SkeletonAsset = { schema: 1, source: 'native', sourceVersion: '1', unitScale: 1,
  skeleton, slots: [slot], animations: new Map(), events: [], hash: 'scale',
  skins: new Map([['default', { id: 'default', attachments: new Map([['box', attachment]]) }]]),
  report: { issues: [], warnings: 0, errors: 0 } }

function boxBounds(matrix: number[]): number[] {
  const points = [[-2, -1], [2, -1], [2, 1], [-2, 1]].map(([x, y]) =>
    [matrix[0]! * x! + matrix[2]! * y! + matrix[4]!, matrix[1]! * x! + matrix[3]! * y! + matrix[5]!])
  const xs = points.map(p => p[0]!), ys = points.map(p => p[1]!)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
}

describe('Spine 4.3 skeleton scale, flip and position parity', () => {
  it('matches root, inherited child matrices and rendered bounds without changing setup channels', () => {
    const transforms = [[9, -6, 2, 0.5], [-3, 8, -1.5, 2.25], [4, 7, 1.25, -0.75]]
    const expected = JSON.parse(execFileSync(process.execPath,
      ['-e', oracle, root, JSON.stringify(fixture), JSON.stringify(transforms)],
      { cwd: root, encoding: 'utf8' })) as number[][][]
    const engine = new Engine({ backend: 'cpu' })
    engine.load(asset)
    const original = engine.pose.local.slice()
    for (const [index, [x, y, sx, sy]] of transforms.entries()) {
      const cachedWorld = engine.pose.world.slice()
      engine.setPosition(x!, y!)
      engine.setScale(Math.abs(sx!), Math.abs(sy!))
      engine.setFlip(sx! < 0, sy! < 0)
      expect(engine.pose.world).toEqual(cachedWorld)
      expect(engine.pose.worldValid).toBe(false)
      expect(engine.pose.local).toEqual(original)
      expect(engine.pose.skeleton.setupLocal).toEqual(skeleton.setupLocal)
      updateWorld(engine.pose)
      for (let bone = 0; bone < skeleton.count; bone++) {
        for (let k = 0; k < WORLD_STRIDE; k++) {
          expect(engine.pose.world[bone * WORLD_STRIDE + k]!).toBeCloseTo(expected[index]![bone]![k]!, 4)
        }
      }
      const b = engine.getBounds()
      const reference = boxBounds(expected[index]![1]!)
      for (const [value, k] of [b.x, b.y, b.width, b.height].map((v, k) => [v, k] as const)) {
        expect(value).toBeCloseTo(reference[k]!, 4)
      }
    }
    engine.dispose()
  })

  it('matches a physics bone at nonunit skeleton scale', () => {
    const physicsFixture = {
      skeleton: { spine: '4.3.0', referenceScale: 2 },
      bones: [{ name: 'root', x: 3, y: -2 }, { name: 'hair', parent: 'root', x: 4, y: 2, length: 12, rotation: 14 }],
      slots: [{ name: 'draw', bone: 'hair' }], skins: [{ name: 'default', attachments: {} }],
      constraints: [{ name: 'hair-physics', type: 'physics', bone: 'hair', x: 0.8, y: 0.6,
        rotate: 0.7, shearX: 0.25, scaleX: 0.45, scaleY: 'Volume',
        limit: 500, fps: 60, inertia: 0.85, strength: 22, damping: 0.88,
        mass: 1.8, wind: 1.3, gravity: 2.1, mix: 0.75 }],
    }
    const physicsOracle = `
const { createRequire } = require('node:module')
const core = createRequire(process.argv[1] + '/package.json')('@esotericsoftware/spine-core')
const data = new core.SkeletonJson({ newRegionAttachment() {}, newMeshAttachment() {}, newBoundingBoxAttachment() {}, newPathAttachment() {}, newPointAttachment() {}, newClippingAttachment() {} }).readSkeletonData(JSON.parse(process.argv[2]))
const skeleton = new core.Skeleton(data)
skeleton.x = 5; skeleton.y = -7; skeleton.scaleX = 2; skeleton.scaleY = 0.5
const frames = []
for (const dt of [0, 1 / 60]) {
  skeleton.update(dt)
  skeleton.updateWorldTransform(core.Physics.update)
  frames.push(skeleton.bones.map(b => {
    const p = b.appliedPose
    return [p.a, p.c, p.b, p.d, p.worldX, p.worldY]
  }))
}
process.stdout.write(JSON.stringify(frames))
`
    const expected = JSON.parse(execFileSync(process.execPath,
      ['-e', physicsOracle, root, JSON.stringify(physicsFixture)], { cwd: root, encoding: 'utf8' })) as number[][][]
    const engine = new Engine({ backend: 'cpu' })
    engine.setPosition(5, -7)
    engine.setScale(2, 0.5)
    engine.load(importSpine(physicsFixture, { unitScale: 1 }))
    for (const [frame, dt] of [0, 1 / 60].entries()) {
      engine.update(dt)
      for (let bone = 0; bone < 2; bone++) {
        for (let k = 0; k < WORLD_STRIDE; k++) {
          expect(engine.pose.world[bone * WORLD_STRIDE + k]!).toBeCloseTo(expected[frame]![bone]![k]!, 3)
        }
      }
    }
    engine.dispose()
  })
})
