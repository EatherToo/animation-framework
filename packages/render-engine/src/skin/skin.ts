import { mat4, quat, quat2, vec3 } from 'gl-matrix'
import { applyCorrection } from '../correction/correction'
import type { CompiledRig } from '../compile/compile'
import type { Pose } from '../skeleton/pose'
import { multiplyRigid, RIGID_STRIDE, setRigidParentFromBone } from '../skeleton/rigid'
import { bindLength, boneName, findBone } from '../skeleton/skeleton'
import type { RigidPart, SkinnedPart } from '../part/set'
import type { SkinWeights } from '../weight/humanoid'
import {
  ARM_SECTIONS,
  buildArmOutline,
  isArmPart,
  shoulderRoot,
  wristHalfWidth,
  widthProfile,
  type ArmOutlineBones,
} from '../outline/arm'

/**
 * 把一个部件的绑定顶点变到当前角色空间。顶点步长 3。
 * 大腿等 3D 部件混合前先做关节修正，并按 `twistU` 拆轴；
 * 两条手臂不走蒙皮，直接由 fk 的肩、肘、腕按 2D 轮廓重建。
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
  // 2D 手臂不走权重与蒙皮：顶点由 fk 的肩、肘、腕直接生成。
  if (part.kind === 'skinned' && isArmPart(part.id)) {
    writeArmOutline(out, compiled, fk, part.id)
    return
  }
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
  const composed = new Float32Array(RIGID_STRIDE)
  const inverseSlice = new Float32Array(RIGID_STRIDE)
  const m4 = mat4.create()
  const bone = quat2.create()
  const acc = quat2.create()
  const point = vec3.create()
  const translation = vec3.create()
  for (let v = 0; v < vertexCount; v += 1) {
    const x = positions[v * 3]!
    const y = positions[v * 3 + 1]!
    const z = positions[v * 3 + 2]!
    const twistScale = found.twistU[v]!
    let weightSum = 0
    quat2.identity(acc)
    for (let i = 0; i < part.bones.length; i += 1) {
      const weight = found.weights[v * found.influences + i]!
      if (weight === 0) continue
      const boneIndex = part.bones[i]!
      const distributed = isTwistDistributed(boneName(compiled.skeleton, boneIndex))
      applyScaledMatrix(
        scaled,
        local,
        parent,
        fk,
        compiled,
        pose,
        boneIndex,
        distributed ? twistScale : 1,
      )
      inverseSlice.set(
        inverse.subarray(boneIndex * RIGID_STRIDE, boneIndex * RIGID_STRIDE + RIGID_STRIDE),
      )
      multiplyRigid(composed, distributed ? scaled : fkSlice(fk, boneIndex), inverseSlice)
      writeMat4(m4, composed)
      quat2.fromMat4(bone, m4)
      // 半球对齐：与已累积的实部点积为负时整体取反，否则 q 与 −q 会互相抵消。
      if (
        weightSum > 0 &&
        acc[0]! * bone[0]! + acc[1]! * bone[1]! + acc[2]! * bone[2]! + acc[3]! * bone[3]! < 0
      ) {
        quat2.scale(bone, bone, -1)
      }
      for (let k = 0; k < 8; k += 1) acc[k]! += weight * bone[k]!
      weightSum += weight
    }
    if (weightSum === 0) {
      out[v * 3] = x
      out[v * 3 + 1] = y
      out[v * 3 + 2] = z
      continue
    }
    quat2.normalize(acc, acc)
    quat2.getTranslation(translation, acc)
    point[0] = x
    point[1] = y
    point[2] = z
    vec3.transformQuat(point, point, acc as unknown as quat)
    out[v * 3] = point[0]! + translation[0]!
    out[v * 3 + 1] = point[1]! + translation[1]!
    out[v * 3 + 2] = point[2]! + translation[2]!
  }
}

/** fk 刚体里某根骨的原点。 */
function originOf(fk: Float32Array, bone: number): { x: number; y: number; z: number } {
  const base = bone * RIGID_STRIDE
  if (bone < 0 || base + 11 >= fk.length) throw new Error('fk')
  return { x: fk[base + 9]!, y: fk[base + 10]!, z: fk[base + 11]! }
}

/**
 * 当前姿态下一条手臂的三维骨轴端点与宽度曲线。
 * 采样阶段用它重建顶点；投影阶段按视角重新投影这三个点。
 * @param compiled 编译结果
 * @param fk 全身正向运动学，步长 12
 * @param partId `armL` 或 `armR`
 */
export function armOutlineBones(
  compiled: CompiledRig,
  fk: Float32Array,
  partId: string,
): ArmOutlineBones {
  const side = partId === 'armL' ? 'L' : partId === 'armR' ? 'R' : null
  if (side === null) throw new Error('part')
  const shoulder = originOf(fk, findBone(compiled.skeleton, `upperArm${side}`))
  const elbow = originOf(fk, findBone(compiled.skeleton, `lowerArm${side}`))
  const hand = findBone(compiled.skeleton, `hand${side}`)
  const wrist = originOf(fk, hand)
  const axis = hand * RIGID_STRIDE
  const length = bindLength(compiled.skeleton, hand)
  const handTip = {
    x: wrist.x + fk[axis]! * length,
    y: wrist.y + fk[axis + 1]! * length,
    z: wrist.z + fk[axis + 2]! * length,
  }
  const handLateral = { x: fk[axis + 6]!, y: fk[axis + 7]!, z: fk[axis + 8]! }
  const handThicknessAxis = { x: fk[axis + 3]!, y: fk[axis + 4]!, z: fk[axis + 5]! }
  return {
    shoulder,
    elbow,
    wrist,
    handTip,
    handLateral,
    handThicknessAxis,
    palmHalfWidth: compiled.proportions.palmWrist.halfWidth,
    palmHalfThickness: compiled.proportions.palmWrist.halfThickness,
    upperWidth: widthProfile(compiled.proportions.upperArmProfile),
    lowerWidth: widthProfile(compiled.proportions.lowerArmProfile),
    sections: ARM_SECTIONS,
    height: compiled.proportions.height,
  }
}

/** 把当前姿态的 2D 轮廓写进 `out`，步长 3，z 恒 0。 */
function writeArmOutline(
  out: Float32Array,
  compiled: CompiledRig,
  fk: Float32Array,
  partId: string,
): void {
  const bones = armOutlineBones(compiled, fk, partId)
  const root = shoulderRoot({ x: bones.shoulder.x, y: bones.shoulder.y }, bones.height)
  const handDir = {
    x: bones.handTip.x - bones.wrist.x,
    y: bones.handTip.y - bones.wrist.y,
  }
  const wristWidth = wristHalfWidth(
    handDir,
    { x: bones.handLateral.x, y: bones.handLateral.y },
    { x: bones.handThicknessAxis.x, y: bones.handThicknessAxis.y },
    bones.palmHalfWidth,
    bones.palmHalfThickness,
  )
  const outline = buildArmOutline({
    shoulder: root,
    elbow: { x: bones.elbow.x, y: bones.elbow.y },
    wrist: { x: bones.wrist.x, y: bones.wrist.y },
    handDir,
    wristWidth,
    upperWidth: bones.upperWidth,
    lowerWidth: bones.lowerWidth,
    sections: bones.sections,
  })
  if (outline.positions.length / 2 !== out.length / 3) throw new Error('mesh')
  for (let v = 0; v < out.length / 3; v += 1) {
    out[v * 3] = outline.positions[v * 2]!
    out[v * 3 + 1] = outline.positions[v * 2 + 1]!
    out[v * 3 + 2] = 0
  }
}

/** 取 `fk` 里某根骨的 12 浮点刚体。 */
function fkSlice(fk: Float32Array, bone: number): Float32Array {
  return fk.subarray(bone * RIGID_STRIDE, bone * RIGID_STRIDE + RIGID_STRIDE)
}

/** 把 12 浮点刚体写成列主序 4×4，供 `quat2.fromMat4` 使用。 */
function writeMat4(out: mat4, rigid: Float32Array): void {
  out[0] = rigid[0]!
  out[1] = rigid[1]!
  out[2] = rigid[2]!
  out[3] = 0
  out[4] = rigid[3]!
  out[5] = rigid[4]!
  out[6] = rigid[5]!
  out[7] = 0
  out[8] = rigid[6]!
  out[9] = rigid[7]!
  out[10] = rigid[8]!
  out[11] = 0
  out[12] = rigid[9]!
  out[13] = rigid[10]!
  out[14] = rigid[11]!
  out[15] = 1
}

function applyScaledMatrix(
  scaled: Float32Array,
  local: Float32Array,
  parent: Float32Array,
  fk: Float32Array,
  compiled: CompiledRig,
  pose: Pose,
  bone: number,
  twistScale: number,
): void {
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

/** 对偶部分的来源：d = ½·(0, t) ⊗ q。 */
function dualFromTranslation(
  out: { w: number; x: number; y: number; z: number },
  tx: number,
  ty: number,
  tz: number,
  q: { w: number; x: number; y: number; z: number },
): void {
  out.w = 0.5 * -(tx * q.x + ty * q.y + tz * q.z)
  out.x = 0.5 * (tx * q.w + ty * q.z - tz * q.y)
  out.y = 0.5 * (ty * q.w + tz * q.x - tx * q.z)
  out.z = 0.5 * (tz * q.w + tx * q.y - ty * q.x)
}

/** 从单位对偶四元数取平移：t = 2·(d ⊗ q*).xyz，直接加到点上。 */
function translationOfDual(
  out: { x: number; y: number; z: number },
  q: { w: number; x: number; y: number; z: number },
  d: { w: number; x: number; y: number; z: number },
): void {
  const tw = d.w * q.w + d.x * q.x + d.y * q.y + d.z * q.z
  const tx = -d.w * q.x + d.x * q.w + d.y * q.z - d.z * q.y
  const ty = -d.w * q.y - d.x * q.z + d.y * q.w + d.z * q.x
  const tz = -d.w * q.z + d.x * q.y - d.y * q.x + d.z * q.w
  void tw
  out.x += 2 * tx
  out.y += 2 * ty
  out.z += 2 * tz
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
