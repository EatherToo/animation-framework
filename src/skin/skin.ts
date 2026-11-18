import { applyCorrection } from '../correction/correction'
import type { CompiledRig } from '../compile/compile'
import type { RigidPart, SkinnedPart } from '../part/set'

/**
 * 把一个部件的绑定顶点变到当前角色空间。
 * @param out 与网格位置等长
 * @param compiled 编译结果
 * @param fk 全身正向运动学，步长 9
 * @param meshIndex 网格下标
 */
export function skinMesh(
  out: Float32Array,
  compiled: CompiledRig,
  fk: Float32Array,
  meshIndex: number,
): void {
  const mesh = compiled.meshes.meshes[meshIndex]
  if (mesh === undefined) throw new Error('mesh')
  if (fk.length !== compiled.skeleton.boneCount * 9) throw new Error('fk')
  if (out.length !== mesh.positions.length) throw new Error('out')

  const corrected = new Float32Array(mesh.positions.length)
  applyCorrection(corrected, mesh.positions, compiled.correction)
  const part = compiled.parts.parts[meshIndex]!
  if (part.kind === 'skinned') skinSkinned(out, compiled, fk, corrected, part)
  else skinRigid(out, fk, corrected, part)
}

function skinSkinned(
  out: Float32Array,
  compiled: CompiledRig,
  fk: Float32Array,
  positions: Float32Array,
  part: SkinnedPart,
): void {
  const found = compiled.weights.weights.find((item) => item.partId === part.id)
  if (found === undefined) throw new Error('weight')
  const vertexCount = positions.length / 2
  for (let v = 0; v < vertexCount; v += 1) {
    const x = positions[v * 2]!
    const y = positions[v * 2 + 1]!
    let sx = 0
    let sy = 0
    for (let i = 0; i < part.bones.length; i += 1) {
      const weight = found.weights[v * found.influences + i]!
      if (weight === 0) continue
      const bone = part.bones[i]!
      const local = apply(compiled.inverseBind, bone, x, y)
      const current = apply(fk, bone, local.x, local.y)
      sx += weight * current.x
      sy += weight * current.y
    }
    out[v * 2] = sx
    out[v * 2 + 1] = sy
  }
}

function skinRigid(
  out: Float32Array,
  fk: Float32Array,
  positions: Float32Array,
  part: RigidPart,
): void {
  const vertexCount = positions.length / 2
  for (let v = 0; v < vertexCount; v += 1) {
    const current = apply(fk, part.bone, positions[v * 2]!, positions[v * 2 + 1]!)
    out[v * 2] = current.x
    out[v * 2 + 1] = current.y
  }
}

function apply(
  matrices: Float32Array,
  bone: number,
  x: number,
  y: number,
): { x: number; y: number } {
  const base = bone * 9
  return {
    x: matrices[base]! * x + matrices[base + 3]! * y + matrices[base + 6]!,
    y: matrices[base + 1]! * x + matrices[base + 4]! * y + matrices[base + 7]!,
  }
}
