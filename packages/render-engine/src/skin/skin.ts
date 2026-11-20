import { applyCorrection } from '../correction/correction'
import type { CompiledRig } from '../compile/compile'
import type { Pose } from '../skeleton/pose'
import { multiplyRigid, RIGID_STRIDE, setRigidParentFromBone } from '../skeleton/rigid'
import { boneName } from '../skeleton/skeleton'
import type { RigidPart, SkinnedPart } from '../part/set'
import type { SkinWeights } from '../weight/humanoid'

/**
 * 把一个部件的绑定顶点变到当前角色空间。顶点步长 3。
 * 混合前先做关节修正；上臂/前臂/大腿按 `twistU` 拆轴混合。
 * @param out 与网格位置等长
 * @param compiled 编译结果
 * @param fk 全身正向运动学，步长 12
 * @param meshIndex 网格下标
 * @param pose 当前姿态（拆扭转与修正读取通道角）
 */
export function skinMesh(
  out: Float32Array,
  compiled: CompiledRig,
  fk: Float32Array,
  meshIndex: number,
  pose: Pose,
): void {
  const mesh = compiled.meshes.meshes[meshIndex]
  if (mesh === undefined) throw new Error('mesh')
  if (fk.length !== compiled.skeleton.boneCount * RIGID_STRIDE) throw new Error('fk')
  if (out.length !== mesh.positions.length) throw new Error('out')
  if (pose.skeleton !== compiled.skeleton) throw new Error('pose')

  const part = compiled.parts.parts[meshIndex]!
  const corrected = new Float32Array(mesh.positions.length)
  if (part.kind === 'skinned') {
    const found = compiled.weights.weights.find((item) => item.partId === part.id)
    if (found === undefined) throw new Error('weight')
    applyCorrection(corrected, mesh.positions, compiled.correction, {
      bones: part.bones,
      weights: found.weights,
      influences: found.influences,
      bindRig: compiled.bindRig,
      pose,
    })
    skinSkinned(out, compiled, fk, corrected, part, found, pose)
  } else {
    applyCorrection(corrected, mesh.positions, { enabled: false, twistGain: 0, bendGain: 0 })
    skinRigid(out, fk, corrected, part)
  }
}

function skinSkinned(
  out: Float32Array,
  compiled: CompiledRig,
  fk: Float32Array,
  positions: Float32Array,
  part: SkinnedPart,
  found: SkinWeights,
  pose: Pose,
): void {
  const inverse = compiled.inverseBind
  const vertexCount = positions.length / 3
  const local = new Float32Array(RIGID_STRIDE)
  const scaled = new Float32Array(RIGID_STRIDE)
  const parent = new Float32Array(RIGID_STRIDE)
  for (let v = 0; v < vertexCount; v += 1) {
    const x = positions[v * 3]!
    const y = positions[v * 3 + 1]!
    const z = positions[v * 3 + 2]!
    const twistScale = found.twistU[v]!
    let sx = 0
    let sy = 0
    let sz = 0
    for (let i = 0; i < part.bones.length; i += 1) {
      const weight = found.weights[v * found.influences + i]!
      if (weight === 0) continue
      const bone = part.bones[i]!
      const bindLocal = applyRigid(inverse, bone, x, y, z)
      const world = isTwistDistributed(boneName(compiled.skeleton, bone))
        ? applyScaled(
            scaled,
            local,
            parent,
            fk,
            compiled,
            pose,
            bone,
            twistScale,
            bindLocal.x,
            bindLocal.y,
            bindLocal.z,
          )
        : applyRigid(fk, bone, bindLocal.x, bindLocal.y, bindLocal.z)
      sx += weight * world.x
      sy += weight * world.y
      sz += weight * world.z
    }
    out[v * 3] = sx
    out[v * 3 + 1] = sy
    out[v * 3 + 2] = sz
  }
}

function applyScaled(
  scaled: Float32Array,
  local: Float32Array,
  parent: Float32Array,
  fk: Float32Array,
  compiled: CompiledRig,
  pose: Pose,
  bone: number,
  twistScale: number,
  x: number,
  y: number,
  z: number,
): { x: number; y: number; z: number } {
  const joint = compiled.joints[bone]!
  setRigidParentFromBone(
    local,
    compiled.skeleton,
    pose,
    bone,
    joint.swingSign,
    joint.twistSign,
    twistScale,
  )
  const parentIndex = compiled.skeleton.parent[bone]!
  if (parentIndex < 0) {
    scaled.set(local)
  } else {
    parent.set(fk.subarray(parentIndex * RIGID_STRIDE, parentIndex * RIGID_STRIDE + RIGID_STRIDE))
    multiplyRigid(scaled, parent, local)
  }
  return {
    x: scaled[0]! * x + scaled[3]! * y + scaled[6]! * z + scaled[9]!,
    y: scaled[1]! * x + scaled[4]! * y + scaled[7]! * z + scaled[10]!,
    z: scaled[2]! * x + scaled[5]! * y + scaled[8]! * z + scaled[11]!,
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

function isTwistDistributed(name: string): boolean {
  return (
    name.startsWith('upperArm') || name.startsWith('lowerArm') || name.startsWith('thigh')
  )
}
