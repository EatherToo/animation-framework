import { describe, expect, it } from '@jest/globals'
import { createBinding, createMemoryLayer, destroyBinding, notifyContextLost, notifyContextRestored, updateBinding } from '@/bind/bind'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { fillPose } from '@/fill/fill'
import { createPose, setPoseRotation } from '@/skeleton/pose'
import { findBone } from '@/skeleton/skeleton'
import { drawOrder } from '@/slot/slot'
import { strokeContours } from '@/stroke/stroke'

function view(facing: 1 | -1, knee: number) {
  const compiled = compileHumanoid(createHumanoid(1.7))
  const pose = createPose(compiled.skeleton)
  if (knee !== 0) setPoseRotation(pose, findBone(compiled.skeleton, 'shinL'), knee)
  const filled = fillPose(compiled, pose)
  const order = drawOrder(new Array<string>(compiled.slots.slots.length), compiled.slots, facing)
  return { compiled, filled, order }
}

describe('bind', () => {
  it('重复更新不追加对象，丢失期间不改顶点', () => {
    const layer = createMemoryLayer()
    const binding = createBinding(layer)
    const first = view(1, 0)
    updateBinding(binding, first.filled, strokeContours(first.filled, true), first.order)
    expect(layer.objects).toHaveLength(first.filled.length * 2)
    const identity = layer.objects.slice()
    const second = view(1, -0.8)
    updateBinding(binding, second.filled, strokeContours(second.filled, true), second.order)
    expect(layer.objects).toHaveLength(identity.length)
    for (let i = 0; i < identity.length; i += 1) expect(layer.objects[i]).toBe(identity[i])
    const leg = layer.objects.find((object) => object.kind === 'fill' && object.partId === 'legL')!
    expect(Array.from(leg.positions)).toEqual(Array.from(second.filled.find((part) => part.partId === 'legL')!.positions))

    const frozen = leg.positions.slice()
    notifyContextLost(binding)
    updateBinding(binding, first.filled, strokeContours(first.filled, true), first.order)
    expect(Array.from(leg.positions)).toEqual(Array.from(frozen))
    notifyContextRestored(binding)
    updateBinding(binding, first.filled, strokeContours(first.filled, true), first.order)
    expect(Array.from(leg.positions)).toEqual(Array.from(first.filled.find((part) => part.partId === 'legL')!.positions))
  })

  it('销毁只释放自己的对象', () => {
    const layer = createMemoryLayer()
    const binding = createBinding(layer)
    const posed = view(1, 0)
    updateBinding(binding, posed.filled, strokeContours(posed.filled, true), posed.order)
    destroyBinding(binding)
    expect(layer.objects).toHaveLength(0)
    expect(layer.lost).toBe(false)
  })

  it('朝向改变对象顺序，关闭描边只清空描边', () => {
    const layer = createMemoryLayer()
    const binding = createBinding(layer)
    const positive = view(1, 0)
    updateBinding(binding, positive.filled, strokeContours(positive.filled, true), positive.order)
    const sequence = () =>
      layer.objects
        .filter((object) => object.kind === 'fill')
        .sort((a, b) => a.order - b.order)
        .map((object) => object.partId)
    expect(sequence()).toEqual(positive.order)

    const negative = view(-1, 0)
    updateBinding(binding, negative.filled, strokeContours(negative.filled, true), negative.order)
    expect(sequence()).toEqual(negative.order)

    updateBinding(binding, negative.filled, strokeContours(negative.filled, false), negative.order)
    const stroke = layer.objects.find((object) => object.kind === 'stroke' && object.partId === 'legL')!
    expect(stroke.indices.length).toBe(0)
    const fill = layer.objects.find((object) => object.kind === 'fill' && object.partId === 'legL')!
    expect(Array.from(fill.positions)).toEqual(
      Array.from(negative.filled.find((part) => part.partId === 'legL')!.positions),
    )
  })
})
