import type { CompiledRig } from '../compile/compile'
import { multiplyRigid, RIGID_STRIDE, setRigidParentFromBone } from '../skeleton/rigid'
import type { Pose } from '../skeleton/pose'

/**
 * 计算拓扑序前缀里每根骨头的角色空间刚体。
 * 每根骨头 12 个数。零偏移时与 `bindRig` 按位相同。
 * @param out 长度 `count * 12`
 * @param compiled 编译结果，提供左右符号
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
  if (out.length !== count * RIGID_STRIDE) throw new Error('out')

  const local = new Float32Array(RIGID_STRIDE)
  const parent = new Float32Array(RIGID_STRIDE)
  const combined = new Float32Array(RIGID_STRIDE)
  for (let bone = 0; bone < count; bone += 1) {
    const joint = compiled.joints[bone]!
    setRigidParentFromBone(
      local,
      compiled.skeleton,
      pose,
      bone,
      joint.swingSign,
      joint.twistSign,
    )
    const parentIndex = compiled.skeleton.parent[bone]!
    const dst = bone * RIGID_STRIDE
    if (parentIndex < 0) {
      out.set(local, dst)
      continue
    }
    parent.set(out.subarray(parentIndex * RIGID_STRIDE, parentIndex * RIGID_STRIDE + RIGID_STRIDE))
    multiplyRigid(combined, parent, local)
    out.set(combined, dst)
  }
}
