import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { evaluateFk } from '@/fk/evaluate'
import {
  buildHumanoid2DScene,
  buildSkinnedHandAttachment,
  buildRenderPackets,
  sampleHumanoid2DPackets,
} from '@/pipeline2d'
import { createPose, setPoseRotation, setPoseSwing } from '@/skeleton/pose'

function setup(): {
  compiled: ReturnType<typeof compileHumanoid>
  pose: ReturnType<typeof createPose>
  fk: Float32Array
} {
  const humanoid = createHumanoid(1.8)
  const compiled = compileHumanoid(humanoid)
  const pose = createPose(compiled.skeleton)
  const fk = new Float32Array(compiled.skeleton.boneCount * 12)
  evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
  return { compiled, pose, fk }
}

describe('pipeline2d humanoid', () => {
  it('R2：十二件 2D 附件（含肩桥）与渲染包', () => {
    const { compiled, fk } = setup()
    const scene = buildHumanoid2DScene(compiled, fk)
    expect(scene.slots).toHaveLength(14)
    expect(scene.skins[0]!.attachments).toHaveLength(14)
    const packets = buildRenderPackets(scene)
    expect(packets).toHaveLength(14)
    expect(packets.map((packet) => packet.partId)).toEqual([
      'legL', 'legR', 'footL', 'footR',
      'gapL', 'gapR', 'torso', 'armL', 'armR', 'shoulderL', 'shoulderR', 'handR', 'handL', 'head',
    ])
    for (const packet of packets) {
      expect(packet.version).toBe(2)
      expect(packet.vertices.length).toBeGreaterThanOrEqual(6)
      expect(packet.vertices.length % 2).toBe(0)
      expect(packet.depth.length).toBe(packet.vertices.length / 2)
      expect(packet.indices.length % 3).toBe(0)
      for (const value of packet.vertices) expect(Number.isFinite(value)).toBe(true)
      for (const value of packet.depth) expect(Number.isFinite(value)).toBe(true)
      expect(packet.bounds.width).toBeGreaterThan(0)
      expect(packet.bounds.height).toBeGreaterThan(0)
    }
  })

  it('R2：躯干/头/手/脚都有合理包围盒，手有掌+五指', () => {
    const { compiled, fk } = setup()
    const scene = buildHumanoid2DScene(compiled, fk)
    const byId = new Map(scene.skins[0]!.attachments.map((item) => [item.id, item]))
    const torso = byId.get('torso')!
    expect(torso.mesh.bounds!.height).toBeGreaterThan(0.4)
    expect(torso.mesh.bounds!.width).toBeGreaterThan(0.2)
    const head = byId.get('head')!
    expect(head.mesh.bounds!.height).toBeGreaterThan(0.15)
    expect(head.mesh.bounds!.width).toBeGreaterThan(0.1)
    const foot = byId.get('footL')!
    expect(foot.mesh.bounds!.width).toBeGreaterThan(0.05)
    const hand = byId.get('handL')!
    expect(hand.mesh.indices.length / 3).toBe(46)
    expect(hand.mesh.bounds!.height).toBeGreaterThan(0.1)
  })

  it('P3：手指传统权重蒙皮，权重和为 1', () => {
    const { compiled, pose, fk } = setup()
    const fillColor = { r: 0.9, g: 0.78, b: 0.64, a: 1 }
    const bind = buildSkinnedHandAttachment(compiled, fk, 'L', fillColor)
    expect(bind.mesh.weights.length).toBe((bind.mesh.positions.length / 2) * 4)
    expect(bind.mesh.boneIndices.length).toBe(bind.mesh.weights.length)
    for (let v = 0; v < bind.mesh.positions.length / 2; v += 1) {
      const sum = bind.mesh.weights[v * 4]! + bind.mesh.weights[v * 4 + 1]! + bind.mesh.weights[v * 4 + 2]! + bind.mesh.weights[v * 4 + 3]!
      expect(sum).toBeCloseTo(1, 5)
    }
    setPoseRotation(pose, compiled.skeleton.name.indexOf('index1L'), 1.2)
    evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
    const posed = buildSkinnedHandAttachment(compiled, fk, 'L', fillColor)
    expect(Array.from(posed.mesh.positions)).not.toEqual(Array.from(bind.mesh.positions))
    for (const value of posed.mesh.positions) expect(Number.isFinite(value)).toBe(true)
  })

  it('P5：手臂/腿按深度动态前后排序', () => {
    const { compiled, pose, fk } = setup()
    for (const swing of [-Math.PI / 2, Math.PI / 2]) {
      setPoseSwing(pose, compiled.skeleton.name.indexOf('upperArmL'), swing)
      evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
      const scene = buildHumanoid2DScene(compiled, fk)
      const byId = new Map(scene.slots.map((slot) => [slot.id, slot]))
      const arm = byId.get('armL')!
      const hand = byId.get('handL')!
      expect([1.5, 3]).toContain(arm.order)
      expect(hand.order).toBe(arm.order === 3 ? 4 : 1.6)
      const packets = buildRenderPackets(scene)
      expect(packets).toHaveLength(14)
      if (arm.order === 1.5) {
        const ids = packets.map((packet) => packet.partId)
        expect(ids.indexOf('armL')).toBeLessThan(ids.indexOf('torso'))
      }
    }
  })

  it('P5：交叉腿前后分层，包无 NaN', () => {
    const { compiled, pose, fk } = setup()
    setPoseRotation(pose, compiled.skeleton.name.indexOf('thighL'), 0.8)
    setPoseRotation(pose, compiled.skeleton.name.indexOf('thighR'), -0.2)
    evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
    const scene = buildHumanoid2DScene(compiled, fk)
    const byId = new Map(scene.slots.map((slot) => [slot.id, slot]))
    const orders = [byId.get('legL')!.order, byId.get('legR')!.order].sort((a, b) => a - b)
    expect(orders).toEqual([0, 0.2])
    const packets = buildRenderPackets(scene)
    for (const packet of packets) {
      for (const value of packet.vertices) expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('P5：肘/腕弯曲无 NaN，包结构保持', () => {
    const { compiled, pose, fk } = setup()
    setPoseRotation(pose, compiled.skeleton.name.indexOf('lowerArmL'), 2.0)
    setPoseRotation(pose, compiled.skeleton.name.indexOf('handL'), 0.8)
    evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
    const packets = buildRenderPackets(buildHumanoid2DScene(compiled, fk))
    expect(packets).toHaveLength(14)
    for (const packet of packets) {
      for (const value of packet.vertices) expect(Number.isFinite(value)).toBe(true)
      for (const value of packet.depth) expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('R2：摆臂 90° 后 2D 包变化且没有 NaN', () => {
    const { compiled, pose, fk } = setup()
    const before = buildRenderPackets(buildHumanoid2DScene(compiled, fk))
    setPoseSwing(pose, compiled.skeleton.name.indexOf('upperArmL'), Math.PI / 2)
    evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
    const after = buildRenderPackets(buildHumanoid2DScene(compiled, fk))
    const armBefore = before.find((packet) => packet.partId === 'armL')!
    const armAfter = after.find((packet) => packet.partId === 'armL')!
    expect(armAfter.bounds.height).not.toBe(armBefore.bounds.height)
    for (const packet of after) {
      for (const value of packet.vertices) expect(Number.isFinite(value)).toBe(true)
    }
    const sampled = sampleHumanoid2DPackets(compiled, pose)
    expect(sampled).toHaveLength(14)
  })
})
