import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { compileSkeleton } from '@/core/skeleton'
import { createPose, getRotation } from '@/core/pose'
import { createSlotSet } from '@/slot/slot'
import {
  AnimationState, AnimationStateData, createTrack, type AnimationClip, type AnimationEvent,
} from '@/animation/animation'

const sk = compileSkeleton({
  name: 'state', profile: 'simple2d',
  bones: [{ name: 'root', parent: -1, length: 1 }],
})
const slotSet = createSlotSet([], new Map([['default', { id: 'default', attachments: new Map() }]]), 'default')
const walk: AnimationClip = {
  name: 'walk', duration: 1,
  timelines: [
    { kind: 'rotate', path: 'root', keys: [{ time: 0, value: 0 }, { time: 1, value: 1 }] },
    { kind: 'event', path: '0', events: [{ time: 0.5, name: 'footstep' }] },
  ],
}

const clips = new Map<string, AnimationClip>(['A', 'B', 'C'].map((name) => [
  name, { name, duration: 1, timelines: [] },
]))

// Jest runs CommonJS here; launch the official ESM runtime in Node for the oracle.
const officialSample = `
import { Animation, AnimationState, AnimationStateData, Skeleton, SkeletonData } from '@esotericsoftware/spine-core'
const skeleton = new SkeletonData()
for (const name of ['A', 'B', 'C']) skeleton.animations.push(new Animation(name, [], 1))
const data = new AnimationStateData(skeleton)
const initial = data.defaultMix
data.defaultMix = 0.35
data.setMix('A', 'B', 0.8)
data.setMix(skeleton.findAnimation('B'), skeleton.findAnimation('A'), 0)
const get = (from, to) => data.getMix(skeleton.findAnimation(from), skeleton.findAnimation(to))
const lookups = [['A', 'B'], ['B', 'A'], ['A', 'C'], ['C', 'A']].map(([from, to]) => get(from, to))
let unknown = false
try { data.setMix('missing', 'A', 1) } catch (error) { unknown = error.message.includes('Animation not found') }
data.defaultMix = 0.4
data.setMix('A', 'B', 0.8)
const state = new AnimationState(data)
const posed = new Skeleton(skeleton)
const first = state.setAnimation(0, 'A', false).mixDuration
state.update(0.1)
state.apply(posed)
const b = state.setAnimation(0, 'B', false)
const replacement = b.mixDuration
state.update(0.2)
const progress = b.mix()
state.apply(posed)
const queueData = new AnimationStateData(skeleton)
queueData.defaultMix = 0.2
queueData.setMix('A', 'B', 0.6)
queueData.setMix('B', 'C', 0.9)
const queueState = new AnimationState(queueData)
queueState.setAnimation(0, 'A', false)
const queued = [queueState.addAnimation(0, 'B', false).mixDuration, queueState.addAnimation(0, 'C', false).mixDuration]
process.stdout.write(JSON.stringify({ initial, lookups, unknown, first, replacement, progress, queued }))
`
const official = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', officialSample], {
  cwd: process.cwd().replace(/\/packages\/render-engine$/, ''), encoding: 'utf8',
})) as {
  initial: number; lookups: number[]; unknown: boolean; first: number
  replacement: number; progress: number; queued: number[]
}

function localState(data: AnimationStateData) {
  return new AnimationState(clips, createPose(sk), slotSet, data)
}

describe('A16 AnimationStateData mix parity with spine-core', () => {
  it('uses zero by default, then a mutable default and directional pair overrides', () => {
    const local = new AnimationStateData(clips)
    expect(local.defaultMix).toBe(official.initial)
    local.defaultMix = 0.35
    local.setMix('A', 'B', 0.8)
    local.setMix(clips.get('B')!, clips.get('A')!, 0)
    const pairs = [['A', 'B'], ['B', 'A'], ['A', 'C'], ['C', 'A']] as const
    expect(pairs.map(([from, to]) => local.getMix(from, to))).toEqual(official.lookups)
    expect(() => local.setMix('missing', 'A', 1)).toThrow('E_ANIM')
    expect(official.unknown).toBe(true)
  })

  it('applies configured mix on replacement but not on an empty track', () => {
    const data = new AnimationStateData(clips)
    data.defaultMix = 0.4
    data.setMix('A', 'B', 0.8)
    const local = localState(data)
    const a = local.play('A')
    expect(a.mixDuration).toBe(official.first)
    local.update(0.1)
    const b = local.play('B')
    expect(b.mixDuration).toBe(official.replacement)
    local.update(0.2)
    expect(b.mixTime / b.mixDuration).toBeCloseTo(official.progress, 6)
    expect(local.play('A').mixDuration).toBe(data.defaultMix)
    expect(local.play('B', { mixDuration: 0 }).mixDuration).toBe(0)
  })

  it('resolves queued mix from the last queued animation and retains explicit overrides', () => {
    const data = new AnimationStateData(clips)
    data.defaultMix = 0.2
    data.setMix('A', 'B', 0.6)
    data.setMix('B', 'C', 0.9)
    const local = localState(data)
    const track = local.play('A', { loop: false })
    local.queue('B', { loop: false })
    local.queue('C', { loop: false })
    expect(track.queue.map((entry) => entry.mixDuration)).toEqual(official.queued)
    expect(track.queue[0]!.delay).toBeCloseTo(0.4)
    expect(track.queue[1]!.delay).toBeCloseTo(0.1)
    local.update(1)
    expect(track.clip.name).toBe('A')
    local.update(1)
    expect(track.clip.name).toBe('B')
    expect(track.mixDuration).toBe(official.queued[0])
    local.update(1)
    expect(track.clip.name).toBe('C')
    expect(track.mixDuration).toBe(official.queued[1])
    const override = local.queue('A', { mixDuration: 0.15 })
    expect(override.queue[0]?.mixDuration).toBe(0.15)
  })
})

describe('AnimationState facade', () => {
  it('plays, advances, emits events and applies to pose', () => {
    const pose = createPose(sk)
    const state = new AnimationState(new Map([['walk', walk]]), pose, slotSet)
    const seen: AnimationEvent[] = []
    state.addListener('event', (e) => seen.push(e))
    const track = state.play('walk', { loop: true })
    expect(track).toBe(state.tracks[0])
    state.update(0.5)
    expect(getRotation(pose, 0)).toBeCloseTo(0.5, 6)
    expect(seen.map((e) => e.name)).toContain('footstep')
    state.pause()
    state.update(0.5)
    expect(getRotation(pose, 0)).toBeCloseTo(0.5, 6)
    state.resume()
    state.update(0.5)
    expect(getRotation(pose, 0)).toBeCloseTo(0, 6)
    expect(() => state.play('missing')).toThrow('E_ANIM')
    state.dispose()
    expect(() => state.update(0.1)).toThrow('E_DISPOSED')
  })

  it('exposes a compatible createTrack path', () => {
    const t = createTrack(walk)
    expect(t.loop).toBe(true)
  })
})
