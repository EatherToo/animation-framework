import { applyCorrection } from '../correction/correction'
import type { CompiledRig } from '../compile/compile'
import type { RigidPart, SkinnedPart } from '../part/set'

/**
 * 把一个部件的绑定顶点变到当前角色空间。顶点步长 3：`x, y, z`。
 * `x, y` 走骨头矩阵，`z` 跟着骨头的横向位置。
 * @param out 与网格位置等长
 * @param compiled 编译结果
 * @param fk 全身正向运动学，步长 9
 * @param lateral 全身骨头的横向位置，每骨一个
 * @param meshIndex 网格下标
 */
export function skinMesh(
  out: Float32Array,
  compiled: CompiledRig,
  fk: Float32Array,
  lateral: Float32Array,
  meshIndex: number,
): void {
  const mesh = compiled.meshes.meshes[meshIndex]
  if (mesh === undefined) throw new Error('mesh')
  if (fk.length !== compiled.skeleton.boneCount * 9) throw new Error('fk')
  if (lateral.length !== compiled.skeleton.boneCount) throw new Error('lateral')
  if (out.length !== mesh.positions.length) throw new Error('out')

  const corrected = new Float32Array(mesh.positions.length)
  applyCorrection(corrected, mesh.positions, compiled.correction)
  const part = compiled.parts.parts[meshIndex]!
  if (part.kind === 'skinned') skinSkinned(out, compiled, fk, lateral, corrected, part)
  else skinRigid(out, fk, lateral, corrected, part)
}

function skinSkinned(
  out: Float32Array,
  compiled: CompiledRig,
  fk: Float32Array,
  lateral: Float32Array,
  positions: Float32Array,
  part: SkinnedPart,
): void {
  const found = compiled.weights.weights.find((item) => item.partId === part.id)
  if (found === undefined) throw new Error('weight')
  const inverse = compiled.inverseBind
  const lateralBind = compiled.lateralBind
  const vertexCount = positions.length / 3
  for (let v = 0; v < vertexCount; v += 1) {
    const x = positions[v * 3]!
    const y = positions[v * 3 + 1]!
    const z = positions[v * 3 + 2]!
    let sx = 0
    let sy = 0
    let sz = 0
    for (let i = 0; i < part.bones.length; i += 1) {
      const weight = found.weights[v * found.influences + i]!
      if (weight === 0) continue
      const bone = part.bones[i]!
      const base = bone * 9
      const lx = inverse[base]! * x + inverse[base + 3]! * y + inverse[base + 6]!
      const ly = inverse[base + 1]! * x + inverse[base + 4]! * y + inverse[base + 7]!
      sx += weight * (fk[base]! * lx + fk[base + 3]! * ly + fk[base + 6]!)
      sy += weight * (fk[base + 1]! * lx + fk[base + 4]! * ly + fk[base + 7]!)
      sz += weight * (lateral[bone]! + (z - lateralBind[bone]!))
    }
    out[v * 3] = sx
    out[v * 3 + 1] = sy
    out[v * 3 + 2] = sz
  }
}

function skinRigid(
  out: Float32Array,
  fk: Float32Array,
  lateral: Float32Array,
  positions: Float32Array,
  part: RigidPart,
): void {
  const base = part.bone * 9
  const offset = lateral[part.bone]!
  const vertexCount = positions.length / 3
  for (let v = 0; v < vertexCount; v += 1) {
    const x = positions[v * 3]!
    const y = positions[v * 3 + 1]!
    out[v * 3] = fk[base]! * x + fk[base + 3]! * y + fk[base + 6]!
    out[v * 3 + 1] = fk[base + 1]! * x + fk[base + 4]! * y + fk[base + 7]!
    out[v * 3 + 2] = offset + positions[v * 3 + 2]!
  }
}
