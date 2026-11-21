import type { ProjectedPart } from '../view/project'
import { HUMANOID_FILL, type HumanoidPartId } from '../part/humanoid'
import { sortRenderPackets } from './packet'
import type { RenderPacket, RGBA } from './types'

/**
 * 把 3D 代理的投影部件转成最小渲染单元（三角形）渲染包。
 * 位置已是屏幕米；深度按部件平均排序，保留 360° 体积与遮挡关系。
 * @param parts 投影后的部件
 */
export function buildVolumetricPackets(parts: readonly ProjectedPart[]): RenderPacket[] {
  const packets: RenderPacket[] = []
  for (const part of parts) {
    const fill = HUMANOID_FILL[part.partId as HumanoidPartId] ?? { r: 0.7, g: 0.7, b: 0.7 }
    const color: RGBA = { r: fill.r, g: fill.g, b: fill.b, a: 1 }
    const count = part.positions.length / 2
    if (count === 0) continue
    const colors = new Uint8Array(count * 4)
    const depth = new Float32Array(count)
    for (let v = 0; v < count; v += 1) {
      colors[v * 4] = Math.round(color.r * 255)
      colors[v * 4 + 1] = Math.round(color.g * 255)
      colors[v * 4 + 2] = Math.round(color.b * 255)
      colors[v * 4 + 3] = 255
      depth[v] = part.depths?.[v] ?? part.depth
    }
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (let v = 0; v < count; v += 1) {
      minX = Math.min(minX, part.positions[v * 2]!)
      maxX = Math.max(maxX, part.positions[v * 2]!)
      minY = Math.min(minY, part.positions[v * 2 + 1]!)
      maxY = Math.max(maxY, part.positions[v * 2 + 1]!)
    }
    packets.push({
      version: 2,
      partId: part.partId,
      vertices: part.positions,
      uvs: new Float32Array(count * 2),
      indices: part.indices,
      colors,
      seam: part.seam,
      outline: {
        widthPx: 1.5,
        color: { r: 0.08, g: 0.08, b: 0.08, a: 1 },
        join: 'round',
        cap: 'round',
        depthBias: 0,
      },
      atlasPage: -1,
      atlasKey: part.partId,
      materialId: -1,
      blend: 'normal',
      mask: null,
      order: 0,
      depth,
      bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    })
  }
  return sortRenderPackets(packets)
}
