import type { CompiledRig } from '../compile/compile'
import { evaluateFk } from '../fk/evaluate'
import { halfWidthAt } from '../outline/arm'
import { HUMANOID_FILL, type HumanoidPartId } from '../part/humanoid'
import type { Pose } from '../skeleton/pose'
import { bindLength, findBone } from '../skeleton/skeleton'
import { multiplyRigid, RIGID_STRIDE } from '../skeleton/rigid'
import { buildRenderPackets } from './packet'
import { createRenderScene, meshBounds } from './scene'
import type {
  RenderAttachment,
  RenderPacket,
  RenderScene,
  RenderSlot,
  RGBA,
} from './types'
import {
  ellipseGridShape,
  ellipseShape,
  gridShape,
  mergeShapes,
  quadShape,
  shapeToMesh,
  type Shape,
} from './geometry'
import { buildArmAttachment, buildArmParts, buildLegAttachment, frontDepth, frontPoint } from './limb'

const SKIN = 'base'

type Vec3 = { x: number; y: number; z: number }

/** 正面正交下整个 2D 人形场景。每帧重建附件顶点。 */
export function buildHumanoid2DScene(compiled: CompiledRig, fk: Float32Array): RenderScene {
  const torso = buildTorsoAttachment(compiled, fk)
  const partL = buildArmParts(compiled, fk, 'L', fill('armL'))
  const partR = buildArmParts(compiled, fk, 'R', fill('armR'))
  const attachments: RenderAttachment[] = [
    buildLegAttachment(compiled, fk, 'L', fill('legL')),
    buildLegAttachment(compiled, fk, 'R', fill('legR')),
    buildFootAttachment(compiled, fk, 'L', fill('footL')),
    buildFootAttachment(compiled, fk, 'R', fill('footR')),
    torso,
    partL.arm,
    partR.arm,
    buildShoulderYoke(torso, partL.outline, partL.cut, 'L', fill('armL')),
    buildShoulderYoke(torso, partR.outline, partR.cut, 'R', fill('armR')),
    buildGapFill(torso, partL.arm, 'L', fill('armL')),
    buildGapFill(torso, partR.arm, 'R', fill('armR')),
    buildSkinnedHandAttachment(compiled, fk, 'L', fill('handL')),
    buildSkinnedHandAttachment(compiled, fk, 'R', fill('handR')),
    buildHeadAttachment(compiled, fk),
  ]
  return createRenderScene(slots(compiled, fk), [{ id: SKIN, attachments }])
}

/** 当前姿态的 2D 渲染包；按 Slot 主序排好。 */
export function sampleHumanoid2DPackets(compiled: CompiledRig, pose: Pose): RenderPacket[] {
  if (pose.skeleton !== compiled.skeleton) throw new Error('pose')
  const fk = new Float32Array(compiled.skeleton.boneCount * 12)
  evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
  return buildRenderPackets(buildHumanoid2DScene(compiled, fk))
}

function torsoShoulderBoost(t: number): number {
  const up = Math.min(1, Math.max(0, (t - 0.1) / 0.25))
  const down = Math.min(1, Math.max(0, (0.82 - t) / 0.2))
  const smooth = (x: number): number => x * x * (3 - 2 * x)
  return 0.035 * smooth(up) * smooth(down)
}

/** 2D 躯干：闭合轮廓，中心 + 两列宽度；正面横轴取 z。 */
export function buildTorsoAttachment(compiled: CompiledRig, fk: Float32Array): RenderAttachment {
  const pelvis = origin(fk, findBone(compiled.skeleton, 'pelvis'))
  const neck = origin(fk, findBone(compiled.skeleton, 'head'))
  const sections = 24
  const columns = 5
  const rows: { x: number; y: number; depth: number }[][] = []
  for (let i = 0; i <= sections; i += 1) {
    const t = i / sections
    const x = neck.z * t + pelvis.z * (1 - t)
    const y = neck.y * t + pelvis.y * (1 - t)
    const depth = -(neck.x * t + pelvis.x * (1 - t))
    const width = halfWidthAt(compiled.proportions.torsoProfile, t) + torsoShoulderBoost(t)
    const row: { x: number; y: number; depth: number }[] = []
    for (let j = 0; j <= columns; j += 1) {
      const u = j / columns
      row.push({ x: x - width + u * width * 2, y, depth })
    }
    rows.push(row)
  }
  return attachment('torso', shapeToMesh(gridShape(rows)), fill('torso'))
}

/** 2D 头：沿 head 骨轴的椭圆。 */
export function buildHeadAttachment(compiled: CompiledRig, fk: Float32Array): RenderAttachment {
  const bone = findBone(compiled.skeleton, 'head')
  const head = origin(fk, bone)
  const axis = axisOf(fk, bone)
  const u = { x: axis.z, y: axis.y }
  const n = { x: -u.y, y: u.x }
  const length = bindLength(compiled.skeleton, bone)
  const center = { x: head.z + u.x * length * 0.5, y: head.y + u.y * length * 0.5 }
  const halfWidth = maxHalfWidth(compiled.proportions.headProfile)
  return attachment(
    'head',
    shapeToMesh(ellipseGridShape(center, u, n, length * 0.5, halfWidth, 24, 3, frontDepth(head))),
    fill('head'),
  )
}

/** 2D 手：掌 + 四指/拇指按指骨链生成，指节随 FK 弯曲。 */
export function buildHandAttachment(
  compiled: CompiledRig,
  fk: Float32Array,
  side: 'L' | 'R',
  color: RGBA,
): RenderAttachment {
  const bone = findBone(compiled.skeleton, `hand${side}`)
  const wrist3 = origin(fk, bone)
  const axis = axisOf(fk, bone)
  const u = normalize2({ x: axis.z, y: axis.y })
  const n = { x: -u.y, y: u.x }
  const wrist = frontPoint(wrist3)
  const length = bindLength(compiled.skeleton, bone)
  const depth = frontDepth(wrist3)
  const p = compiled.proportions
  const palm = p.palmFraction * length
  const wristWidth = p.palmWrist.halfWidth
  const knuckleWidth = p.palmKnuckle.halfWidth
  const at = (along: number, across: number): { x: number; y: number; depth: number } => ({
    x: wrist.x + u.x * along + n.x * across,
    y: wrist.y + u.y * along + n.y * across,
    depth,
  })
  const shapes: Shape[] = [
    ellipseShape(wrist, u, n, wristWidth * 1.05, wristWidth * 0.85, 16, depth),
    quadShape(
      at(0, -wristWidth),
      at(0, wristWidth),
      at(palm, knuckleWidth),
      at(palm, -knuckleWidth),
    ),
  ]
  const fingers: readonly [string, number, number][] = [
    ['thumb', 2, p.thumbRadius],
    ['index', 3, p.fingerRadius],
    ['middle', 3, p.fingerRadius],
    ['ring', 3, p.fingerRadius],
    ['pinky', 3, p.fingerRadius],
  ]
  for (const [finger, segments, radius] of fingers) {
    for (let s = 0; s < segments; s += 1) {
      const name = `${finger}${s + 1}${side}`
      const fingerBone = findBone(compiled.skeleton, name)
      if (fingerBone < 0) continue
      const base3 = origin(fk, fingerBone)
      const baseAxis = axisOf(fk, fingerBone)
      const baseU = normalize2({ x: baseAxis.z, y: baseAxis.y })
      const baseN = { x: -baseU.y, y: baseU.x }
      const base = frontPoint(base3)
      const segmentLength = bindLength(compiled.skeleton, fingerBone)
      const projected = Math.hypot(baseAxis.z, baseAxis.y) * segmentLength
      const next = findBone(compiled.skeleton, `${finger}${s + 2}${side}`)
      const tip = next < 0 ? {
        x: base.x + baseU.x * projected,
        y: base.y + baseU.y * projected,
        depth: frontDepth(base3),
      } : frontPoint(origin(fk, next))
      const t0 = s / segments
      const t1 = (s + 1) / segments
      const baseRadius = finger === 'thumb'
        ? radius * (1 - t0 * 0.3)
        : p.fingerRadius + (p.fingerTipRadius - p.fingerRadius) * t0
      const tipRadius = finger === 'thumb'
        ? radius * (1 - t1 * 0.3)
        : p.fingerRadius + (p.fingerTipRadius - p.fingerRadius) * t1
      shapes.push(
        quadShape(
          { x: base.x + baseN.x * baseRadius, y: base.y + baseN.y * baseRadius, depth: frontDepth(base3) },
          { x: base.x - baseN.x * baseRadius, y: base.y - baseN.y * baseRadius, depth: frontDepth(base3) },
          { x: tip.x - baseN.x * tipRadius, y: tip.y - baseN.y * tipRadius, depth: frontDepth(base3) },
          { x: tip.x + baseN.x * tipRadius, y: tip.y + baseN.y * tipRadius, depth: frontDepth(base3) },
        ),
      )
    }
  }
  return attachment(`hand${side}`, shapeToMesh(mergeShapes(shapes)), color)
}

/**
 * 2D 指骨手的传统权重蒙皮：绑定时生成固定拓扑，按最近两根骨生成权重，
 * 每帧用 FK 的 bind→current 矩阵变换顶点。
 * @param compiled 编译结果
 * @param fk 当前 FK
 * @param side 左/右
 * @param color 颜色
 */
export function buildSkinnedHandAttachment(
  compiled: CompiledRig,
  fk: Float32Array,
  side: 'L' | 'R',
  color: RGBA,
): RenderAttachment {
  const bind = buildHandAttachment(compiled, compiled.bindRig, side, color)
  const mesh = bind.mesh
  const count = mesh.positions.length / 2
  const boneNames = [
    `hand${side}`,
    ...[1, 2, 3].flatMap((s) => ['thumb', 'index', 'middle', 'ring', 'pinky']
      .filter((finger) => !(finger === 'thumb' && s === 3))
      .map((finger) => `${finger}${s}${side}`)),
  ]
  const bones = boneNames.map((name) => findBone(compiled.skeleton, name)).filter((bone) => bone >= 0)
  const weights = new Float32Array(count * 4)
  const boneIndices = new Uint16Array(count * 4)
  const matrixCache = new Map<number, Float32Array>()
  const matrixOf = (bone: number): Float32Array => {
    const found = matrixCache.get(bone)
    if (found !== undefined) return found
    const matrix = new Float32Array(RIGID_STRIDE)
    multiplyRigid(
      matrix,
      fk.subarray(bone * RIGID_STRIDE, bone * RIGID_STRIDE + RIGID_STRIDE),
      compiled.inverseBind.subarray(bone * RIGID_STRIDE, bone * RIGID_STRIDE + RIGID_STRIDE),
    )
    matrixCache.set(bone, matrix)
    return matrix
  }
  const positions = new Float32Array(count * 2)
  const depths = new Float32Array(count)
  for (let v = 0; v < count; v += 1) {
    const p = {
      x: -mesh.depth[v]!,
      y: mesh.positions[v * 2 + 1]!,
      z: mesh.positions[v * 2]!,
    }
    const distances: { bone: number; distance: number }[] = []
    for (const bone of bones) {
      const base = bone * RIGID_STRIDE
      const ox = compiled.bindRig[base + 9]!
      const oy = compiled.bindRig[base + 10]!
      const oz = compiled.bindRig[base + 11]!
      const ax = compiled.bindRig[base]!
      const ay = compiled.bindRig[base + 1]!
      const az = compiled.bindRig[base + 2]!
      const length = bindLength(compiled.skeleton, bone)
      const dx = p.x - ox
      const dy = p.y - oy
      const dz = p.z - oz
      const t = Math.max(0, Math.min(1, (dx * ax + dy * ay + dz * az) / Math.max(1e-9, length * length)))
      const ex = dx - ax * length * t
      const ey = dy - ay * length * t
      const ez = dz - az * length * t
      distances.push({ bone, distance: Math.hypot(ex, ey, ez) })
    }
    distances.sort((a, b) => a.distance - b.distance)
    const first = distances[0]!
    const second = distances[1]
    const d0 = Math.max(1e-4, first.distance)
    const d1 = second === undefined ? Infinity : Math.max(1e-4, second.distance)
    let w0 = 1
    let w1 = 0
    if (Number.isFinite(d1) && d1 < d0 * 4) {
      w0 = 1 / (d0 * d0)
      w1 = 1 / (d1 * d1)
      const sum = w0 + w1
      w0 /= sum
      w1 /= sum
    }
    boneIndices[v * 4] = first.bone
    boneIndices[v * 4 + 1] = second?.bone ?? 0
    weights[v * 4] = w0
    weights[v * 4 + 1] = w1
    let sx = 0
    let sy = 0
    let sz = 0
    for (let i = 0; i < 2; i += 1) {
      const weight = weights[v * 4 + i]!
      if (weight === 0) continue
      const matrix = matrixOf(boneIndices[v * 4 + i]!)
      sx += weight * (matrix[0]! * p.x + matrix[3]! * p.y + matrix[6]! * p.z + matrix[9]!)
      sy += weight * (matrix[1]! * p.x + matrix[4]! * p.y + matrix[7]! * p.z + matrix[10]!)
      sz += weight * (matrix[2]! * p.x + matrix[5]! * p.y + matrix[8]! * p.z + matrix[11]!)
    }
    positions[v * 2] = sz
    positions[v * 2 + 1] = sy
    depths[v] = -sx
  }
  return {
    ...bind,
    mesh: {
      ...mesh,
      positions,
      depth: depths,
      weights,
      boneIndices,
      bounds: meshBounds(positions),
    },
  }
}

/** 2D 脚：鞋头 + 鞋底；正面看是上窄下宽的鞋型，脚长仍落在深度方向。 */
export function buildFootAttachment(
  compiled: CompiledRig,
  fk: Float32Array,
  side: 'L' | 'R',
  color: RGBA,
): RenderAttachment {
  const bone = findBone(compiled.skeleton, `foot${side}`)
  const ankle3 = origin(fk, bone)
  const ankle = frontPoint(ankle3)
  const width = maxRadius(compiled.proportions.footHalfWidth)
  const height = Math.max(0.024, compiled.proportions.ankleHeight * 0.8)
  const depth = frontDepth(ankle3)
  const upper = ellipseGridShape(
    { x: ankle.x, y: ankle.y - height * 0.55 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    width * 0.96,
    height * 0.5,
    20,
    2,
    depth,
  )
  const sole = quadShape(
    { x: ankle.x - width * 1.03, y: ankle.y - height, depth },
    { x: ankle.x + width * 1.03, y: ankle.y - height, depth },
    { x: ankle.x + width * 1.03, y: ankle.y - height + 0.012, depth },
    { x: ankle.x - width * 1.03, y: ankle.y - height + 0.012, depth },
  )
  return attachment(`foot${side}`, shapeToMesh(mergeShapes([upper, sole])), color)
}

function extremeAt(vertices: Float32Array, y: number, sign: number): number {
  let result = sign === 1 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  let any = false
  for (let i = 0; i < vertices.length; i += 2) {
    if (Math.abs(vertices[i + 1]! - y) > 0.03) continue
    any = true
    const x = vertices[i]!
    result = sign === 1 ? Math.max(result, x) : Math.min(result, x)
  }
  return any ? result : Number.NaN
}

/** 扫描线填缝：只填躯干边与手臂内边之间的真实空隙，画在两者后面。 */
export function buildGapFill(
  torso: RenderAttachment,
  arm: RenderAttachment,
  side: 'L' | 'R',
  color: RGBA,
): RenderAttachment {
  const sideSign = side === 'L' ? 1 : -1
  const rows: { x: number; y: number; depth: number }[][] = []
  // 手臂接近水平时不做腋下填缝，否则会拉出大片三角网。
  if (arm.mesh.bounds !== null && arm.mesh.bounds.width > arm.mesh.bounds.height * 0.9) {
    const y = 1.25
    const x = sideSign * 0.16
    rows.push([{ x, y, depth: 0 }, { x: x + sideSign * 0.002, y, depth: 0 }])
    rows.push([{ x, y: y + 0.01, depth: 0 }, { x: x + sideSign * 0.002, y: y + 0.01, depth: 0 }])
    return attachment(`gap${side}`, shapeToMesh(gridShape(rows)), color, null, `arm${side}`)
  }
  for (let y = 0.95; y <= 1.45; y += 0.01) {
    const torsoX = boundaryX(torso.mesh, y, sideSign)
    const armX = boundaryX(arm.mesh, y, -sideSign)
    if (!Number.isFinite(torsoX) || !Number.isFinite(armX)) continue
    const gap = sideSign * (armX - torsoX)
    if (gap <= 0.0005) continue
    rows.push([
      { x: torsoX, y, depth: 0 },
      { x: armX, y, depth: 0 },
    ])
  }
  if (rows.length < 2) {
    const y = 1.25
    const x = sideSign * 0.16
    rows.push([{ x, y, depth: 0 }, { x: x + sideSign * 0.002, y, depth: 0 }])
    rows.push([{ x, y: y + 0.01, depth: 0 }, { x: x + sideSign * 0.002, y: y + 0.01, depth: 0 }])
  }
  return attachment(`gap${side}`, shapeToMesh(gridShape(rows)), color, null, `arm${side}`)
}

function boundaryX(mesh: RenderAttachment['mesh'], y: number, sign: number): number {
  let result = sign === 1 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  const positions = mesh.positions
  const indices = mesh.indices
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e += 1) {
      const a = indices[t + e]!
      const b = indices[t + ((e + 1) % 3)]!
      const ay = positions[a * 2 + 1]!
      const by = positions[b * 2 + 1]!
      if (y < Math.min(ay, by) || y > Math.max(ay, by) || Math.abs(by - ay) < 1e-9) continue
      const u = (y - ay) / (by - ay)
      const x = positions[a * 2]! + (positions[b * 2]! - positions[a * 2]!) * u
      result = sign === 1 ? Math.max(result, x) : Math.min(result, x)
    }
  }
  return result
}

/** 肩部 yoke：/** 肩部 yoke：从躯干边到手臂外边的袖山，和手臂切环共享边界；无描边。 */
export function buildShoulderYoke(
  torso: RenderAttachment,
  outline: { positions: Float32Array },
  cut: number,
  side: 'L' | 'R',
  color: RGBA,
): RenderAttachment {
  const sideSign = side === 'L' ? 1 : -1
  const rows: { x: number; y: number; depth: number }[][] = []
  for (let r = 0; r <= cut; r += 1) {
    const i = r * 4
    const y = (outline.positions[i + 1]! + outline.positions[i + 3]!) / 2
    const outer = sideSign === 1
      ? Math.max(outline.positions[i]!, outline.positions[i + 2]!)
      : Math.min(outline.positions[i]!, outline.positions[i + 2]!)
    const torsoX = extremeAt(torso.mesh.positions, y, sideSign)
    const inner = Number.isFinite(torsoX) ? torsoX : outer - sideSign * 0.03
    rows.push([
      { x: inner, y, depth: 0 },
      { x: outer, y, depth: 0 },
    ])
  }
  return attachment(`shoulder${side}`, shapeToMesh(gridShape(rows)), color, null, `arm${side}`)
}

function armDepth(compiled: CompiledRig, fk: Float32Array, side: 'L' | 'R'): number {
  const bones = [`upperArm${side}`, `lowerArm${side}`, `hand${side}`]
  let sum = 0
  for (const name of bones) sum += origin(fk, findBone(compiled.skeleton, name)).x
  return sum / bones.length
}

function legDepth(compiled: CompiledRig, fk: Float32Array, side: 'L' | 'R'): number {
  const bones = [`thigh${side}`, `shin${side}`, `foot${side}`]
  let sum = 0
  for (const name of bones) sum += origin(fk, findBone(compiled.skeleton, name)).x
  return sum / bones.length
}

function slots(compiled: CompiledRig, fk: Float32Array): RenderSlot[] {
  const chestX = origin(fk, findBone(compiled.skeleton, 'chest')).x
  const armLX = armDepth(compiled, fk, 'L')
  const armRX = armDepth(compiled, fk, 'R')
  const legLX = legDepth(compiled, fk, 'L')
  const legRX = legDepth(compiled, fk, 'R')
  const armLFront = armLX >= chestX - 1e-4
  const armRFront = armRX >= chestX - 1e-4
  const legLFront = legLX > legRX + 1e-4
  const legRFront = legRX > legLX + 1e-4
  const list: { id: string; order: number; attachment: string }[] = [
    { id: 'legL', order: legLFront ? 0.2 : 0, attachment: 'legL' },
    { id: 'legR', order: legRFront ? 0.2 : 0, attachment: 'legR' },
    { id: 'footL', order: legLFront ? 1.2 : 1, attachment: 'footL' },
    { id: 'footR', order: legRFront ? 1.2 : 1, attachment: 'footR' },
    { id: 'torso', order: 2, attachment: 'torso' },
    // 手臂按当前深度动态放到躯干前/后；肩口 mask 只裁根部。
    { id: 'armL', order: armLFront ? 3 : 1.5, attachment: 'armL' },
    { id: 'armR', order: armRFront ? 3 : 1.5, attachment: 'armR' },
    { id: 'gapL', order: 1.5, attachment: 'gapL' },
    { id: 'gapR', order: 1.5, attachment: 'gapR' },
    { id: 'shoulderL', order: armLFront ? 3.5 : 1.7, attachment: 'shoulderL' },
    { id: 'shoulderR', order: armRFront ? 3.5 : 1.7, attachment: 'shoulderR' },
    { id: 'handL', order: armLFront ? 4 : 1.6, attachment: 'handL' },
    { id: 'handR', order: armRFront ? 4 : 1.6, attachment: 'handR' },
    { id: 'head', order: 5, attachment: 'head' },
  ]
  return list.map((item) => ({
    ...item,
    tint: { r: 1, g: 1, b: 1, a: 1 },
    blend: 'normal',
    mask: item.id === 'armL' || item.id === 'armR' ? 'shoulder' : null,
  }))
}

function attachment(
  id: string,
  mesh: RenderAttachment['mesh'],
  color: RGBA,
  outline: RenderAttachment['outline'] = {
    widthPx: 2.5,
    color: { r: 0.08, g: 0.08, b: 0.08, a: 1 },
    join: 'round',
    cap: 'round',
    depthBias: 0,
  },
  atlasKey?: string,
): RenderAttachment {
  return {
    id,
    skin: SKIN,
    mesh,
    material: { kind: 'flat', color },
    outline,
    ...(atlasKey === undefined ? {} : { atlasKey }),
  }
}

function fill(part: HumanoidPartId): RGBA {
  const color = HUMANOID_FILL[part]
  return { r: color.r, g: color.g, b: color.b, a: 1 }
}

function origin(fk: Float32Array, bone: number): Vec3 {
  if (bone < 0) throw new Error('bone')
  const base = bone * 12
  return { x: fk[base + 9]!, y: fk[base + 10]!, z: fk[base + 11]! }
}

function axisOf(fk: Float32Array, bone: number): Vec3 {
  if (bone < 0) throw new Error('bone')
  const base = bone * 12
  return { x: fk[base]!, y: fk[base + 1]!, z: fk[base + 2]! }
}

function maxHalfWidth(profile: readonly { t: number; halfWidth: number }[]): number {
  let max = 0
  for (const sample of profile) max = Math.max(max, sample.halfWidth)
  return max
}

function maxRadius(profile: readonly { t: number; radius: number }[]): number {
  let max = 0
  for (const sample of profile) max = Math.max(max, sample.radius)
  return max
}

function normalize2(v: { x: number; y: number }): { x: number; y: number } {
  const length = Math.hypot(v.x, v.y)
  if (length < 1e-9) return { x: 0, y: -1 }
  return { x: v.x / length, y: v.y / length }
}
