import { describe, expect, it } from '@jest/globals'
import { compileSkeleton } from '@/core/skeleton'
import { CH_ROT, CH_SHX, CH_SHY, CH_SX, CH_SY, CH_X, CH_Y, createPose } from '@/core/pose'
import { createSlotSet } from '@/slot/slot'
import {
  applySliderBoneAnimation, createTrack, sampleAnimation, sampleScalar,
  type AnimationClip, type ScalarTimeline,
} from '@/animation/animation'

const skeleton = compileSkeleton({
  name: 'before-first', profile: 'simple2d',
  bones: [{ name: 'root', parent: -1, setup: {
    rotation: 0.4, x: 2, y: 3, scaleX: 2, scaleY: 3, shearX: 0.2, shearY: 0.3,
  } }],
})
const slots = () => createSlotSet([], new Map([['default', { id: 'default', attachments: new Map() }]]), 'default')
const channels = [CH_ROT, CH_X, CH_Y, CH_SX, CH_SY, CH_SHX, CH_SHY] as const
const earlyValues = [0.1, 1, 2, 1.2, 1.3, 0.05, 0.07]
const lateValues = [0.6, 7, 8, 1.5, 1.6, 0.4, 0.5]
const kinds = ['rotate', 'translate', 'translate', 'scale', 'scale', 'shear', 'shear'] as const
const axes = [undefined, 'x', 'y', 'x', 'y', 'x', 'y'] as const

function clip(name: string, first: number, values: readonly number[]): AnimationClip {
  const timelines: ScalarTimeline[] = channels.map((_, i) => ({
    kind: kinds[i]!, bone: 0,
    ...(axes[i] === undefined ? {} : { axis: axes[i] }),
    keys: [{ time: first, value: values[i]! }],
  }))
  return { name, duration: 1, timelines }
}

function expected(values: readonly number[]): number[] {
  return channels.map((channel, i) => {
    const setup = skeleton.setupLocal[channel]!
    return kinds[i] === 'scale' ? setup * values[i]! : setup + values[i]!
  })
}

function assertChannels(actual: Float32Array, values: readonly number[]): void {
  for (const [i, channel] of channels.entries()) expect(actual[channel]).toBeCloseTo(values[i]!, 6)
}

describe('bone timelines before the first key', () => {
  it('uses setup before key and activates the key exactly at its time, without changing scalar clamping', () => {
    const pose = createPose(skeleton)
    const animation = clip('late', 0.25, lateValues)
    pose.local.fill(99)
    sampleAnimation([createTrack(animation, { time: 0.249 })], pose, slots(), 0)
    assertChannels(pose.local, channels.map(channel => skeleton.setupLocal[channel]!))
    sampleAnimation([createTrack(animation, { time: 0.25 })], pose, slots(), 0)
    assertChannels(pose.local, expected(lateValues))
    expect(sampleScalar([{ time: 0.25, value: 7 }], 0.1)).toBe(7)
  })

  it('keeps underlying tracks through pre-key replace and additive mixes', () => {
    const underlying = clip('underlying', 0, earlyValues)
    const delayed = clip('delayed', 0.25, lateValues)
    for (const blendMode of ['replace', 'additive'] as const) {
      const pose = createPose(skeleton)
      sampleAnimation([
        createTrack(underlying, { time: 0.15 }),
        createTrack(delayed, { time: 0.15, alpha: 0.4, blendMode }),
      ], pose, slots(), 0)
      assertChannels(pose.local, expected(earlyValues))
      const activated = createPose(skeleton)
      sampleAnimation([
        createTrack(underlying, { time: 0.25 }),
        createTrack(delayed, { time: 0.25, alpha: 0.4, blendMode }),
      ], activated, slots(), 0)
      expect(activated.local[CH_ROT]).not.toBeCloseTo(pose.local[CH_ROT]!, 6)
    }
  })

  it('does not prematurely apply slider bone keys to the current pose', () => {
    const pose = createPose(skeleton)
    pose.local[CH_ROT] = 1.2
    const animation = clip('slider', 0.25, lateValues)
    applySliderBoneAnimation(animation, pose, 0.249, 0.5, false, false)
    expect(pose.local[CH_ROT]).toBeCloseTo(1.2, 6)
    applySliderBoneAnimation(animation, pose, 0.25, 0.5, false, false)
    expect(pose.local[CH_ROT]).toBeCloseTo((1.2 + skeleton.setupLocal[CH_ROT]! + lateValues[0]!) / 2, 6)
  })
})
