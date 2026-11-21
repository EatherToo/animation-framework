import type { HumanoidAtlas } from './humanoidAtlas'
import type { RenderPacket, RGBA } from './types'

/** 后端种类。GPU 后端是 WebGL2，CPU 是参考实现。 */
export type BackendKind = 'cpu' | 'webgl2' | 'canvas2d'

/** 后端每帧统计；用于性能预算与测试。 */
export type BackendStats = {
  readonly drawCalls: number
  readonly vertices: number
  readonly textureBinds: number
  readonly frameMs: number
}

/** mask id → 逐像素 alpha（0–255）。 */
export type MaskSet = ReadonlyMap<string, Uint8Array>

/**
 * 2D 渲染后端契约。模型/求值层只产出 RenderPacket；后端只读包。
 */
export interface RenderBackend {
  readonly kind: BackendKind
  readonly stats: BackendStats
  resize(width: number, height: number, dpr: number): void
  beginFrame(clear: RGBA): void
  drawPackets(
    packets: readonly RenderPacket[],
    atlas: HumanoidAtlas,
    masks: MaskSet,
    frame: { scale: number; originX: number; originY: number },
  ): void
  endFrame(): void
  dispose(): void
}
