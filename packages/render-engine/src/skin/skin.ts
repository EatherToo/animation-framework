import { applyCorrection } from '../correction/correction'
import type { CompiledRig } from '../compile/compile'
import { RIGID_STRIDE } from '../skeleton/rigid'
import type { RigidPart, SkinnedPart } from '../part/set'

/**
 * 把一个部件的绑定顶点变到当前角色空间。顶点步长 3。
 * 三个分量都乘当前刚体。体积补偿保持关闭。
 * @param out 与网格位置等长
 * @param compiled 编译结果
 * @param fk 全身正向运动学，步长 12
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
  if (fk.length !== compiled.skeleton.boneCount * RIGID_STRIDE) throw new Error('fk')
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
  const inverse = compiled.inverseBind
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
      const local = applyRigid(inverse, bone, x, y, z)
      const world = applyRigid(fk, bone, local.x, local.y, local.z)
      sx += weight * world.x
      sy += weight * world.y
      sz += weight * world.z
    }
    out[v * 3] = sx
    out[v * 3 + 1] = sy
    out[v * 3 + 2] = sz
  }
}

function skinRigid(
  out: Float32Array,
  fk: Float32Array,
  positions: Float32Array,
  part: RigidPart,
): void {
  const vertexCount = positions.length / 3
  for (let v = 0; v < vertexCount; v += 1) {
    const world = applyRigid(
      fk,
      part.bone,
      positions[v * 3]!,
      positions[v * 3 + 1]!,
      positions[v * 3 + 2]!,
    )
    out[v * 3] = world.x
    out[v * 3 + 1] = world.y
    out[v * 3 + 2] = world.z
  }
}

function applyRigid(
  rigid: Float32Array,
  bone: number,
  x: number,
  y: number,
  z: number,
): { x: number; y: number; z: number } {
  const base = bone * RIGID_STRIDE
  return {
    x: rigid[base]! * x + rigid[base + 3]! * y + rigid[base + 6]! * z + rigid[base + 9]!,
    y: rigid[base + 1]! * x + rigid[base + 4]! * y + rigid[base + 7]! * z + rigid[base + 10]!,
    z: rigid[base + 2]! * x + rigid[base + 5]! * y + rigid[base + 8]! * z + rigid[base + 11]!,
  }
}
