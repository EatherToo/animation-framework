import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importSpine } from '@/asset/importer'
import { createTrack, sampleAnimation, type Timeline } from '@/animation/animation'
import { createPose } from '@/core/pose'
import { createSlotSet } from '@/slot/slot'

const root = resolve(process.cwd(), '../..')
const declaration = resolve(root, 'node_modules/@esotericsoftware/spine-core/dist/Animation.d.ts')

// Every concrete 4.3.13 class maps to an imported channel; null marks a real gap.
const correspondence = {
  RotateTimeline: 'rotate',
  TranslateTimeline: 'translate', TranslateXTimeline: 'translate', TranslateYTimeline: 'translate',
  ScaleTimeline: 'scale', ScaleXTimeline: 'scale', ScaleYTimeline: 'scale',
  ShearTimeline: 'shear', ShearXTimeline: 'shear', ShearYTimeline: 'shear',
  InheritTimeline: null,
  RGBATimeline: 'color', RGBTimeline: 'color', AlphaTimeline: 'color',
  RGBA2Timeline: 'color', RGB2Timeline: 'color',
  AttachmentTimeline: 'attachment', DeformTimeline: 'deform', SequenceTimeline: null,
  EventTimeline: 'event', DrawOrderTimeline: 'drawOrder', DrawOrderFolderTimeline: null,
  IkConstraintTimeline: 'ik', TransformConstraintTimeline: 'transform',
  PathConstraintPositionTimeline: 'path', PathConstraintSpacingTimeline: 'path',
  PathConstraintMixTimeline: 'path',
  PhysicsConstraintInertiaTimeline: 'physics', PhysicsConstraintStrengthTimeline: 'physics',
  PhysicsConstraintDampingTimeline: 'physics', PhysicsConstraintMassTimeline: 'physics',
  PhysicsConstraintWindTimeline: 'physics', PhysicsConstraintGravityTimeline: 'physics',
  PhysicsConstraintMixTimeline: 'physics', PhysicsConstraintResetTimeline: 'physics',
  SliderTimeline: 'slider', SliderMixTimeline: 'slider',
} as const satisfies Record<string, Timeline['kind'] | null>

const missing = Object.entries(correspondence).filter(([, kind]) => kind === null).map(([name]) => name).sort()
const sourceClasses = Array.from(readFileSync(declaration, 'utf8').matchAll(
  /export declare class (\w+Timeline) extends /g,
), match => match[1]!).sort()

const fixture = {
  skeleton: { spine: '4.3.13' },
  bones: [{ name: 'root', x: 2, y: 3, rotation: 10, scaleX: 2, scaleY: 3, shearX: 5, shearY: 7 }],
  slots: [],
  animations: { probe: { bones: { root: {
    rotate: [{ value: 20 }, { time: 1, value: 80 }],
    translate: [{ x: 4, y: 6 }, { time: 1, x: 8, y: 12 }],
    scale: [{ x: 1.2, y: 0.8 }, { time: 1, x: 1.8, y: 1.4 }],
    shear: [{ x: 4, y: 6 }, { time: 1, x: 8, y: 10 }],
  } } } },
}

const official = `
const { createRequire } = require('node:module')
const requireRoot = createRequire(process.argv[1] + '/package.json')
const { SkeletonJson, Skeleton, AnimationState, AnimationStateData } = requireRoot('@esotericsoftware/spine-core')
const data = new SkeletonJson({}).readSkeletonData(JSON.parse(process.argv[2]))
const animation = data.findAnimation('probe')
const skeleton = new Skeleton(data)
const state = new AnimationState(new AnimationStateData(data))
state.setAnimation(0, 'probe', false)
const frames = []
let previous = 0
for (const time of [0.125, 0.5, 0.875]) {
  state.update(time - previous)
  state.apply(skeleton)
  const { x, y, rotation, scaleX, scaleY, shearX, shearY } = skeleton.bones[0].pose
  frames.push([x, y, rotation, scaleX, scaleY, shearX, shearY])
  previous = time
}
process.stdout.write(JSON.stringify({ kinds: animation.timelines.map(t => t.constructor.name).sort(), frames }))
`

describe('A12 spine-core@4.3.13 timeline class matrix', () => {
  it('pins every concrete reference class and the exact unsupported set', () => {
    expect(Object.keys(correspondence).sort()).toEqual(sourceClasses)
    expect(missing).toEqual(['DrawOrderFolderTimeline', 'InheritTimeline', 'SequenceTimeline'])
    // The opt-in release gate fails until every class has an import/apply equivalent.
    if (process.env.SPINE_A12_REQUIRED === '1') expect(missing).toEqual([])
  })

  it('applies sampled 4.3 bone timeline frames against the official runtime at 1e-6', () => {
    const reference = JSON.parse(execFileSync(process.execPath,
      ['-e', official, root, JSON.stringify(fixture)], { cwd: root, encoding: 'utf8' })) as {
      kinds: string[]; frames: number[][]
    }
    expect(reference.kinds).toEqual([
      'RotateTimeline', 'ScaleTimeline', 'ShearTimeline', 'TranslateTimeline',
    ])
    const asset = importSpine(fixture, { unitScale: 1, sourceYDown: false })
    const clip = asset.animations.get('probe')!
    expect(new Set(clip.timelines.map(t => t.kind))).toEqual(new Set(reference.kinds.map(
      name => correspondence[name as keyof typeof correspondence],
    )))
    const slots = createSlotSet(asset.slots,
      new Map([['default', { id: 'default', attachments: new Map() }]]), 'default')
    for (const [index, time] of [0.125, 0.5, 0.875].entries()) {
      const pose = createPose(asset.skeleton)
      sampleAnimation([createTrack(clip, { time, loop: false })], pose, slots, 0)
      const expected = reference.frames[index]!
      for (let channel = 0; channel < 7; channel++) {
        const actual = pose.local[channel]!
        const converted = channel === 2 || channel >= 5 ? expected[channel]! * Math.PI / 180 : expected[channel]!
        expect(Math.abs(actual - converted)).toBeLessThanOrEqual(1e-6)
      }
    }
  })
})
