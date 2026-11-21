/**
 * M2 应用级烟测：18 骨 humanoid + walk clip，跑满 120 帧。
 * 断言确定性、无 NaN、事件次数合理、姿态确实被动画改变。
 */
import { describe, expect, it } from '@jest/globals'
import { compileSkeleton, type BoneSpec } from '@/core/skeleton'
import { createPose, updateWorld, CH_X } from '@/core/pose'
import type { AnimationClip, EventTimeline, Timeline } from '@/animation/animation'

import { createSlotSet, type SkinData, type SlotData } from '@/slot/slot'
import { createTrack, sampleAnimation } from '@/animation/animation'

function emptySlotSet() {
  const data: SlotData[] = [
    { id: 'body', bone: 0, order: 0, color: { r: 1, g: 1, b: 1, a: 1 }, blend: 'normal', attachment: null, mask: null, zOffset: 0 },
  ]
  const skins = new Map<string, SkinData>([['default', { id: 'default', attachments: new Map() }]])
  return createSlotSet(data, skins, 'default')
}

function humanoid(): BoneSpec[] {
  const b = (name: string, parent: number, x = 0, y = 0): BoneSpec => ({
    name, parent, length: 0.2,
    rest: { x, y, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
  })
  return [
    b('root', -1), b('hips', 0, 0, 0.9), b('spine', 1, 0, 0.15), b('chest', 2, 0, 0.15),
    b('neck', 3, 0, 0.15), b('head', 4, 0, 0.12),
    b('upperArmR', 3, 0.2, 0.05), b('lowerArmR', 6, 0.25, 0), b('handR', 7, 0.22, 0),
    b('upperArmL', 3, -0.2, 0.05), b('lowerArmL', 9, -0.25, 0), b('handL', 10, -0.22, 0),
    b('thighR', 1, 0.08, -0.05), b('shinR', 12, 0, -0.4), b('footR', 13, 0, -0.4),
    b('thighL', 1, -0.08, -0.05), b('shinL', 15, 0, -0.4), b('footL', 16, 0, -0.4),
  ]
}

function walkClip(): AnimationClip {
  const events: EventTimeline = {
    kind: 'event', path: 'walk',
    events: [
      { time: 0, name: 'stepR' },
      { time: 0.5, name: 'stepL' },
      { time: 1, name: 'cycle' },
    ],
  }
  const timelines: readonly Timeline[] = [
    { kind: 'rotate', path: 'thighR', keys: [
      { time: 0, value: 0 }, { time: 0.5, value: 0.6 }, { time: 1, value: 0 },
    ] },
    { kind: 'rotate', path: 'thighL', keys: [
      { time: 0, value: 0.6 }, { time: 0.5, value: 0 }, { time: 1, value: 0.6 },
    ] },
    { kind: 'translate', path: 'hips', keys: [
      { time: 0, value: 0 }, { time: 0.5, value: 0.08 }, { time: 1, value: 0 },
    ] },
    events,
  ]
  return { name: 'walk', duration: 1, timelines }
}

type Run = { locals: Float32Array; worlds: Float32Array; events: string[]; loopCount: number }

function run120(): Run {
  const sk = compileSkeleton({ name: 'humanoid', profile: 'simple2d', bones: humanoid() })
  const pose = createPose(sk)
  const clip = walkClip()
  const track = createTrack(clip, { loop: true })
  const slotSet = emptySlotSet()
  const events: string[] = []
  for (let frame = 0; frame < 120; frame += 1) {
    const result = sampleAnimation([track], pose, slotSet, 1 / 60)
    events.push(...result.events)
    updateWorld(pose)
  }
  return { locals: pose.local.slice(), worlds: pose.world.slice(), events, loopCount: track.loopCount }
}

describe('M2 smoke: 18 骨 humanoid + walk clip', () => {
  it('120 帧确定性、无 NaN、事件合理且姿态确实变化', () => {
    const sk = compileSkeleton({ name: 'humanoid', profile: 'simple2d', bones: humanoid() })
    const setup = sk.setupLocal.slice()

    const first = run120()
    const second = run120()

    expect(first.loopCount).toBe(2)
    expect(Array.from(first.locals)).toEqual(Array.from(second.locals))
    expect(Array.from(first.worlds)).toEqual(Array.from(second.worlds))
    expect(first.events).toEqual(second.events)

    for (const v of first.locals) expect(Number.isFinite(v)).toBe(true)
    for (const v of first.worlds) expect(Number.isFinite(v)).toBe(true)

    // 3 个事件/圈 × 2 圈，额外边界最多一两个；总数落在合理区间。
    expect(first.events.length).toBeGreaterThanOrEqual(5)
    expect(first.events.length).toBeLessThanOrEqual(9)

    let changed = 0
    for (let i = 0; i < first.locals.length; i += 1) {
      if (Math.abs(first.locals[i]! - setup[i]!) > 1e-4) changed += 1
    }
    expect(changed).toBeGreaterThan(0)
    expect(first.locals[sk.boneIdByName.get('hips')! * 7 + CH_X]).not.toBe(
      setup[sk.boneIdByName.get('hips')! * 7 + CH_X],
    )
  })
})
