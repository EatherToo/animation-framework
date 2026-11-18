/** 首版关闭关节修正。求值只原样复制顶点。 */
export type Correction = {
  readonly enabled: false
}

/**
 * 创建一份关闭的修正。
 */
export function createCorrection(): Correction {
  return { enabled: false }
}

/**
 * 把 `positions` 抄到 `out`。长度不同则抛出且不写 `out`。
 * @param out 输出
 * @param positions 绑定或已蒙皮的顶点
 * @param correction 修正数据；首版 `enabled` 为 false
 * @returns `out`
 */
export function applyCorrection(
  out: Float32Array,
  positions: Float32Array,
  correction: Correction,
): Float32Array {
  if (correction.enabled !== false) throw new Error('correction')
  if (out.length !== positions.length) throw new Error('out')
  out.set(positions)
  return out
}
