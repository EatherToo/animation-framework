import { describe, expect, it } from '@jest/globals'
import { createBinding, createMemoryLayer, updateBinding } from '@/bind/bind'
import { createHumanoid } from '@/body/assemble'
import { pullContacts } from '@/event/event'
import { createEngine, destroyEngine, diagnoseEngine, presentEngine, resetEngine, restoreEngine, captureEngine, stepEngine } from '@/engine/engine'
import { setSpeed, stepParams } from '@/params/params'
import { createPose, setPoseTranslation } from '@/skeleton/pose'
import { findBone } from '@/skeleton/skeleton'
import { strokeContours } from '@/stroke/stroke'
import { presentPose } from '../view/present'

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
    presentEngine(engine, 0.5, 0)
    expect(layer.objects).toHaveLength(engine.solver.compiled.meshes.meshes.length * 3)
    const identity = layer.objects.slice()
    expect(Array.from(engine.solver.pose.data)).toEqual(pose)
    expect(engine.solver.stepTime).toBe(stepTime)
    expect(engine.log.pending.length).toBe(pending)
    stepEngine(engine, DT)
    expect(layer.objects).toHaveLength(identity.length)
    for (let i = 0; i < identity.length; i += 1) expect(layer.objects[i]).toBe(identity[i])
  })

  it('视角只在呈现时生效：换一档不改姿态，非法下标不写绑定', () => {
    const layer = createMemoryLayer()
    const engine = createEngine(createHumanoid(1.7), layer)
    setSpeed(engine.solver.params, 1.2)
    for (let i = 0; i < 40; i += 1) stepEngine(engine, DT)
    const sequence = () =>
      layer.objects
        .filter((object) => object.kind === 'fill')
        .sort((a, b) => a.order - b.order)
        .map((object) => object.partId)
    const shown = () => layer.objects.map((object) => Array.from(object.positions))

    presentEngine(engine, 0.5, 0)
    const pose = Array.from(engine.solver.pose.data)
    const before = Array.from(engine.pair.before.pose.data)
    const after = Array.from(engine.pair.after.pose.data)
    const side = shown()
    const sideOrder = sequence()
    expect(sideOrder.indexOf('legL')).toBeLessThan(sideOrder.indexOf('torso'))
    expect(sideOrder.indexOf('torso')).toBeLessThan(sideOrder.indexOf('legR'))
    const torso = layer.objects.find((object) => object.kind === 'fill' && object.partId === 'torso')!
    const torsoMesh = engine.solver.compiled.meshes.meshes.find((mesh) => mesh.partId === 'torso')!
    expect(torso.positions.length).toBe((torsoMesh.positions.length / 3) * 2)

    presentEngine(engine, 0.5, 180)
    expect(Array.from(engine.solver.pose.data)).toEqual(pose)
    expect(Array.from(engine.pair.before.pose.data)).toEqual(before)
    expect(Array.from(engine.pair.after.pose.data)).toEqual(after)
    const other = shown()
    const otherOrder = sequence()
    expect(other).not.toEqual(side)
    expect(otherOrder.indexOf('legR')).toBeLessThan(otherOrder.indexOf('torso'))
    expect(otherOrder.indexOf('torso')).toBeLessThan(otherOrder.indexOf('legL'))

    for (const view of [360, 1.5, -1, Number.NaN]) {
      expect(() => presentEngine(engine, 0.5, view)).toThrow(/^view$/)
      expect(shown()).toEqual(other)
      expect(sequence()).toEqual(otherOrder)
    }
    expect(Array.from(engine.solver.pose.data)).toEqual(pose)

    const facing = engine.solver.params.current.facing
    const generation = engine.solver.placement.generation
    presentEngine(engine, 0.5, 0)
    expect(shown()).toEqual(side)
    expect(sequence()).toEqual(sideOrder)
    expect(engine.solver.params.current.facing).toBe(facing)
    expect(engine.solver.placement.generation).toBe(generation)
    expect(JSON.stringify(Object.keys(captureEngine(engine)))).not.toMatch(/view/i)
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
    presentEngine(engine, 1, 0)
    const other = createBinding(layer)
    const { filled, textured, order } = presentPose(engine.solver.compiled, engine.solver.pose, 0)
    updateBinding(other, filled, textured, strokeContours(filled, false), order)
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
