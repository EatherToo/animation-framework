import type { Fill } from '../part/set'
import type { ProjectedPart } from '../view/project'

/** 一件已着上纯色的平面轮廓。`positions` 交错存放屏幕横、屏幕竖。 */
export type FilledPart = {
  readonly partId: string
  readonly positions: Float32Array
  readonly indices: Uint16Array
  readonly fill: Fill
  /** 与 08 网格上同一份 `seam` 引用。 */
  readonly seam: Uint8Array
}

/**
 * 给已投影的部件配上颜色。部件与颜色按登记下标对齐。
 * 件数不一致时抛出 `part`，不返回半份列表。
 * @param parts 投影后的平面三角形
 * @param fills 各部件的纯色
 */
export function fillProjected(
  parts: readonly ProjectedPart[],
  fills: readonly Fill[],
): FilledPart[] {
  if (parts.length !== fills.length) throw new Error('part')
  const filled: FilledPart[] = []
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!
    filled.push({
      partId: part.partId,
      positions: part.positions.slice(),
      indices: part.indices,
      fill: fills[i]!,
      seam: part.seam,
    })
  }
  return filled
}
