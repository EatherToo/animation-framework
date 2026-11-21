import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { evaluateFk } from '@/fk/evaluate'
import { armOutlineTriangles } from '@/outline/arm'
import {
  armMeshVertexCount,
  buildArmAttachment,
  buildLegAttachment,
  buildRenderPackets,
  createRenderScene,
  frontDepth,
  frontPoint,
  legMeshVertexCount,
  type RenderAttachment,
  type RenderSlot,
} from '@/pipeline2d'
import { createPose, setPoseSwing } from '@/skeleton/pose'

const fill = { r: 0.3, g: 0.48, b: 0.72, a: 1 }

function setup(): {
  compiled: ReturnType<typeof compileHumanoid>
  fk: Float32Array
  pose: ReturnType<typeof createPose>
} {
  const humanoid = createHumanoid(1.8)
  const compiled = compileHumanoid(humanoid)
  const pose = createPose(compiled.skeleton)
  const fk = new Float32Array(compiled.skeleton.boneCount * 12)
  evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
  return { compiled, fk, pose }
}

function slot(id: string, order: number, attachment: string): RenderSlot {
  return {
    id,
    order,
    tint: { r: 1, g: 1, b: 1, a: 1 },
    blend: 'normal',
    mask: null,
    attachment,
  }
}

describe('pipeline2d limb', () => {
  it('R2：正面投影与深度', () => {
    expect(frontPoint({ x: 1, y: 2, z: 3 })).toEqual({ x: 3, y: 2 })
    expect(frontDepth({ x: 1, y: 2, z: 3 })).toBe(-1)
  })

  it('R2：2D 手臂附件张数、深度与 seam', () => {
    const { compiled, fk } = setup()
    const arm = buildArmAttachment(compiled, fk, 'L', fill)
    expect(arm.id).toBe('armL')
    expect(arm.material.kind).toBe('flat')
    expect(arm.mesh.positions.length).toBe(armMeshVertexCount() * 2)
    expect(arm.mesh.indices.length).toBe(armOutlineTriangles() * 3)
    expect(arm.mesh.depth.length).toBe(armMeshVertexCount())
    expect(arm.mesh.seam.reduce((sum, value) => sum + value, 0)).toBe(4)
    expect(arm.mesh.bounds!.width).toBeGreaterThan(0)
    expect(arm.mesh.bounds!.height).toBeGreaterThan(0)
    for (const value of arm.mesh.positions) expect(Number.isFinite(value)).toBe(true)
    // 左臂在正面的屏幕横轴（z）在身体左侧。
    let minX = Infinity
    for (let i = 0; i < arm.mesh.positions.length; i += 2) minX = Math.min(minX, arm.mesh.positions[i]!)
    expect(minX).toBeGreaterThan(0)
  })

  it('R2：2D 腿附件有独立拓扑与有限深度', () => {
    const { compiled, fk } = setup()
    const leg = buildLegAttachment(compiled, fk, 'L', fill)
    expect(leg.id).toBe('legL')
    expect(leg.mesh.positions.length).toBe(legMeshVertexCount() * 2)
    expect(leg.mesh.depth.length).toBe(legMeshVertexCount())
    expect(leg.mesh.seam.reduce((sum, value) => sum + value, 0)).toBe(4)
    for (const value of leg.mesh.positions) expect(Number.isFinite(value)).toBe(true)
    for (const value of leg.mesh.depth) expect(Number.isFinite(value)).toBe(true)
  })

  it('R2：摆臂后重建，场景/RenderPacket 能消费', () => {
    const { compiled, fk, pose } = setup()
    const bind = buildArmAttachment(compiled, fk, 'L', fill)
    setPoseSwing(pose, compiled.skeleton.name.indexOf('upperArmL'), Math.PI / 2)
    evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
    const raised = buildArmAttachment(compiled, fk, 'L', fill)
    expect(raised.mesh.bounds!.height).not.toBe(bind.mesh.bounds!.height)

    const attachments: RenderAttachment[] = [bind, buildLegAttachment(compiled, fk, 'L', fill)]
    const scene = createRenderScene(
      [slot('leg', 0, 'legL'), slot('arm', 3, 'armL')],
      [{ id: 'base', attachments }],
    )
    const packets = buildRenderPackets(scene)
    expect(packets.map((packet) => packet.partId)).toEqual(['legL', 'armL'])
    expect(packets[1]!.vertices.length).toBe(armMeshVertexCount() * 2)
  })
})
