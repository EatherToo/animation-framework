import { describe, expect, it } from '@jest/globals'
import * as body from '@/body'
import {
  BONE_NAMES,
  FINGER_BONE_NAMES,
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
  bindLateral,
  bindLength,
  bindRotation,
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
  clavicleL: 'chest',
  clavicleR: 'chest',
  neck: 'chest',
  head: 'neck',
  upperArmL: 'clavicleL',
  lowerArmL: 'upperArmL',
  handL: 'lowerArmL',
  upperArmR: 'clavicleR',
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

  it('19 核心骨 + 28 指骨的名字、下标与查找一致', () => {
    const human = createHumanoid(H)
    expect(human.skeleton.boneCount).toBe(47)
    expect(BONE_NAMES).toHaveLength(19)
    expect(FINGER_BONE_NAMES).toHaveLength(28)

    for (let i = 0; i < BONE_NAMES.length; i += 1) {
      const name = BONE_NAMES[i]!
      expect(human.boneIndex[name]).toBe(i)
      expect(findBone(human.skeleton, name)).toBe(i)
    }
    for (const name of FINGER_BONE_NAMES) {
      const bone = human.fingerIndex[name]
      expect(bone).toBeGreaterThanOrEqual(19)
      expect(findBone(human.skeleton, name)).toBe(bone)
      const match = /^(thumb|index|middle|ring|pinky)([123])([LR])$/.exec(name)!
      const parentName = match[2] === '1'
        ? `hand${match[3]}`
        : `${match[1]}${Number(match[2]) - 1}${match[3]}`
      expect(parentOf(human.skeleton, bone)).toBe(findBone(human.skeleton, parentName))
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

  it('髋与肩的左右分开写在横向，矢状面 x 相同', () => {
    const human = createHumanoid(H)
    const p = human.proportions
    const { skeleton, boneIndex } = human
    const out = createVec2()

    for (const name of ['thighL', 'thighR'] as const) {
      bindTranslation(out, skeleton, boneIndex[name])
      expect(out[0]).toBe(0)
      expectClose(out[1]!, -p.hipDropY)
    }
    expectClose(bindLateral(skeleton, boneIndex.thighL), p.hipOffsetZ)
    expectClose(bindLateral(skeleton, boneIndex.thighR), -p.hipOffsetZ)

    // 锁骨是零长枢轴：接在胸段肩高处，横向只挪到胸骨端；上臂再从锁骨接出去。
    for (const side of ['L', 'R'] as const) {
      bindTranslation(out, skeleton, boneIndex[`clavicle${side}`])
      expectClose(out[0]!, p.chestLength - p.shoulderDropY)
      expect(out[1]).toBe(0)
      expectClose(
        Math.abs(bindLateral(skeleton, boneIndex[`clavicle${side}`])),
        0.02 * p.height,
      )
      bindTranslation(out, skeleton, boneIndex[`upperArm${side}`])
      expect(out[0]).toBe(0)
      expect(out[1]).toBe(0)
      expectClose(
        Math.abs(bindLateral(skeleton, boneIndex[`upperArm${side}`])),
        p.shoulderOffsetZ - 0.02 * p.height,
      )
    }

    // 有横向分离的只有髋、锁骨与上臂；其余骨头的横向偏移都是 0。
    const spaced = new Set([
      'thighL', 'thighR', 'clavicleL', 'clavicleR', 'upperArmL', 'upperArmR',
    ])
    for (const name of BONE_NAMES) {
      if (spaced.has(name)) continue
      expect(bindLateral(skeleton, boneIndex[name])).toBe(0)
    }
  })

  it('上臂局部 +X 在角色空间指向 -Y', () => {
    const human = createHumanoid(H)
    const { skeleton, boneIndex } = human
    for (const name of ['upperArmL', 'upperArmR'] as const) {
      let angle = 0
      for (let bone = boneIndex[name]; bone !== PARENT_NONE; bone = parentOf(skeleton, bone)) {
        angle += bindRotation(skeleton, bone)
      }
      expectClose(Math.cos(angle), 0, 1e-6)
      expectClose(Math.sin(angle), -1, 1e-6)
    }
    for (const name of ['lowerArmL', 'handL', 'lowerArmR', 'handR'] as const) {
      expect(bindRotation(skeleton, boneIndex[name])).toBe(0)
    }
  })

  it('createHumanoid 与 FromProportions 绑定按位相同', () => {
    const a = createHumanoid(H)
    const b = createHumanoidFromProportions(createProportions(H))
    expectSameBits(a.skeleton.bindTranslation, b.skeleton.bindTranslation)
    expectSameBits(a.skeleton.bindLateral, b.skeleton.bindLateral)
    expectSameBits(a.skeleton.bindRotation, b.skeleton.bindRotation)
    expectSameBits(a.skeleton.bindLength, b.skeleton.bindLength)
    expectSameBits(a.skeleton.parent, b.skeleton.parent)
  })

  it('同一 H 两次装配绑定按位相同、对象不同', () => {
    const a = createHumanoid(H)
    const b = createHumanoid(H)
    expect(a.skeleton).not.toBe(b.skeleton)
    expectSameBits(a.skeleton.bindTranslation, b.skeleton.bindTranslation)
    expectSameBits(a.skeleton.bindLateral, b.skeleton.bindLateral)
    expectSameBits(a.skeleton.bindRotation, b.skeleton.bindRotation)
    expectSameBits(a.skeleton.bindLength, b.skeleton.bindLength)
    expectSameBits(a.skeleton.parent, b.skeleton.parent)
  })

  it('非法身高抛出', () => {
    expect(() => createHumanoid(0)).toThrow()
  })
})
