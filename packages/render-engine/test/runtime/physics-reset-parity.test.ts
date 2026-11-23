import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importSpineAtlas } from '@/asset/atlas'
import { importSpine } from '@/asset/importer'
import { CH_X, WORLD_STRIDE } from '@/core/math'
import { setLocal } from '@/core/pose'
import { Engine } from '@/runtime/runtime'

const root = resolve(process.cwd(), '../..')
const fixture = resolve(root, 'test/fixtures/synthetic/corpus-a41')
const frames = [
  { dt: 0, x: 0 }, { dt: 0.15, x: 12 }, { dt: 0.15, x: 25 },
  { dt: 0.15, x: 39 }, { dt: 0.15, x: 53 }, { dt: 0.15, x: 66 },
]
const oracle = `
const { createRequire } = require('node:module')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const core = createRequire(resolve(process.argv[1], 'package.json'))('@esotericsoftware/spine-core')
const dir = process.argv[2]
const json = JSON.parse(readFileSync(resolve(dir, 'corpus-a41-pro.json'), 'utf8'))
delete json.animations.exercise.bones
const atlas = new core.TextureAtlas(readFileSync(resolve(dir, 'corpus-a41.atlas'), 'utf8'))
const data = new core.SkeletonJson(new core.AtlasAttachmentLoader(atlas)).readSkeletonData(json)
const skeleton = new core.Skeleton(data)
const state = new core.AnimationState(new core.AnimationStateData(data))
state.setAnimation(0, 'exercise', false)
const result = []
for (const frame of JSON.parse(process.argv[3])) {
  skeleton.setupPoseBones()
  state.update(frame.dt)
  state.apply(skeleton)
  skeleton.findBone('root').pose.x = frame.x
  skeleton.update(frame.dt)
  skeleton.updateWorldTransform(core.Physics.update)
  const arm = skeleton.findBone('arm').appliedPose
  result.push([arm.a, arm.c, arm.b, arm.d, arm.worldX, arm.worldY])
}
process.stdout.write(JSON.stringify(result))
`

describe('A41 runtime physics reset parity', () => {
  it('matches every spring world component before and after the animation reset', () => {
    const expected = JSON.parse(execFileSync(process.execPath,
      ['-e', oracle, root, fixture, JSON.stringify(frames)], { cwd: root, encoding: 'utf8' })) as number[][]
    const json = JSON.parse(readFileSync(resolve(fixture, 'corpus-a41-pro.json'), 'utf8'))
    delete json.animations.exercise.bones
    const atlas = importSpineAtlas(readFileSync(resolve(fixture, 'corpus-a41.atlas'), 'utf8'))
    const asset = importSpine(json, { unitScale: 1, atlas })
    const engine = new Engine({ backend: 'cpu' })
    engine.load(asset)
    engine.play('exercise')
    const arm = asset.skeleton.boneIdByName.get('arm')!
    const rootBone = asset.skeleton.boneIdByName.get('root')!
    const errors: string[] = []
    frames.forEach((frame, index) => {
      engine.skeleton.setupPoseBones()
      setLocal(engine.pose, rootBone, CH_X, frame.x)
      engine.update(frame.dt)
      for (let component = 0; component < WORLD_STRIDE; component++) {
        const actual = engine.pose.world[arm * WORLD_STRIDE + component]!
        const reference = expected[index]![component]!
        if (Math.abs(actual - reference) > 1e-3) errors.push(`${index}/${component}: ${actual} vs ${reference}`)
      }
    })
    engine.dispose()
    expect(errors).toEqual([])
  })
})
