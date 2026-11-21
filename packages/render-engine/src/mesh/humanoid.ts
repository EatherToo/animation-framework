import type { Humanoid } from '../body/assemble'
import type {
  BodyProportions,
  PalmSection,
  RadiusProfile,
  RadiusSample,
  SectionProfile,
} from '../body/proportions'
import { createMat3, multiplyMat3, type Mat3 } from '../math/mat3'
import {
  ARM_SECTIONS,
  armOutlineVertexCount,
  buildArmOutline,
  shoulderRoot,
  widthProfile,
  wristHalfWidth,
} from '../outline/arm'
import type { Fill, PartSet, SkinnedPart } from '../part/set'
import { createPose } from '../skeleton/pose'
import { multiplyRigid, RIGID_STRIDE, setRigidParentFromBone } from '../skeleton/rigid'
import { bindLength, boneName, findBone, type Skeleton } from '../skeleton/skeleton'
import { createMeshTextures } from './texture'
import { AXIAL_STEPS, TUBE_SIDES, type Mesh, type MeshSet, type MeshSpace } from './strip'

export type { Mesh } from './strip'

type Point = { x: number; y: number; z: number }

type Frame = {
  readonly ox: number
  readonly oy: number
  readonly oz: number
  /** 骨轴，单位向量 */
  readonly ax: number
  readonly ay: number
  readonly az: number
  /** 截面法线（前后），`cross(lateral, axis)`；直立骨得到 −X */
  readonly nx: number
  readonly ny: number
  readonly nz: number
  /** 截面横向（左右），世界 +Z 在垂直于骨轴的平面上的投影 */
  readonly ux: number
  readonly uy: number
  readonly uz: number
  readonly length: number
}

type Draft = {
  positions: number[]
  indices: number[]
  seam: number[]
  endShare: number[]
  skinned: boolean
}

/**
 * 按绑定姿态为每个人形部件生成网格。
 * 借来的邻骨只提供接缝，不把整段体积再放样一遍。
 */
export function createHumanoidMeshes(humanoid: Humanoid, parts: PartSet): MeshSet {
  if (parts.skeleton !== humanoid.skeleton) throw new Error('skeleton')
  const rig = writeBindRig(humanoid)
  const meshes: Mesh[] = []
  for (let i = 0; i < parts.parts.length; i += 1) {
    const part = parts.parts[i]!
    if (part.kind === 'skinned') {
      meshes.push(skinnedMesh(part, humanoid.skeleton, humanoid.proportions, rig))
    } else {
      meshes.push(rigidMesh(part.id, part.bone, humanoid.skeleton, humanoid.proportions, part.fill))
    }
  }
  return { meshes }
}

function draft(skinned: boolean): Draft {
  return { positions: [], indices: [], seam: [], endShare: [], skinned }
}

function skinnedMesh(
  part: SkinnedPart,
  skeleton: Skeleton,
  proportions: BodyProportions,
  rig: Float32Array,
): Mesh {
  if (part.id === 'torso') return torsoMesh(part, skeleton, proportions, rig)
  if (part.id === 'armL' || part.id === 'armR') return armOutlineMesh(part, skeleton, proportions, rig)
  if (part.id === 'legL' || part.id === 'legR') return legMesh(part, skeleton, proportions, rig)
  throw new Error('part')
}

function torsoMesh(
  part: SkinnedPart,
  skeleton: Skeleton,
  proportions: BodyProportions,
  rig: Float32Array,
): Mesh {
  const d = draft(true)
  const spine = frameOf(rig, skeleton, findBone(skeleton, 'spine'))
  const chest = frameOf(rig, skeleton, findBone(skeleton, 'chest'))
  const neck = frameOf(rig, skeleton, findBone(skeleton, 'neck'))
  const tS = 1 - proportions.shoulderDropY / proportions.chestLength
  const chestTs = chestStations(tS)

  const spineRings: number[] = []
  for (let k = 0; k <= AXIAL_STEPS; k += 1) {
    const t = k / AXIAL_STEPS
    const ring = addRing(
      d,
      ringPoints(spine, t, torsoSectionAt(proportions, t * proportions.spineLength), TORSO_FRONT),
    )
    setShare(d, ring, Math.max(0, 1 - 2 * t), 0)
    spineRings.push(ring)
  }
  markSeam(d, spineRings[0]!)
  link(d.indices, spineRings)

  const chestRings: number[] = [spineRings[spineRings.length - 1]!]
  for (let i = 1; i < chestTs.length; i += 1) {
    const t = chestTs[i]!
    const ring = addRing(
      d,
      ringPoints(chest, t, torsoSectionAt(proportions, proportions.spineLength + t * proportions.chestLength), TORSO_FRONT),
    )
    setShare(d, ring, 0, 0)
    chestRings.push(ring)
  }
  // 2D 手臂不再从肩孔接出去；胸段保留完整表面，手臂轮廓带叠在它上面。
  link(d.indices, chestRings)

  const neckRings: number[] = [chestRings[chestRings.length - 1]!]
  for (let k = 1; k <= AXIAL_STEPS; k += 1) {
    const t = k / AXIAL_STEPS
    const ring = addRing(d, ringPoints(neck, t, sectionAt(proportions.neckProfile, t), TORSO_FRONT))
    const headShare = t >= 0.5 ? 2 * t - 1 : 0
    setShare(d, ring, 0, headShare)
    neckRings.push(ring)
  }
  markSeam(d, neckRings[neckRings.length - 1]!)
  link(d.indices, neckRings)

  return finish(part.id, 'character', d, part.fill)
}

function armOutlineMesh(
  part: SkinnedPart,
  skeleton: Skeleton,
  proportions: BodyProportions,
  rig: Float32Array,
): Mesh {
  // 2D 轮廓带：绑定姿态下先把肩、肘、腕投到矢状面 (x, y)，z 恒为 0。
  // 采样阶段再按当前 fk 重建；投影阶段按当前视角重建屏幕轮廓。
  const side = part.id === 'armL' ? 'L' : 'R'
  const shoulder = originOf(rig, findBone(skeleton, `upperArm${side}`))
  const elbow = originOf(rig, findBone(skeleton, `lowerArm${side}`))
  const hand = findBone(skeleton, `hand${side}`)
  const wrist = originOf(rig, hand)
  const axis = axisOf(rig, hand)
  const handLength = bindLength(skeleton, hand)
  const handTip = {
    x: wrist.x + axis.x * handLength,
    y: wrist.y + axis.y * handLength,
  }
  const handDir = { x: handTip.x - wrist.x, y: handTip.y - wrist.y }
  const handBase = hand * RIGID_STRIDE
  const wristWidth = wristHalfWidth(
    handDir,
    { x: rig[handBase + 6]!, y: rig[handBase + 7]! },
    { x: rig[handBase + 3]!, y: rig[handBase + 4]! },
    proportions.palmWrist.halfWidth,
    proportions.palmWrist.halfThickness,
  )
  const root = shoulderRoot({ x: shoulder.x, y: shoulder.y }, proportions.height)
  const outline = buildArmOutline({
    shoulder: root,
    elbow: { x: elbow.x, y: elbow.y },
    wrist: { x: wrist.x, y: wrist.y },
    handDir,
    wristWidth,
    upperWidth: widthProfile(proportions.upperArmProfile),
    lowerWidth: widthProfile(proportions.lowerArmProfile),
    sections: ARM_SECTIONS,
  })
  const vertexCount = armOutlineVertexCount(ARM_SECTIONS)
  const positions = new Float32Array(vertexCount * 3)
  for (let v = 0; v < vertexCount; v += 1) {
    positions[v * 3] = outline.positions[v * 2]!
    positions[v * 3 + 1] = outline.positions[v * 2 + 1]!
    positions[v * 3 + 2] = 0
  }
  // 肩、腕两端是开口：标成接缝，描边不会在那里画封口线。
  const seam = new Uint8Array(vertexCount)
  seam[0] = 1
  seam[1] = 1
  seam[vertexCount - 2] = 1
  seam[vertexCount - 1] = 1
  return {
    partId: part.id,
    space: 'character',
    positions,
    indices: outline.indices,
    ...createMeshTextures(outline.indices, part.fill),
    seam,
    endShare: new Float32Array(vertexCount * 2),
  }
}

function legMesh(
  part: SkinnedPart,
  skeleton: Skeleton,
  proportions: BodyProportions,
  rig: Float32Array,
): Mesh {
  const d = draft(true)
  const side = part.id === 'legL' ? 1 : -1
  const spine = frameOf(rig, skeleton, findBone(skeleton, 'spine'))
  const thigh = frameOf(rig, skeleton, findBone(skeleton, `thigh${side > 0 ? 'L' : 'R'}`))
  const shin = frameOf(rig, skeleton, findBone(skeleton, `shin${side > 0 ? 'L' : 'R'}`))
  const foot = frameOf(rig, skeleton, findBone(skeleton, `foot${side > 0 ? 'L' : 'R'}`))
  const rim = hipRimPoints(spine, proportions, side)
  const end = ringPoints(thigh, 3 / 8, sectionAt(proportions.thighProfile, 3 / 8), LIMB_FRONT)
  const collar = addCollar(d, rim, end, thigh, proportions.thighProfile, 0, true, null, LIMB_FRONT, 3 / 8)
  markSeam(d, collar[0]!)
  link(d.indices, collar)

  const thighTail = addProfile(
    d,
    thigh,
    proportions.thighProfile,
    [3 / 8, 5 / 8, 7 / 8, 1],
    collar[collar.length - 1]!,
    LIMB_FRONT,
  )
  link(d.indices, thighTail)

  const shinRings = addProfile(
    d,
    shin,
    proportions.shinProfile,
    [0, 1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8],
    thighTail[thighTail.length - 1]!,
    LIMB_FRONT,
  )
  link(d.indices, shinRings)

  const ankleRim = footHoleRimPoints(proportions, side).map((point) => transformPartPoint(foot, point))
  const ankleRings = addCollar(
    d,
    ringPoints(shin, 5 / 8, sectionAt(proportions.shinProfile, 5 / 8), LIMB_FRONT),
    ankleRim,
    shin,
    null,
    1,
    false,
    shinRings[shinRings.length - 1]!,
    LIMB_FRONT,
  )
  markSeam(d, ankleRings[ankleRings.length - 1]!)
  link(d.indices, ankleRings)
  return finish(part.id, 'character', d, part.fill)
}

function rigidMesh(
  partId: string,
  bone: number,
  skeleton: Skeleton,
  proportions: BodyProportions,
  fill: Fill,
): Mesh {
  const length = bindLength(skeleton, bone)
  const name = boneName(skeleton, bone)
  if (name === 'head') return headMesh(partId, length, proportions, fill)
  if (name === 'handL' || name === 'handR') {
    return handMesh(partId, name === 'handL' ? 1 : -1, length, proportions, fill)
  }
  if (name === 'footL' || name === 'footR') return footMesh(partId, proportions, fill)
  throw new Error('part')
}

function headMesh(partId: string, length: number, proportions: BodyProportions, fill: Fill): Mesh {
  const d = draft(false)
  const frame: Frame = {
    ox: 0, oy: 0, oz: 0,
    ax: 1, ay: 0, az: 0,
    nx: 0, ny: 1, nz: 0,
    ux: 0, uy: 0, uz: 1,
    length,
  }
  const rings = addProfile(d, frame, proportions.headProfile, uniformStations(), null, HEAD_FRONT)
  markSeam(d, rings[0]!)
  link(d.indices, rings)
  addCap(d, rings[rings.length - 1]!, true)
  return finish(partId, 'part', d, fill)
}

function handMesh(
  partId: string,
  side: number,
  length: number,
  proportions: BodyProportions,
  fill: Fill,
): Mesh {
  const d = draft(false)
  const palmEnd = proportions.palmFraction * length
  const palm = palmTube(d, palmEnd, proportions.palmWrist, proportions.palmKnuckle)
  markSeam(d, palm[0]!)
  const thumbX = proportions.thumbAlong * length
  const thumbY = -proportions.thumbDrop
  const thumbZ = side * proportions.thumbOffsetZ
  const hole = thumbHole(palmEnd, thumbX, thumbY, thumbZ)
  linkExcept(d.indices, palm, (interval, j) => interval === hole.interval && hole.omitted.has(j))
  const fingers: number[] = []
  for (let f = 0; f < 4; f += 1) {
    const spread = side * proportions.fingerOffsets[f]!
    const tip = proportions.fingerLengths[f]! * length
    const root = tubeAlongX(
      d,
      palmEnd,
      0,
      spread,
      tip,
      0,
      spread,
      proportions.fingerRadius,
      proportions.fingerTipRadius,
    )
    link(d.indices, root)
    addCap(d, root[root.length - 1]!, true)
    const ring = root[0]!
    for (let j = 0; j < TUBE_SIDES; j += 1) {
      clampPalmThickness(d.positions, ring + j, proportions.palmKnuckle.halfThickness)
    }
    fingers.push(ring)
  }
  const thumb = tubeAlongX(
    d,
    thumbX,
    thumbY,
    thumbZ,
    proportions.thumbTipAlong * length,
    thumbY,
    side * proportions.thumbTipZ,
    proportions.thumbRadius,
  )
  link(d.indices, thumb)
  addCap(d, thumb[thumb.length - 1]!, true)
  weldPalmEnd(d.indices, d.positions, palm[palm.length - 1]!, fingers)
  weldThumb(d.indices, d.positions, palm, hole, thumb[0]!)
  return finish(partId, 'part', d, fill)
}

/** 掌的扁截面：`θ = 0` 落在 `+y`（掌厚），`θ = π/2` 落在 `+z`（掌宽）。 */
function palmPoint(section: PalmSection, theta: number): { y: number; z: number } {
  const power = 2 / 3
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  return {
    y: section.halfThickness * Math.sign(cos) * Math.pow(Math.abs(cos), power),
    z: section.halfWidth * Math.sign(sin) * Math.pow(Math.abs(sin), power),
  }
}

function palmTube(
  d: Draft,
  length: number,
  wrist: PalmSection,
  knuckle: PalmSection,
): number[] {
  const rings: number[] = []
  for (let k = 0; k <= AXIAL_STEPS; k += 1) {
    const u = k / AXIAL_STEPS
    const section = {
      halfWidth: wrist.halfWidth + (knuckle.halfWidth - wrist.halfWidth) * u,
      halfThickness: wrist.halfThickness + (knuckle.halfThickness - wrist.halfThickness) * u,
    }
    const points: Point[] = []
    for (let j = 0; j < TUBE_SIDES; j += 1) {
      const theta = (j * 2 * Math.PI) / TUBE_SIDES
      const { y, z } = palmPoint(section, theta)
      points.push({ x: length * u, y, z })
    }
    rings.push(addRing(d, points))
  }
  return rings
}

function footMesh(partId: string, proportions: BodyProportions, fill: Fill): Mesh {
  const d = draft(false)
  const side = partId === 'footL' ? 1 : -1
  const x0 = -proportions.heelBack
  const x1 = proportions.footLength
  const rings: number[] = []
  for (let k = 0; k <= AXIAL_STEPS; k += 1) {
    const t = k / AXIAL_STEPS
    rings.push(addRing(d, footSection(proportions, t, x0, x1, side)))
  }
  linkExcept(
    d.indices,
    rings,
    (interval, j) =>
      interval >= FOOT_HOLE_LO && interval < FOOT_HOLE_HI && j >= 1 && j <= 6,
  )
  for (const vertex of footHoleRimIndices(rings)) d.seam[vertex] = 1
  addCap(d, rings[0]!, false)
  addCap(d, rings[rings.length - 1]!, true)
  return finish(partId, 'part', d, fill)
}

function chestStations(tS: number): number[] {
  // 肩孔要 9 个插值点，胸段至少得给 11 圈；这里取 17 圈，孔占 5..15。
  const ts: number[] = []
  for (let i = 0; i <= 16; i += 1) ts.push(i / 16)
  void tS
  return ts
}

function hipRimPoints(spine: Frame, proportions: BodyProportions, side: number): Point[] {
  const base = torsoSectionAt(proportions, 0)
  const half = TUBE_SIDES / 2
  const crotchCount = TUBE_SIDES - (half + 1)
  const drop = proportions.thighLength / 10
  const crotch = (m: number): Point => {
    const beta = (m * Math.PI) / (crotchCount + 1)
    const depth = beta <= Math.PI / 2 ? base.backDepth : base.frontDepth
    return { x: -depth * Math.cos(beta), y: spine.oy - drop * Math.sin(beta), z: 0 }
  }
  const rim: Point[] = []
  if (side > 0) {
    // 前 → +Z → 后 → 裆线回到前
    for (let k = 0; k <= half; k += 1) {
      rim.push(sample(spine, 0, base, (half - k + TUBE_SIDES) % TUBE_SIDES, TORSO_FRONT))
    }
    for (let m = 1; m <= crotchCount; m += 1) rim.push(crotch(m))
  } else {
    // 前 → 裆线到后 → −Z 回到前，使裆线与左腿走向相反
    rim.push(sample(spine, 0, base, half, TORSO_FRONT))
    for (let m = crotchCount; m >= 1; m -= 1) rim.push(crotch(m))
    rim.push(sample(spine, 0, base, 0, TORSO_FRONT))
    for (let j = TUBE_SIDES - 1; j >= half + 1; j -= 1) {
      rim.push(sample(spine, 0, base, j, TORSO_FRONT))
    }
  }
  return rim
}

/** 脚背孔占的环号：随 `AXIAL_STEPS` 变，孔只跨两段，边界正好三圈。 */
const FOOT_HOLE_LO = Math.round((1 / 6) * AXIAL_STEPS)
const FOOT_HOLE_MID = FOOT_HOLE_LO + 1
const FOOT_HOLE_HI = FOOT_HOLE_LO + 2
/** 脚背孔跨的列：从 1 到 `(TUBE_SIDES - 2) / 2`，经过 90° 列。 */
const FOOT_HOLE_CM = TUBE_SIDES / 4
const FOOT_HOLE_C1 = (TUBE_SIDES - 2) / 2

function footHoleRimPoints(proportions: BodyProportions, side = 1): Point[] {
  const x0 = -proportions.heelBack
  const x1 = proportions.footLength
  const at = (ring: number, j: number) =>
    footSection(proportions, ring / AXIAL_STEPS, x0, x1, side)[j]!
  const rim: Point[] = []
  for (let j = FOOT_HOLE_CM; j <= FOOT_HOLE_C1; j += 1) rim.push(at(FOOT_HOLE_HI, j))
  rim.push(at(FOOT_HOLE_MID, FOOT_HOLE_C1))
  for (let j = FOOT_HOLE_C1; j >= 1; j -= 1) rim.push(at(FOOT_HOLE_LO, j))
  rim.push(at(FOOT_HOLE_MID, 1))
  for (let j = 1; j < FOOT_HOLE_CM; j += 1) rim.push(at(FOOT_HOLE_HI, j))
  return rim
}

function footHoleRimIndices(rings: readonly number[]): number[] {
  const at = (ring: number, j: number) => rings[ring]! + j
  const rim: number[] = []
  for (let j = FOOT_HOLE_CM; j <= FOOT_HOLE_C1; j += 1) rim.push(at(FOOT_HOLE_HI, j))
  rim.push(at(FOOT_HOLE_MID, FOOT_HOLE_C1))
  for (let j = FOOT_HOLE_C1; j >= 1; j -= 1) rim.push(at(FOOT_HOLE_LO, j))
  rim.push(at(FOOT_HOLE_MID, 1))
  for (let j = 1; j < FOOT_HOLE_CM; j += 1) rim.push(at(FOOT_HOLE_HI, j))
  return rim
}

/**
 * 接头段：从 A 放到 B，共 9 圈。chainEnd 0=链首份额，1=链尾份额。
 * writeFirst 为假时第 0 圈复用 reuseFirst。
 */
function addCollar(
  d: Draft,
  from: readonly Point[],
  to: readonly Point[],
  frame: Frame,
  profile: SectionProfile | null,
  chainEnd: 0 | 1,
  writeFirst: boolean,
  reuseFirst: number | null = null,
  frontSign: FrontSign = LIMB_FRONT,
  tEnd = 1,
): number[] {
  const rings: number[] = []
  for (let i = 0; i <= AXIAL_STEPS; i += 1) {
    const s = i / AXIAL_STEPS
    const share = chainEnd === 0 ? 1 - s : s
    if (i === 0 && !writeFirst) {
      const ring = reuseFirst!
      if (chainEnd === 0) setShare(d, ring, share, 0)
      else setShare(d, ring, 0, share)
      rings.push(ring)
      continue
    }
    const points: Point[] = []
    for (let k = 0; k < TUBE_SIDES; k += 1) {
      const a = from[k]!
      const b = to[k]!
      // 墙按圈号推进，不再用接缝点的投影：否则整段都取到最粗的一站，肩头会鼓成球。
      const tk = clamp01((i / AXIAL_STEPS) * tEnd)
      const wall =
        profile === null ? b : sample(frame, tk, sectionAt(profile, tk), k, frontSign)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
      // 控制点偏向墙，让三角肌从接缝鼓出去；0.5/0.5 会把肩头压平。
      const c = {
        x: 0.35 * mid.x + 0.65 * wall.x,
        y: 0.35 * mid.y + 0.65 * wall.y,
        z: 0.35 * mid.z + 0.65 * wall.z,
      }
      const u = 1 - s
      points.push({
        x: u * u * a.x + 2 * u * s * c.x + s * s * b.x,
        y: u * u * a.y + 2 * u * s * c.y + s * s * b.y,
        z: u * u * a.z + 2 * u * s * c.z + s * s * b.z,
      })
    }
    const ring = addRing(d, points)
    if (chainEnd === 0) setShare(d, ring, share, 0)
    else setShare(d, ring, 0, share)
    rings.push(ring)
  }
  return rings
}

function addProfile(
  d: Draft,
  frame: Frame,
  profile: SectionProfile,
  ts: readonly number[],
  reuseFirst: number | null,
  frontSign: FrontSign,
): number[] {
  const rings: number[] = []
  for (let i = 0; i < ts.length; i += 1) {
    if (i === 0 && reuseFirst !== null) {
      rings.push(reuseFirst)
      continue
    }
    const ring = addRing(d, ringPoints(frame, ts[i]!, sectionAt(profile, ts[i]!), frontSign))
    setShare(d, ring, 0, 0)
    rings.push(ring)
  }
  return rings
}

function addRing(d: Draft, points: readonly Point[]): number {
  const start = d.positions.length / 3
  for (const point of points) {
    d.positions.push(point.x, point.y, point.z)
    d.seam.push(0)
    if (d.skinned) d.endShare.push(0, 0)
  }
  return start
}

function setShare(d: Draft, ring: number, head: number, tail: number): void {
  if (!d.skinned) return
  for (let j = 0; j < TUBE_SIDES; j += 1) {
    const base = (ring + j) * 2
    d.endShare[base] = head
    d.endShare[base + 1] = tail
  }
}

function markSeam(d: Draft, ring: number): void {
  for (let j = 0; j < TUBE_SIDES; j += 1) d.seam[ring + j] = 1
}

function link(indices: number[], rings: readonly number[]): void {
  linkExcept(indices, rings, () => false)
}

function linkExcept(
  indices: number[],
  rings: readonly number[],
  skip: (interval: number, j: number) => boolean,
): void {
  for (let i = 0; i < rings.length - 1; i += 1) {
    const near = rings[i]!
    const far = rings[i + 1]!
    if (near < 0 || far < 0) continue
    for (let j = 0; j < TUBE_SIDES; j += 1) {
      if (skip(i, j)) continue
      const next = (j + 1) % TUBE_SIDES
      indices.push(near + j, near + next, far + j, near + next, far + next, far + j)
    }
  }
}

function addCap(d: Draft, ring: number, reverse: boolean): void {
  let x = 0
  let y = 0
  let z = 0
  for (let j = 0; j < TUBE_SIDES; j += 1) {
    const base = (ring + j) * 3
    x += d.positions[base]!
    y += d.positions[base + 1]!
    z += d.positions[base + 2]!
  }
  const center = d.positions.length / 3
  d.positions.push(x / TUBE_SIDES, y / TUBE_SIDES, z / TUBE_SIDES)
  d.seam.push(0)
  for (let j = 0; j < TUBE_SIDES; j += 1) {
    const next = (j + 1) % TUBE_SIDES
    if (reverse) d.indices.push(center, ring + j, ring + next)
    else d.indices.push(center, ring + next, ring + j)
  }
}

function finish(partId: string, space: MeshSpace, d: Draft, fill: Fill): Mesh {
  const positions = Float32Array.from(d.positions)
  const indices = Uint16Array.from(d.indices)
  const vertexCount = positions.length / 3
  const seam = new Uint8Array(vertexCount)
  for (let i = 0; i < d.seam.length; i += 1) seam[i] = d.seam[i]!
  const endShare = d.skinned ? Float32Array.from(d.endShare) : new Float32Array(0)
  return {
    partId,
    space,
    positions,
    indices,
    ...createMeshTextures(indices, fill),
    seam,
    endShare,
  }
}

function footSection(
  proportions: BodyProportions,
  t: number,
  x0: number,
  x1: number,
  side = 1,
): Point[] {
  const x = x0 + (x1 - x0) * t
  // 跟端收成圆角，前掌先加宽再收到趾端，形成脚跟与趾箱。
  const heelRound =
    t < 0.12 ? 0.22 + 0.78 * Math.sqrt(Math.max(0, 1 - ((0.12 - t) / 0.12) ** 2)) : 1
  const toeBox = t > 0.8 ? 1 + 0.1 * Math.sin(((t - 0.8) / 0.2) * Math.PI) : 1
  // 内侧足弓：脚掌靠中线的一侧在中段抬起，外侧保持贴地。
  const arch = 0.006 * proportions.height * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.2) / 0.5)))
  const halfWidth = radiusAt(proportions.footHalfWidth, t) * heelRound * toeBox
  const instep = radiusAt(proportions.footInstep, t) * heelRound
  const points: Point[] = []
  for (let j = 0; j < TUBE_SIDES; j += 1) {
    const theta = (j * 2 * Math.PI) / TUBE_SIDES
    const lifted = Math.max(0, (Math.sin(theta) + 1) / 2)
    const medial = Math.max(0, -side * Math.cos(theta))
    points.push({
      x,
      y: -proportions.ankleHeight + instep * lifted + arch * medial,
      z: -halfWidth * Math.cos(theta),
    })
  }
  return points
}

function transformPartPoint(frame: Frame, point: Point): Point {
  return {
    x: frame.ox + frame.ax * point.x + frame.nx * point.y + frame.ux * point.z,
    y: frame.oy + frame.ay * point.x + frame.ny * point.y + frame.uy * point.z,
    z: frame.oz + frame.az * point.x + frame.nz * point.y + frame.uz * point.z,
  }
}

type ThumbHole = { interval: number; omitted: Set<number>; j0: number; count: number }

function thumbHole(palmEnd: number, thumbX: number, thumbY: number, thumbZ: number): ThumbHole {
  const along = Math.min(AXIAL_STEPS - 1, Math.max(0, Math.floor((thumbX / palmEnd) * AXIAL_STEPS)))
  let theta = Math.atan2(thumbZ, thumbY)
  if (theta < 0) theta += Math.PI * 2
  const count = 4
  const j0 = Math.round((theta / (Math.PI * 2)) * TUBE_SIDES) - count / 2
  const omitted = new Set<number>()
  for (let s = 0; s < count; s += 1) omitted.add(mod(j0 + s))
  return { interval: along, omitted, j0, count }
}

/** 指根环压进掌的厚度范围，避免指管露到掌背或掌心之外。 */
function clampPalmThickness(positions: number[], vertex: number, halfThickness: number): void {
  const y = positions[vertex * 3 + 1]!
  const limit = halfThickness * 0.98
  if (Math.abs(y) <= limit) return
  positions[vertex * 3 + 1] = Math.sign(y) * limit
}

function weldPalmEnd(indices: number[], positions: number[], palm: number, fingers: readonly number[]): void {
  const poly: number[] = []
  for (let j = 0; j < TUBE_SIDES; j += 1) poly.push(palm + j)
  for (const finger of fingers) {
    const hole = [finger]
    for (let j = TUBE_SIDES - 1; j >= 1; j -= 1) hole.push(finger + j)
    spliceHole(poly, hole, positions)
  }
  earClip(indices, poly, positions)
}

function weldThumb(
  indices: number[],
  positions: number[],
  palm: readonly number[],
  hole: ThumbHole,
  thumb: number,
): void {
  const near = palm[hole.interval]!
  const far = palm[hole.interval + 1]!
  const boundary: number[] = []
  for (let s = 0; s <= hole.count; s += 1) boundary.push(near + mod(hole.j0 + s))
  for (let s = 0; s <= hole.count; s += 1) boundary.push(far + mod(hole.j0 + hole.count - s))
  const ring = [thumb]
  for (let j = TUBE_SIDES - 1; j >= 1; j -= 1) ring.push(thumb + j)
  zip(indices, positions, boundary, ring)
}

function spliceHole(poly: number[], hole: number[], positions: number[]): void {
  let best = Number.POSITIVE_INFINITY
  let holeAt = 0
  let polyAt = 0
  for (let h = 0; h < hole.length; h += 1) {
    for (let p = 0; p < poly.length; p += 1) {
      const gap = vertexGap(positions, hole[h]!, poly[p]!)
      if (gap >= best || !bridgeFree(poly, hole, hole[h]!, poly[p]!, positions)) continue
      best = gap
      holeAt = h
      polyAt = p
    }
  }
  if (!Number.isFinite(best)) throw new Error('weld')
  const rotated = hole.slice(holeAt).concat(hole.slice(0, holeAt))
  poly.splice(polyAt + 1, 0, ...rotated, rotated[0]!, poly[polyAt]!)
}

function bridgeFree(
  poly: readonly number[],
  hole: readonly number[],
  from: number,
  to: number,
  positions: number[],
): boolean {
  if (hitsLoop(from, to, poly, positions) || hitsLoop(from, to, hole, positions)) return false
  const y = (positions[from * 3 + 1]! + positions[to * 3 + 1]!) / 2
  const z = (positions[from * 3 + 2]! + positions[to * 3 + 2]!) / 2
  return contains(poly, y, z, positions)
}

function earClip(indices: number[], poly: number[], positions: number[]): void {
  const loop = poly.slice()
  let guard = loop.length * loop.length
  while (loop.length > 3) {
    let clipped = false
    for (let i = 0; i < loop.length; i += 1) {
      const prev = loop[(i + loop.length - 1) % loop.length]!
      const curr = loop[i]!
      const next = loop[(i + 1) % loop.length]!
      if (orient(positions, prev, curr, next) <= 1e-10) continue
      if (
        loop.some((other, index) => {
          if (index === i || other === prev || other === curr || other === next) return false
          return insideTri(positions, other, prev, curr, next)
        })
      ) {
        continue
      }
      indices.push(prev, curr, next)
      loop.splice(i, 1)
      clipped = true
      break
    }
    guard -= 1
    if (!clipped || guard < 0) throw new Error('weld')
  }
  indices.push(loop[0]!, loop[1]!, loop[2]!)
}

function zip(indices: number[], positions: number[], left: number[], right: number[]): void {
  const a = spin(left, nearest(left, right[0]!, positions))
  const b = spin(right, nearest(right, a[0]!, positions))
  const n = a.length
  const m = b.length
  const used = new Set<string>()
  const chosen: number[] = []
  const free = (p: number, q: number, r: number) =>
    !used.has(`${p}:${q}`) && !used.has(`${q}:${r}`) && !used.has(`${r}:${p}`)
  const take = (p: number, q: number, r: number) => {
    used.add(`${p}:${q}`)
    used.add(`${q}:${r}`)
    used.add(`${r}:${p}`)
    chosen.push(p, q, r)
  }
  const drop = (p: number, q: number, r: number) => {
    used.delete(`${p}:${q}`)
    used.delete(`${q}:${r}`)
    used.delete(`${r}:${p}`)
    chosen.length -= 3
  }
  const search = (i: number, j: number): boolean => {
    if (i === n && j === m) return true
    const hole = i < n ? [a[i]!, a[(i + 1) % n]!, b[j === m ? 0 : (j + 1) % m]!] : null
    const thumb = j < m ? [a[i === n ? 0 : (i + 1) % n]!, b[j]!, b[(j + 1) % m]!] : null
    const options = [hole, thumb]
    for (let k = 0; k < options.length; k += 1) {
      const tri = options[k]
      if (tri === null || tri === undefined || !free(tri[0]!, tri[1]!, tri[2]!)) continue
      const p = tri[0]!
      const q = tri[1]!
      const r = tri[2]!
      take(p, q, r)
      if (search(i + (k === 0 ? 1 : 0), j + (k === 1 ? 1 : 0))) return true
      drop(p, q, r)
    }
    return false
  }
  if (!search(0, 0)) throw new Error('weld')
  for (const index of chosen) indices.push(index)
}

function spin(loop: readonly number[], start: number): number[] {
  return loop.slice(start).concat(loop.slice(0, start))
}

function nearest(loop: readonly number[], target: number, positions: number[]): number {
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < loop.length; i += 1) {
    const gap = vertexGap(positions, loop[i]!, target)
    if (gap < bestDist) {
      bestDist = gap
      best = i
    }
  }
  return best
}

function hitsLoop(from: number, to: number, loop: readonly number[], positions: number[]): boolean {
  for (let i = 0; i < loop.length; i += 1) {
    const c = loop[i]!
    const d = loop[(i + 1) % loop.length]!
    if (c === from || c === to || d === from || d === to) continue
    if (segmentsCross(positions, from, to, c, d)) return true
  }
  return false
}

function contains(poly: readonly number[], y: number, z: number, positions: number[]): boolean {
  let inside = false
  for (let i = 0; i < poly.length; i += 1) {
    const a = yz(positions, poly[i]!)
    const b = yz(positions, poly[(i + 1) % poly.length]!)
    if ((a.z > z) === (b.z > z)) continue
    const at = a.y + ((b.y - a.y) * (z - a.z)) / (b.z - a.z)
    if (at > y) inside = !inside
  }
  return inside
}

function insideTri(positions: number[], point: number, a: number, b: number, c: number): boolean {
  const ab = orient(positions, a, b, point)
  const bc = orient(positions, b, c, point)
  const ca = orient(positions, c, a, point)
  return ab > 1e-12 && bc > 1e-12 && ca > 1e-12
}

function segmentsCross(positions: number[], a: number, b: number, c: number, d: number): boolean {
  const o1 = orient(positions, a, b, c)
  const o2 = orient(positions, a, b, d)
  const o3 = orient(positions, c, d, a)
  const o4 = orient(positions, c, d, b)
  return o1 * o2 < 0 && o3 * o4 < 0
}

function orient(positions: number[], a: number, b: number, c: number): number {
  const pa = yz(positions, a)
  const pb = yz(positions, b)
  const pc = yz(positions, c)
  return (pb.y - pa.y) * (pc.z - pa.z) - (pb.z - pa.z) * (pc.y - pa.y)
}

function yz(positions: number[], index: number): { y: number; z: number } {
  return { y: positions[index * 3 + 1]!, z: positions[index * 3 + 2]! }
}

function vertexGap(positions: number[], a: number, b: number): number {
  const dx = positions[a * 3]! - positions[b * 3]!
  const dy = positions[a * 3 + 1]! - positions[b * 3 + 1]!
  const dz = positions[a * 3 + 2]! - positions[b * 3 + 2]!
  return dx * dx + dy * dy + dz * dz
}

function mod(j: number): number {
  return ((j % TUBE_SIDES) + TUBE_SIDES) % TUBE_SIDES
}

function tubeAlongX(
  d: Draft,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  radius: number,
  tipRadius = radius,
): number[] {
  const rings: number[] = []
  for (let k = 0; k <= AXIAL_STEPS; k += 1) {
    const u = k / AXIAL_STEPS
    // 近节粗、远节细，指节处留一个小鼓包；单段管也能看出分节。
    const taper = radius + (tipRadius - radius) * u
    const knuckle = 0.00035 * Math.exp(-(((u - 0.55) / 0.12) ** 2))
    const at = taper + knuckle
    const points: Point[] = []
    for (let j = 0; j < TUBE_SIDES; j += 1) {
      const theta = (j * 2 * Math.PI) / TUBE_SIDES
      points.push({
        x: x0 + (x1 - x0) * u,
        y: y0 + (y1 - y0) * u + at * Math.cos(theta),
        z: z0 + (z1 - z0) * u + at * Math.sin(theta),
      })
    }
    rings.push(addRing(d, points))
  }
  return rings
}

function uniformStations(): number[] {
  const ts: number[] = []
  for (let k = 0; k <= AXIAL_STEPS; k += 1) ts.push(k / AXIAL_STEPS)
  return ts
}

/** 截面 `+along` 指向角色哪一侧：躯干和头的骨轴法线朝 −X，四肢朝 +X。 */
type FrontSign = 1 | -1

const TORSO_FRONT: FrontSign = -1
const LIMB_FRONT: FrontSign = 1
const HEAD_FRONT: FrontSign = -1

/** 插值后的一站截面，四个量都已换成米或无量纲。 */
type SectionValues = {
  readonly halfWidth: number
  readonly frontDepth: number
  readonly backDepth: number
  readonly exponent: number
}

/** 躯干站位表按「骨盆原点以上的高度」取样，和骨轴的 `t` 无关。 */
function torsoSectionAt(proportions: BodyProportions, heightAboveHip: number): SectionValues {
  const total = proportions.spineLength + proportions.chestLength
  return sectionAt(proportions.torsoProfile, heightAboveHip / total)
}

function sectionAt(profile: SectionProfile, t: number): SectionValues {
  for (let i = 0; i < profile.length - 1; i += 1) {
    const left = profile[i]!
    const right = profile[i + 1]!
    if (t < left.t || t > right.t) continue
    const span = right.t - left.t
    const u = span === 0 ? 0 : (t - left.t) / span
    return {
      halfWidth: left.halfWidth * (1 - u) + right.halfWidth * u,
      frontDepth: left.frontDepth * (1 - u) + right.frontDepth * u,
      backDepth: left.backDepth * (1 - u) + right.backDepth * u,
      exponent: left.exponent * (1 - u) + right.exponent * u,
    }
  }
  throw new Error('section')
}

/**
 * 超椭圆截面上的点。`θ = 0` 落在 `along` 正侧，`θ = π/2` 落在 `+lateral`。
 * `frontSign` 说明 `along` 正侧是不是角色的前方，只切换用前深还是后深，不改环的走向。
 */
function sectionPoint(
  section: SectionValues,
  theta: number,
  frontSign: FrontSign,
): { along: number; lateral: number } {
  const power = 2 / section.exponent
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const towardFront = (cos >= 0) === (frontSign > 0)
  const depth = (towardFront ? section.frontDepth : section.backDepth) * Math.pow(Math.abs(cos), power)
  return {
    along: cos >= 0 ? depth : -depth,
    lateral: section.halfWidth * Math.sign(sin) * Math.pow(Math.abs(sin), power),
  }
}

/** 圆截面：腕口与掌根共用的临时形状。 */
function circle(radius: number): SectionValues {
  return { halfWidth: radius, frontDepth: radius, backDepth: radius, exponent: 2 }
}

function ringPoints(
  frame: Frame,
  t: number,
  section: SectionValues,
  frontSign: FrontSign,
): Point[] {
  const points: Point[] = []
  for (let j = 0; j < TUBE_SIDES; j += 1) points.push(sample(frame, t, section, j, frontSign))
  return points
}

function sample(
  frame: Frame,
  t: number,
  section: SectionValues,
  j: number,
  frontSign: FrontSign,
): Point {
  const theta = (j * 2 * Math.PI) / TUBE_SIDES
  const { along, lateral } = sectionPoint(section, theta, frontSign)
  const at = frame.length * t
  return {
    x: frame.ox + frame.ax * at + frame.nx * along + frame.ux * lateral,
    y: frame.oy + frame.ay * at + frame.ny * along + frame.uy * lateral,
    z: frame.oz + frame.az * at + frame.nz * along + frame.uz * lateral,
  }
}

function dotAxis(point: Point, frame: Frame): number {
  const dx = point.x - frame.ox
  const dy = point.y - frame.oy
  const dz = point.z - frame.oz
  return (dx * frame.ax + dy * frame.ay + dz * frame.az) * frame.length
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function frameOf(rig: Float32Array, skeleton: Skeleton, bone: number): Frame {
  const base = bone * RIGID_STRIDE
  const ax = rig[base]!
  const ay = rig[base + 1]!
  const az = rig[base + 2]!
  const length = bindLength(skeleton, bone)
  // 世界 +Z 去掉沿骨轴的分量，得到截面的横向；直立骨得到 (0, 0, 1)。
  let ux = -az * ax
  let uy = -az * ay
  let uz = 1 - az * az
  const norm = Math.hypot(ux, uy, uz) || 1
  ux /= norm
  uy /= norm
  uz /= norm
  // 法线 = cross(lateral, axis)：直立骨得到 −X，与既有 frontSign 常量一致。
  return {
    ox: rig[base + 9]!,
    oy: rig[base + 10]!,
    oz: rig[base + 11]!,
    ax,
    ay,
    az,
    nx: uy * az - uz * ay,
    ny: uz * ax - ux * az,
    nz: ux * ay - uy * ax,
    ux,
    uy,
    uz,
    length,
  }
}

function radiusAt(profile: readonly RadiusSample[], t: number): number {
  for (let i = 0; i < profile.length - 1; i += 1) {
    const left = profile[i]!
    const right = profile[i + 1]!
    if (t < left.t || t > right.t) continue
    const span = right.t - left.t
    const u = span === 0 ? 0 : (t - left.t) / span
    return left.radius * (1 - u) + right.radius * u
  }
  throw new Error('radius')
}

/** 绑定刚体里某根骨的平移。 */
function originOf(rig: Float32Array, bone: number): { x: number; y: number; z: number } {
  const base = bone * RIGID_STRIDE
  return { x: rig[base + 9]!, y: rig[base + 10]!, z: rig[base + 11]! }
}

/** 绑定刚体里某根骨的单位轴。 */
function axisOf(rig: Float32Array, bone: number): { x: number; y: number; z: number } {
  const base = bone * RIGID_STRIDE
  return { x: rig[base]!, y: rig[base + 1]!, z: rig[base + 2]! }
}

function writeBindRig(humanoid: Humanoid): Float32Array {
  const skeleton = humanoid.skeleton
  const pose = createPose(skeleton)
  const rig = new Float32Array(skeleton.boneCount * RIGID_STRIDE)
  const local = new Float32Array(RIGID_STRIDE)
  const parent = new Float32Array(RIGID_STRIDE)
  const combined = new Float32Array(RIGID_STRIDE)
  for (let bone = 0; bone < skeleton.boneCount; bone += 1) {
    const joint = humanoid.joints[bone]!
    setRigidParentFromBone(local, skeleton, pose, bone, joint.swingSign, joint.twistSign)
    const parentIndex = skeleton.parent[bone]!
    const dst = bone * RIGID_STRIDE
    if (parentIndex < 0) {
      rig.set(local, dst)
      continue
    }
    parent.set(rig.subarray(parentIndex * RIGID_STRIDE, (parentIndex + 1) * RIGID_STRIDE))
    multiplyRigid(combined, parent, local)
    rig.set(combined, dst)
  }
  return rig
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
