import { describe, expect, it } from '@jest/globals'
import {
  applyPreset,
  createParams,
  setCadenceStyle,
  setCrouch,
  setFacing,
  setSpeed,
  stepParams,
} from '@/params/params'

describe('params', () => {
  it('创建后站立，朝向为 1', () => {
    const params = createParams()
    expect(params.current.speed).toBe(0)
    expect(params.current.facing).toBe(1)
    expect(params.current.cadenceStyle).toBe(1)
  })

  it('速度平滑靠近目标，朝向立即生效', () => {
    const params = createParams()
    setSpeed(params, 2)
    expect(params.target.speed).toBe(2)
    expect(params.current.speed).toBe(0)
    stepParams(params, 0.25)
    expect(params.current.speed).toBeGreaterThan(0)
    expect(params.current.speed).toBeLessThan(2)
    setFacing(params, -1)
    expect(params.current.facing).toBe(-1)
  })

  it('行走预设把目标速度设为 1.2', () => {
    const params = createParams()
    applyPreset(params, 'walk')
    expect(params.target.speed).toBe(1.2)
    expect(params.current.facing).toBe(1)
  })

  it('非法输入不改原值', () => {
    const params = createParams()
    setSpeed(params, 1)
    expect(() => setSpeed(params, Number.NaN)).toThrow(/^speed$/)
    expect(params.target.speed).toBe(1)
    expect(() => setCadenceStyle(params, 0)).toThrow(/^cadenceStyle$/)
    expect(() => setCrouch(params, 1.2)).toThrow(/^crouch$/)
    expect(() => setFacing(params, 0 as 1)).toThrow(/^facing$/)
    expect(params.current.facing).toBe(1)
    expect(() => stepParams(params, 0)).toThrow(/^dt$/)
    expect(params.current.speed).toBe(0)
  })
})
