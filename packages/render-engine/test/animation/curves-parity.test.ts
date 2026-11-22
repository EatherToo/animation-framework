/**
 * 22-Spine 对标：曲线编码、颜色通道、deform/drawOrder/sequence、约束 mix 与 crossfade。
 * 对应 docs/22-Spine渲染对标/curves-and-timelines.md 的验收清单。
 */
import { afterEach, describe, expect, it } from '@jest/globals'
import { compileSkeleton, type BoneSpec } from '@/core/skeleton'
import { CH_ROT, createPose, getLocal } from '@/core/pose'
import { createSlotSet, type SlotData } from '@/slot/slot'
import {
  AnimationState,
  createTrack,
  sampleAnimation,
  sampleAngle,
  sampleScalar,
  setCurveDiagnosticSink,
  type AnimationClip,
  type ColorKey,
  type CurveDiagnostic,
  type ScalarKey,
  type Timeline,
} from '@/animation/animation'

const TAU = Math.PI * 2
const DEG = Math.PI / 180

function skeleton(bones: BoneSpec[] = [{ name: 'root', parent: -1, length: 1 }]) {
  return compileSkeleton({ name: 'curves', profile: 'simple2d', bones })
}

function makeSlots(count: number) {
  const data: SlotData[] = Array.from({ length: count }, (_, i) => ({
    id: `slot${i}`,
    bone: 0,
    order: i,
    color: { r: 1, g: 1, b: 1, a: 1 },
    blend: 'normal' as const,
    attachment: null,
    mask: null,
    zOffset: 0,
  }))
  return createSlotSet(data, new Map([['default', { id: 'default', attachments: new Map() }]]), 'default')
}

function clip(name: string, timelines: readonly Timeline[], duration = 1): AnimationClip {
  return { name, duration, timelines }
}

function scalar(time: number, value: number, curve?: ScalarKey['curve']): ScalarKey {
  return { time, value, ...(curve === undefined ? {} : { curve }) }
}

/** 独立参考解：单段 Bezier 按 x 二分反解后取 y。 */
function refBezierY(t: number, c1x: number, c1y: number, c2x: number, c2y: number): number {
  const bx = (u: number) => 3 * (1 - u) ** 2 * u * c1x + 3 * (1 - u) * u ** 2 * c2x + u ** 3
  let lo = 0
  let hi = 1
  let u = t
  for (let i = 0; i < 80; i += 1) {
    const x = bx(u)
    if (Math.abs(x - t) < 1e-13) break
    if (x < t) lo = u
    else hi = u
    u = (lo + hi) / 2
  }
  return 3 * (1 - u) ** 2 * u * c1y + 3 * (1 - u) * u ** 2 * c2y + u ** 3
}

const diagnostics: CurveDiagnostic[] = []
afterEach(() => {
  setCurveDiagnosticSink(null)
  diagnostics.length = 0
})

describe('Curve：多段 Bezier / stepped / 非法降级', () => {
  it('多段 Bezier 第 2 段使用第 2 组控制点', () => {
    const identity: readonly number[] = [1 / 3, 1 / 3, 2 / 3, 2 / 3]
    const second: readonly number[] = [0.2, 0.9, 0.8, 0.9]
    const curve: readonly number[] = [...identity, ...second]
    const keys: ScalarKey[] = [{ time: 0, value: 0, curve }, { time: 1, value: 1 }]

    // 前半段是恒等曲线。
    expect(sampleScalar(keys, 0.25)).toBeCloseTo(0.25, 5)
    // 后半段 t=0.75 → 段内 0.5，使用第二组控制点。
    const local = refBezierY(0.5, 0.2, 0.9, 0.8, 0.9)
    expect(sampleScalar(keys, 0.75)).toBeCloseTo((1 + local) / 2, 5)
    // 与单一恒等曲线明显不同，证明确实换了控制点。
    expect(Math.abs(sampleScalar(keys, 0.75) - 0.75)).toBeGreaterThan(0.02)
  })

  it('{ bezier } 对象编码与 stepped 保持语义', () => {
    const objKeys: ScalarKey[] = [
      { time: 0, value: 0, curve: { bezier: [1 / 3, 1 / 3, 2 / 3, 2 / 3] } },
      { time: 1, value: 1 },
    ]
    expect(sampleScalar(objKeys, 0.5)).toBeCloseTo(0.5, 4)

    const stepped: ScalarKey[] = [scalar(0, 2, 'stepped'), scalar(0.5, 8), scalar(1, 9)]
    expect(sampleScalar(stepped, 0.49)).toBe(2)
    expect(sampleScalar(stepped, 0.5)).toBe(8)
  })

  it('x 非单调的 Bezier 降级为 linear 并发出 W_CURVE 诊断', () => {
    setCurveDiagnosticSink((d) => diagnostics.push(d))
    const bad: readonly number[] = [0.8, 0.1, 0.2, 0.9]
    const keys: ScalarKey[] = [{ time: 0, value: 0, curve: bad }, { time: 1, value: 10 }]
    expect(sampleScalar(keys, 0.5)).toBeCloseTo(5, 6)
    expect(diagnostics.some((d) => d.code === 'W_CURVE')).toBe(true)
  })
})

describe('角度：连续采样与多圈', () => {
  it('0 → 720° 采样保持两圈，不折返', () => {
    const keys = [scalar(0, 0), scalar(1, 4 * Math.PI)]
    expect(sampleAngle(keys, 0.25)).toBeCloseTo(Math.PI, 6)
    expect(sampleAngle(keys, 0.5)).toBeCloseTo(TAU, 6)
    expect(sampleAngle(keys, 0.75)).toBeCloseTo(3 * Math.PI, 6)
    expect(sampleAngle(keys, 1)).toBeCloseTo(4 * Math.PI, 6)
    expect(sampleAngle(keys, 2)).toBeCloseTo(4 * Math.PI, 6)
  })

  it('350° → 10° 走最短弧，rotate timeline 写连续角', () => {
    const keys = [scalar(0, 350 * DEG), scalar(1, 10 * DEG)]
    expect(sampleAngle(keys, 0.5)).toBeCloseTo(360 * DEG, 5)

    const sk = skeleton([{ name: 'root', parent: -1, length: 1 }])
    const pose = createPose(sk)
    const c = clip('spin', [{ kind: 'rotate', path: 'root', keys }])
    sampleAnimation([createTrack(c, { loop: false })], pose, makeSlots(1), 0.5)
    expect(getLocal(pose, 0, CH_ROT)).toBeCloseTo(TAU, 5)
  })
})

describe('颜色：六个通道只改目标通道', () => {
  it('rgb / alpha / rgba / rgb2 / alpha2 / rgba2', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const slots = makeSlots(4)
    const light = (r: number, g: number, b: number, a: number): ColorKey => ({
      time: 0, light: { r, g, b, a },
    })
    const c = clip('color-channels', [
      { kind: 'color', slot: 0, channel: 'rgb', keys: [light(1, 0, 0, 0.1)] },
      { kind: 'color', slot: 1, channel: 'alpha', keys: [light(0, 0, 0, 0.5)] },
      { kind: 'color', slot: 2, channel: 'rgba', keys: [light(0, 0, 1, 0.25)] },
      {
        kind: 'color', slot: 3, channel: 'rgb2',
        keys: [{ time: 0, light: { r: 1, g: 1, b: 1, a: 1 }, dark: { r: 1, g: 1, b: 0, a: 1 } }],
      },
      {
        kind: 'color', slot: 3, channel: 'alpha2',
        keys: [{ time: 0, light: { r: 1, g: 1, b: 1, a: 1 }, dark: { r: 1, g: 1, b: 1, a: 0.25 } }],
      },
    ])
    const result = sampleAnimation([createTrack(c, { loop: false })], pose, slots, 1 / 60)

    expect(slots.slots[0]!.color).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    expect(slots.slots[1]!.color).toEqual({ r: 1, g: 1, b: 1, a: 0.5 })
    expect(slots.slots[2]!.color.r).toBe(0)
    expect(slots.slots[2]!.color.g).toBe(0)
    expect(slots.slots[2]!.color.b).toBe(1)
    expect(slots.slots[2]!.color.a).toBe(0.25)
    // rgb2/alpha2 只改 dark，不污染 light。
    expect(slots.slots[3]!.color).toEqual({ r: 1, g: 1, b: 1, a: 1 })
    expect(result.colorDark.get(3)).toEqual({ r: 1, g: 1, b: 0, a: 0.25 })
  })

  it('颜色按 curve 插值且只混合目标通道', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const slots = makeSlots(1)
    const c = clip('color-lerp', [
      {
        kind: 'color', slot: 0, channel: 'alpha',
        keys: [
          { time: 0, light: { r: 0, g: 0, b: 0, a: 0 } },
          { time: 1, light: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      },
    ])
    sampleAnimation([createTrack(c, { loop: false })], pose, slots, 0.5)
    expect(slots.slots[0]!.color.a).toBeCloseTo(0.5, 6)
    expect(slots.slots[0]!.color.r).toBe(1)
  })
})

describe('deform：offset 与多 track 叠加', () => {
  it('offset 为起始顶点索引，段外保持 0（bind）', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const c = clip('deform-offset', [
      {
        kind: 'deform', skin: 'default', slot: 0, attachment: 'mesh',
        keys: [
          { time: 0, offset: 2, vertices: new Float32Array([10, 20]) },
          { time: 1, offset: 2, vertices: new Float32Array([30, 40]) },
        ],
      },
    ])
    const result = sampleAnimation([createTrack(c, { loop: false })], pose, makeSlots(1), 0)
    const offsets = result.deformOffsets.get('default:0:mesh')!
    expect(offsets).toBeInstanceOf(Float32Array)
    expect(offsets.length).toBe(2 * 2 + 2)
    expect(Array.from(offsets.slice(0, 4))).toEqual([0, 0, 0, 0])
    expect(Array.from(offsets.slice(4))).toEqual([10, 20])
  })

  it('多 track 按 alpha 叠加，绝对偏移不随帧累加', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const a = clip('A', [{
      kind: 'deform', slot: 0, attachment: 'mesh',
      keys: [{ time: 0, offset: 0, vertices: new Float32Array([10]) }],
    }])
    const b = clip('B', [{
      kind: 'deform', slot: 0, attachment: 'mesh',
      keys: [{ time: 0, offset: 0, vertices: new Float32Array([4]) }],
    }])
    const trackA = createTrack(a, { loop: false })
    trackA.alpha = 0.5
    const result = sampleAnimation([trackA, createTrack(b, { loop: false })], pose, makeSlots(1), 0)
    expect(result.deformOffsets.get('default:0:mesh')![0]).toBeCloseTo(9, 6)

    // scrub 幂等：再采样一次结果相同（不是在上次结果上累加）。
    const again = sampleAnimation([trackA, createTrack(b, { loop: false })], pose, makeSlots(1), 0)
    expect(again.deformOffsets.get('default:0:mesh')![0]).toBeCloseTo(9, 6)
  })
})

describe('drawOrder：offset 列表 → 全排列且循环稳定', () => {
  const c = clip('draworder-loop', [
    {
      kind: 'drawOrder',
      keys: [
        { time: 0, offsets: [] },
        { time: 0.5, offsets: [{ slot: 0, offset: 2 }] },
        { time: 1, offsets: [{ slot: 3, offset: -3 }] },
      ],
    },
  ], 1)

  function isPermutation(order: readonly number[], n: number): boolean {
    return order.length === n && [...order].sort((x, y) => x - y).every((v, i) => v === i)
  }

  it('按 setup 顺序移动 slot，结果为全排列', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const slots = makeSlots(4)
    const track = createTrack(c, { loop: false })
    const r0 = sampleAnimation([track], pose, slots, 0)
    expect(r0.drawOrder).toEqual([0, 1, 2, 3])

    sampleAnimation([track], pose, slots, 0.5)
    expect(slots.drawOrder).toEqual([1, 2, 0, 3])

    sampleAnimation([track], pose, slots, 0.5)
    expect(slots.drawOrder).toEqual([3, 0, 1, 2])
    expect(isPermutation(slots.drawOrder, 4)).toBe(true)
  })

  it('循环多圈不漂移：每次从 setup 顺序重建', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const slots = makeSlots(4)
    const track = createTrack(c)
    for (let frame = 0; frame < 14; frame += 1) {
      const r = sampleAnimation([track], pose, slots, 0.125)
      expect(isPermutation(r.drawOrder!, 4)).toBe(true)
    }
    expect(slots.drawOrder).toEqual([1, 2, 0, 3])
  })
})

describe('event：载荷与 (prev, curr] 边界', () => {
  it('int/float/string 载荷随事件派发，循环边界不重复同帧', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const c = clip('event-loop', [{
      kind: 'event',
      keys: [
        { time: 0, name: 'start', int: 1, float: 0.5, string: 'go' },
        { time: 0.5, name: 'hit' },
      ],
    }], 1)
    const track = createTrack(c)
    const first = sampleAnimation([track], pose, makeSlots(1), 0.6)
    expect(first.events).toEqual(['start', 'hit'])
    const start = first.eventData.find((e) => e.name === 'start')!
    expect(start.int).toBe(1)
    expect(start.float).toBe(0.5)
    expect(start.string).toBe('go')

    // 同一帧再次 dt=0 不重复。
    expect(sampleAnimation([track], pose, makeSlots(1), 0).events).toEqual([])

    // 越过尾段回到头段：尾段事件 + 0 点事件各一次。
    const wrapped = sampleAnimation([track], pose, makeSlots(1), 1.0)
    expect(wrapped.events.filter((e) => e === 'hit')).toHaveLength(1)
    expect(wrapped.events.filter((e) => e === 'start')).toHaveLength(1)
  })

  it('非循环最后一帧事件按 (prev, duration] 触发', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const c = clip('event-end', [{
      kind: 'event', keys: [{ time: 1, name: 'end' }],
    }], 1)
    const track = createTrack(c, { loop: false })
    expect(sampleAnimation([track], pose, makeSlots(1), 0.5).events).toEqual([])
    expect(sampleAnimation([track], pose, makeSlots(1), 0.6).events).toEqual(['end'])
    expect(sampleAnimation([track], pose, makeSlots(1), 0.6).events).toEqual([])
  })
})

describe('AnimationState：PlayOptions 与 crossfade', () => {
  const sk = skeleton()
  const clipA: AnimationClip = {
    name: 'A', duration: 1,
    timelines: [
      { kind: 'rotate', path: 'root', keys: [scalar(0, 0), scalar(1, 1)] },
      { kind: 'event', keys: [{ time: 0.5, name: 'tick' }] },
    ],
  }
  const clipB: AnimationClip = {
    name: 'B', duration: 1,
    timelines: [{ kind: 'rotate', path: 'root', keys: [scalar(0, 2), scalar(1, 2)] }],
  }

  it('mixDuration 中点 alpha = 0.5，并按 alpha 混合到 pose', () => {
    const pose = createPose(sk)
    const state = new AnimationState(new Map([['A', clipA], ['B', clipB]]), pose, makeSlots(1))
    state.play('A', { loop: false, blendMode: 'replace', track: 0, speed: 1 })
    state.update(0)
    const b = state.play('B', { loop: false, mixDuration: 1, alpha: 1 })
    expect(b.alpha).toBe(0)
    state.update(0.5)
    expect(b.alpha).toBeCloseTo(0.5, 6)
    expect(getLocal(pose, 0, CH_ROT)).toBeCloseTo(1, 6)
    state.update(0.5)
    expect(b.alpha).toBeCloseTo(1, 6)
  })

  it('delay 结束前不推进时间；queue 在非循环结束后接续', () => {
    const pose = createPose(sk)
    const state = new AnimationState(new Map([['A', clipA], ['B', clipB]]), pose, makeSlots(1))
    const t = state.play('A', { loop: false, delay: 0.5 })
    state.update(0.25)
    expect(t.time).toBe(0)
    state.update(0.25)
    expect(t.time).toBe(0)

    state.queue('B', { loop: false })
    state.update(0.5)
    expect(t.time).toBeCloseTo(0.5, 6)
    state.update(0.5)
    expect(t.clip.name).toBe('B')
    expect(state.tracks[0]!.clip.name).toBe('B')
  })

  it('事件监听器异常被隔离，complete 在同一帧末派发', () => {
    const pose = createPose(sk)
    const state = new AnimationState(new Map([['A', clipA]]), pose, makeSlots(1))
    const names: string[] = []
    state.addListener('complete', (e) => names.push(e.type))
    state.addListener('event', () => { throw new Error('listener boom') })
    state.play('A', { loop: false })
    expect(() => state.update(1.5)).not.toThrow()
    expect(names).toContain('complete')
  })
})

describe('sequence 与约束 mix', () => {
  it('sequence 采样离散帧索引', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const c = clip('sequence', [{
      kind: 'sequence', slot: 0, attachment: 'anim',
      keys: [scalar(0, 0), scalar(0.3, 1), scalar(0.6, 2)],
    }], 1)
    const first = createTrack(c, { loop: false })
    expect(sampleAnimation([first], pose, makeSlots(1), 0.2).sequence.get(0)).toBe(0)
    expect(sampleAnimation([first], pose, makeSlots(1), 0.3).sequence.get(0)).toBe(1)
    expect(sampleAnimation([first], pose, makeSlots(1), 0.2).sequence.get(0)).toBe(2)
  })

  it('ik/transform/path/physics 输出 constraintMix，legacy ik 仍写 ik', () => {
    const sk = skeleton()
    const pose = createPose(sk)
    const c = clip('mix', [
      { kind: 'ik', constraint: 'armIk', keys: [scalar(0, 0, 'stepped'), scalar(1, 1)] },
      { kind: 'transform', constraint: '2', keys: [scalar(0, 0.2)] },
      { kind: 'path', constraint: 'pathA', keys: [scalar(0, 0.6)] },
      { kind: 'physics', constraint: 'hair', keys: [scalar(0, 1)] },
      { kind: 'ik', path: '7', keys: [scalar(0, 0.4)] },
    ])
    const result = sampleAnimation([createTrack(c, { loop: false })], pose, makeSlots(1), 0)
    expect(result.constraintMixByName.get('armIk')).toBe(0)
    expect(result.constraintMix.get(2)).toBeCloseTo(0.2, 6)
    expect(result.constraintMixByName.get('pathA')).toBeCloseTo(0.6, 6)
    expect(result.constraintMixByName.get('hair')).toBe(1)
    expect(result.ik.get(7)).toBeCloseTo(0.4, 6)
  })
})
