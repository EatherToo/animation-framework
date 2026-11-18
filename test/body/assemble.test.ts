import { describe, expect, it } from '@jest/globals'
import * as body from '@/body'
import {
  BONE_NAMES,
  createHumanoid,
  createHumanoidFromProportions,
  type BoneId,
} from '@/body/assemble'
import {
  ARM_BEND_SIGN,
  ARM_ROM_MAX,
  ARM_ROM_MIN,
  LEG_BEND_SIGN,
  LEG_ROM_MAX,
  LEG_ROM_MIN,
} from '@/body/chains'
import { createProportions } from '@/body/proportions'
import {
  PARENT_NONE,
  bindLength,
  bindTranslation,
  findBone,
  parentOf,
} from '@/skeleton/skeleton'
import { createVec2 } from '@/math/vec2'
import { expectClose, expectSameBits } from '../math/assert'

const H = 1.7

const EXPECTED_PARENT: Record<BoneId, BoneId | null> = {
  pelvis: null,
  spine: 'pelvis',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  upperArmL: 'chest',
  lowerArmL: 'upperArmL',
  handL: 'lowerArmL',
  upperArmR: 'chest',
  lowerArmR: 'upperArmR',
  handR: 'lowerArmR',
  thighL: 'pelvis',
  shinL: 'thighL',
  footL: 'shinL',
  thighR: 'pelvis',
  shinR: 'thighR',
  footR: 'shinR',
}

describe('assemble', () => {
  it('从 body 入口再导出', () => {
    expect(body.createHumanoid).toBe(createHumanoid)
    expect(body.createHumanoidFromProportions).toBe(createHumanoidFromProportions)
    expect(body.BONE_NAMES).toBe(BONE_NAMES)
  })

  it('17 骨名字、下标与查找一致', () => {
    const human = createHumanoid(H)
    expect(human.skeleton.boneCount).toBe(17)
    expect(BONE_NAMES).toHaveLength(17)

    for (let i = 0; i < BONE_NAMES.length; i += 1) {
      const name = BONE_NAMES[i]!
      expect(human.boneIndex[name]).toBe(i)
      expect(findBone(human.skeleton, name)).toBe(i)
    }
  })

  it('父下标符合层次表', () => {
    const human = createHumanoid(H)
    expect(parentOf(human.skeleton, human.boneIndex.pelvis)).toBe(PARENT_NONE)

    for (const [name, parentName] of Object.entries(EXPECTED_PARENT) as Array<
      [BoneId, BoneId | null]
    >) {
      const bone = human.boneIndex[name]
      if (parentName === null) {
        expect(parentOf(human.skeleton, bone)).toBe(PARENT_NONE)
      } else {
        expect(parentOf(human.skeleton, bone)).toBe(human.boneIndex[parentName])
      }
    }
  })

  it('链上后继绑定平移为 (父长度, 0)', () => {
    const human = createHumanoid(H)
    const p = human.proportions
    const out = createVec2()

    const pairs: Array<[BoneId, number]> = [
      ['shinL', p.thighLength],
      ['footL', p.shinLength],
      ['shinR', p.thighLength],
      ['footR', p.shinLength],
      ['lowerArmL', p.upperArmLength],
      ['handL', p.lowerArmLength],
      ['lowerArmR', p.upperArmLength],
      ['handR', p.lowerArmLength],
    ]

    for (const [name, parentLen] of pairs) {
      const bone = human.boneIndex[name]
      bindTranslation(out, human.skeleton, bone)
      expectClose(out[0]!, parentLen)
      expectClose(out[1]!, 0)
      expectClose(bindLength(human.skeleton, bone), name.startsWith('shin')
        ? p.shinLength
        : name.startsWith('foot')
          ? p.footLength
          : name.startsWith('lower')
            ? p.lowerArmLength
            : p.handLength)
    }
  })

  it('四条链下标与 ROM / 弯曲符号', () => {
    const human = createHumanoid(H)
    const { boneIndex, chains } = human

    expect(chains.legL.root).toBe(boneIndex.thighL)
    expect(chains.legL.mid).toBe(boneIndex.shinL)
    expect(chains.legL.end).toBe(boneIndex.footL)
    expect(chains.legR.root).toBe(boneIndex.thighR)
    expect(chains.legR.mid).toBe(boneIndex.shinR)
    expect(chains.legR.end).toBe(boneIndex.footR)
    expect(chains.armL.root).toBe(boneIndex.upperArmL)
    expect(chains.armL.mid).toBe(boneIndex.lowerArmL)
    expect(chains.armL.end).toBe(boneIndex.handL)
    expect(chains.armR.root).toBe(boneIndex.upperArmR)
    expect(chains.armR.mid).toBe(boneIndex.lowerArmR)
    expect(chains.armR.end).toBe(boneIndex.handR)

    for (const leg of [chains.legL, chains.legR]) {
      expect(leg.bendSign).toBe(LEG_BEND_SIGN)
      expect(leg.romMin).toBe(LEG_ROM_MIN)
      expect(leg.romMax).toBe(LEG_ROM_MAX)
    }
    for (const arm of [chains.armL, chains.armR]) {
      expect(arm.bendSign).toBe(ARM_BEND_SIGN)
      expect(arm.romMin).toBe(ARM_ROM_MIN)
      expect(arm.romMax).toBe(ARM_ROM_MAX)
    }
  })

  it('绑定脚底在 y=0', () => {
    const human = createHumanoid(H)
    const p = human.proportions
    const out = createVec2()
    bindTranslation(out, human.skeleton, human.boneIndex.thighL)
    const soleY =
      p.hipHeight + out[1]! - p.thighLength - p.shinLength - p.ankleHeight
    expect(Math.abs(soleY)).toBeLessThanOrEqual(1e-6)
  })

  it('createHumanoid 与 FromProportions 绑定按位相同', () => {
    const a = createHumanoid(H)
    const b = createHumanoidFromProportions(createProportions(H))
    expectSameBits(a.skeleton.bindTranslation, b.skeleton.bindTranslation)
    expectSameBits(a.skeleton.bindRotation, b.skeleton.bindRotation)
    expectSameBits(a.skeleton.bindLength, b.skeleton.bindLength)
    expectSameBits(a.skeleton.parent, b.skeleton.parent)
  })

  it('同一 H 两次装配绑定按位相同、对象不同', () => {
    const a = createHumanoid(H)
    const b = createHumanoid(H)
    expect(a.skeleton).not.toBe(b.skeleton)
    expectSameBits(a.skeleton.bindTranslation, b.skeleton.bindTranslation)
    expectSameBits(a.skeleton.bindRotation, b.skeleton.bindRotation)
    expectSameBits(a.skeleton.bindLength, b.skeleton.bindLength)
    expectSameBits(a.skeleton.parent, b.skeleton.parent)
  })

  it('非法身高抛出', () => {
    expect(() => createHumanoid(0)).toThrow()
  })
})
