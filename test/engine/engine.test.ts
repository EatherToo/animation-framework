import { describe, expect, it } from '@jest/globals'
import { createBinding, createMemoryLayer, updateBinding } from '@/bind/bind'
import { createHumanoid } from '@/body/assemble'
import { pullContacts } from '@/event/event'
import { createEngine, destroyEngine, diagnoseEngine, presentEngine, resetEngine, restoreEngine, captureEngine, stepEngine } from '@/engine/engine'
import { fillPose } from '@/fill/fill'
import { setSpeed, stepParams } from '@/params/params'
import { createPose, setPoseTranslation } from '@/skeleton/pose'
import { findBone } from '@/skeleton/skeleton'
import { drawOrder } from '@/slot/slot'
import { strokeContours } from '@/stroke/stroke'

const DT = 1 / 60

describe('engine', () => {
  it('固定步不创建对象，取样才写入绑定', () => {
    const layer = createMemoryLayer()
    const engine = createEngine(createHumanoid(1.7), layer)
    setSpeed(engine.solver.params, 1.2)
    for (let i = 0; i < 40; i += 1) stepEngine(engine, DT)
    expect(layer.objects).toHaveLength(0)
    const pose = Array.from(engine.solver.pose.data)
    const stepTime = engine.solver.stepTime
    const pending = engine.log.pending.length
    presentEngine(engine, 0.5)
    expect(layer.objects).toHaveLength(engine.solver.compiled.meshes.meshes.length * 2)
    const identity = layer.objects.slice()
    expect(Array.from(engine.solver.pose.data)).toEqual(pose)
    expect(engine.solver.stepTime).toBe(stepTime)
    expect(engine.log.pending.length).toBe(pending)
    stepEngine(engine, DT)
    expect(layer.objects).toHaveLength(identity.length)
    for (let i = 0; i < identity.length; i += 1) expect(layer.objects[i]).toBe(identity[i])
  })

  it('提交的离地可以在步进之后拉取', () => {
    const engine = createEngine(createHumanoid(1.7), createMemoryLayer())
    setSpeed(engine.solver.params, 1.2)
    for (let i = 0; i < 90; i += 1) stepParams(engine.solver.params, DT)
    const seen: string[] = []
    for (let i = 0; i < 80 && !seen.includes('liftoff'); i += 1) {
      stepEngine(engine, DT)
      for (const event of pullContacts(engine.log)) seen.push(event.kind)
    }
    expect(seen).toContain('liftoff')
  })

  it('站姿成立才重置', () => {
    const engine = createEngine(createHumanoid(1.7), createMemoryLayer())
    setSpeed(engine.solver.params, 1.2)
    for (let i = 0; i < 40; i += 1) stepEngine(engine, DT)
    const stand = createPose(engine.solver.pose.skeleton)
    resetEngine(engine, stand)
    expect(engine.solver.gait.mode).toBe('stand')
    expect(engine.solver.plan.active).toBeNull()
    expect(engine.solver.params.target.speed).toBe(0)
    expect(engine.solver.recovery.active).toBe(false)
    expect(engine.log.pending).toEqual([])
    expect(Array.from(engine.solver.pose.data)).toEqual(Array.from(stand.data))

    setSpeed(engine.solver.params, 1.2)
    for (let i = 0; i < 40; i += 1) stepEngine(engine, DT)
    const again = Array.from(engine.solver.pose.data)
    const unreachable = createPose(engine.solver.pose.skeleton)
    setPoseTranslation(unreachable, findBone(unreachable.skeleton, 'footL'), 5, 0)
    expect(() => resetEngine(engine, unreachable)).toThrow(/^stance$/)
    expect(Array.from(engine.solver.pose.data)).toEqual(again)
    expect(engine.solver.plan.active).not.toBeNull()
  })

  it('销毁只释放自己的对象', () => {
    const layer = createMemoryLayer()
    const engine = createEngine(createHumanoid(1.7), layer)
    presentEngine(engine, 1)
    const other = createBinding(layer)
    const filled = fillPose(engine.solver.compiled, engine.solver.pose)
    const order = drawOrder(new Array<string>(engine.solver.compiled.slots.slots.length), engine.solver.compiled.slots, 1)
    updateBinding(other, filled, strokeContours(filled, false), order)
    const foreign = other.objects[0]
    destroyEngine(engine)
    expect(layer.objects).toContain(foreign)
    expect(foreign!.destroyed).toBe(false)
    expect(engine.binding.objects).toHaveLength(0)
    expect(layer.lost).toBe(false)
    expect(() => stepEngine(engine, DT)).toThrow(/^destroyed$/)
  })

  it('快照和诊断从门面进出', () => {
    const engine = createEngine(createHumanoid(1.7), createMemoryLayer())
    setSpeed(engine.solver.params, 1.2)
    for (let i = 0; i < 40; i += 1) stepEngine(engine, DT)
    const pose = Array.from(engine.solver.pose.data)
    const shot = captureEngine(engine)
    expect(diagnoseEngine(engine).contactResidual).toBeCloseTo(0, 3)
    for (let i = 0; i < 10; i += 1) stepEngine(engine, DT)
    restoreEngine(engine, shot)
    expect(Array.from(engine.solver.pose.data)).toEqual(pose)
  })
})
