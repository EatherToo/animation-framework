import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { importSpine } from '@/asset/importer'
import { createConstraintSolver } from '@/constraint/constraint'
import { CH_X } from '@/core/math'
import { createPose, setLocal } from '@/core/pose'
import { createSlotSet } from '@/slot/slot'

const root = resolve(process.cwd(), '../..')
const oracle = `
const { createRequire } = require('node:module')
const core = createRequire(process.argv[1] + '/package.json')('@esotericsoftware/spine-core')
const doc = JSON.parse(process.argv[2]), time = Number(process.argv[3]), drive = Number(process.argv[4])
const loader = { newRegionAttachment: (_, name) => new core.RegionAttachment(name, new core.Sequence(0, false)),
  newMeshAttachment() {}, newBoundingBoxAttachment() {}, newPathAttachment() {}, newPointAttachment() {}, newClippingAttachment() {} }
const data = new core.SkeletonJson(loader).readSkeletonData(doc)
const skeleton = new core.Skeleton(data)
skeleton.bones[0].pose.x = drive
skeleton.updateWorldTransform(core.Physics.none)
process.stdout.write(JSON.stringify({
  time: skeleton.constraints[0].appliedPose.time,
  attachments: skeleton.slots.map(slot => slot.appliedPose.attachment?.name ?? null),
  order: skeleton.drawOrder.appliedPose.map(slot => slot.data.index),
}))
`

function document(local: boolean, additive: boolean, loop: boolean) {
  return {
    skeleton: { spine: '4.3.0' },
    bones: [{ name: 'root' }],
    slots: [{ name: 'front', bone: 'root', attachment: 'a' }, { name: 'back', bone: 'root', attachment: 'b' }],
    skins: [{ name: 'default', attachments: { front: { a: { type: 'region' }, c: { type: 'region' } },
      back: { b: { type: 'region' } } } }],
    events: { ping: {} },
    constraints: [{ name: 'slider', type: 'slider', animation: 'nested', bone: 'root', property: 'x',
      local, additive, loop, from: 0, to: 0, scale: 1, mix: 0.2 }],
    animations: { nested: {
      slots: { front: { attachment: [{ time: 0.25, name: 'c' }, { time: 0.75, name: null }] } },
      drawOrder: [{ time: 0.5, offsets: [{ slot: 'front', offset: 1 }] }],
      events: [{ time: 0.25, name: 'ping' }],
    } },
  }
}

describe('Spine 4.3 slider nested instant channels', () => {
  for (const local of [false, true]) for (const additive of [false, true]) for (const loop of [false, true]) {
    for (const drive of [0.1, 0.4, 0.8, 1.4]) it(`local=${local} additive=${additive} loop=${loop} drive=${drive}`, () => {
      const doc = document(local, additive, loop)
      const expected = JSON.parse(execFileSync(process.execPath,
        ['-e', oracle, root, JSON.stringify(doc), '0', String(drive)], { cwd: root, encoding: 'utf8' })) as {
          time: number; attachments: (string | null)[]; order: number[]
        }
      const asset = importSpine(doc, { unitScale: 1 })
      const clip = asset.animations.get('nested')!
      const slots = createSlotSet(asset.slots, asset.skins, 'default')
      const pose = createPose(asset.skeleton)
      setLocal(pose, 0, CH_X, drive)
      createConstraintSolver(asset.constraints ?? []).solve(pose, 0, undefined, slots)
      expect(slots.slots.map(slot => slot.attachmentId)).toEqual(expected.attachments)
      expect(slots.drawOrder).toEqual(expected.order)
      expect(clip.timelines.some(timeline => timeline.kind === 'event')).toBe(true)
      expect(asset.report.issues.some(item => item.code === 'W_CONSTRAINT_UNSUPPORTED')).toBe(false)
    })
  }
})
