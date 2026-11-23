import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { importSpine } from '@/asset/importer'
import { createPose, setLocal, updateWorld } from '@/core/pose'
import { CH_ROT, CH_X, CH_Y, WORLD_STRIDE } from '@/core/math'
import { createConstraintSolver, createPhysicsConstraintState, stepPhysicsConstraint, type PhysicsConstraint } from '@/constraint/constraint'

const root = resolve(process.cwd(), '../..')
const frames = [
  { dt: 0, x: 0, y: 0, angle: 0 },
  { dt: 1 / 30, x: 1.1, y: -0.3, angle: 9 },
  { dt: 1 / 60, x: 2.7, y: -1.2, angle: 17 },
  { dt: 1 / 30, x: 3.2, y: -1.5, angle: 21 },
  { dt: 1 / 60, x: 5.1, y: -0.5, angle: 27, reset: true },
  { dt: 1 / 60, x: 6.4, y: 0.4, angle: 34 },
  { dt: 1 / 30, x: 7.7, y: 1.1, angle: 40 },
]
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
const oracle = `
const { createRequire } = require('node:module')
const core = createRequire(process.argv[1] + '/package.json')('@esotericsoftware/spine-core')
const data = new core.SkeletonJson({ newRegionAttachment() {}, newMeshAttachment() {}, newBoundingBoxAttachment() {}, newPathAttachment() {}, newPointAttachment() {}, newClippingAttachment() {} }).readSkeletonData(JSON.parse(process.argv[2]))
const skeleton = new core.Skeleton(data)
skeleton.windX = 0.6; skeleton.windY = -0.3; skeleton.gravityX = 0.25; skeleton.gravityY = 1.1
const out = []
for (const frame of JSON.parse(process.argv[3])) {
  skeleton.setupPoseBones()
  const root = skeleton.findBone('root').pose
  root.x = frame.x; root.y = frame.y; root.rotation = frame.angle
  skeleton.update(frame.dt)
  skeleton.updateWorldTransform(frame.reset ? core.Physics.reset : core.Physics.update)
  out.push({ matrix: ['root', 'hair', 'tip'].map(name => {
    const b = skeleton.findBone(name).appliedPose
    return [b.a, b.c, b.b, b.d, b.worldX, b.worldY]
  }), state: Object.fromEntries(['ux','uy','cx','cy','tx','ty','xOffset','yOffset','rotateOffset','scaleOffset','remaining'].map(key => [key, skeleton.physics[0][key]])) })
}
process.stdout.write(JSON.stringify(out))
`

describe('Spine 4.3 world-space physics oracle', () => {
  it('matches all world matrix components across force steps, bone motion and reset', () => {
    const expected = JSON.parse(execFileSync(process.execPath,
      ['-e', oracle, root, JSON.stringify(fixture), JSON.stringify(frames)],
      { cwd: root, encoding: 'utf8' })) as { matrix: number[][]; state: Record<string, number> }[]
    const asset = importSpine(fixture, { unitScale: 1 })
    const original = asset.constraints!.find(c => c.kind === 'physics') as PhysicsConstraint
    const constraint: PhysicsConstraint = { ...original,
      environment: { referenceScale: 2, windX: 0.6, windY: -0.3, gravityX: 0.25, gravityY: 1.1 } }
    const solver = createConstraintSolver([constraint])
    const state = createPhysicsConstraintState()
    const errors: string[] = []
    frames.forEach((frame, frameIndex) => {
      const pose = createPose(asset.skeleton)
      const rootBone = asset.skeleton.boneIdByName.get('root')!
      setLocal(pose, rootBone, CH_X, frame.x)
      setLocal(pose, rootBone, CH_Y, frame.y)
      setLocal(pose, rootBone, CH_ROT, frame.angle * Math.PI / 180)
      const channels = new Map()
      if (frame.reset) channels.set(constraint.id, [{ kind: 'physics', alpha: 1, additive: false, values: { reset: true } }])
      const weights = Object.assign(new Map<string, number>(), { channels })
      solver.solve(pose, frame.dt, weights)
      const isolated = createPose(asset.skeleton)
      setLocal(isolated, rootBone, CH_X, frame.x)
      setLocal(isolated, rootBone, CH_Y, frame.y)
      setLocal(isolated, rootBone, CH_ROT, frame.angle * Math.PI / 180)
      stepPhysicsConstraint(isolated, frame.reset ? { ...constraint, reset: true } : constraint, state, frame.dt)
      const fields = { ux: 'ux', uy: 'uy', cx: 'cx', cy: 'cy', tx: 'tx', ty: 'ty', xOffset: 'x', yOffset: 'y', rotateOffset: 'rot', scaleOffset: 'scale', remaining: 'remaining' } as const
      for (const [field, key] of Object.entries(fields)) {
        const actual = state.spine![key as keyof typeof state.spine] as number
        const reference = expected[frameIndex]!.state[field]!
        if (Math.abs(actual - reference) > 0.00005) errors.push(`${frameIndex} state ${field}: ${actual} vs ${reference}`)
      }
      updateWorld(pose)
      for (const [boneIndex, name] of ['root', 'hair', 'tip'].entries()) {
        const id = asset.skeleton.boneIdByName.get(name)!
        for (let component = 0; component < WORLD_STRIDE; component += 1) {
          const actual = pose.world[id * WORLD_STRIDE + component]!
          const reference = expected[frameIndex]!.matrix[boneIndex]![component]!
          if (Math.abs(actual - reference) > 0.00005) errors.push(`${frameIndex} ${name} ${component}: ${actual} vs ${reference}`)
        }
      }
    })
    expect(errors).toEqual([])
  })
})
