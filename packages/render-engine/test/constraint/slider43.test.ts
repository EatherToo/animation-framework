import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createTrack, sampleAnimation } from '@/animation/animation'
import { importSpine } from '@/asset/importer'
import { createConstraintSolver } from '@/constraint/constraint'
import { createPose, updateWorld } from '@/core/pose'
import { createSlotSet } from '@/slot/slot'

const root = resolve(process.cwd(), '../..')
const source = `
const { createRequire } = require('node:module')
const core = createRequire(process.argv[1] + '/package.json')('@esotericsoftware/spine-core')
const doc = JSON.parse(process.argv[2]), at = +process.argv[3], drive = +process.argv[4]
const loader = { newRegionAttachment() {}, newMeshAttachment() {}, newBoundingBoxAttachment() {}, newPathAttachment() {}, newPointAttachment() {}, newClippingAttachment() {} }
const data = new core.SkeletonJson(loader).readSkeletonData(doc)
const skeleton = new core.Skeleton(data)
skeleton.bones[0].pose.x = drive
const state = new core.AnimationState(new core.AnimationStateData(data))
state.setAnimation(0, 'control', false)
state.update(at)
state.apply(skeleton)
skeleton.updateWorldTransform(core.Physics.none)
process.stdout.write(JSON.stringify(skeleton.bones.map(b => [b.appliedPose.a, b.appliedPose.c, b.appliedPose.b, b.appliedPose.d, b.appliedPose.worldX, b.appliedPose.worldY])))
`

function document(mode: { local?: boolean; additive?: boolean; loop?: boolean; bone?: boolean; timeline?: boolean; rotate?: boolean }) {
  return {
    skeleton: { spine: '4.3.0' },
    bones: [{ name: 'root', rotation: 20 }, { name: 'driver', parent: 'root', x: 1.4, rotation: 30 },
      { name: 'child', parent: 'root', x: 2, rotation: 15 }],
    slots: [], skins: [{ name: 'default', attachments: {} }],
    constraints: [{ name: 'slider', type: 'slider', animation: 'nested', mix: 0.65,
      time: 0.35, ...(mode.bone ? { bone: 'driver', property: mode.rotate ? 'rotate' : 'x', from: mode.rotate ? 10 : 1,
        to: 0.2, scale: mode.rotate ? 0.02 : mode.loop ? 3 : 0.6 } : {}),
      local: mode.local ?? false, additive: mode.additive ?? false, loop: mode.loop ?? false }],
    animations: {
      nested: { bones: { child: {
        translate: [{ time: 0, x: 0 }, { time: 1, x: 8 }],
        rotate: [{ time: 0, value: 0 }, { time: 1, value: 60 }],
        scale: [{ time: 0, x: 1, y: 1 }, { time: 1, x: 1.2, y: 0.8 }],
        shear: [{ time: 0, x: 0, y: 0 }, { time: 1, x: 4, y: 10 }],
      } } },
      control: { ...(mode.additive ? { bones: { child: { translate: [{ time: 0, x: 3, y: 0 }] } } } : {}),
        ...(mode.timeline ? { slider: { slider: {
        time: [{ time: 0, value: 0.1 }, { time: 1, value: 0.9 }],
        mix: [{ time: 0, value: 0.2 }, { time: 1, value: 0.8 }],
      } } } : {}) },
    },
  }
}

describe('Spine 4.3 slider official world poses', () => {
  for (const mode of [
    { name: 'manual', opts: {} },
    { name: 'time and mix timelines', opts: { timeline: true } },
    { name: 'local source', opts: { bone: true, local: true } },
    { name: 'world source', opts: { bone: true, local: false } },
    { name: 'local rotation source', opts: { bone: true, rotate: true, local: true } },
    { name: 'world rotation source', opts: { bone: true, rotate: true, local: false } },
    { name: 'additive', opts: { additive: true, timeline: true } },
    { name: 'loop', opts: { bone: true, local: true, loop: true } },
  ]) {
    for (const at of [0.15, 0.5, 0.85]) it(`${mode.name} at ${at}`, () => {
      const doc = document(mode.opts)
      const drive = mode.opts.bone ? (mode.opts.loop ? 3.8 : 1.4) : 0
      const expected = JSON.parse(execFileSync(process.execPath,
        ['-e', source, root, JSON.stringify(doc), String(at), String(drive)],
        { cwd: root, encoding: 'utf8' })) as number[][]
      const asset = importSpine(doc, { unitScale: 1 })
      const pose = createPose(asset.skeleton)
      pose.local[0] = drive
      const slotSet = createSlotSet(asset.slots, asset.skins, 'default')
      const track = createTrack(asset.animations.get('control')!, { loop: false })
      const sample = sampleAnimation([track], pose, slotSet, at)
      createConstraintSolver(asset.constraints!).solve(pose, 0, sample.constraintMixByName)
      updateWorld(pose)
      for (let bone = 0; bone < expected.length; bone++) {
        for (let component = 0; component < 6; component++) {
          expect(pose.world[bone * 6 + component]).toBeCloseTo(expected[bone]![component]!, 4)
        }
      }
    })
  }
})
