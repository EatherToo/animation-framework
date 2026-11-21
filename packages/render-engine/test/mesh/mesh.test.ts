import { describe, expect, it } from '@jest/globals'
import { compileSkeleton, type BoneSpec } from '@/core/skeleton'
import { addRotation, createPose, updateWorld, type Pose } from '@/core/pose'
import {
  buildInverseBind,
  deformPositions,
  skinMesh2D,
  validateTopology,
  type MeshData,
  type WeightedMeshData,
} from '@/mesh/mesh'

function rig(): { pose: Pose; inverseBind: Float32Array } {
  const bones: BoneSpec[] = [
    { name: 'root', parent: -1, length: 0 },
    { name: 'arm', parent: 0, length: 1, rest: { x: 1, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 } },
  ]
  const pose = createPose(compileSkeleton({ name: 'mesh', profile: 'full2d', bones }))
  updateWorld(pose)
  return { pose, inverseBind: buildInverseBind(pose) }
}

const quad: MeshData = {
  id: 'q', bone: 1, vertexSpace: 'bindWorld',
  positions: Float32Array.from([1, 0, 2, 0, 2, 1, 1, 1]),
  uvs: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
  indices: Uint16Array.from([0, 1, 2, 0, 2, 3]),
}

describe('core2d mesh / skinning', () => {
  it('keeps bindWorld vertices stationary at setup', () => {
    const { pose, inverseBind } = rig()
    const out = skinMesh2D(quad, pose, inverseBind)
    expect(Array.from(out)).toEqual(Array.from(quad.positions))
  })

  it('moves a single-bone mesh rigidly with its bone', () => {
    const { pose, inverseBind } = rig()
    addRotation(pose, 1, Math.PI / 2)
    updateWorld(pose)
    const out = skinMesh2D(quad, pose, inverseBind)
    expect(out[0]).toBeCloseTo(1, 5)
    expect(out[1]).toBeCloseTo(0, 5)
    expect(out[2]).toBeCloseTo(1, 5)
    expect(out[3]).toBeCloseTo(1, 5)
  })

  it('linearly blends weighted vertices across two bones', () => {
    const { pose, inverseBind } = rig()
    const weighted: WeightedMeshData = {
      ...quad,
      bone: 0,
      boneIndices: Uint16Array.from([0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0]),
      weights: Float32Array.from([0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0]),
    }
    const before = skinMesh2D(weighted, pose, inverseBind)
    addRotation(pose, 1, Math.PI / 2)
    updateWorld(pose)
    const after = skinMesh2D(weighted, pose, inverseBind)
    // 第 2 个顶点 (2,0): 0.5·(2,0) + 0.5·绕 (1,0) 旋转后的 (1,1) = (1.5,0.5)
    expect(after[2]).toBeCloseTo(1.5, 4)
    expect(after[3]).toBeCloseTo(0.5, 4)
    expect(Math.hypot(after[2]! - before[2]!, after[3]! - before[3]!)).toBeGreaterThan(0.4)
  })

  it('applies FFD offsets as absolute store-space deltas', () => {
    const base = Float32Array.from([1, 2, 3, 4])
    const out = deformPositions(base, {
      version: 3,
      offsets: Float32Array.from([0.1, -0.2, 0, 0]),
    });
    [1.1, 1.8, 3, 4].forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6))
    expect(deformPositions(base, null)).toBe(base)
    expect(() => deformPositions(base, { version: 1, offsets: new Float32Array(3) })).toThrow()
  })

  it('supports boneLocal mesh vertices', () => {
    const { pose, inverseBind } = rig()
    const local: MeshData = { ...quad, bone: 1, vertexSpace: 'boneLocal', positions: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]) }
    const out = skinMesh2D(local, pose, inverseBind)
    expect(Array.from(out)).toEqual([1, 0, 2, 0, 2, 1, 1, 1])
  })

  it('classifies topology errors and warnings', () => {
    const bad: WeightedMeshData = {
      ...quad,
      boneIndices: Uint16Array.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      weights: Float32Array.from([0.5, 0.2, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
      indices: Uint16Array.from([0, 4, 2]),
    }
    const report = validateTopology(bad)
    expect(report.errors.some((e) => /index/i.test(e))).toBe(true)
    expect(report.errors.some((e) => /weight/i.test(e))).toBe(true)
    const degenerate: MeshData = { ...quad, indices: Uint16Array.from([0, 1, 1]) }
    expect(validateTopology(degenerate).errors.some((e) => /degenerate/i.test(e))).toBe(true)
    expect(validateTopology(quad).errors).toHaveLength(0)
    expect(validateTopology({ ...quad, indices: Uint16Array.from([2, 1, 0, 3, 2, 0]) }).warnings.some((w) => /winding/i.test(w))).toBe(true)
  })
})
