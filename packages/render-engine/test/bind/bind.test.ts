import { describe, expect, it } from '@jest/globals'
import { createBinding, createMemoryLayer, destroyBinding, notifyContextLost, notifyContextRestored, updateBinding } from '@/bind/bind'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { createPose, setPoseRotation } from '@/skeleton/pose'
import { findBone } from '@/skeleton/skeleton'
import { strokeContours } from '@/stroke/stroke'
import { presentPose } from '../view/present'

function view(index: number, knee: number) {
  const compiled = compileHumanoid(createHumanoid(1.7))
  const pose = createPose(compiled.skeleton)
  if (knee !== 0) setPoseRotation(pose, findBone(compiled.skeleton, 'shinL'), knee)
  const { filled, textured, order } = presentPose(compiled, pose, index)
  return { compiled, filled, textured, order }
}

describe('bind', () => {
  it('重复更新不追加对象，丢失期间不改顶点', () => {
    const layer = createMemoryLayer()
    const binding = createBinding(layer)
    const first = view(0, 0)
    updateBinding(binding, first.filled, first.textured, strokeContours(first.filled, true), first.order)
    expect(layer.objects).toHaveLength(first.filled.length * 3)
    const identity = layer.objects.slice()
    const second = view(0, -0.8)
    updateBinding(binding, second.filled, second.textured, strokeContours(second.filled, true), second.order)
    expect(layer.objects).toHaveLength(identity.length)
    for (let i = 0; i < identity.length; i += 1) expect(layer.objects[i]).toBe(identity[i])
    const leg = layer.objects.find((object) => object.kind === 'fill' && object.partId === 'legL')!
    expect(Array.from(leg.positions)).toEqual(Array.from(second.filled.find((part) => part.partId === 'legL')!.positions))

    const frozen = leg.positions.slice()
    notifyContextLost(binding)
    updateBinding(binding, first.filled, first.textured, strokeContours(first.filled, true), first.order)
    expect(Array.from(leg.positions)).toEqual(Array.from(frozen))
    notifyContextRestored(binding)
    updateBinding(binding, first.filled, first.textured, strokeContours(first.filled, true), first.order)
    expect(Array.from(leg.positions)).toEqual(Array.from(first.filled.find((part) => part.partId === 'legL')!.positions))
  })

  it('销毁只释放自己的对象', () => {
    const layer = createMemoryLayer()
    const binding = createBinding(layer)
    const posed = view(0, 0)
    updateBinding(binding, posed.filled, posed.textured, strokeContours(posed.filled, true), posed.order)
    destroyBinding(binding)
    expect(layer.objects).toHaveLength(0)
    expect(layer.lost).toBe(false)
  })

  it('顺序来自投影深度：0° 右侧更近，180° 左侧更近，关闭描边只清空描边', () => {
    const layer = createMemoryLayer()
    const binding = createBinding(layer)
    const side = view(0, 0)
    updateBinding(binding, side.filled, side.textured, strokeContours(side.filled, true), side.order)
    const sequence = () =>
      layer.objects
        .filter((object) => object.kind === 'fill')
        .sort((a, b) => a.order - b.order)
        .map((object) => object.partId)
    const at = (id: string) => sequence().indexOf(id)
    expect(sequence()).toEqual(side.order)
    expect(at('legL')).toBeLessThan(at('legR'))
    expect(at('armL')).toBeLessThan(at('armR'))
    expect(at('torso')).toBeLessThan(at('legR'))
    expect(at('legL')).toBeLessThan(at('torso'))
    for (const object of layer.objects) {
      if (object.kind !== 'stroke') continue
      const fill = layer.objects.find((item) => item.kind === 'fill' && item.partId === object.partId)!
      expect(object.order).toBe(fill.order + 0.5)
    }

    const other = view(180, 0)
    updateBinding(binding, other.filled, other.textured, strokeContours(other.filled, true), other.order)
    expect(sequence()).toEqual(other.order)
    expect(at('legR')).toBeLessThan(at('legL'))
    expect(at('armR')).toBeLessThan(at('armL'))
    expect(at('torso')).toBeLessThan(at('legL'))

    const strokeBefore = layer.objects.find((object) => object.kind === 'stroke' && object.partId === 'legL')!
    expect(strokeBefore.indices.length).toBeGreaterThan(0)
    updateBinding(binding, other.filled, other.textured, strokeContours(other.filled, false), other.order)
    const stroke = layer.objects.find((object) => object.kind === 'stroke' && object.partId === 'legL')!
    expect(stroke.indices.length).toBe(0)
    const fill = layer.objects.find((object) => object.kind === 'fill' && object.partId === 'legL')!
    expect(Array.from(fill.positions)).toEqual(
      Array.from(other.filled.find((part) => part.partId === 'legL')!.positions),
    )
    expect(fill.positions.length).toBe(544)
  })

  it('贴图与部件对不上时不改已有对象', () => {
    const layer = createMemoryLayer()
    const binding = createBinding(layer)
    const first = view(90, 0)
    updateBinding(binding, first.filled, first.textured, strokeContours(first.filled, true), first.order)
    const kept = layer.objects.slice()
    const arm = layer.objects.find((object) => object.kind === 'texture' && object.partId === 'armL')!
    const source = first.textured.find((part) => part.partId === 'armL')!
    expect(arm.textures).toBe(source.textures)
    expect(arm.triangleTexture).toBe(source.triangleTexture)
    expect(arm.indices).toBe(source.indices)
    expect(Array.from(arm.uvs!)).toEqual(Array.from(source.uvs))
    const positions = Array.from(kept[0]!.positions)
    expect(() =>
      updateBinding(binding, first.filled, [], strokeContours(first.filled, true), first.order),
    ).toThrow(/^texture$/)
    expect(layer.objects).toEqual(kept)
    expect(Array.from(layer.objects[0]!.positions)).toEqual(positions)
    const mismatched = first.textured.map((part, index) =>
      index === 0 ? { ...part, partId: 'missing' } : part,
    )
    expect(() =>
      updateBinding(binding, first.filled, mismatched, strokeContours(first.filled, true), first.order),
    ).toThrow(/^texture$/)
    expect(layer.objects).toEqual(kept)
  })
})
