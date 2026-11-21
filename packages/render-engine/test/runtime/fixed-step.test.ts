import { describe, expect, it } from '@jest/globals'
import { Engine } from '@/runtime/runtime'
import { compileSkeleton } from '@/core/skeleton'
import { getRotation } from '@/core/pose'
import type { SkeletonAsset } from '@/asset/importer'
import type { AnimationClip } from '@/animation/animation'

const skeleton = compileSkeleton({
  name: 'fixed', profile: 'simple2d',
  bones: [{ name: 'root', parent: -1, length: 1 }],
})
const clip: AnimationClip = {
  name: 'spin', duration: 1,
  timelines: [{ kind: 'rotate', path: 'root', keys: [{ time: 0, value: 0 }, { time: 1, value: 1 }] }],
}
const asset: SkeletonAsset = {
  schema: 1, source: 'native', sourceVersion: '1', unitScale: 1,
  skeleton, slots: [], skins: new Map([['default', { id: 'default', attachments: new Map() }]]),
  animations: new Map([['spin', clip]]), events: [], hash: 'fixed', report: { issues: [], warnings: 0, errors: 0 },
}

function rotationAfter(steps: readonly number[], fixedDt?: number): number {
  const engine = new Engine({ backend: 'cpu', ...(fixedDt === undefined ? {} : { fixedDt }) })
  engine.load(asset)
  engine.play('spin')
  for (const dt of steps) engine.update(dt)
  return getRotation(engine.pose, 0)
}

describe('fixed timestep', () => {
  it('accumulates sub-frame dt instead of dropping it', () => {
    expect(rotationAfter([1 / 240, 1 / 240, 1 / 240, 1 / 240], 1 / 60)).toBeCloseTo(1 / 60, 6)
    expect(rotationAfter([1 / 240], 1 / 60)).toBe(0)
  })

  it('matches variable dt for the same total time', () => {
    const fixed = rotationAfter([1 / 60, 1 / 60, 1 / 60], 1 / 120)
    const variable = rotationAfter([1 / 120, 1 / 120, 1 / 120, 1 / 120, 1 / 120, 1 / 120])
    expect(Math.abs(fixed - variable)).toBeLessThan(1e-5)
  })
})
