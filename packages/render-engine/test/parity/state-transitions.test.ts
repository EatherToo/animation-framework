import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { importSpine } from '@/asset/importer'
import { AnimationState, AnimationStateData } from '@/animation/animation'
import { createPose, getLocal, CH_X } from '@/core/pose'
import { createSlotSet } from '@/slot/slot'

const root = resolve(process.cwd(), '../..')
const fixture = {
  skeleton: { spine: '4.3.13' },
  bones: [{ name: 'root' }],
  slots: [],
  animations: {
    A: { bones: { root: { translate: [{ x: 10, y: 0 }, { time: 1, x: 20, y: 0 }] } },
      events: [{ time: 0.25, name: 'tick' }] },
    B: { bones: { root: { translate: [{ x: 30, y: 0 }, { time: 1, x: 40, y: 0 }] } },
      events: [{ time: 0.25, name: 'tock' }] },
  },
  events: { tick: {}, tock: {} },
}

type Frame = { x: number; events: string[]; time: number; mix: number }
const oracleScript = `
const { createRequire } = require('node:module')
const requireRoot = createRequire(process.argv[1] + '/package.json')
const { SkeletonJson, Skeleton, AnimationState, AnimationStateData } = requireRoot('@esotericsoftware/spine-core')
const data = new SkeletonJson({}).readSkeletonData(JSON.parse(process.argv[2]))
const skeleton = new Skeleton(data)
const mix = new AnimationStateData(data)
mix.defaultMix = 0.4
mix.setMix('A', 'B', 0.6)
const state = new AnimationState(mix)
const events = []
state.addListener({ event: (_entry, event) => events.push(event.data.name) })
const mode = process.argv[3]
const a = state.setAnimation(0, 'A', mode === 'queue')
if (mode === 'threshold') a.eventThreshold = 0.75
if (mode === 'queue') state.addAnimation(0, 'B', false)
const frames = []
for (const step of [0.2, 0.2, 0.2, 0.2, 0.2, 0.2]) {
  if (['crossfade', 'threshold', 'alpha'].includes(mode) && frames.length === 1) {
    const b = state.setAnimation(0, 'B', false)
    if (mode === 'alpha') b.alpha = 0.5
  }
  if (mode === 'empty' && frames.length === 1) state.setEmptyAnimation(0, 0.4)
  if (mode === 'reverse' && frames.length === 1) state.setAnimation(0, 'B', false).reverse = true
  state.update(step)
  state.apply(skeleton)
  const entry = state.tracks[0]
  frames.push({ x: skeleton.bones[0].pose.x, events: events.splice(0), time: entry?.trackTime ?? 0,
    mix: entry?.mix() ?? 0 })
}
process.stdout.write(JSON.stringify(frames))
`

function official(mode: string): Frame[] {
  return JSON.parse(execFileSync(process.execPath,
    ['-e', oracleScript, root, JSON.stringify(fixture), mode],
    { cwd: root, encoding: 'utf8' })) as Frame[]
}

function local(mode: string): Frame[] {
  const asset = importSpine(fixture, { sourceYDown: false, unitScale: 1 })
  const data = new AnimationStateData(asset.animations)
  data.defaultMix = 0.4
  data.setMix('A', 'B', 0.6)
  const pose = createPose(asset.skeleton)
  const state = new AnimationState(asset.animations, pose, createSlotSet(asset.slots, new Map([['default', { id: 'default', attachments: new Map() }]]), 'default'), data)
  const a = state.play('A', { loop: mode === 'queue' })
  if (mode === 'threshold') a.eventThreshold = 0.75
  if (mode === 'queue') state.queue('B', { loop: false })
  const frames: Frame[] = []
  for (const step of [0.2, 0.2, 0.2, 0.2, 0.2, 0.2]) {
    if (['crossfade', 'threshold', 'alpha'].includes(mode) && frames.length === 1)
      state.play('B', { loop: false, alpha: mode === 'alpha' ? 0.5 : 1 })
    if (mode === 'empty' && frames.length === 1) state.setEmptyAnimation(0, 0.4)
    if (mode === 'reverse' && frames.length === 1) state.play('B', { loop: false, reverse: true })
    const result = state.update(step)
    const entry = state.tracks[0]!
    frames.push({ x: getLocal(pose, 0, CH_X), events: result.events, time: entry.time,
      mix: entry.mixDuration > 0 ? Math.min(1, entry.mixTime / entry.mixDuration) : 1 })
  }
  return frames
}

describe('AnimationState transitions versus spine-core 4.3.13 SkeletonJson', () => {
  for (const mode of ['crossfade', 'empty', 'reverse', 'queue', 'threshold', 'alpha']) {
    it(`${mode} pose, events and track time`, () => {
      const expected = official(mode)
      const actual = local(mode)
      for (let i = 0; i < expected.length; i++) {
        expect(actual[i]!.x).toBeCloseTo(expected[i]!.x, 4)
        expect(actual[i]!.events).toEqual(expected[i]!.events)
        expect(actual[i]!.time).toBeCloseTo(expected[i]!.time, 4)
        if (actual[i]!.time > 0) expect(actual[i]!.mix).toBeCloseTo(expected[i]!.mix, 4)
      }
    })
  }
})
