/**
 * M2 动画模块的 TDD 测试。
 * M1（@/slot/slot）由并行代理实现，这里用虚拟 mock 隔离，
 * 使 M2 单元行为可以独立验证；M1 落地后同一份用例继续有效。
 */
import { describe, expect, it } from '@jest/globals'
import { compileSkeleton, type BoneSpec } from '@/core/skeleton'
import {
  CH_ROT, CH_SHX, CH_SX, CH_X, POSE_STRIDE,
  createPose, getLocal,
} from '@/core/pose'
import type {
  AnimationClip,
  Bezier,
  EventTimeline,
  ScalarKey,
  Timeline,
  Track,
} from '@/animation/animation'

import { createSlotSet, type SkinData, type SlotData } from '@/slot/slot'
import {
  createTrack, sampleAnimation, sampleScalar, shortestAngle, unwrapRotateKeys,
} from '@/animation/animation'

function makeSlotSet() {
  const data: SlotData[] = Array.from({ length: 3 }, (_, i) => ({
    id: `slot${i}`, bone: 0, order: i, color: { r: 1, g: 1, b: 1, a: 1 },
    blend: 'normal' as const, attachment: null, mask: null, zOffset: 0,
  }))
  const skins = new Map<string, SkinData>([
    ['default', { id: 'default', attachments: new Map() }],
  ])
  return createSlotSet(data, skins, 'default')
}

const TAU = Math.PI * 2
const EPS = 1e-6

function key(time: number, value: number, curve?: ScalarKey['curve'], bezier?: Bezier): ScalarKey {
  return { time, value, ...(curve === undefined ? {} : { curve }), ...(bezier === undefined ? {} : { bezier }) }
}

function skeleton() {
  const bones: BoneSpec[] = [
    { name: 'root', parent: -1, length: 1 },
    { name: 'arm', parent: 0, length: 1 },
    { name: 'leg', parent: 0, length: 1 },
  ]
  return compileSkeleton({ name: 'anim-test', profile: 'simple2d', bones })
}

function clip(name: string, timelines: readonly Timeline[], duration = 1): AnimationClip {
  return { name, duration, timelines }
}

function slotSetArg() {
  return makeSlotSet()
}

/** 独立的 Bézier 参考求解器，用于反解精度交叉验证。 */
function referenceBezier(t: number, c1x: number, c1y: number, c2x: number, c2y: number): number {
  const bx = (u: number) => 3 * (1 - u) ** 2 * u * c1x + 3 * (1 - u) * u ** 2 * c2x + u ** 3
  let lo = 0
  let hi = 1
  let u = t
  for (let i = 0; i < 60; i += 1) {
    const x = bx(u)
    if (Math.abs(x - t) < 1e-12) break
    if (x < t) lo = u
    else hi = u
    u = (lo + hi) / 2
  }
  return 3 * (1 - u) ** 2 * u * c1y + 3 * (1 - u) * u ** 2 * c2y + u ** 3
}

describe('sampleScalar 曲线求值', () => {
  it('空 keys 返回 0，单 key 为常量，时间夹在首尾', () => {
    expect(sampleScalar([], 1)).toBe(0)
    expect(sampleScalar([key(0.5, 7)], -10)).toBe(7)
    expect(sampleScalar([key(0.5, 7)], 100)).toBe(7)
    const keys = [key(0, 0), key(1, 10)]
    expect(sampleScalar(keys, -1)).toBe(0)
    expect(sampleScalar(keys, 2)).toBe(10)
    expect(sampleScalar(keys, 0.25)).toBeCloseTo(2.5, 7)
  })

  it('stepped 保持前键值直到下一键', () => {
    const keys = [key(0, 0, 'stepped'), key(0.5, 5, 'stepped'), key(1, 9)]
    expect(sampleScalar(keys, 0.1)).toBe(0)
    expect(sampleScalar(keys, 0.499)).toBe(0)
    expect(sampleScalar(keys, 0.5)).toBe(5)
    expect(sampleScalar(keys, 0.9)).toBe(5)
    expect(sampleScalar(keys, 1)).toBe(9)
  })

  it('easeSine 端点精确、单调、关于中点对称', () => {
    const keys = [key(0, 0, 'easeSine'), key(1, 1)]
    expect(sampleScalar(keys, 0)).toBeCloseTo(0, 7)
    expect(sampleScalar(keys, 1)).toBeCloseTo(1, 7)
    let prev = -Infinity
    for (let i = 0; i <= 20; i += 1) {
      const v = sampleScalar(keys, i / 20)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
    expect(sampleScalar(keys, 0.25) + sampleScalar(keys, 0.75)).toBeCloseTo(1, 6)
  })

  it('bezier 恒等控制点近似线性，反解精度优于 1e-4', () => {
    const identity: Bezier = [1 / 3, 1 / 3, 2 / 3, 2 / 3]
    const keys = [key(0, 0, 'bezier', identity), key(1, 1)]
    for (let i = 0; i <= 10; i += 1) {
      const t = i / 10
      expect(Math.abs(sampleScalar(keys, t) - t)).toBeLessThan(1e-4)
    }
    // 多组控制点与独立参考解交叉验证（确定性伪随机）。
    let seed = 12345
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let n = 0; n < 24; n += 1) {
      const c1x = rand() * 0.5
      const c2x = c1x + rand() * (1 - c1x)
      const c1y = rand()
      const c2y = rand()
      const t = rand()
      const bezier: Bezier = [c1x, c1y, c2x, c2y]
      const got = sampleScalar([key(0, 0, 'bezier', bezier), key(1, 1)], t)
      expect(Number.isFinite(got)).toBe(true)
      expect(Math.abs(got - referenceBezier(t, c1x, c1y, c2x, c2y))).toBeLessThan(1e-4)
    }
  })

  it('非法 bezier 控制点回退且不产生 NaN', () => {
    const bad: Bezier = [1, Number.NaN, 0, 1]
    const got = sampleScalar([key(0, 0, 'bezier', bad), key(1, 10)], 0.5)
    expect(Number.isFinite(got)).toBe(true)
  })
})

describe('角度与展开', () => {
  it('shortestAngle 走最短弧且 wrap 幂等', () => {
    const a = (359 / 180) * Math.PI
    const b = (1 / 180) * Math.PI
    expect(shortestAngle(a, b)).toBeCloseTo((2 / 180) * Math.PI, 7)
    expect(shortestAngle(b, a)).toBeCloseTo(-(2 / 180) * Math.PI, 7)
    expect(shortestAngle(0, 0)).toBeCloseTo(0, 7)
    const d = shortestAngle(a, b)
    expect(shortestAngle(0, d)).toBeCloseTo(d, 7)
  })

  it('unwrapRotateKeys 对普通键走最短弧，720 度连续角不折叠', () => {
    const folded = unwrapRotateKeys([
      key(0, 0),
      key(1, (350 / 180) * Math.PI),
      key(2, 0),
    ])
    expect(folded[1]!.value).toBeCloseTo(-(10 / 180) * Math.PI, 6)
    expect(folded[2]!.value).toBeCloseTo(0, 6)

    const turns = unwrapRotateKeys([key(0, 0), key(1, TAU), key(2, TAU * 2)])
    expect(turns[0]!.value).toBe(0)
    expect(turns[1]!.value).toBeCloseTo(TAU, 6)
    expect(turns[2]!.value).toBeCloseTo(TAU * 2, 6)
    expect(turns[1]!.time).toBe(1)
    expect(turns[2]!.time).toBe(2)
  })
})

describe('Track 构造', () => {
  it('提供 Spine 风格默认值并允许覆盖', () => {
    const c = clip('idle', [])
    const t = createTrack(c)
    expect(t.clip).toBe(c)
    expect(t.time).toBe(0)
    expect(t.lastTime).toBe(0)
    expect(t.alpha).toBe(1)
    expect(t.speed).toBe(1)
    expect(t.loop).toBe(true)
    expect(t.blendMode).toBe('replace')
    expect(t.loopCount).toBe(0)

    const custom = createTrack(c, { alpha: 0.4, speed: 2, loop: false, blendMode: 'additive', time: 0.25 })
    expect(custom.alpha).toBe(0.4)
    expect(custom.speed).toBe(2)
    expect(custom.loop).toBe(false)
    expect(custom.blendMode).toBe('additive')
    expect(custom.time).toBe(0.25)
  })
})

describe('sampleAnimation 十类 timeline', () => {
  it('rotate 写入 Pose 局部角（连续，不折叠）', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const c = clip('rot', [{ kind: 'rotate', path: 'arm', keys: [key(0, 0), key(1, Math.PI / 2)] }])
    const track = createTrack(c)
    sampleAnimation([track], pose, slotSetArg(), 0.5)
    expect(getLocal(pose, 1, CH_ROT)).toBeCloseTo(Math.PI / 4, 6)
    expect(pose.dirty[1]).toBe(1)
  })

  it('translate / scale / shear 写入 Pose 对应通道', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const c = clip('xform', [
      { kind: 'translate', path: 'arm', keys: [key(0, 0), key(1, 10)] },
      { kind: 'scale', path: 'arm', keys: [key(0, 1), key(1, 2)] },
      { kind: 'shear', path: 'arm', keys: [key(0, 0), key(1, 1)] },
    ])
    sampleAnimation([createTrack(c)], pose, slotSetArg(), 0.5)
    expect(getLocal(pose, 1, CH_X)).toBeCloseTo(5, 6)
    expect(getLocal(pose, 1, CH_SX)).toBeCloseTo(1.5, 6)
    expect(getLocal(pose, 1, CH_SHX)).toBeCloseTo(0.5, 6)
  })

  it('attachment / color / drawOrder 写入 SlotSet', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const c = clip('slots', [
      { kind: 'attachment', path: '0', keys: [key(0, 7)] },
      { kind: 'color', path: '1', keys: [key(0, 3)] },
      { kind: 'drawOrder', path: '2', keys: [key(0, 9)] },
    ])
    const slots = makeSlotSet()
    sampleAnimation([createTrack(c)], pose, slots, 1 / 60)
    expect(slots.slots[0]!.attachmentId).toBe('7')
    expect(slots.slots[1]!.color.r).toBe(0)
    expect(slots.drawOrder).toEqual([0, 1, 2]) // 9 % 3 = 0
  })

  it('deform / ik 被处理且不崩溃', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const c = clip('data', [
      { kind: 'deform', path: '0', keys: [key(0, 0.25), key(1, 0.75)] },
      { kind: 'ik', path: '0', keys: [key(0, 0.5)] },
    ])
    expect(() => sampleAnimation([createTrack(c)], pose, slotSetArg(), 0.5)).not.toThrow()
    expect(getLocal(pose, 1, CH_X)).toBe(sk.setupLocal[POSE_STRIDE + CH_X]!)
  })

  it('event timeline 采集事件名', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const ev: EventTimeline = {
      kind: 'event', path: 'clip', events: [{ time: 0, name: 'start' }, { time: 0.5, name: 'hit' }],
    }
    const result = sampleAnimation([createTrack(clip('walk', [ev], 1))], pose, slotSetArg(), 0.6)
    expect(result.events).toContain('start')
    expect(result.events).toContain('hit')
  })
})

describe('事件边界、去重、循环与 scrub', () => {
  it('区间 (prev,curr] 触发，同帧不重复', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const ev: EventTimeline = { kind: 'event', path: 'clip', events: [{ time: 0.5, name: 'hit' }] }
    const track = createTrack(clip('walk', [ev], 1))
    const first = sampleAnimation([track], pose, slotSetArg(), 0.5)
    expect(first.events.filter((e) => e === 'hit')).toHaveLength(1)
    const second = sampleAnimation([track], pose, slotSetArg(), 0.1)
    expect(second.events).not.toContain('hit')
  })

  it('首帧 time=0 触发一次，后续循环边界再次触发', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const ev: EventTimeline = {
      kind: 'event', path: 'clip',
      events: [{ time: 0, name: 'start' }, { time: 1, name: 'end' }],
    }
    const track = createTrack(clip('walk', [ev], 1))
    const r1 = sampleAnimation([track], pose, slotSetArg(), 0.6)
    expect(r1.events).toEqual(['start'])
    const r2 = sampleAnimation([track], pose, slotSetArg(), 0.6)
    expect(r2.events).toEqual(['end', 'start'])
  })

  it('loop 计数随回绕递增，大 dt 跨多圈仍采集', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const ev: EventTimeline = {
      kind: 'event', path: 'clip',
      events: [{ time: 0, name: 'start' }, { time: 0.5, name: 'mid' }],
    }
    const track = createTrack(clip('walk', [ev], 1))
    const r = sampleAnimation([track], pose, slotSetArg(), 2.2)
    expect(track.loopCount).toBe(2)
    expect(r.events.filter((e) => e === 'mid').length).toBeGreaterThanOrEqual(2)
    expect(track.time).toBeCloseTo(0.2, 6)
    expect(track.lastTime).toBeCloseTo(0.2, 6)
  })

  it('scrub（dt=0）幂等且不触发事件', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const ev: EventTimeline = { kind: 'event', path: 'clip', events: [{ time: 0, name: 'start' }] }
    const track = createTrack(clip('walk', [ev], 1))
    sampleAnimation([track], pose, slotSetArg(), 0.5)
    const before = pose.local.slice()
    const t0 = track.time
    const r = sampleAnimation([track], pose, slotSetArg(), 0)
    expect(r.events).toEqual([])
    expect(Array.from(pose.local)).toEqual(Array.from(before))
    expect(track.time).toBe(t0)
  })

  it('alpha 为 0 的 track 不采样、不触发事件', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const ev: EventTimeline = { kind: 'event', path: 'clip', events: [{ time: 0, name: 'start' }] }
    const track = createTrack(clip('walk', [ev], 1))
    track.alpha = 0
    const before = pose.local.slice()
    const r = sampleAnimation([track], pose, slotSetArg(), 0.5)
    expect(r.events).toEqual([])
    expect(Array.from(pose.local)).toEqual(Array.from(before))
  })
})

describe('混合、叠加与主导 clip', () => {
  it('crossfade 的连续通道按 alpha 在偏移空间线性混合', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const a = createTrack(clip('A', [{ kind: 'rotate', path: 'arm', keys: [key(0, 1)] }]))
    const b = createTrack(clip('B', [{ kind: 'rotate', path: 'arm', keys: [key(0, 0)] }]))
    // Spine 风格：replace track 依次在偏移空间覆盖，后写入者按 alpha 混入。
    a.alpha = 1
    b.alpha = 0
    sampleAnimation([a, b], pose, slotSetArg(), 0)
    expect(getLocal(pose, 1, CH_ROT)).toBeCloseTo(1, 6)

    a.alpha = 1
    b.alpha = 0.5
    sampleAnimation([a, b], pose, slotSetArg(), 0)
    expect(getLocal(pose, 1, CH_ROT)).toBeCloseTo(0.5, 6)

    a.alpha = 0
    b.alpha = 1
    sampleAnimation([a, b], pose, slotSetArg(), 0)
    expect(getLocal(pose, 1, CH_ROT)).toBeCloseTo(0, 6)
  })

  it('additive track 叠加偏移且不改变 setup 基线', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const base = createTrack(clip('base', [{ kind: 'rotate', path: 'arm', keys: [key(0, 1)] }]))
    const add = createTrack(clip('add', [{ kind: 'rotate', path: 'arm', keys: [key(0, 0.5)] }]), {
      blendMode: 'additive', alpha: 1,
    })
    sampleAnimation([base, add], pose, slotSetArg(), 0)
    expect(getLocal(pose, 1, CH_ROT)).toBeCloseTo(1.5, 6)
  })

  it('driven/dominant 为最后写入的 replace track', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const a = createTrack(clip('A', [{ kind: 'attachment', path: '0', keys: [key(0, 1)] }]), { alpha: 0.9 })
    const b = createTrack(clip('B', [{ kind: 'attachment', path: '0', keys: [key(0, 2)] }]), { alpha: 0.2 })
    const c = createTrack(clip('C', [{ kind: 'attachment', path: '0', keys: [key(0, 3)] }]), {
      blendMode: 'additive',
    })
    const r = sampleAnimation([a, b, c], pose, slotSetArg(), 0)
    expect(r.dominant).toBe('B')
  })
})
