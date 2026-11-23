import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createTrack, sampleAnimation } from '@/animation/animation'
import { importSpine } from '@/asset/importer'
import { createPose } from '@/core/pose'
import { createSlotSet } from '@/slot/slot'

const root = resolve(process.cwd(), '../..')
const doc = {
  skeleton: { spine: '4.3.0', referenceScale: 100 },
  bones: [{ name: 'root' }, { name: 'hair', parent: 'root', length: 30 }],
  slots: [], skins: [{ name: 'default', attachments: {} }],
  constraints: [
    { name: 'hair-physics', type: 'physics', bone: 'hair', x: 1, y: 0.5, rotate: 0.7,
      scaleX: 0.3, shearX: 0.2, scaleY: 'Volume', limit: 120, fps: 30,
      inertia: 0.8, strength: 41, damping: 0.6, mass: 2.5, wind: 3, gravity: 4,
      mix: 0.9, inertiaGlobal: true, massGlobal: true },
    { name: 'other-physics', type: 'physics', bone: 'root', inertiaGlobal: false, massGlobal: true },
  ],
  animations: { probe: { physics: {
    'hair-physics': { wind: [{ time: 0, value: 2 }, { time: 1, value: 6 }],
      reset: [{ time: 0.25 }] },
    '': { inertia: [{ time: 0, value: 0.2 }, { time: 1, value: 0.6 }],
      mass: [{ time: 0, value: 2 }, { time: 1, value: 4 }],
      reset: [{ time: 0.75 }] },
  } } },
}

const oracle = `
const { createRequire } = require('node:module')
const core = createRequire(process.argv[1] + '/package.json')('@esotericsoftware/spine-core')
const data = new core.SkeletonJson({ newRegionAttachment() {}, newMeshAttachment() {}, newBoundingBoxAttachment() {}, newPathAttachment() {}, newPointAttachment() {}, newClippingAttachment() {} }).readSkeletonData(JSON.parse(process.argv[2]))
const skeleton = new core.Skeleton(data)
const state = new core.AnimationState(new core.AnimationStateData(data))
state.setAnimation(0, 'probe', false)
state.update(0.5)
state.apply(skeleton)
process.stdout.write(JSON.stringify({ data: data.constraints.filter(c => c instanceof core.PhysicsConstraintData).map(c => ({
name: c.name, x: c.x, y: c.y, rotate: c.rotate, scaleX: c.scaleX, shearX: c.shearX,
limit: c.limit, step: c.step, scaleYMode: c.scaleYMode, inertiaGlobal: c.inertiaGlobal,
massGlobal: c.massGlobal, setupPose: c.setupPose })), pose: skeleton.physics.map(c => ({ name: c.data.name, pose: c.pose })) }))
`

describe('Spine 4.3 physics JSON and timeline oracle', () => {
  it('matches setup data and sampled physics pose', () => {
    const official = JSON.parse(execFileSync(process.execPath, ['-e', oracle, root, JSON.stringify(doc)],
      { cwd: root, encoding: 'utf8' })) as { data: Record<string, any>[]; pose: { name: string; pose: Record<string, number> }[] }
    const asset = importSpine(doc, { unitScale: 0.01 })
    const physics = asset.constraints!.filter(c => c.kind === 'physics')
    expect(physics).toHaveLength(2)
    for (const c of physics) {
      const expected = official.data.find(p => p.name === c.id)!
      for (const key of ['x', 'y', 'rotate', 'scaleX', 'shearX', 'step', 'inertiaGlobal', 'massGlobal'] as const) {
        expect(c[key]).toBe(expected[key])
      }
      expect(c.limit).toBeCloseTo(expected.limit * 0.01)
      expect(c.massInverse).toBeCloseTo(expected.setupPose.massInverse)
      expect(c.scaleYMode).toBe(['None', 'Uniform', 'Volume'][expected.scaleYMode])
    }
    const clip = asset.animations.get('probe')!
    expect(clip.timelines.filter(t => t.kind === 'physics')).toHaveLength(5)
    const pose = createPose(asset.skeleton)
    const slotSet = createSlotSet(asset.slots, asset.skins, 'default')
    const sample = sampleAnimation([createTrack(clip, { loop: false })], pose, slotSet, 0.5)
    for (const c of physics) {
      const expected = official.pose.find(p => p.name === c.id)!.pose
      const channels = [...(sample.constraintMixByName.channels.get(c.id) ?? []),
        ...(sample.constraintMixByName.channels.get('-1') ?? []).map(ch => ({ ...ch,
          values: Object.fromEntries(Object.entries(ch.values).filter(([field]) => c[`${field}Global` as keyof typeof c] === true)) }))]
      for (const channel of channels) for (const [field, value] of Object.entries(channel.values)) {
        if (field === 'reset') continue
        expect(Number(value)).toBeCloseTo(field === 'mass' ? 1 / expected.massInverse! : expected[field]!, 5)
      }
    }
    expect(sample.constraintMixByName.channels.get('hair-physics')?.some(ch => ch.values.reset)).toBe(true)
    expect(sample.constraintMixByName.channels.get('-1')?.some(ch => ch.values.reset)).toBeFalsy()
    const resetSample = sampleAnimation([createTrack(clip, { loop: false })], createPose(asset.skeleton),
      createSlotSet(asset.slots, asset.skins, 'default'), 0.8)
    expect(resetSample.constraintMixByName.channels.get('-1')?.some(ch => ch.values.reset)).toBe(true)
  })
})
