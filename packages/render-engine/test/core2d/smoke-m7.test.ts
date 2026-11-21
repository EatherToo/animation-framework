/**
 * M7 应用视角冒烟：importSpine 最小 fixture → Engine → 60 帧 update+render。
 * 校验 CPU 后端出图非空、暂停后时间不推进、dispose 后调用抛 E_DISPOSED。
 */
import { describe, expect, it } from '@jest/globals'
import { Engine } from '@/core2d/runtime'
import { importSpine } from '@/core2d/importer'

/** 最小 Spine 4.2 fixture：带一个可见的白色 region 附件与一条旋转动画。 */
function fixture(): Record<string, unknown> {
  return {
    skeleton: { spine: '4.2.0', width: 100, height: 100 },
    bones: [
      { name: 'root' },
      { name: 'body', parent: 'root', x: 0, y: -10, rotation: 0, length: 10 },
    ],
    slots: [
      { name: 'bodySlot', bone: 'body', attachment: 'body', color: 'ffffffff' },
    ],
    skins: [{
      name: 'default',
      attachments: {
        bodySlot: { body: { type: 'region', path: 'body', color: 'ffffffff' } },
      },
    }],
    atlas: ['body'],
    animations: {
      idle: {
        bones: {
          body: { rotate: [{ time: 0, angle: 0 }, { time: 0.5, angle: 30 }, { time: 1, angle: 0 }] },
        },
      },
    },
  }
}

describe('M7 冒烟 · Engine 应用视角', () => {
  it('载入 → play → 60 帧出图非空 → pause 时间静止 → dispose 后抛错', () => {
    // 默认 auto：Node 无 WebGL2 上下文，应回退 CPU 后端。
    const engine = new Engine()
    expect(engine.phase).toBe('created')
    engine.load(importSpine(fixture(), { unitScale: 0.01 }))
    expect(engine.phase).toBe('ready')
    engine.play()
    expect(engine.phase).toBe('running')

    for (let i = 0; i < 60; i += 1) {
      engine.update(1 / 60)
      const frame = engine.render()
      expect(frame.packets.length).toBeGreaterThan(0)
    }

    // CPU 后端：白色四边形应落在画面内，至少有一个非背景（r/g/b > 0）像素。
    const pixels = engine.readPixels()
    expect(pixels.length).toBeGreaterThan(0)
    let painted = false
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i]! > 0 || pixels[i + 1]! > 0 || pixels[i + 2]! > 0) {
        painted = true
        break
      }
    }
    expect(painted).toBe(true)

    // 暂停后时间不再推进，但仍可渲染最后一帧。
    engine.pause()
    expect(engine.phase).toBe('paused')
    const frozen = engine.tracks[0]!.time
    for (let i = 0; i < 20; i += 1) {
      engine.update(1 / 60)
      engine.render()
    }
    expect(engine.tracks[0]!.time).toBe(frozen)

    engine.dispose()
    expect(engine.phase).toBe('disposed')
    expect(() => engine.update(1 / 60)).toThrow('E_DISPOSED')
    expect(() => engine.render()).toThrow('E_DISPOSED')
    expect(() => engine.readPixels()).toThrow('E_DISPOSED')
    expect(() => engine.play()).toThrow('E_DISPOSED')
  })
})
