import { describe, expect, it } from '@jest/globals'
import { compileSkeleton } from '@/core/skeleton'
import { createPose, getRotation } from '@/core/pose'
import { createSlotSet } from '@/slot/slot'
import {
  AnimationState, createTrack, type AnimationClip, type AnimationEvent,
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
