import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import * as entry from '@/index'
import { createPose, setPoseRotation } from '@/skeleton/pose'
import { findBone } from '@/skeleton/skeleton'
import {
  DEPTH_EPSILON,
  VIEW_COUNT,
  VIEW_STEP_DEG,
  depthOrder,
  isViewIndex,
  projectParts,
  projectPositions,
  viewAngle,
  windIndices,
  type ProjectedPart,
} from '@/view/project'
import { expectClose } from '../math/assert'
import { presentPose, skinPose } from './present'

const INVALID = [-1, 360, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 720]

function project(point: [number, number, number], view: number): { x: number; y: number; depth: number } {
  const out = new Float32Array(2)
  const depth = projectPositions(out, new Float32Array(point), view)
  return { x: out[0]!, y: out[1]!, depth }
}

function part(partId: string, depth: number): ProjectedPart {
  return { partId, positions: new Float32Array(6), indices: new Uint16Array(3), depth }
}

function cross(positions: Float32Array, indices: Uint16Array, t: number): number {
  const a = indices[t]! * 2
  const b = indices[t + 1]! * 2
  const c = indices[t + 2]! * 2
  return (
    (positions[b]! - positions[a]!) * (positions[c + 1]! - positions[a + 1]!) -
    (positions[b + 1]! - positions[a + 1]!) * (positions[c]! - positions[a]!)
  )
}

describe('view', () => {
  it('从公共入口导出，一圈 360 档，每档 1°', () => {
    expect(entry.projectParts).toBe(projectParts)
    expect(entry.depthOrder).toBe(depthOrder)
    expect(entry.VIEW_COUNT).toBe(VIEW_COUNT)
    expect(VIEW_COUNT).toBe(360)
    expect(VIEW_STEP_DEG).toBe(1)
    expect(VIEW_COUNT * VIEW_STEP_DEG).toBe(360)
    for (const view of [0, 1, 90, 180, 270, 359]) expect(isViewIndex(view)).toBe(true)
    for (const view of INVALID) expect(isViewIndex(view)).toBe(false)
    expect(isViewIndex('0')).toBe(false)
    expect(viewAngle(0)).toBe(0)
    expectClose(viewAngle(90), Math.PI / 2, 1e-12)
    expectClose(viewAngle(359), (359 * Math.PI) / 180, 1e-12)
    expect(() => viewAngle(360)).toThrow(/^view$/)
  })

  it('非法下标抛出 view，输出保持原样', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const skinned = skinPose(compiled, createPose(compiled.skeleton))
    for (const view of INVALID) {
      const out = new Float32Array(2).fill(7)
      expect(() => projectPositions(out, new Float32Array([1, 2, 3]), view)).toThrow(/^view$/)
      expect(Array.from(out)).toEqual([7, 7])
      expect(() => projectParts(skinned, view)).toThrow(/^view$/)
    }
  })

  it('positions 或 out 长度不符时不写 out', () => {
    const out = new Float32Array(2).fill(7)
    expect(() => projectPositions(out, new Float32Array([1, 2]), 0)).toThrow(/^positions$/)
    expect(() => projectPositions(out, new Float32Array(0), 0)).toThrow(/^positions$/)
    expect(() => projectPositions(out, new Float32Array(6), 0)).toThrow(/^out$/)
    expect(() => projectPositions(out, new Float32Array([1, 2]), 400)).toThrow(/^view$/)
    expect(Array.from(out)).toEqual([7, 7])
  })

  it('k = 0：屏幕横是 x，屏幕竖是 y，深度是 z', () => {
    const seen = project([0.25, 1.5, -0.125], 0)
    expect(seen.x).toBe(0.25)
    expect(seen.y).toBe(1.5)
    expect(seen.depth).toBe(-0.125)

    const lateral = project([0, 0, 0.5], 0)
    expect(lateral.x).toBe(0)
    expect(lateral.depth).toBe(0.5)
    expect(project([0, 0, -0.5], 0).x).toBe(0)
  })

  it('k = 90：屏幕横是 z，深度是 −x；k = 180：深度是 −z；k = 270：屏幕横是 −z', () => {
    const front = project([0.25, 1.5, -0.125], 90)
    expect(front.x).toBe(-0.125)
    expect(front.y).toBe(1.5)
    expect(front.depth).toBe(-0.25)
    expect(project([0.1, 1.2, 0], 90).depth).toBeLessThan(project([-0.1, 1.2, 0], 90).depth)

    const left = project([0.25, 1.5, -0.125], 180)
    expect(left.x).toBe(-0.25)
    expect(left.y).toBe(1.5)
    expect(left.depth).toBe(0.125)
    expect(project([0, 1, 0.1], 180).depth).toBeLessThan(project([0, 1, -0.1], 180).depth)

    const back = project([0.25, 1.5, -0.125], 270)
    expect(back.x).toBe(0.125)
    expect(back.depth).toBe(0.25)
  })

  it('斜向按公式投影，每一档都是一次转动', () => {
    for (let view = 0; view < VIEW_COUNT; view += 1) {
      const psi = (view * Math.PI) / 180
      const seen = project([0.3, 0.9, -0.2], view)
      expectClose(seen.x, 0.3 * Math.cos(psi) - 0.2 * Math.sin(psi), 1e-6)
      expect(seen.y).toBe(Math.fround(0.9))
      expectClose(seen.depth, -0.3 * Math.sin(psi) - 0.2 * Math.cos(psi), 1e-6)
      expectClose(seen.x * seen.x + seen.depth * seen.depth, 0.3 * 0.3 + 0.2 * 0.2, 1e-6)
    }
  })

  it('深度是部件顶点深度的平均值', () => {
    const out = new Float32Array(6)
    const depth = projectPositions(out, new Float32Array([0, 0, 1, 0, 0, 2, 0, 0, 6]), 0)
    expect(depth).toBe(3)
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('k = 0：左侧、躯干、右侧的深度依次变小，近腿画在躯干之后', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const shown = presentPose(compiled, createPose(compiled.skeleton), 0)
    const depth = (id: string) => shown.projected.find((item) => item.partId === id)!.depth
    const at = (id: string) => shown.order.indexOf(id)

    expect(depth('legL')).toBeGreaterThan(depth('torso'))
    expect(depth('torso')).toBeGreaterThan(depth('legR'))
    expectClose(depth('legL'), compiled.proportions.hipOffsetZ, 1e-5)
    expectClose(depth('armR'), -compiled.proportions.shoulderOffsetZ, 1e-5)
    expectClose(depth('torso'), 0, 1e-6)

    expect(at('legL')).toBeLessThan(at('torso'))
    expect(at('torso')).toBeLessThan(at('legR'))
    expect(at('armL')).toBeLessThan(at('torso'))
    expect(at('torso')).toBeLessThan(at('armR'))
    expect(at('torso')).toBeLessThan(at('head'))
    expect(at('legL')).toBeLessThan(at('footL'))
    expect(at('armR')).toBeLessThan(at('handR'))
    expect(shown.order).not.toEqual(shown.tie)
    expect(shown.order.slice().sort()).toEqual(shown.tie.slice().sort())
  })

  it('k = 180：左侧更近、后画；次序不随行走朝向改变', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const pose = createPose(compiled.skeleton)
    const shown = presentPose(compiled, pose, 180)
    const depth = (id: string) => shown.projected.find((item) => item.partId === id)!.depth
    const at = (id: string) => shown.order.indexOf(id)
    expect(depth('legL')).toBeLessThan(depth('torso'))
    expect(depth('torso')).toBeLessThan(depth('legR'))
    expect(at('legR')).toBeLessThan(at('torso'))
    expect(at('torso')).toBeLessThan(at('legL'))
    expect(at('armR')).toBeLessThan(at('armL'))

    for (const view of [0, 180]) {
      const forward = presentPose(compiled, pose, view, 1)
      const backward = presentPose(compiled, pose, view, -1)
      const legs = (order: string[]) => order.filter((id) => id === 'legL' || id === 'legR' || id === 'torso')
      expect(legs(backward.order)).toEqual(legs(forward.order))
      for (let i = 0; i < forward.projected.length; i += 1) {
        expect(Array.from(backward.projected[i]!.positions)).toEqual(
          Array.from(forward.projected[i]!.positions),
        )
      }
    }
  })

  it('k = 0 的屏幕点就是矢状面里的 x, y；k = 90 露出髋宽和肩宽', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const pose = createPose(compiled.skeleton)
    setPoseRotation(pose, findBone(compiled.skeleton, 'shinL'), -0.8)
    const skinned = skinPose(compiled, pose)
    const side = projectParts(skinned, 0)
    for (let i = 0; i < skinned.length; i += 1) {
      const source = skinned[i]!.positions
      const seen = side[i]!.positions
      expect(seen.length).toBe((source.length / 3) * 2)
      for (let v = 0; v < source.length / 3; v += 1) {
        expect(seen[v * 2] === source[v * 3]).toBe(true)
        expect(seen[v * 2 + 1] === source[v * 3 + 1]).toBe(true)
      }
    }

    const front = projectParts(skinned, 90)
    const span = (items: ProjectedPart[], id: string) => {
      const positions = items.find((item) => item.partId === id)!.positions
      let min = Infinity
      let max = -Infinity
      for (let i = 0; i < positions.length; i += 2) {
        min = Math.min(min, positions[i]!)
        max = Math.max(max, positions[i]!)
      }
      return { min, max }
    }
    const p = compiled.proportions
    expectClose(span(front, 'armL').max, p.shoulderOffsetZ + p.upperArmRadius, 1e-5)
    expectClose(span(front, 'armR').min, -p.shoulderOffsetZ - p.upperArmRadius, 1e-5)
    expect(span(front, 'legL').min).toBeGreaterThan(span(front, 'legR').max - 2 * p.thighRadius)
    expectClose(span(front, 'footL').max, p.hipOffsetZ + p.footRadius, 1e-5)
    expectClose(span(front, 'torso').max, p.chestRadius, 1e-5)
    expectClose(span(side, 'armR').max - span(side, 'armR').min, 2 * p.upperArmRadius, 1e-5)
  })

  it('投影后的三角形都不是顺时针，索引只换同一个三角形里的两个', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const pose = createPose(compiled.skeleton)
    setPoseRotation(pose, findBone(compiled.skeleton, 'thighR'), 0.5)
    const skinned = skinPose(compiled, pose)
    let swapped = 0
    for (const view of [0, 37, 90, 180, 251, 359]) {
      const projected = projectParts(skinned, view)
      for (let i = 0; i < projected.length; i += 1) {
        const item = projected[i]!
        const source = skinned[i]!.indices
        expect(item.indices).not.toBe(source)
        expect(item.indices.length).toBe(source.length)
        for (let t = 0; t < item.indices.length; t += 3) {
          expect(cross(item.positions, item.indices, t)).toBeGreaterThanOrEqual(-1e-8)
          expect(item.indices[t]).toBe(source[t])
          const kept = item.indices[t + 1] === source[t + 1] && item.indices[t + 2] === source[t + 2]
          const flipped = item.indices[t + 1] === source[t + 2] && item.indices[t + 2] === source[t + 1]
          expect(kept || flipped).toBe(true)
          if (flipped) swapped += 1
        }
      }
    }
    expect(swapped).toBeGreaterThan(0)

    const near = projectParts(skinned, 0)
    const far = projectParts(skinned, 180)
    const leg = skinned.findIndex((item) => item.partId === 'legL')
    let differs = false
    for (let i = 0; i < near[leg]!.indices.length; i += 1) {
      if (near[leg]!.indices[i] !== far[leg]!.indices[i]) differs = true
    }
    expect(differs).toBe(true)
  })

  it('windIndices：顺时针调回逆时针，侧对视线的保持原样，失败不写', () => {
    const screen = new Float32Array([0, 0, 1, 0, 0, 1, 2, 0])
    const out = new Uint16Array(9)
    windIndices(out, new Uint16Array([0, 1, 2, 0, 2, 1, 0, 1, 3]), screen)
    expect(Array.from(out)).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 3])

    const kept = new Uint16Array(3).fill(5)
    expect(() => windIndices(kept, new Uint16Array([0, 1]), screen)).toThrow(/^indices$/)
    expect(() => windIndices(kept, new Uint16Array([0, 1, 4]), screen)).toThrow(/^indices$/)
    expect(() => windIndices(kept, new Uint16Array([0, 1, 2, 0, 1, 2]), screen)).toThrow(/^out$/)
    expect(Array.from(kept)).toEqual([5, 5, 5])
  })

  it('同一姿态连续用两个下标投影，姿态和蒙皮顶点按位不变', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const pose = createPose(compiled.skeleton)
    setPoseRotation(pose, findBone(compiled.skeleton, 'shinL'), -0.8)
    const data = Array.from(pose.data)
    const skinned = skinPose(compiled, pose)
    const before = skinned.map((item) => Array.from(item.positions))
    const first = projectParts(skinned, 0)
    const second = projectParts(skinned, 123)
    const again = projectParts(skinned, 0)
    expect(Array.from(pose.data)).toEqual(data)
    for (let i = 0; i < skinned.length; i += 1) {
      expect(Array.from(skinned[i]!.positions)).toEqual(before[i])
      expect(Array.from(again[i]!.positions)).toEqual(Array.from(first[i]!.positions))
      expect(again[i]!.depth).toBe(first[i]!.depth)
      expect(second[i]!.partId).toBe(skinned[i]!.partId)
    }
  })

  it('深度大的先画；深度相同按槽位次序；失败时不写 out', () => {
    const tie = ['a', 'b', 'c', 'd']
    const out = ['', '', '', '']
    depthOrder(out, [part('d', 0), part('a', 0.5), part('c', 0), part('b', -0.5)], tie)
    expect(out).toEqual(['a', 'c', 'd', 'b'])

    depthOrder(out, [part('d', 1), part('c', 1 + DEPTH_EPSILON / 100), part('b', 1), part('a', 1)], tie)
    expect(out).toEqual(['a', 'b', 'c', 'd'])

    depthOrder(out, [part('a', 0), part('b', 0.01), part('c', 0.02), part('d', 0.03)], tie)
    expect(out).toEqual(['d', 'c', 'b', 'a'])

    const kept = ['x', 'y']
    expect(() => depthOrder(kept, [part('a', 0)], tie)).toThrow(/^order$/)
    expect(() => depthOrder(kept, [part('a', 0), part('z', 1)], tie)).toThrow(/^slot$/)
    expect(kept).toEqual(['x', 'y'])
  })
})
