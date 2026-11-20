import type { Humanoid } from '../body/assemble'
import type {
  BodyProportions,
  PalmSection,
  RadiusProfile,
  RadiusSample,
  SectionProfile,
} from '../body/proportions'
import { createMat3, multiplyMat3, type Mat3 } from '../math/mat3'
import type { Fill, PartSet, SkinnedPart } from '../part/set'
import { bindLength, boneName, findBone, type Skeleton } from '../skeleton/skeleton'
import { setBindParentFromBone } from '../skeleton/parent-from-bone'
import { createMeshTextures } from './texture'
import { AXIAL_STEPS, TUBE_SIDES, type Mesh, type MeshSet, type MeshSpace } from './strip'

export type { Mesh } from './strip'

type Point = { x: number; y: number; z: number }

type Frame = {
  readonly ox: number
  readonly oy: number
  readonly oz: number
  readonly ax: number
  readonly ay: number
  readonly px: number
  readonly py: number
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
  const rig = writeBindRig(humanoid.skeleton)
  const lateral = writeBindLateral(humanoid.skeleton)
  const meshes: Mesh[] = []
  for (let i = 0; i < parts.parts.length; i += 1) {
    const part = parts.parts[i]!
    if (part.kind === 'skinned') {
      meshes.push(skinnedMesh(part, humanoid.skeleton, humanoid.proportions, rig, lateral))
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
  lateral: Float32Array,
): Mesh {
  if (part.id === 'torso') return torsoMesh(part, skeleton, proportions, rig, lateral)
  if (part.id === 'armL' || part.id === 'armR') return armMesh(part, skeleton, proportions, rig, lateral)
  if (part.id === 'legL' || part.id === 'legR') return legMesh(part, skeleton, proportions, rig, lateral)
  throw new Error('part')
}

function torsoMesh(
  part: SkinnedPart,
  skeleton: Skeleton,
  proportions: BodyProportions,
  rig: Float32Array,
  lateral: Float32Array,
): Mesh {
  const d = draft(true)
  const spine = frameOf(rig, lateral, skeleton, findBone(skeleton, 'spine'))
  const chest = frameOf(rig, lateral, skeleton, findBone(skeleton, 'chest'))
  const neck = frameOf(rig, lateral, skeleton, findBone(skeleton, 'neck'))
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
  const holeLo = 3
  const holeHi = 9
  linkExcept(d.indices, chestRings, (interval, j) => {
    if (interval < holeLo || interval >= holeHi) return false
    return j === 3 || j === 4 || j === 11 || j === 12
  })

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

  for (const side of [1, -1] as const) {
    const rim = shoulderRimIndices(chestRings, holeLo, holeHi, side)
    for (const vertex of rim) d.seam[vertex] = 1
  }
  return finish(part.id, 'character', d, part.fill)
}

function armMesh(
  part: SkinnedPart,
  skeleton: Skeleton,
  proportions: BodyProportions,
  rig: Float32Array,
  lateral: Float32Array,
): Mesh {
  const d = draft(true)
  const side = part.id === 'armL' ? 1 : -1
  const chest = frameOf(rig, lateral, skeleton, findBone(skeleton, 'chest'))
  const upper = frameOf(rig, lateral, skeleton, findBone(skeleton, `upperArm${side > 0 ? 'L' : 'R'}`))
  const lower = frameOf(rig, lateral, skeleton, findBone(skeleton, `lowerArm${side > 0 ? 'L' : 'R'}`))
  const tS = 1 - proportions.shoulderDropY / proportions.chestLength
  const chestTs = chestStations(tS)
  const chestRingsPoints = chestTs.map((t) =>
    ringPoints(
      chest,
      t,
      torsoSectionAt(proportions, proportions.spineLength + t * proportions.chestLength),
      TORSO_FRONT,
    ),
  )
  const rim = shoulderRimPoints(chestRingsPoints, 3, 9, side)
  const end = ringPoints(upper, 6 / 8, sectionAt(proportions.upperArmProfile, 6 / 8), LIMB_FRONT)
  const collar = addCollar(d, rim, end, upper, proportions.upperArmProfile, 0, true, null, LIMB_FRONT)
  markSeam(d, collar[0]!)
  link(d.indices, collar)

  const upperTail = addProfile(
    d,
    upper,
    proportions.upperArmProfile,
    [6 / 8, 7 / 8, 1],
    collar[collar.length - 1]!,
    LIMB_FRONT,
  )
  link(d.indices, upperTail)

  const forearm = addProfile(
    d,
    lower,
    proportions.lowerArmProfile,
    [0, 1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8],
    upperTail[upperTail.length - 1]!,
    LIMB_FRONT,
  )
  link(d.indices, forearm)

  const wristTo = ringPoints(
    lower,
    1,
    {
      halfWidth: proportions.palmWrist.halfWidth,
      frontDepth: proportions.palmWrist.halfThickness,
      backDepth: proportions.palmWrist.halfThickness,
      exponent: 3,
    },
    LIMB_FRONT,
  )
  const wristRings = addCollar(
    d,
    ringPoints(lower, 5 / 8, sectionAt(proportions.lowerArmProfile, 5 / 8), LIMB_FRONT),
    wristTo,
    lower,
    null,
    1,
    false,
    forearm[forearm.length - 1]!,
    LIMB_FRONT,
  )
  markSeam(d, wristRings[wristRings.length - 1]!)
  link(d.indices, wristRings)
  return finish(part.id, 'character', d, part.fill)
}

function legMesh(
  part: SkinnedPart,
  skeleton: Skeleton,
  proportions: BodyProportions,
  rig: Float32Array,
  lateral: Float32Array,
): Mesh {
  const d = draft(true)
  const side = part.id === 'legL' ? 1 : -1
  const spine = frameOf(rig, lateral, skeleton, findBone(skeleton, 'spine'))
  const thigh = frameOf(rig, lateral, skeleton, findBone(skeleton, `thigh${side > 0 ? 'L' : 'R'}`))
  const shin = frameOf(rig, lateral, skeleton, findBone(skeleton, `shin${side > 0 ? 'L' : 'R'}`))
  const foot = frameOf(rig, lateral, skeleton, findBone(skeleton, `foot${side > 0 ? 'L' : 'R'}`))
  const rim = hipRimPoints(spine, proportions, side)
  const end = ringPoints(thigh, 6 / 8, sectionAt(proportions.thighProfile, 6 / 8), LIMB_FRONT)
  const collar = addCollar(d, rim, end, thigh, proportions.thighProfile, 0, true, null, LIMB_FRONT)
  markSeam(d, collar[0]!)
  link(d.indices, collar)

  const thighTail = addProfile(
    d,
    thigh,
    proportions.thighProfile,
    [6 / 8, 7 / 8, 1],
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

  const ankleRim = footHoleRimPoints(proportions).map((point) => transformPartPoint(foot, point))
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
  const frame: Frame = { ox: 0, oy: 0, oz: 0, ax: 1, ay: 0, px: 0, py: 1, length }
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
    const root = tubeAlongX(d, palmEnd, 0, spread, tip, 0, spread, proportions.fingerRadius)
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
  const x0 = -proportions.heelBack
  const x1 = proportions.footLength
  const rings: number[] = []
  for (let k = 0; k <= AXIAL_STEPS; k += 1) {
    const t = k / AXIAL_STEPS
    rings.push(addRing(d, footSection(proportions, t, x0, x1)))
  }
  linkExcept(d.indices, rings, (interval, j) => interval >= 1 && interval < 3 && j >= 1 && j <= 6)
  for (const vertex of footHoleRimIndices(rings)) d.seam[vertex] = 1
  addCap(d, rings[0]!, false)
  addCap(d, rings[rings.length - 1]!, true)
  return finish(partId, 'part', d, fill)
}

function chestStations(tS: number): number[] {
  const ts = [0, 1 / 8, 2 / 8, 3 / 8]
  for (let i = 1; i <= 6; i += 1) ts.push(3 / 8 + (i * (tS - 3 / 8)) / 6)
  ts.push(1)
  return ts
}

function shoulderRimPoints(
  chestRings: readonly Point[][],
  holeLo: number,
  holeHi: number,
  side: number,
): Point[] {
  const jf = side > 0 ? 5 : 11
  const jc = side > 0 ? 4 : 12
  const jb = side > 0 ? 3 : 13
  const left: Point[] = new Array(TUBE_SIDES)
  left[4] = chestRings[holeHi]![jc]!
  left[3] = chestRings[holeHi]![jf]!
  left[5] = chestRings[holeHi]![jb]!
  left[12] = chestRings[holeLo]![jc]!
  left[13] = chestRings[holeLo]![jf]!
  left[11] = chestRings[holeLo]![jb]!
  const frontK = [14, 15, 0, 1, 2]
  const backK = [10, 9, 8, 7, 6]
  for (let m = 0; m < 5; m += 1) {
    left[frontK[m]!] = chestRings[holeLo + 1 + m]![jf]!
    left[backK[m]!] = chestRings[holeLo + 1 + m]![jb]!
  }
  if (side > 0) return left
  return Array.from({ length: TUBE_SIDES }, (_, k) => left[(TUBE_SIDES - k) % TUBE_SIDES]!)
}

function shoulderRimIndices(
  chestRings: readonly number[],
  holeLo: number,
  holeHi: number,
  side: number,
): number[] {
  const jf = side > 0 ? 5 : 11
  const jc = side > 0 ? 4 : 12
  const jb = side > 0 ? 3 : 13
  const left: number[] = new Array(TUBE_SIDES)
  left[4] = chestRings[holeHi]! + jc
  left[3] = chestRings[holeHi]! + jf
  left[5] = chestRings[holeHi]! + jb
  left[12] = chestRings[holeLo]! + jc
  left[13] = chestRings[holeLo]! + jf
  left[11] = chestRings[holeLo]! + jb
  const frontK = [14, 15, 0, 1, 2]
  const backK = [10, 9, 8, 7, 6]
  for (let m = 0; m < 5; m += 1) {
    left[frontK[m]!] = chestRings[holeLo + 1 + m]! + jf
    left[backK[m]!] = chestRings[holeLo + 1 + m]! + jb
  }
  if (side > 0) return left
  return Array.from({ length: TUBE_SIDES }, (_, k) => left[(TUBE_SIDES - k) % TUBE_SIDES]!)
}

function hipRimPoints(spine: Frame, proportions: BodyProportions, side: number): Point[] {
  const base = torsoSectionAt(proportions, 0)
  const drop = proportions.thighLength / 8
  const crotch = (m: number): Point => {
    const beta = (m * Math.PI) / 8
    const depth = beta <= Math.PI / 2 ? base.backDepth : base.frontDepth
    return { x: -depth * Math.cos(beta), y: spine.oy - drop * Math.sin(beta), z: 0 }
  }
  const rim: Point[] = []
  if (side > 0) {
    // 前 → +Z → 后 → 裆线回到前
    for (let k = 0; k <= 8; k += 1) rim.push(sample(spine, 0, base, 8 - k, TORSO_FRONT))
    for (let m = 1; m <= 7; m += 1) rim.push(crotch(m))
  } else {
    // 前 → 裆线到后 → −Z 回到前，使裆线与左腿走向相反
    rim.push(sample(spine, 0, base, 8, TORSO_FRONT))
    for (let m = 7; m >= 1; m -= 1) rim.push(crotch(m))
    rim.push(sample(spine, 0, base, 0, TORSO_FRONT))
    for (let j = 15; j >= 9; j -= 1) rim.push(sample(spine, 0, base, j, TORSO_FRONT))
  }
  return rim
}

function footHoleRimPoints(proportions: BodyProportions): Point[] {
  const x0 = -proportions.heelBack
  const x1 = proportions.footLength
  const at = (s: number, j: number) => footSection(proportions, s, x0, x1)[j]!
  return [
    at(3 / 8, 4),
    at(3 / 8, 5),
    at(3 / 8, 6),
    at(3 / 8, 7),
    at(2 / 8, 7),
    at(1 / 8, 7),
    at(1 / 8, 6),
    at(1 / 8, 5),
    at(1 / 8, 4),
    at(1 / 8, 3),
    at(1 / 8, 2),
    at(1 / 8, 1),
    at(2 / 8, 1),
    at(3 / 8, 1),
    at(3 / 8, 2),
    at(3 / 8, 3),
  ]
}

function footHoleRimIndices(rings: readonly number[]): number[] {
  const at = (s: number, j: number) => rings[s]! + j
  return [
    at(3, 4),
    at(3, 5),
    at(3, 6),
    at(3, 7),
    at(2, 7),
    at(1, 7),
    at(1, 6),
    at(1, 5),
    at(1, 4),
    at(1, 3),
    at(1, 2),
    at(1, 1),
    at(2, 1),
    at(3, 1),
    at(3, 2),
    at(3, 3),
  ]
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
      const tk = clamp01(dotAxis(a, frame) / (frame.length * frame.length))
      const wall =
        profile === null ? b : sample(frame, tk, sectionAt(profile, tk), k, frontSign)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
      const c = {
        x: 0.5 * mid.x + 0.5 * wall.x,
        y: 0.5 * mid.y + 0.5 * wall.y,
        z: 0.5 * mid.z + 0.5 * wall.z,
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

function footSection(proportions: BodyProportions, t: number, x0: number, x1: number): Point[] {
  const x = x0 + (x1 - x0) * t
  const points: Point[] = []
  for (let j = 0; j < TUBE_SIDES; j += 1) {
    const theta = (j * 2 * Math.PI) / TUBE_SIDES
    const lifted = Math.max(0, (Math.sin(theta) + 1) / 2)
    points.push({
      x,
      y: -proportions.ankleHeight + radiusAt(proportions.footInstep, t) * lifted,
      z: -radiusAt(proportions.footHalfWidth, t) * Math.cos(theta),
    })
  }
  return points
}

function transformPartPoint(frame: Frame, point: Point): Point {
  return {
    x: frame.ox + frame.ax * point.x + frame.px * point.y,
    y: frame.oy + frame.ay * point.x + frame.py * point.y,
    z: frame.oz + point.z,
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
): number[] {
  const rings: number[] = []
  for (let k = 0; k <= AXIAL_STEPS; k += 1) {
    const u = k / AXIAL_STEPS
    const points: Point[] = []
    for (let j = 0; j < TUBE_SIDES; j += 1) {
      const theta = (j * 2 * Math.PI) / TUBE_SIDES
      points.push({
        x: x0 + (x1 - x0) * u,
        y: y0 + (y1 - y0) * u + radius * Math.cos(theta),
        z: z0 + (z1 - z0) * u + radius * Math.sin(theta),
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
  return {
    x: frame.ox + frame.ax * frame.length * t + frame.px * along,
    y: frame.oy + frame.ay * frame.length * t + frame.py * along,
    z: frame.oz + lateral,
  }
}

function dotAxis(point: Point, frame: Frame): number {
  const dx = point.x - frame.ox
  const dy = point.y - frame.oy
  return dx * frame.ax * frame.length + dy * frame.ay * frame.length
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function frameOf(rig: Float32Array, lateral: Float32Array, skeleton: Skeleton, bone: number): Frame {
  const length = bindLength(skeleton, bone)
  const base = bone * 9
  const ax = rig[base]!
  const ay = rig[base + 1]!
  return {
    ox: rig[base + 6]!,
    oy: rig[base + 7]!,
    oz: lateral[bone]!,
    ax,
    ay,
    px: -ay,
    py: ax,
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

function writeBindRig(skeleton: Skeleton): Float32Array {
  const rig = new Float32Array(skeleton.boneCount * 9)
  const local = createMat3()
  const parent = createMat3()
  const combined = createMat3()
  for (let bone = 0; bone < skeleton.boneCount; bone += 1) {
    setBindParentFromBone(local, skeleton, bone)
    const parentIndex = skeleton.parent[bone]!
    const dst = bone * 9
    const source = parentIndex < 0 ? local : combine(combined, parent, rig, parentIndex, local)
    for (let k = 0; k < 9; k += 1) rig[dst + k] = source[k]!
  }
  return rig
}

function writeBindLateral(skeleton: Skeleton): Float32Array {
  const lateral = new Float32Array(skeleton.boneCount)
  for (let bone = 0; bone < skeleton.boneCount; bone += 1) {
    const parentIndex = skeleton.parent[bone]!
    const own = skeleton.bindLateral[bone]!
    lateral[bone] = parentIndex < 0 ? own : lateral[parentIndex]! + own
  }
  return lateral
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
