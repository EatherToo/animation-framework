import { evaluateFk } from '../fk/evaluate'
import { skinMesh } from '../skin/skin'
import type { CompiledRig } from '../compile/compile'
import type { Fill } from '../part/set'
import type { Pose } from '../skeleton/pose'

/** 一件已着上纯色的轮廓。 */
export type FilledPart = {
  readonly partId: string
  readonly positions: Float32Array
  readonly indices: Uint16Array
  readonly fill: Fill
}

/**
 * 把姿态收成按部件着色的三角形。
 * @param compiled 编译结果
 * @param pose 当前偏移
 */
export function fillPose(compiled: CompiledRig, pose: Pose): FilledPart[] {
  const fk = new Float32Array(compiled.bindRig.length)
  evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
  const filled: FilledPart[] = []
  for (let i = 0; i < compiled.meshes.meshes.length; i += 1) {
    const mesh = compiled.meshes.meshes[i]!
    const positions = new Float32Array(mesh.positions.length)
    skinMesh(positions, compiled, fk, i)
    filled.push({
      partId: mesh.partId,
      positions,
      indices: mesh.indices,
      fill: compiled.parts.parts[i]!.fill,
    })
  }
  return filled
}
