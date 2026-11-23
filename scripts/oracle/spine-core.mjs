#!/usr/bin/env node
// Official 4.3.13 numeric oracle. Run from any directory: node scripts/oracle/spine-core.mjs <sample-dir> [animation].
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(fileURLToPath(new URL('../../package.json', import.meta.url)))
const { AtlasAttachmentLoader, AnimationState, AnimationStateData, Physics, Skeleton, SkeletonJson, TextureAtlas } = require('@esotericsoftware/spine-core')
const root = resolve(process.argv[2] ?? 'test/fixtures/spine/spineboy')
const name = root.split(/[\\/]/).at(-1)
const json = JSON.parse(await readFile(join(root, `${name}-pro.json`), 'utf8'))
const atlas = new TextureAtlas(await readFile(join(root, `${name}.atlas`), 'utf8'))
const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(json)
const animation = process.argv[3] ?? data.animations.find(a => a.duration > 0)?.name
if (!animation) throw new Error(`No positive-duration animation in ${name}`)
const clip = data.animations.find(a => a.name === animation)
if (!clip) throw new Error(`Unknown animation ${animation}`)
const unitScale = 0.01
const number = n => Number.isFinite(n) ? n : null
const color = c => c && ({ r: c.r, g: c.g, b: c.b, a: c.a })
const pose = p => ({
  x: number(p.x * unitScale), y: number(p.y * unitScale), rotation: number(p.rotation * Math.PI / 180),
  scaleX: number(p.scaleX), scaleY: number(p.scaleY), shearX: number(p.shearX * Math.PI / 180), shearY: number(p.shearY * Math.PI / 180),
  world: [p.a, p.c, p.b, p.d, p.worldX * unitScale, p.worldY * unitScale].map(number),
})
const slotPose = p => ({ attachment: p.attachment?.name ?? null, color: color(p.color), darkColor: color(p.darkColor), sequenceIndex: p.sequenceIndex, deform: Array.from(p.deform) })
const constraintPose = p => p && Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === 'number' || typeof v === 'boolean').map(([k, v]) => [k, typeof v === 'number' ? number(v) : v]))
const snapshot = (s, time) => ({
  time, bones: s.bones.map(b => ({ name: b.data.name, pose: pose(b.pose), appliedPose: pose(b.appliedPose) })),
  slots: s.slots.map(slot => ({ name: slot.data.name, pose: slotPose(slot.pose), appliedPose: slotPose(slot.appliedPose) })),
  drawOrder: { pose: s.drawOrder.pose.map(slot => slot.data.name), appliedPose: s.drawOrder.appliedPose.map(slot => slot.data.name) },
  constraints: s.constraints.map(c => ({ name: c.data.name, kind: c.constructor.name, pose: constraintPose(c.pose), appliedPose: constraintPose(c.appliedPose) })),
})
const times = [0.1, 0.25, 0.5, 1].map(f => f * clip.duration).concat(Math.max(0, clip.duration - 0.0001))
const frames = times.map(time => {
  const skeleton = new Skeleton(data)
  skeleton.setupPose()
  skeleton.time = time
  const state = new AnimationState(new AnimationStateData(data))
  state.setAnimation(0, animation, false)
  state.update(time)
  state.apply(skeleton)
  skeleton.updateWorldTransform(Physics.update)
  return snapshot(skeleton, time)
})
process.stdout.write(JSON.stringify({ schema: 1, runtime: 'spine-core@4.3.13', source: root, sourceVersion: json.skeleton?.spine, animation, duration: clip.duration, unitScale, sourceYDown: false, frames }) + '\n')
