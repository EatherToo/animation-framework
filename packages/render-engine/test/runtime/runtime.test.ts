/**
 * M7 运行时与插件宿主单测（TDD 先行）。
 * 覆盖：生命周期状态机、插件顺序/隔离/版本拒绝/逆序 dispose、后端自动回退、
 * 错误码、更新顺序、draw 调用与 packet 排序、1000 帧无状态数组增长。
 */
import { describe, expect, it } from '@jest/globals'
import {
  Engine,
  PluginHost,
  ERROR_CODES,
  type EngineConfig,
  type EnginePhase,
  type EnginePlugin,
  type PluginContext,
} from '@/runtime/runtime'
import { importSpine } from '@/asset/importer'
import { CH_ROT } from '@/core/math'
import type { RenderBackend, Viewport } from '@/backend/backend'
import type { RenderFrame } from '@/render/render'

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------

/** 最小 Spine 4.2 fixture：两根骨、两个 region 附件、一条旋转动画。 */
function spineJson(): Record<string, unknown> {
  return {
    skeleton: { spine: '4.2.0', width: 100, height: 100 },
    bones: [
      { name: 'root' },
      { name: 'body', parent: 'root', x: 0, y: -10, rotation: 0, length: 10 },
    ],
    slots: [
      { name: 'slotA', bone: 'body', attachment: 'a', color: 'ffffffff' },
      { name: 'slotB', bone: 'body', attachment: 'b', color: 'ffffffff', blend: 'additive' },
    ],
    skins: [{
      name: 'default',
      attachments: {
        slotA: { a: { type: 'region', path: 'a' } },
        slotB: { b: { type: 'region', path: 'b' } },
      },
    }],
    atlas: ['a', 'b'],
    animations: {
      spin: { bones: { body: { rotate: [{ time: 0, angle: 0 }, { time: 0.5, angle: 90 }] } } },
    },
  }
}

function makeAsset() {
  return importSpine(spineJson(), { unitScale: 0.01 })
}

/** 可观测的 RenderBackend mock；只记录 draw 调用，不做真实光栅化。 */
type MockBackend = RenderBackend & {
  readonly draws: RenderFrame[]
  readonly kinds: Array<'cpu' | 'webgl2'>
  disposed: boolean
}

function mockBackend(kind: 'cpu' | 'webgl2'): MockBackend {
  return {
    kind,
    draws: [],
    kinds: [],
    disposed: false,
    draw(frame: RenderFrame): void { this.draws.push(frame) },
    readPixels(): Uint8ClampedArray { return new Uint8ClampedArray(16) },
    resize(_v: Viewport): void { /* mock：无需真实尺寸 */ },
    dispose(): void { this.disposed = true },
  }
}

function newEngine(
  config: EngineConfig = { backend: 'cpu' },
  factory: (kind: 'cpu' | 'webgl2') => RenderBackend = (kind) => mockBackend(kind),
): Engine {
  return new Engine(config, { backendFactory: factory })
}

function dummyCtx(stats: Record<string, number> = { pluginErrors: 0 }): PluginContext {
  return { engine: {} as Engine, phase: 'created', stats }
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

describe('M7 · Engine 生命周期状态机', () => {
  it('created → loading(setup 可见) → ready → running ⇄ paused → disposed，dispose 幂等', () => {
    const backend = mockBackend('cpu')
    const engine = new Engine({ backend: 'cpu' }, { backendFactory: () => backend })
    expect(engine.phase).toBe('created')

    const seen: EnginePhase[] = []
    engine.usePlugin({
      id: 'phase.watcher',
      apiVersion: 1,
      setup(ctx) { seen.push(ctx.phase) },
    })
    engine.load(makeAsset())
    expect(engine.phase).toBe('ready')
    expect(seen).toEqual(['loading'])

    engine.play()
    expect(engine.phase).toBe('running')
    expect(() => engine.update(1 / 60)).not.toThrow()
    expect(() => engine.render()).not.toThrow()

    engine.pause()
    expect(engine.phase).toBe('paused')
    expect(() => engine.update(1 / 60)).not.toThrow() // 暂停不推进 dt
    expect(() => engine.render()).not.toThrow()       // 暂停仍可渲染最后一帧

    engine.dispose()
    expect(engine.phase).toBe('disposed')
    expect(backend.disposed).toBe(true)
    expect(() => engine.dispose()).not.toThrow()
  })

  it('ERROR_CODES 固定 6 类且顺序稳定', () => {
    expect(ERROR_CODES).toEqual([
      'E_DISPOSED', 'E_NO_ASSET', 'E_BACKEND', 'E_PLUGIN_API', 'E_CONFIG', 'E_STATE',
    ])
  })
})

// ---------------------------------------------------------------------------
// 插件宿主
// ---------------------------------------------------------------------------

describe('M7 · PluginHost', () => {
  it('hook 按 (order, 注册序) 升序；dispose 逆序', () => {
    const log: string[] = []
    const make = (id: string, order?: number): EnginePlugin => ({
      id,
      apiVersion: 1,
      ...(order === undefined ? {} : { order }),
      beforeUpdate() { log.push(`before:${id}`) },
      afterUpdate() { log.push(`after:${id}`) },
      afterRender() { log.push(`render:${id}`) },
      dispose() { log.push(`dispose:${id}`) },
    })
    const host = new PluginHost(
      [make('late', 10), make('first', -2), make('zero'), make('late2', 10)],
      dummyCtx(),
    )
    host.setup()
    expect(host.order).toEqual(['first', 'zero', 'late', 'late2'])

    host.beforeUpdate(0.016)
    host.afterUpdate(0.016)
    host.afterRender({ packets: [], width: 1, height: 1 })
    expect(log).toEqual([
      'before:first', 'before:zero', 'before:late', 'before:late2',
      'after:first', 'after:zero', 'after:late', 'after:late2',
      'render:first', 'render:zero', 'render:late', 'render:late2',
    ])

    host.dispose()
    expect(log.filter((x) => x.startsWith('dispose:'))).toEqual([
      'dispose:late2', 'dispose:late', 'dispose:zero', 'dispose:first',
    ])
    // dispose 后 hook 不再触发。
    const after = log.length
    host.beforeUpdate(0.016)
    expect(log.length).toBe(after)
  })

  it('插件抛错被隔离并计入 stats.pluginErrors；apiVersion≠1 在 setup 被拒绝', () => {
    const stats = { pluginErrors: 0 }
    let captured: PluginContext | undefined
    let wrongCalls = 0
    let goodCalls = 0
    const bad: EnginePlugin = {
      id: 'bad', apiVersion: 1,
      beforeUpdate() { throw new Error('boom') },
      afterRender() { throw new Error('boom') },
    }
    const wrong = {
      id: 'wrong', apiVersion: 2,
      beforeUpdate() { wrongCalls += 1 },
    } as unknown as EnginePlugin
    const good: EnginePlugin = {
      id: 'good', apiVersion: 1,
      setup(ctx) { captured = ctx },
      beforeUpdate() { goodCalls += 1 },
    }
    const host = new PluginHost([bad, wrong, good], dummyCtx(stats))
    host.setup()
    expect(host.order).not.toContain('wrong')
    expect(stats.pluginErrors).toBe(1) // 版本拒绝
    expect(captured).toBeDefined()

    host.beforeUpdate(0.016)
    host.afterUpdate(0.016)
    host.afterRender({ packets: [], width: 1, height: 1 })
    expect(stats.pluginErrors).toBe(3) // bad 的 beforeUpdate + afterRender
    expect(wrongCalls).toBe(0)
    expect(goodCalls).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 后端选择与错误
// ---------------------------------------------------------------------------

describe('M7 · 后端与错误码', () => {
  it('auto 先试 webgl2 失败后回退 cpu；显式 webgl2 失败抛 E_BACKEND；非法配置抛 E_CONFIG', () => {
    const requested: Array<'cpu' | 'webgl2'> = []
    const factory = (kind: 'cpu' | 'webgl2'): RenderBackend => {
      requested.push(kind)
      if (kind === 'webgl2') throw new Error('no gl')
      return mockBackend('cpu')
    }
    const engine = new Engine({ backend: 'auto' }, { backendFactory: factory })
    expect(requested).toEqual(['webgl2', 'cpu'])
    expect(engine.phase).toBe('created')

    expect(() => new Engine({ backend: 'webgl2' }, { backendFactory: factory })).toThrow('E_BACKEND')
    expect(() => new Engine({ backend: 'bad' as never })).toThrow('E_CONFIG')
    expect(() => new Engine({ pixelRatio: 0 })).toThrow('E_CONFIG')
  })

  it('无资产时 update/render 抛 E_NO_ASSET；dispose 后公开 API 抛 E_DISPOSED（phase 除外）', () => {
    const engine = newEngine()
    expect(() => engine.update(0.016)).toThrow('E_NO_ASSET')
    expect(() => engine.render()).toThrow('E_NO_ASSET')

    engine.dispose()
    expect(engine.phase).toBe('disposed')
    expect(() => engine.load(makeAsset())).toThrow('E_DISPOSED')
    expect(() => engine.usePlugin({ id: 'x', apiVersion: 1 })).toThrow('E_DISPOSED')
    expect(() => engine.play()).toThrow('E_DISPOSED')
    expect(() => engine.pause()).toThrow('E_DISPOSED')
    expect(() => engine.update(0)).toThrow('E_DISPOSED')
    expect(() => engine.render()).toThrow('E_DISPOSED')
    expect(() => engine.readPixels()).toThrow('E_DISPOSED')
    expect(() => engine.pose).toThrow('E_DISPOSED')
    expect(() => engine.slotSet).toThrow('E_DISPOSED')
    expect(() => engine.tracks).toThrow('E_DISPOSED')
  })

  it('usePlugin 仅在 created/ready/running 可用，其余阶段抛 E_STATE', () => {
    const engine = newEngine()
    engine.load(makeAsset())
    engine.play()
    engine.pause()
    expect(() => engine.usePlugin({ id: 'late', apiVersion: 1 })).toThrow('E_STATE')
  })
})

// ---------------------------------------------------------------------------
// 帧顺序 / 内存
// ---------------------------------------------------------------------------

describe('M7 · 一帧流程', () => {
  it('update 顺序：beforeUpdate → sample → updateWorld → afterUpdate（约束缺省则跳过）', () => {
    const engine = newEngine()
    engine.load(makeAsset())
    engine.play()

    const pose = engine.pose
    const body = pose.skeleton.boneIdByName.get('body')!
    const log: string[] = []
    let version = pose.version
    let worldValid = pose.worldValid
    Object.defineProperty(pose, 'version', {
      configurable: true,
      get: () => version,
      set: (v: number) => { if (v !== version) log.push('sample'); version = v },
    })
    Object.defineProperty(pose, 'worldValid', {
      configurable: true,
      get: () => worldValid,
      set: (v: boolean) => { if (v && !worldValid) log.push('updateWorld'); worldValid = v },
    })
    engine.usePlugin({
      id: 'order', apiVersion: 1,
      beforeUpdate() { log.push('beforeUpdate') },
      afterUpdate() { log.push('afterUpdate') },
    })

    engine.update(0.25)
    expect(log).toEqual(['beforeUpdate', 'sample', 'updateWorld', 'afterUpdate'])
    // 采样确实写入了 body 的旋转通道，且世界矩阵已随之刷新。
    expect(Math.abs(pose.local[body * 7 + CH_ROT]!)).toBeGreaterThan(0)
    expect(pose.dirtyCount).toBe(0)
  })

  it('render：backend.draw 调用一次，frame.packets 已排序且 afterRender 收到同一帧', () => {
    const backend = mockBackend('cpu')
    const engine = new Engine({ backend: 'cpu' }, { backendFactory: () => backend })
    engine.load(makeAsset())
    engine.play()
    engine.update(1 / 60)

    let hookFrame: RenderFrame | undefined
    engine.usePlugin({
      id: 'observer', apiVersion: 1,
      afterRender(_ctx, frame) { hookFrame = frame },
    })
    const frame = engine.render()
    expect(backend.draws).toHaveLength(1)
    expect(backend.draws[0]).toBe(frame)
    expect(hookFrame).toBe(frame)
    expect(frame.packets.length).toBeGreaterThan(0)
    const orders = frame.packets.map((p) => p.order)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
    expect(frame.width).toBeGreaterThan(0)
    expect(frame.height).toBeGreaterThan(0)
  })

  it('1000 次 update+render 不增长任何内部状态数组', () => {
    const engine = newEngine()
    engine.load(makeAsset())
    engine.play()
    const tracksLen = engine.tracks.length
    const localLen = engine.pose.local.length
    const worldLen = engine.pose.world.length
    const slotsLen = engine.slotSet.slots.length
    const orderLen = engine.slotSet.drawOrder.length

    let packetCount = -1
    for (let i = 0; i < 1000; i += 1) {
      engine.update(1 / 60)
      const frame = engine.render()
      if (i === 0) packetCount = frame.packets.length
      expect(frame.packets.length).toBe(packetCount)
    }
    expect(engine.tracks.length).toBe(tracksLen)
    expect(engine.pose.local.length).toBe(localLen)
    expect(engine.pose.world.length).toBe(worldLen)
    expect(engine.slotSet.slots.length).toBe(slotsLen)
    expect(engine.slotSet.drawOrder.length).toBe(orderLen)
  })
})
