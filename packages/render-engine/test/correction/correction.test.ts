import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { applyCorrection, createCorrection } from '@/correction/correction'
import { createPose, setPoseSwing, setPoseTwist } from '@/skeleton/pose'
import { findBone } from '@/skeleton/skeleton'

describe('correction', () => {
  it('关闭时按位复制', () => {
    const correction = createCorrection({ enabled: false })
    expect(correction.enabled).toBe(false)
    const positions = new Float32Array([1, 2, 3, 4])
    const out = new Float32Array(4)
    applyCorrection(out, positions, correction)
    for (let i = 0; i < positions.length; i += 1) {
      expect(Object.is(out[i], positions[i])).toBe(true)
    }
    positions[0] = 9
    expect(out[0]).toBe(1)
  })

  it('默认开启扭转与弯曲增益', () => {
    const correction = createCorrection()
    expect(correction.enabled).toBe(true)
    expect(correction.twistGain).toBeCloseTo(0.35)
    expect(correction.bendGain).toBeCloseTo(0.35)
  })

  it('长度不符时不写 out', () => {
    const out = new Float32Array([7, 8])
    expect(() =>
      applyCorrection(out, new Float32Array([1, 2, 3]), createCorrection({ enabled: false })),
    ).toThrow(/^out$/)
    expect(out[0]).toBe(7)
    expect(out[1]).toBe(8)
  })

  it('开启时零姿态不变；扭转与侧摆分别抬升过渡带半径', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const index = compiled.meshes.meshes.findIndex((mesh) => mesh.partId === 'armL')
    const mesh = compiled.meshes.meshes[index]!
    const part = compiled.parts.parts[index]!
    if (part.kind !== 'skinned') throw new Error('kind')
    const weights = compiled.weights.weights.find((item) => item.partId === 'armL')!
    const pose = createPose(compiled.skeleton)
    const bone = findBone(compiled.skeleton, 'upperArmL')
    const base = bone * 12
    const ox = compiled.bindRig[base + 9]!
    const oy = compiled.bindRig[base + 10]!
    const oz = compiled.bindRig[base + 11]!
    const ax = compiled.bindRig[base]!
    const ay = compiled.bindRig[base + 1]!
    const az = compiled.bindRig[base + 2]!

    const meanRadius = (positions: Float32Array): number => {
      let sum = 0
      let count = 0
      for (let v = 0; v < positions.length / 3; v += 1) {
        const w = weights.weights[v * weights.influences + 1]!
        if (w < 0.4 || w > 0.6) continue
        const x = positions[v * 3]! - ox
        const y = positions[v * 3 + 1]! - oy
        const z = positions[v * 3 + 2]! - oz
        const along = x * ax + y * ay + z * az
        sum += Math.hypot(x - ax * along, y - ay * along, z - az * along)
        count += 1
      }
      return sum / count
    }

    const context = {
      bones: part.bones,
      weights: weights.weights,
      influences: weights.influences,
      bindRig: compiled.bindRig,
      pose,
    }

    const bindRadius = meanRadius(mesh.positions)
    const zeroOut = new Float32Array(mesh.positions.length)
    applyCorrection(zeroOut, mesh.positions, compiled.correction, context)
    for (let i = 0; i < mesh.positions.length; i += 1) {
      expect(Math.abs(zeroOut[i]! - mesh.positions[i]!)).toBeLessThanOrEqual(1e-6)
    }

    setPoseTwist(pose, bone, (-70 * Math.PI) / 180)
    const twisted = new Float32Array(mesh.positions.length)
    applyCorrection(twisted, mesh.positions, compiled.correction, context)
    expect(meanRadius(twisted) / bindRadius).toBeGreaterThanOrEqual(0.85)

    pose.data.fill(0)
    setPoseSwing(pose, bone, Math.PI / 2)
    const bent = new Float32Array(mesh.positions.length)
    applyCorrection(bent, mesh.positions, compiled.correction, context)
    expect(meanRadius(bent) / bindRadius).toBeGreaterThanOrEqual(0.85)

    const bendOff = createCorrection({ enabled: true, twistGain: 0.35, bendGain: 0 })
    const noBend = new Float32Array(mesh.positions.length)
    applyCorrection(noBend, mesh.positions, bendOff, context)
    expect(meanRadius(bent) / bindRadius).toBeGreaterThan(meanRadius(noBend) / bindRadius)
  })
})
