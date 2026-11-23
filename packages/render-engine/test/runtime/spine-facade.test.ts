import { describe, expect, it } from '@jest/globals'
import { compileSkeleton } from '@/core/skeleton'
import type { SkeletonAsset } from '@/asset/importer'
import { Engine, Skeleton, SpineBone, Slot, Skin } from '@/runtime/runtime'

const white = { r: 1, g: 1, b: 1, a: 1 }
const asset: SkeletonAsset = {
  schema: 1, source: 'native', sourceVersion: '1', unitScale: 1,
  skeleton: compileSkeleton({ name: 'facade', profile: 'simple2d', bones: [
    { name: 'root', parent: -1, setup: { x: 3, y: -4, rotation: 0.3, scaleX: -1.4, scaleY: 2 } },
    { name: 'arm', parent: 0, setup: { x: 2, y: 1, rotation: -0.7, scaleX: 0.8, scaleY: 1.1, shearX: 0.2 } },
  ] }),
  slots: [{ id: 'hand', bone: 1, order: 0, color: white, blend: 'normal', attachment: 'region', mask: null, zOffset: 0 }],
  skins: new Map([['default', { id: 'default', attachments: new Map([[
    'region', { kind: 'region' as const, id: 'region', color: white,
      region: { atlasKey: 'region', uvs: null, width: 2, height: 2 },
    },
  ]]) }]]),
  animations: new Map(), events: [], hash: 'facade', report: { issues: [], warnings: 0, errors: 0 },
}

function engine(): Engine {
  const result = new Engine({ backend: 'cpu' })
  result.load(asset)
  return result
}

describe('Spine facade public surface', () => {
  it('exposes discoverable instance views without mutable pose arrays', () => {
    const runtime = engine()
    const skeleton = runtime.skeleton
    expect(skeleton).toBeInstanceOf(Skeleton)
    expect(skeleton.findBone('arm')).toBeInstanceOf(SpineBone)
    expect(skeleton.findBone('missing')).toBeNull()
    expect(skeleton.findSlot('hand')).toBeInstanceOf(Slot)
    expect(skeleton.findSkin('default')).toBeInstanceOf(Skin)
    expect(skeleton.bones[1]!.parent).toBe(skeleton.bones[0])
    expect(skeleton.slots[0]!.bone).toBe(skeleton.bones[1])
    expect(skeleton.drawOrder).toEqual(skeleton.slots)
    expect(skeleton.skin).toBe(skeleton.skins[0])
    expect(skeleton.skins[0]!.attachmentNames).toEqual(['region'])
    expect('pose' in skeleton).toBe(false)
    expect('currentPose' in skeleton).toBe(false)
    expect('local' in skeleton.bones[1]!).toBe(false)
    const world = skeleton.bones[1]!.worldTransform
    expect(Object.isFrozen(world)).toBe(true)
    expect(Object.isFrozen(skeleton.bones)).toBe(true)
    expect(Object.isFrozen(skeleton.slots[0]!.color)).toBe(true)
    expect(Object.isFrozen(skeleton.slots[0]!.data.color)).toBe(true)
    expect(Object.isFrozen(skeleton.bones[1]!.data.setup)).toBe(true)
    expect(Object.isFrozen(skeleton.color)).toBe(true)
    expect(world).toEqual(skeleton.bones[1]!.worldTransform)
    runtime.dispose()
  })

  it('round trips affine points and angles under reflection and shear', () => {
    const runtime = engine()
    const arm = runtime.skeleton.findBone('arm')!
    for (const point of [{ x: 0, y: 0 }, { x: -7.25, y: 11.3 }, { x: 1.6, y: -0.5 }]) {
      const back = arm.worldToLocal(arm.localToWorld(point))
      expect(back.x).toBeCloseTo(point.x, 6)
      expect(back.y).toBeCloseTo(point.y, 6)
    }
    for (const angle of [-2.5, -0.1, 0.8, 2.9]) {
      const back = arm.worldToLocalRotation(arm.localToWorldRotation(angle))
      expect(Math.atan2(Math.sin(back - angle), Math.cos(back - angle))).toBeCloseTo(0, 6)
    }
    const initial = arm.worldX
    arm.x += 3
    expect(arm.worldX).not.toBe(initial)
    expect(runtime.pose.worldValid).toBe(true)
    runtime.dispose()
  })

  it('rejects inverse transforms for singular bone matrices', () => {
    const runtime = engine()
    const arm = runtime.skeleton.findBone('arm')!
    arm.scaleX = 0
    expect(() => arm.worldToLocal({ x: 1, y: 2 })).toThrow('singular')
    expect(() => arm.worldToLocalRotation(1)).toThrow('singular')
    runtime.dispose()
  })

  it('provides setup aliases, slot commands, color copies and lifecycle guards', () => {
    const runtime = engine()
    const skeleton = runtime.skeleton
    skeleton.time = 1
    runtime.update(0.25)
    expect(skeleton.time).toBeCloseTo(1.25)
    skeleton.color = { r: 0.4, g: 0.5, b: 0.6, a: 0.7 }
    expect(runtime.color.r).toBe(0.4)
    const color = skeleton.color as { r: number }
    expect(() => { color.r = 0 }).toThrow()
    skeleton.slots[0]!.setAttachment(null)
    expect(skeleton.slots[0]!.attachmentName).toBeNull()
    skeleton.bones[1]!.x = 20
    skeleton.setToSetupPose()
    expect(skeleton.bones[1]!.x).toBe(2)
    expect(skeleton.slots[0]!.attachmentName).toBe('region')
    skeleton.bones[1]!.x = 5
    skeleton.setBonesToSetupPose()
    expect(skeleton.bones[1]!.x).toBe(2)
    runtime.load(asset)
    expect(() => skeleton.findBone('arm')).toThrow('E_STATE')
    runtime.dispose()
    expect(() => runtime.skeleton).toThrow('E_DISPOSED')
  })
})
