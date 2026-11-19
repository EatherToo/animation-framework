import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { evaluateFk } from '@/fk/evaluate'
import { createVec2 } from '@/math/vec2'
import { createPlacement } from '@/place/place'
import { beginRecovery, clearRecovery, createRecovery, recoveryTarget } from '@/recover/recover'
import { reachFootfall } from '@/reach/reach'
import { createPose } from '@/skeleton/pose'
import { createWorldPoint, setWorldPoint, worldToRigPoint } from '@/space/world-point'

function contactAt(compiled: ReturnType<typeof compileHumanoid>, bone: number) {
  const pose = createPose(compiled.skeleton)
  const fk = new Float32Array(compiled.bindRig.length)
  evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
  return { x: fk[bone * 9 + 6]!, y: fk[bone * 9 + 7]! - compiled.foot.ankleHeight }
}

describe('recover', () => {
  it('沿接近方向找到够得着的落点，不改放置和姿态', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const pose = createPose(compiled.skeleton)
    const before = Array.from(pose.data)
    const placement = createPlacement()
    const stance = contactAt(compiled, humanoid.chains.legR.end)
    const recovery = createRecovery()
    beginRecovery(
      recovery,
      compiled,
      pose,
      placement,
      1,
      humanoid.chains.legR,
      'right',
      stance.x,
      stance.y,
      stance.x + 3,
      stance.y,
      stance.x,
      stance.y,
    )
    expect(recovery.active).toBe(true)
    expect(Math.abs(recovery.contactX - stance.x)).toBeLessThan(Math.abs(stance.x + 3 - stance.x))
    expect(placement.origin[0]).toBe(0)
    expect(placement.origin[1]).toBe(0)
    expect(Array.from(pose.data)).toEqual(before)
    const rig = worldToRigPoint(
      createVec2(),
      setWorldPoint(createWorldPoint(), recovery.contactX, recovery.contactY),
      placement.origin,
      1,
    )
    const reached = reachFootfall(
      compiled,
      pose,
      humanoid.chains.legR,
      rig[0]!,
      rig[1]!,
      0,
      -compiled.foot.ankleHeight,
      0,
    )
    expect(reached.reached).toBe(true)
    const end = recoveryTarget(recovery, compiled, placement, 1, recovery.duration)
    expect(Number.isFinite(end.ankleX)).toBe(true)
    expect(Number.isFinite(end.pitch)).toBe(true)
    clearRecovery(recovery)
    expect(recovery.active).toBe(false)
    expect(() => recoveryTarget(recovery, compiled, placement, 1, 0)).toThrow(/^active$/)
  })
})
