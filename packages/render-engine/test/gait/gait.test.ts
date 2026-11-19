import { describe, expect, it } from '@jest/globals'
import { createGait, stepGait, type GaitInput } from '@/gait/gait'

function input(patch: Partial<GaitInput> = {}): GaitInput {
  return {
    speed: 1,
    facing: 1,
    contactHeld: true,
    stepFinished: false,
    requestRecover: false,
    froude: 0.1,
    ...patch,
  }
}

describe('gait', () => {
  it('创建后站立', () => {
    const gait = createGait()
    expect(gait.mode).toBe('stand')
    expect(gait.sign).toBe(0)
    expect(gait.facing).toBe(1)
  })

  it('站立后起步，接触成立才进入行走或跑步', () => {
    const gait = createGait()
    stepGait(gait, input())
    expect(gait.mode).toBe('start')
    expect(gait.sign).toBe(1)
    stepGait(gait, input({ stepFinished: true, contactHeld: false }))
    expect(gait.mode).toBe('start')
    stepGait(gait, input({ stepFinished: true, froude: 0.1 }))
    expect(gait.mode).toBe('walk')
    const running = createGait()
    stepGait(running, input({ froude: 0.6 }))
    stepGait(running, input({ stepFinished: true, froude: 0.6 }))
    expect(running.mode).toBe('run')
  })

  it('速度反向先停止，下一步才按新方向起步', () => {
    const gait = createGait()
    stepGait(gait, input())
    stepGait(gait, input({ stepFinished: true }))
    stepGait(gait, input({ speed: -1 }))
    expect(gait.mode).toBe('stop')
    expect(gait.sign).toBe(1)
    stepGait(gait, input({ speed: -1, stepFinished: true }))
    expect(gait.mode).toBe('stand')
    expect(gait.sign).toBe(0)
    stepGait(gait, input({ speed: -1 }))
    expect(gait.mode).toBe('start')
    expect(gait.sign).toBe(-1)
  })

  it('朝向命令和速度掉到阈值以下都进入停止', () => {
    const gait = createGait()
    stepGait(gait, input())
    stepGait(gait, input({ stepFinished: true }))
    stepGait(gait, input({ facing: -1 }))
    expect(gait.mode).toBe('stop')
    const slowing = createGait()
    stepGait(slowing, input())
    stepGait(slowing, input({ stepFinished: true }))
    stepGait(slowing, input({ speed: 0 }))
    expect(slowing.mode).toBe('stop')
    stepGait(slowing, input({ speed: 1, stepFinished: true }))
    expect(slowing.mode).toBe('stand')
  })

  it('只有请求才进入恢复', () => {
    const gait = createGait()
    stepGait(gait, input())
    stepGait(gait, input({ stepFinished: true }))
    expect(gait.mode).toBe('walk')
    stepGait(gait, input({ requestRecover: true }))
    expect(gait.mode).toBe('recover')
    stepGait(gait, input({ stepFinished: true }))
    expect(gait.mode).toBe('stand')
  })

  it('非法速度不改模式', () => {
    const gait = createGait()
    stepGait(gait, input())
    stepGait(gait, input({ stepFinished: true }))
    expect(() => stepGait(gait, input({ speed: Number.NaN }))).toThrow(/^speed$/)
    expect(gait.mode).toBe('walk')
  })
})
