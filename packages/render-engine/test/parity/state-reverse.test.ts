import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { importSpine } from '@/asset/importer'
import { AnimationState } from '@/animation/animation'
import { createPose, getLocal, CH_X } from '@/core/pose'
import { createSlotSet } from '@/slot/slot'

const root = resolve(process.cwd(), '../..')
const fixture = {
  skeleton: { spine: '4.3.13' },
  bones: [{ name: 'root' }],
  slots: [],
  events: { early: {}, middle: {}, late: {} },
  animations: {
    A: {
      bones: { root: { translate: [{ x: 0, y: 0 }, { time: 1, x: 10, y: 0 }] } },
      events: [
        { time: 0.2, name: 'early' },
        { time: 0.4, name: 'middle' },
        { time: 0.8, name: 'late' },
      ],
    },
    B: {
      bones: { root: { translate: [{ x: 20, y: 0 }, { time: 1, x: 30, y: 0 }] } },
      events: [{ time: 0.25, name: 'early' }],
    },
  },
}
const steps = [0.2, 0.4, 0.2, 0.2, 0.15, 0.3, 0.4]
type Frame = { x: number; events: string[]; time: number; name: string }

const oracleScript = `
const { createRequire } = require('node:module')
const requireRoot = createRequire(process.argv[1] + '/package.json')
const { SkeletonJson, Skeleton, AnimationState, AnimationStateData } = requireRoot('@esotericsoftware/spine-core')
const data = new SkeletonJson({}).readSkeletonData(JSON.parse(process.argv[2]))
const skeleton = new Skeleton(data)
const state = new AnimationState(new AnimationStateData(data))
const queued = process.argv[4] === 'queued'
state.setAnimation(0, 'A', !queued).reverse = !queued
if (queued) state.addAnimation(0, 'B', false).reverse = true
const events = []
state.addListener({ event: (_entry, event) => events.push(event.data.name) })
const frames = []
for (const step of JSON.parse(process.argv[3])) {
  state.update(step)
  state.apply(skeleton)
  frames.push({ x: skeleton.bones[0].pose.x, events: events.splice(0), time: state.tracks[0].trackTime,
    name: state.tracks[0].animation.name })
}
process.stdout.write(JSON.stringify(frames))
`

describe('reverse-loop AnimationState event parity with spine-core 4.3.13', () => {
  it('samples reverse pose and events across key endpoints and loop wrap', () => {
    const expected = JSON.parse(execFileSync(process.execPath,
      ['-e', oracleScript, root, JSON.stringify(fixture), JSON.stringify(steps)],
      { cwd: root, encoding: 'utf8' })) as Frame[]
    const asset = importSpine(fixture, { sourceYDown: false, unitScale: 1 })
    const pose = createPose(asset.skeleton)
    const state = new AnimationState(asset.animations, pose,
      createSlotSet(asset.slots, new Map([['default', { id: 'default', attachments: new Map() }]]), 'default'))
    state.play('A', { loop: true, reverse: true })
    const actual = steps.map(step => {
      const result = state.update(step)
      return { x: getLocal(pose, 0, CH_X), events: result.events, time: state.tracks[0]!.time,
        name: state.tracks[0]!.clip.name }
    })
    for (let i = 0; i < steps.length; i++) {
      expect(actual[i]!.x).toBeCloseTo(expected[i]!.x, 4)
      expect(actual[i]!.events).toEqual(expected[i]!.events)
      expect(actual[i]!.time).toBeCloseTo(expected[i]!.time % 1, 4)
    }
  })

  it('matches reverse event behavior when one update crosses multiple loops', () => {
    const longSteps = [2.35, 0.15, 2.2]
    const expected = JSON.parse(execFileSync(process.execPath,
      ['-e', oracleScript, root, JSON.stringify(fixture), JSON.stringify(longSteps)],
      { cwd: root, encoding: 'utf8' })) as Frame[]
    const asset = importSpine(fixture, { sourceYDown: false, unitScale: 1 })
    const pose = createPose(asset.skeleton)
    const state = new AnimationState(asset.animations, pose,
      createSlotSet(asset.slots, new Map([['default', { id: 'default', attachments: new Map() }]]), 'default'))
    state.play('A', { loop: true, reverse: true })
    const actual = longSteps.map(step => {
      const result = state.update(step)
      return { x: getLocal(pose, 0, CH_X), events: result.events, time: state.tracks[0]!.time }
    })
    for (let i = 0; i < longSteps.length; i++) {
      expect(actual[i]!.x).toBeCloseTo(expected[i]!.x, 4)
      expect(actual[i]!.events).toEqual(expected[i]!.events)
      expect(actual[i]!.time).toBeCloseTo(expected[i]!.time % 1, 4)
    }
  })

  it('retains reverse when a queued entry becomes active', () => {
    const queueSteps = [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25]
    const expected = JSON.parse(execFileSync(process.execPath,
      ['-e', oracleScript, root, JSON.stringify(fixture), JSON.stringify(queueSteps), 'queued'],
      { cwd: root, encoding: 'utf8' })) as Frame[]
    const asset = importSpine(fixture, { sourceYDown: false, unitScale: 1 })
    const pose = createPose(asset.skeleton)
    const state = new AnimationState(asset.animations, pose,
      createSlotSet(asset.slots, new Map([['default', { id: 'default', attachments: new Map() }]]), 'default'))
    state.play('A', { loop: false })
    state.queue('B', { loop: false, reverse: true })
    const actual = queueSteps.map(step => {
      const result = state.update(step)
      const entry = state.tracks[0]!
      return { x: getLocal(pose, 0, CH_X), events: result.events, time: entry.time, name: entry.clip.name }
    })
    expect(expected.some(frame => frame.name === 'B')).toBe(true)
    for (let i = 0; i < queueSteps.length; i++) {
      expect(actual[i]!.name).toBe(expected[i]!.name)
      expect(actual[i]!.x).toBeCloseTo(expected[i]!.x, 4)
      expect(actual[i]!.events).toEqual(expected[i]!.events)
      expect(actual[i]!.time).toBeCloseTo(expected[i]!.time, 4)
    }
    expect(state.tracks[0]!.reverse).toBe(true)
  })
})
