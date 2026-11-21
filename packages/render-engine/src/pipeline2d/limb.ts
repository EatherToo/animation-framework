import type { CompiledRig } from '../compile/compile'
import {
  ARM_SECTIONS,
  armOutlineVertexCount,
  buildArmOutline,
  type OutlineMesh,
  shoulderRoot,
  widthProfile,
  wristHalfWidth,
} from '../outline/arm'
import { armOutlineBones } from '../skin/skin'
import { findBone } from '../skeleton/skeleton'
import { meshBounds } from './scene'
import type { RenderAttachment, RenderMesh, RenderOutline, RGBA } from './types'

const SKIN = 'base'

const OUTLINE: RenderOutline = {
  widthPx: 2.5,
  color: { r: 0.08, g: 0.08, b: 0.08, a: 1 },
  join: 'round',
  cap: 'round',
  depthBias: 0,
}

/**
 * 正面正交下把 3D 点收成屏幕平面点：横轴取角色 z，竖轴取 y。
 * 深度 = −x（Front view 90°），只用于排序。
 * @param point 角色空间点
 */
export function frontPoint(point: { x: number; y: number; z: number }): { x: number; y: number } {
  return { x: point.z, y: point.y }
}

/**
 * 正面正交下的排序深度。
 * @param point 角色空间点
 */
export function frontDepth(point: { x: number; y: number; z: number }): number {
  return -point.x
}

/**
 * 把一个 OutlineMesh 转成 2D 渲染网格。肩/腕两端标 seam。
 * @param positions 平面点，步长 2
 * @param indices 三角形
 * @param depths 每顶点深度
 */
export function outlineToMesh(
  positions: Float32Array,
  indices: Uint16Array,
  depths: Float32Array,
): RenderMesh {
  const count = positions.length / 2
  if (depths.length !== count) throw new Error('depth')
  const seam = new Uint8Array(count)
  seam[0] = 1
  seam[1] = 1
  seam[count - 2] = 1
  seam[count - 1] = 1
  return {
    positions,
    uvs: new Float32Array(0),
    indices,
    colors: new Uint8Array(0),
    boneIndices: new Uint16Array(0),
    weights: new Float32Array(0),
    seam,
    depth: depths,
    bounds: meshBounds(positions),
  }
}

/**
 * 当前 fk 下的一条 2D 手臂附件。
 * @param compiled 编译结果
 * @param fk 全身 FK，步长 12
 * @param side 'L' | 'R'
 * @param fill 部件颜色
 */
export function buildArmAttachment(
  compiled: CompiledRig,
  fk: Float32Array,
  side: 'L' | 'R',
  fill: RGBA,
): RenderAttachment {
  const bones = armOutlineBones(compiled, fk, `arm${side}`)
  const shoulder = frontPoint(bones.shoulder)
  const elbow = frontPoint(bones.elbow)
  const wrist = frontPoint(bones.wrist)
  const handTip = frontPoint(bones.handTip)
  const handDir = { x: handTip.x - wrist.x, y: handTip.y - wrist.y }
  const wristWidth = wristHalfWidth(
    handDir,
    { x: bones.handLateral.z, y: bones.handLateral.y },
    { x: bones.handThicknessAxis.z, y: bones.handThicknessAxis.y },
    bones.palmHalfWidth,
    bones.palmHalfThickness,
  )
  const root = shoulderRoot(shoulder, bones.height)
  const outline = buildArmOutline({
    shoulder: root,
    elbow,
    wrist,
    handDir,
    wristWidth,
    upperWidth: bones.upperWidth,
    lowerWidth: bones.lowerWidth,
    sections: ARM_SECTIONS,
    shoulderDepth: frontDepth(bones.shoulder),
    elbowDepth: frontDepth(bones.elbow),
    wristDepth: frontDepth(bones.wrist),
  })
  return {
    id: `arm${side}`,
    skin: SKIN,
    mesh: outlineToMesh(outline.positions, outline.indices, outline.depths),
    material: { kind: 'flat', color: fill },
    outline: OUTLINE,
  }
}

/** 肩部 yoke 占用的上臂环数；切环处与手臂共享顶点。 */
export const ARM_YOKE_RINGS = 2

/**
 * 生成完整手臂 + 肩部 yoke 取环数；当前 yoke 只取最上 2 环作袖山，不真正切手臂。
 * @param compiled 编译结果
 * @param fk 当前 FK
 * @param side 左/右
 * @param fill 颜色
 */
export function buildArmParts(
  compiled: CompiledRig,
  fk: Float32Array,
  side: 'L' | 'R',
  fill: RGBA,
): { arm: RenderAttachment; outline: OutlineMesh; cut: number } {
  const bones = armOutlineBones(compiled, fk, `arm${side}`)
  const shoulder = frontPoint(bones.shoulder)
  const elbow = frontPoint(bones.elbow)
  const wrist = frontPoint(bones.wrist)
  const handTip = frontPoint(bones.handTip)
  const handDir = { x: handTip.x - wrist.x, y: handTip.y - wrist.y }
  const wristWidth = wristHalfWidth(
    handDir,
    { x: bones.handLateral.z, y: bones.handLateral.y },
    { x: bones.handThicknessAxis.z, y: bones.handThicknessAxis.y },
    bones.palmHalfWidth,
    bones.palmHalfThickness,
  )
  const outline = buildArmOutline({
    shoulder: shoulderRoot(shoulder, bones.height),
    elbow,
    wrist,
    handDir,
    wristWidth,
    upperWidth: bones.upperWidth,
    lowerWidth: bones.lowerWidth,
    sections: ARM_SECTIONS,
    shoulderDepth: frontDepth(bones.shoulder),
    elbowDepth: frontDepth(bones.elbow),
    wristDepth: frontDepth(bones.wrist),
  })
  const ringCount = outline.positions.length / 4
  const cut = Math.max(1, Math.min(ARM_YOKE_RINGS, ringCount - 2))
  const arm: RenderAttachment = {
    id: `arm${side}`,
    skin: SKIN,
    mesh: outlineToMesh(outline.positions, outline.indices, outline.depths),
    material: { kind: 'flat', color: fill },
    outline: OUTLINE,
  }
  return { arm, outline, cut }
}

/**
 * 当前 fk 下的一条 2D 腿附件。髋→膝→踝用轮廓带；脚另做。
 * @param compiled 编译结果
 * @param fk 全身 FK，步长 12
 * @param side 'L' | 'R'
 * @param fill 部件颜色
 */
export function buildLegAttachment(
  compiled: CompiledRig,
  fk: Float32Array,
  side: 'L' | 'R',
  fill: RGBA,
): RenderAttachment {
  const suffix = side
  const hipBone = findBone(compiled.skeleton, `thigh${suffix}`)
  const kneeBone = findBone(compiled.skeleton, `shin${suffix}`)
  const ankleBone = findBone(compiled.skeleton, `foot${suffix}`)
  for (const bone of [hipBone, kneeBone, ankleBone]) {
    if (bone < 0) throw new Error('bone')
  }
  const hip = origin(fk, hipBone)
  const knee = origin(fk, kneeBone)
  const ankle = origin(fk, ankleBone)
  const outline = buildArmOutline({
    shoulder: frontPoint(hip),
    elbow: frontPoint(knee),
    wrist: frontPoint(ankle),
    upperWidth: widthProfile(compiled.proportions.thighProfile),
    lowerWidth: widthProfile(compiled.proportions.shinProfile),
    sections: ARM_SECTIONS,
    wristRings: 0,
    shoulderDepth: frontDepth(hip),
    elbowDepth: frontDepth(knee),
    wristDepth: frontDepth(ankle),
  })
  return {
    id: `leg${side}`,
    skin: SKIN,
    mesh: outlineToMesh(outline.positions, outline.indices, outline.depths),
    material: { kind: 'flat', color: fill },
    outline: OUTLINE,
  }
}

/**
 * 供测试/诊断用：一条手臂的顶点数。
 */
export function armMeshVertexCount(): number {
  return armOutlineVertexCount()
}

/** 一条腿的顶点数（无腕部圆弧，所以比手臂少 2 个截面）。 */
export function legMeshVertexCount(): number {
  return armOutlineVertexCount(ARM_SECTIONS, undefined, 0)
}

function origin(
  fk: Float32Array,
  bone: number,
): { x: number; y: number; z: number } {
  if (bone < 0) throw new Error('bone')
  const base = bone * 12
  return { x: fk[base + 9]!, y: fk[base + 10]!, z: fk[base + 11]! }
}

