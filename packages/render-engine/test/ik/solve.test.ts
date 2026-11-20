import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { evaluateFk } from '@/fk/evaluate'
import { solveTwoBone } from '@/ik/solve'
import { createPose, poseRotation, poseTranslation, setPoseRotation, setPoseTranslation } from '@/skeleton/pose'
import { createVec2 } from '@/math/vec2'
import { expectClose } from '../math/assert'

function origins(compiled: ReturnType<typeof compileHumanoid>, pose: ReturnType<typeof createPose>) {
  const fk = new Float32Array(compiled.bindRig.length)
  evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
  return (bone: number) => ({ x: fk[bone * 12 + 9]!, y: fk[bone * 12 + 10]! })
}

describe('two-bone ik', () => {
  it('直腿够到绑定踝，膝角接近伸直', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const pose = createPose(compiled.skeleton)
    const at = origins(compiled, pose)
    const chain = humanoid.chains.legL
    const ankle = at(chain.end)
    const solved = solveTwoBone(pose, compiled, chain, ankle.x, ankle.y)
    expect(solved.reached).toBe(true)
    expect(Math.abs(poseRotation(pose, chain.mid))).toBeLessThan(1e-3)
  })

  it('踝前移后膝在髋踝连线的逆时针侧', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const pose = createPose(compiled.skeleton)
    const chain = humanoid.chains.legL
    const ankle = origins(compiled, pose)(chain.end)
    const solved = solveTwoBone(pose, compiled, chain, ankle.x + 0.12, ankle.y + 0.04)
    expect(solved.reached).toBe(true)
    const at = origins(compiled, pose)
    const hip = at(chain.root)
    const knee = at(chain.mid)
    const foot = at(chain.end)
    const cross = (foot.x - hip.x) * (knee.y - hip.y) - (foot.y - hip.y) * (knee.x - hip.x)
    expect(cross).toBeGreaterThan(0)
    expectClose(foot.x, ankle.x + 0.12, 1e-4)
    expectClose(foot.y, ankle.y + 0.04, 1e-4)
  })

  it('臂的肘落在弯曲符号的一侧', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const pose = createPose(compiled.skeleton)
    const chain = humanoid.chains.armL
    const at0 = origins(compiled, pose)
    const shoulder = at0(chain.root)
    const wrist = at0(chain.end)
    const spanX = wrist.x - shoulder.x
    const spanY = wrist.y - shoulder.y
    const span = Math.hypot(spanX, spanY)
    const targetX = shoulder.x + (spanX / span) * (span - 0.0008)
    const targetY = shoulder.y + (spanY / span) * (span - 0.0008)
    const solved = solveTwoBone(pose, compiled, chain, targetX, targetY)
    expect(solved.reached).toBe(true)
    const at = origins(compiled, pose)
    const root = at(chain.root)
    const mid = at(chain.mid)
    const end = at(chain.end)
    const cross = (end.x - root.x) * (mid.y - root.y) - (end.y - root.y) * (mid.x - root.x)
    expect(cross * chain.bendSign).toBeGreaterThan(0)
  })

  it('远于两段总长时不够着，中骨仍在活动范围内', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const pose = createPose(compiled.skeleton)
    const chain = humanoid.chains.legL
    const hip = origins(compiled, pose)(chain.root)
    const reach = humanoid.proportions.legLength + 0.4
    const solved = solveTwoBone(pose, compiled, chain, hip.x + reach, hip.y)
    expect(solved.reached).toBe(false)
    const mid = poseRotation(pose, chain.mid)
    expect(mid).toBeGreaterThanOrEqual(chain.romMin)
    expect(mid).toBeLessThanOrEqual(chain.romMax)
  })

  it('不改链根平移和末端旋转', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const pose = createPose(compiled.skeleton)
    const chain = humanoid.chains.legL
    setPoseTranslation(pose, chain.root, 0.01, 0.02)
    setPoseRotation(pose, chain.end, 0.2)
    const before = poseTranslation(createVec2(), pose, chain.root)
    const keptX = before[0]
    const keptY = before[1]
    const keptFoot = poseRotation(pose, chain.end)
    const ankle = origins(compiled, createPose(compiled.skeleton))(chain.end)
    solveTwoBone(pose, compiled, chain, ankle.x, ankle.y)
    const translation = poseTranslation(createVec2(), pose, chain.root)
    expect(translation[0]).toBe(keptX)
    expect(translation[1]).toBe(keptY)
    expect(poseRotation(pose, chain.end)).toBe(keptFoot)
  })

  it('姿态不属于这棵骨架时不写', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const other = createPose(createHumanoid(1.8).skeleton)
    setPoseRotation(other, 0, 0.4)
    const kept = poseRotation(other, 0)
    const chain = createHumanoid(1.7).chains.legL
    expect(() => solveTwoBone(other, compiled, chain, 0, 0)).toThrow(/^pose$/)
    expect(poseRotation(other, 0)).toBe(kept)
  })
})
