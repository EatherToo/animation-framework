import { createMat3, multiplyMat3, type Mat3 } from '../math/mat3'
import type { CompiledRig } from '../compile/compile'
import { setParentFromBone } from '../skeleton/parent-from-bone'
import type { Pose } from '../skeleton/pose'

/**
 * 计算拓扑序前缀里每根骨头的角色空间矩阵。
 * @param out 长度 `count * 9`
 * @param compiled 编译结果
 * @param pose 当前偏移
 * @param count 从骨盆起的骨头数
 */
export function evaluateFk(
  out: Float32Array,
  compiled: CompiledRig,
  pose: Pose,
  count: number,
): void {
  if (pose.skeleton !== compiled.skeleton) throw new Error('pose')
  const boneCount = compiled.skeleton.boneCount
  if (!Number.isInteger(count) || count < 1 || count > boneCount) throw new Error('count')
  if (out.length !== count * 9) throw new Error('out')

  const local = createMat3()
  const parent = createMat3()
  const combined = createMat3()
  for (let bone = 0; bone < count; bone += 1) {
    setParentFromBone(local, compiled.skeleton, pose, bone)
    const parentIndex = compiled.skeleton.parent[bone]!
    const source =
      parentIndex < 0 ? local : combine(combined, parent, out, parentIndex, local)
    const dst = bone * 9
    for (let k = 0; k < 9; k += 1) out[dst + k] = source[k]!
  }
}

function combine(
  combined: Mat3,
  parent: Mat3,
  rig: Float32Array,
  parentIndex: number,
  local: Mat3,
): Mat3 {
  const src = parentIndex * 9
  for (let k = 0; k < 9; k += 1) parent[k] = rig[src + k]!
  return multiplyMat3(combined, parent, local)
}
