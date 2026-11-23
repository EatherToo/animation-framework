import { describe, expect, it } from '@jest/globals'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { importSpineAtlas } from '@/asset/atlas'
import { importSpine } from '@/asset/importer'
import { Engine } from '@/runtime/runtime'
import { POSE_STRIDE, WORLD_STRIDE } from '@/core/pose'

const root = resolve(process.cwd(), '../..')
// Same SpineJson / AnimationState / Physics.update sequence as scripts/oracle/spine-core.mjs,
// sampled at setup and absolute 0.25 seconds rather than fractions of clip duration.
const officialSample = `
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(process.argv[1] + '/package.json')
const { AtlasAttachmentLoader, AnimationState, AnimationStateData, Physics, Skeleton, SkeletonJson, TextureAtlas } = require('@esotericsoftware/spine-core')
const dir = process.argv[2], name = process.argv[3]
const json = JSON.parse(readFileSync(dir + '/' + name + '-pro.json', 'utf8'))
const data = new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(readFileSync(dir + '/' + name + '.atlas', 'utf8')))).readSkeletonData(json)
const animation = data.animations.find(a => a.duration > 0)?.name
const snapshot = skeleton => ({ bones: skeleton.bones.map(b => ({ data: { name: b.data.name }, pose: Object.fromEntries(['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY', 'a', 'b', 'c', 'd', 'worldX', 'worldY'].map(k => [k, b.appliedPose[k]])) })) })
const setup = new Skeleton(data)
setup.setupPose()
setup.updateWorldTransform(Physics.update)
const animated = new Skeleton(data)
animated.setupPose()
animated.time = 0.25
const state = new AnimationState(new AnimationStateData(data))
state.setAnimation(0, animation, false)
state.update(0.25)
state.apply(animated)
animated.updateWorldTransform(Physics.update)
process.stdout.write(JSON.stringify({ animation, setup: snapshot(setup), animated: snapshot(animated) }))
`
const samples = ['spineboy', 'raptor', 'stretchyman']
const available = samples.every(name => ['-pro.json', '.atlas'].every(ext =>
  existsSync(resolve(root, 'test/fixtures/spine', name, `${name}${ext}`))))
if (process.env.SPINE_PARITY_REQUIRED === '1' && !available) {
  throw new Error('Official Spine samples missing; run node scripts/fetch-spine-samples.mjs')
}

type OfficialBone = {
  data: { name: string }
  pose: {
    x: number; y: number; rotation: number; scaleX: number; scaleY: number; shearX: number; shearY: number
    a: number; b: number; c: number; d: number; worldX: number; worldY: number
  }
}
const channels = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'] as const
const matrix = ['a', 'c', 'b', 'd', 'tx', 'ty'] as const
function officialLocal(bone: OfficialBone): number[] {
  const p = bone.pose
  return [p.x * 0.01, p.y * 0.01, p.rotation * Math.PI / 180, p.scaleX, p.scaleY,
    p.shearX * Math.PI / 180, p.shearY * Math.PI / 180]
}
function officialWorld(bone: OfficialBone): number[] {
  const p = bone.pose
  return [p.a, p.c, p.b, p.d, p.worldX * 0.01, p.worldY * 0.01]
}

const suite = available ? describe : describe.skip
suite('official spine-core bone world parity', () => {
  for (const name of samples) {
    it(`${name} matches setup and absolute t=0.25s`, () => {
      const dir = resolve(root, 'test/fixtures/spine', name)
      const json = JSON.parse(readFileSync(resolve(dir, `${name}-pro.json`), 'utf8'))
      const atlasText = readFileSync(resolve(dir, `${name}.atlas`), 'utf8')
      const official = JSON.parse(execFileSync(process.execPath,
        ['--input-type=module', '-e', officialSample, root, dir, name], { cwd: root, encoding: 'utf8' })) as {
        animation: string; setup: { bones: OfficialBone[] }; animated: { bones: OfficialBone[] }
      }
      expect(official.animation).toBeDefined()
      const asset = importSpine(json, { atlas: importSpineAtlas(atlasText), unitScale: 0.01, sourceYDown: false })
      const engine = new Engine({ backend: 'cpu' })
      engine.load(asset)
      const failures: string[] = []
      function compare(phase: string, official: { bones: OfficialBone[] }): void {
        const pose = engine.pose
        let firstLocal = ''
        let firstWorld = ''
        let maxWorld = 0
        expect(pose.skeleton.count).toBe(official.bones.length)
        for (const bone of official.bones) {
          const id = pose.skeleton.boneIdByName.get(bone.data.name)
          if (id === undefined) { failures.push(`${phase}: missing bone ${bone.data.name}`); continue }
          const local = officialLocal(bone)
          const world = officialWorld(bone)
          for (let c = 0; c < POSE_STRIDE; c++) {
            const actual = pose.local[id * POSE_STRIDE + c]!
            const expected = local[c]!
            const tolerance = c === 0 || c === 1 ? 1e-4 : 1e-5
            const delta = c === 2 ? Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected)) : actual - expected
            if (!firstLocal && Math.abs(delta) > tolerance) {
              firstLocal = `${bone.data.name}.${channels[c]} expected=${expected.toFixed(8)} actual=${actual.toFixed(8)} delta=${(actual - expected).toFixed(8)}`
            }
          }
          for (let c = 0; c < WORLD_STRIDE; c++) {
            const actual = pose.world[id * WORLD_STRIDE + c]!
            const expected = world[c]!
            expect(Number.isFinite(expected)).toBe(true)
            expect(Number.isFinite(actual)).toBe(true)
            const delta = Math.abs(actual - expected)
            maxWorld = Math.max(maxWorld, delta)
            const tolerance = c >= 4 ? 1e-4 : 1e-6
            if (!firstWorld && delta > tolerance) {
              firstWorld = `${bone.data.name}.${matrix[c]} expected=${expected.toFixed(8)} actual=${actual.toFixed(8)} delta=${(actual - expected).toFixed(8)}`
            }
          }
        }
        console.log(`${name} ${phase}: firstLocal=${firstLocal || 'none'} firstWorld=${firstWorld || 'none'} maxWorld=${maxWorld.toFixed(8)}`)
        if (firstWorld) failures.push(`${phase}: ${firstWorld}`)
      }
      try {
        compare('setup', official.setup)
        engine.play(official.animation)
        engine.update(0.25)
        compare('t=0.25', official.animated)
        expect(failures).toEqual([])
      } finally {
        engine.dispose()
      }
    })
  }
})
