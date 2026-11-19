import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import * as fillEntry from '@/fill'
import { fillProjected } from '@/fill/fill'
import { HUMANOID_FILL } from '@/part/humanoid'
import { createPose, setPoseRotation } from '@/skeleton/pose'
import { findBone } from '@/skeleton/skeleton'
import { projectParts } from '@/view/project'
import { skinPose } from '../view/present'

describe('fill', () => {
  it('投影后的平面点配上部件颜色，位置是副本，索引和颜色是原来的引用', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const fills = compiled.parts.parts.map((part) => part.fill)
    const projected = projectParts(skinPose(compiled, createPose(compiled.skeleton)), 0)
    const before = projected.map((part) => Array.from(part.positions))
    const filled = fillProjected(projected, fills)
    expect(fillEntry.fillProjected).toBe(fillProjected)
    expect(filled).toHaveLength(compiled.meshes.meshes.length)

    for (let i = 0; i < filled.length; i += 1) {
      const part = filled[i]!
      expect(part.partId).toBe(compiled.meshes.meshes[i]!.partId)
      expect(part.positions).not.toBe(projected[i]!.positions)
      expect(part.positions.length).toBe((compiled.meshes.meshes[i]!.positions.length / 3) * 2)
      expect(Array.from(part.positions)).toEqual(before[i])
      expect(Array.from(projected[i]!.positions)).toEqual(before[i])
      expect(part.indices).toBe(projected[i]!.indices)
      expect(part.fill).toBe(compiled.parts.parts[i]!.fill)
    }

    const leg = filled.find((part) => part.partId === 'legL')!
    expect(leg.fill.r).toBe(HUMANOID_FILL.legL.r)
    expect(leg.fill.g).toBe(HUMANOID_FILL.legL.g)
    expect(leg.fill.b).toBe(HUMANOID_FILL.legL.b)
    expect(
      Object.is(leg.fill.r, compiled.parts.parts.find((part) => part.id === 'legL')!.fill.r),
    ).toBe(true)
  })

  it('屈膝后左腿移动，换一档投影颜色引用不变', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const fills = compiled.parts.parts.map((part) => part.fill)
    const pose = createPose(compiled.skeleton)
    const rest = fillProjected(projectParts(skinPose(compiled, pose), 0), fills)
    const restLeg = rest.find((part) => part.partId === 'legL')!

    setPoseRotation(pose, findBone(compiled.skeleton, 'shinL'), -0.8)
    const skinned = skinPose(compiled, pose)
    const bent = fillProjected(projectParts(skinned, 0), fills)
    const bentLeg = bent.find((part) => part.partId === 'legL')!
    let moved = false
    for (let i = 0; i < restLeg.positions.length; i += 1) {
      if (Math.abs(restLeg.positions[i]! - bentLeg.positions[i]!) > 1e-3) moved = true
    }
    expect(moved).toBe(true)
    expect(bentLeg.fill).toBe(restLeg.fill)

    const turned = fillProjected(projectParts(skinned, 90), fills)
    const turnedLeg = turned.find((part) => part.partId === 'legL')!
    expect(turnedLeg.fill).toBe(restLeg.fill)
    expect(Array.from(turnedLeg.positions)).not.toEqual(Array.from(bentLeg.positions))
  })

  it('件数不一致时抛出 part', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const fills = compiled.parts.parts.map((part) => part.fill)
    const projected = projectParts(skinPose(compiled, createPose(compiled.skeleton)), 0)
    expect(() => fillProjected(projected, fills.slice(1))).toThrow(/^part$/)
    expect(() => fillProjected(projected.slice(1), fills)).toThrow(/^part$/)
  })
})
