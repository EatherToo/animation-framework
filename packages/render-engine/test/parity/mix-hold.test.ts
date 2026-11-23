import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { importSpine } from '@/asset/importer'
import { AnimationState, AnimationStateData } from '@/animation/animation'
import { createPose, getLocal, CH_X, CH_Y, CH_ROT } from '@/core/pose'
import { createSlotSet } from '@/slot/slot'

const root = resolve(process.cwd(), '../..')
const fixture = {
  skeleton: { spine: '4.3.13' }, bones: [{ name: 'root' }], slots: [],
  animations: {
    A: { bones: { root: { translate: [{ x: 10, y: 8 }, { time: 1, x: 20, y: 12 }] } },
      events: [{ time: 0.25, name: 'aEvent' }] },
    B: { bones: { root: { translate: [{ x: 30, y: 16 }, { time: 1, x: 40, y: 20 }] } },
      events: [{ time: 0.25, name: 'bEvent' }] },
    C: { bones: { root: { rotate: [{ value: 30 }, { time: 1, value: 60 }] } },
      events: [{ time: 0.25, name: 'cEvent' }] },
    D: { bones: { root: { translate: [{ x: 4, y: 2 }, { time: 1, x: 6, y: 4 }] } } },
  },
  events: { aEvent: {}, bEvent: {}, cEvent: {} },
}
const oracle = `
const { createRequire } = require('node:module')
const requireRoot = createRequire(process.argv[1] + '/package.json')
const { SkeletonJson, Skeleton, AnimationState, AnimationStateData } = requireRoot('@esotericsoftware/spine-core')
const data = new SkeletonJson({}).readSkeletonData(JSON.parse(process.argv[2]))
const skeleton = new Skeleton(data)
const mixes = new AnimationStateData(data)
mixes.defaultMix = 0.6
const state = new AnimationState(mixes)
const events = []
state.addListener({ event: (_, event) => events.push(event.data.name) })
state.setAnimation(0, 'A', false)
const frames = []
for (let i = 0; i < 6; i++) {
  if (i === 1) state.setAnimation(0, 'B', false)
  if (i === 2) state.setAnimation(0, 'C', false)
  if (i === 3) state.setAnimation(1, 'D', false).alpha = 0.5
  state.update(0.2)
  state.apply(skeleton)
  const pose = skeleton.bones[0].pose
  frames.push({ x: pose.x, y: pose.y, rotation: pose.rotation, events: events.splice(0),
    attachments: skeleton.slots.map(slot => slot.pose.attachment?.name ?? null),
    drawOrder: skeleton.drawOrder.appliedPose.map(slot => slot.data.index) })
}
process.stdout.write(JSON.stringify(frames))
`
type Frame = { x: number; y: number; rotation: number; events: string[]; attachments: (string | null)[]; drawOrder: number[] }

describe('Spine 4.3.13 interruption mixing', () => {
  it('compares held shared, fading distinct and upper-track channels at every frame', () => {
    const expected = JSON.parse(execFileSync(process.execPath,
      ['-e', oracle, root, JSON.stringify(fixture)], { cwd: root, encoding: 'utf8' })) as Frame[]
    const asset = importSpine(fixture, { sourceYDown: false, unitScale: 1 })
    const pose = createPose(asset.skeleton)
    const slots = createSlotSet(asset.slots,
      new Map([['default', { id: 'default', attachments: new Map() }]]), 'default')
    const mixes = new AnimationStateData(asset.animations)
    mixes.defaultMix = 0.6
    const state = new AnimationState(asset.animations, pose, slots, mixes)
    state.play('A', { loop: false })
    const actual: Frame[] = []
    for (let i = 0; i < 6; i++) {
      if (i === 1) state.play('B', { loop: false })
      if (i === 2) state.play('C', { loop: false })
      if (i === 3) state.play('D', { loop: false, track: 1, alpha: 0.5 })
      const sample = state.update(0.2)
      actual.push({ x: getLocal(pose, 0, CH_X), y: getLocal(pose, 0, CH_Y),
        rotation: getLocal(pose, 0, CH_ROT) * 180 / Math.PI, events: sample.events,
        attachments: slots.slots.map(slot => slot.attachmentId), drawOrder: sample.drawOrder ?? [] })
    }
    for (let i = 0; i < expected.length; i++) {
      expect(actual[i]!.x).toBeCloseTo(expected[i]!.x, 4)
      expect(actual[i]!.y).toBeCloseTo(expected[i]!.y, 4)
      expect(actual[i]!.rotation).toBeCloseTo(expected[i]!.rotation, 4)
      expect(actual[i]!.events).toEqual(expected[i]!.events)
      expect(actual[i]!.attachments).toEqual(expected[i]!.attachments)
      expect(actual[i]!.drawOrder).toEqual(expected[i]!.drawOrder)
    }
  })

  it('compares attachment and draw-order thresholds during replacement', () => {
    const slotsFixture = {
      skeleton: { spine: '4.3.13' }, bones: [{ name: 'root' }],
      slots: [{ name: 'front', bone: 'root', attachment: 'base' },
        { name: 'back', bone: 'root', attachment: 'base' }],
      skins: [{ name: 'default', attachments: {
        front: { base: { type: 'region', width: 1, height: 1 },
          changed: { type: 'region', width: 1, height: 1 } },
        back: { base: { type: 'region', width: 1, height: 1 } },
      } }],
      animations: {
        A: { slots: { front: { attachment: [{ time: 0, name: 'changed' }] } },
          drawOrder: [{ time: 0, offsets: [{ slot: 'front', offset: 1 }] }] },
        B: { bones: { root: { translate: [{ x: 5 }] } } },
      },
    }
    const slotOracle = `
const { createRequire } = require('node:module')
const requireRoot = createRequire(process.argv[1] + '/package.json')
const core = requireRoot('@esotericsoftware/spine-core')
const data = new core.SkeletonJson({ newRegionAttachment: (_, name) => ({ name, updateSequence() {} }) })
  .readSkeletonData(JSON.parse(process.argv[2]))
const skeleton = new core.Skeleton(data)
const mix = new core.AnimationStateData(data)
mix.defaultMix = 0.6
const state = new core.AnimationState(mix)
const a = state.setAnimation(0, 'A', false)
a.mixAttachmentThreshold = Number(process.argv[3])
a.mixDrawOrderThreshold = Number(process.argv[3])
const frames = []
for (let i = 0; i < 4; i++) {
  if (i === 1) state.setAnimation(0, 'B', false)
  state.update(0.2)
  state.apply(skeleton)
  frames.push({ attachment: skeleton.slots[0].pose.attachment?.name ?? null,
    order: skeleton.drawOrder.appliedPose.map(slot => slot.data.index) })
}
process.stdout.write(JSON.stringify(frames))
`
    for (const threshold of [0, 0.75]) {
      const expected = JSON.parse(execFileSync(process.execPath,
        ['-e', slotOracle, root, JSON.stringify(slotsFixture), String(threshold)],
        { cwd: root, encoding: 'utf8' })) as { attachment: string | null; order: number[] }[]
      const asset = importSpine(slotsFixture, { sourceYDown: false, unitScale: 1 })
      const slots = createSlotSet(asset.slots, asset.skins, 'default')
      const pose = createPose(asset.skeleton)
      const mix = new AnimationStateData(asset.animations)
      mix.defaultMix = 0.6
      const state = new AnimationState(asset.animations, pose, slots, mix)
      const a = state.play('A', { loop: false })
      a.mixAttachmentThreshold = threshold
      a.mixDrawOrderThreshold = threshold
      for (let i = 0; i < 4; i++) {
        if (i === 1) state.play('B', { loop: false })
        const sample = state.update(0.2)
        expect(slots.slots[0]!.attachmentId).toBe(expected[i]!.attachment)
        expect({ threshold, frame: i, order: sample.drawOrder }).toEqual({ threshold, frame: i, order: expected[i]!.order })
      }
    }
  })
})
