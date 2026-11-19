import { TUBE_SIDES } from '@animation-framework/render-engine/mesh/strip'

/** 正面白膜。0° 是参考图里的 T 字站姿，身高 1.8 米。网格一格就是引擎圆管的一块。 */
export const MANNEQUIN_HEIGHT = 1.8

/** 引擎里的正面视角：屏幕横轴是角色 z，竖轴是 y。 */
export const FRONT_VIEW = 90

const CLAY = 0
const JOINT = 1

export type MannequinMesh = {
  readonly positions: Float32Array
  readonly quads: Uint32Array
  /** 与四边形一一对应：0 白膜，1 关节。 */
  readonly materials: Uint8Array
}

type Vec3 = readonly [number, number, number]

/**
 * 弧度，0 是 T 字站姿。
 * 肩、髋是球窝，各有屈伸、展收、旋转。肘、膝、前臂是铰链。腕和踝各有屈伸和侧向活动。
 * 屈的正角度朝前，展的正角度离开躯干，肘的负角度朝前弯，膝的负角度朝后弯。
 * 腕屈的正角度手指向上，踝屈的正角度脚尖上抬。
 */
export type MannequinPose = {
  readonly shoulderFlexL: number
  readonly shoulderAbdL: number
  readonly shoulderRotL: number
  readonly elbowL: number
  readonly forearmL: number
  readonly wristFlexL: number
  readonly wristDevL: number
  readonly shoulderFlexR: number
  readonly shoulderAbdR: number
  readonly shoulderRotR: number
  readonly elbowR: number
  readonly forearmR: number
  readonly wristFlexR: number
  readonly wristDevR: number
  readonly hipFlexL: number
  readonly hipAbdL: number
  readonly hipRotL: number
  readonly kneeL: number
  readonly ankleFlexL: number
  readonly ankleRollL: number
  readonly hipFlexR: number
  readonly hipAbdR: number
  readonly hipRotR: number
  readonly kneeR: number
  readonly ankleFlexR: number
  readonly ankleRollR: number
}

export const REST_POSE: MannequinPose = {
  shoulderFlexL: 0,
  shoulderAbdL: 0,
  shoulderRotL: 0,
  elbowL: 0,
  forearmL: 0,
  wristFlexL: 0,
  wristDevL: 0,
  shoulderFlexR: 0,
  shoulderAbdR: 0,
  shoulderRotR: 0,
  elbowR: 0,
  forearmR: 0,
  wristFlexR: 0,
  wristDevR: 0,
  hipFlexL: 0,
  hipAbdL: 0,
  hipRotL: 0,
  kneeL: 0,
  ankleFlexL: 0,
  ankleRollL: 0,
  hipFlexR: 0,
  hipAbdR: 0,
  hipRotR: 0,
  kneeR: 0,
  ankleFlexR: 0,
  ankleRollR: 0,
}

type Body = {
  readonly height: number
  readonly headH: number
  readonly headW: number
  readonly headD: number
  readonly neckR: number
  readonly shoulderY: number
  readonly shoulderZ: number
  readonly hipY: number
  readonly hipZ: number
  readonly upper: number
  readonly fore: number
  readonly hand: number
  readonly thigh: number
  readonly shin: number
  readonly ankleY: number
  readonly gap: number
}

export function createMannequinMesh(height = MANNEQUIN_HEIGHT, pose: MannequinPose = REST_POSE): MannequinMesh {
  const body = measure(height)
  const mesh = new MeshBuilder()
  addTorso(mesh, body)
  addHead(mesh, body)
  addArm(mesh, body, 1, pose.shoulderFlexL, pose.shoulderAbdL, pose.shoulderRotL, pose.elbowL, pose.forearmL, pose.wristFlexL, pose.wristDevL)
  addArm(mesh, body, -1, pose.shoulderFlexR, pose.shoulderAbdR, pose.shoulderRotR, pose.elbowR, pose.forearmR, pose.wristFlexR, pose.wristDevR)
  const ankleL = addLeg(mesh, body, 1, pose.hipFlexL, pose.hipAbdL, pose.hipRotL, pose.kneeL)
  const ankleR = addLeg(mesh, body, -1, pose.hipFlexR, pose.hipAbdR, pose.hipRotR, pose.kneeR)
  addFoot(mesh, body, pose.ankleFlexL, pose.ankleRollL, pose.hipRotL, ankleL, 1)
  addFoot(mesh, body, pose.ankleFlexR, pose.ankleRollR, pose.hipRotR, ankleR, -1)
  return mesh.build()
}

/** 按参考人偶的头身、肩宽和四肢长度，缩放到给定身高。 */
function measure(height: number): Body {
  const hipY = 0.5 * height
  const thigh = 0.232 * height
  const shin = 0.222 * height
  return {
    height,
    headH: 0.125 * height,
    headW: 0.084 * height,
    headD: 0.096 * height,
    neckR: 0.024 * height,
    shoulderY: 0.828 * height,
    shoulderZ: 0.118 * height,
    hipY,
    hipZ: 0.06 * height,
    upper: 0.16 * height,
    fore: 0.142 * height,
    hand: 0.09 * height,
    thigh,
    shin,
    ankleY: hipY - thigh - shin,
    gap: 0.016 * height,
  }
}

class MeshBuilder {
  private readonly xyz: number[] = []
  private readonly quads: number[] = []
  private readonly materials: number[] = []
  private material = CLAY

  use(material: number): void {
    this.material = material
  }

  vertex(point: Vec3): number {
    const index = this.xyz.length / 3
    this.xyz.push(point[0], point[1], point[2])
    return index
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.quads.push(a, b, c, d)
    this.materials.push(this.material)
  }

  get quadCount(): number {
    return this.quads.length / 4
  }

  orient(fromQuad: number, inside: (mid: Vec3) => Vec3): void {
    for (let q = fromQuad; q < this.quadCount; q += 1) {
      const a = this.quads[q * 4]!
      const b = this.quads[q * 4 + 1]!
      const c = this.quads[q * 4 + 2]!
      const d = this.quads[q * 4 + 3]!
      const normal = quadNormal(this.xyz, a, b, c, d)
      if (normal === null) continue
      const mid = centroid(this.xyz, a, b, c, d)
      const origin = inside(mid)
      if (dot(normal, sub(mid, origin)) >= 0) continue
      if (d === a) {
        this.quads[q * 4 + 1] = c
        this.quads[q * 4 + 2] = b
      } else if (d === c) {
        this.quads[q * 4 + 1] = c
        this.quads[q * 4 + 2] = b
        this.quads[q * 4 + 3] = b
      } else {
        this.quads[q * 4 + 1] = d
        this.quads[q * 4 + 3] = b
      }
    }
  }

  build(): MannequinMesh {
    return {
      positions: Float32Array.from(this.xyz),
      quads: Uint32Array.from(this.quads),
      materials: Uint8Array.from(this.materials),
    }
  }
}

function addTorso(mesh: MeshBuilder, body: Body): void {
  const h = body.height
  const shoulder = body.shoulderY
  const hip = body.hipY
  const waist = hip + 0.16 * h
  const chest = shoulder - 0.08 * h
  const stops: Stop[] = [
    { y: hip - 0.045 * h, z: 0.042 * h, x: 0.04 * h },
    { y: hip, z: 0.092 * h, x: 0.058 * h },
    { y: hip + 0.07 * h, z: 0.084 * h, x: 0.052 * h },
    { y: waist - 0.02 * h, z: 0.064 * h, x: 0.044 * h },
    { y: waist + 0.02 * h, z: 0.07 * h, x: 0.046 * h },
    { y: chest, z: 0.1 * h, x: 0.062 * h },
    { y: shoulder - 0.01 * h, z: 0.125 * h, x: 0.058 * h },
    { y: shoulder + 0.035 * h, z: 0.055 * h, x: 0.042 * h },
  ]
  mesh.use(CLAY)
  addProfile(mesh, stops, TUBE_SIDES)
  const bust = chest - 0.015 * h
  mesh.use(JOINT)
  addProfile(
    mesh,
    [
      { y: bust - 0.006 * h, z: 0.102 * h, x: 0.064 * h },
      { y: bust + 0.012 * h, z: 0.104 * h, x: 0.066 * h },
    ],
    TUBE_SIDES,
  )
  addProfile(
    mesh,
    [
      { y: waist - 0.014 * h, z: 0.072 * h, x: 0.05 * h },
      { y: waist + 0.014 * h, z: 0.072 * h, x: 0.05 * h },
    ],
    TUBE_SIDES,
  )
  mesh.use(CLAY)
}

function addHead(mesh: MeshBuilder, body: Body): void {
  const top = body.height
  const centerY = top - body.headH / 2
  mesh.use(CLAY)
  addEllipsoid(mesh, [0, centerY, 0], [body.headD / 2, body.headH / 2, body.headW / 2], 1, TUBE_SIDES, TUBE_SIDES)
  const neckTop = centerY - body.headH * 0.42
  const neckBase = body.shoulderY + 0.02 * body.height
  mesh.use(CLAY)
  addTube(
    mesh,
    [
      [0, neckBase, 0],
      [0, (neckBase + neckTop) / 2, 0],
      [0, neckTop, 0],
    ],
    [body.neckR * 1.15, body.neckR, body.neckR * 0.92],
    circular,
    TUBE_SIDES,
  )
  mesh.use(JOINT)
  addTube(
    mesh,
    [
      [0, neckBase - 0.006 * body.height, 0],
      [0, neckBase + 0.008 * body.height, 0],
    ],
    [body.neckR * 1.28, body.neckR * 1.28],
    circular,
    TUBE_SIDES,
  )
  mesh.use(CLAY)
}

function addArm(
  mesh: MeshBuilder,
  body: Body,
  side: 1 | -1,
  flex: number,
  abd: number,
  rot: number,
  elbowAngle: number,
  forearm: number,
  wristFlex: number,
  wristDev: number,
): void {
  const upperDir = shoulderDirection(side, flex, abd)
  const foreDir = flexForearm(upperDir, elbowAngle, rot)
  const twisted = handAxes(foreDir, rot + forearm)
  const flexed = bendToward(foreDir, twisted.up, wristFlex)
  const handDir = bendToward(flexed, twisted.front, wristDev)
  const basis = alignBasis(handDir, twisted.up, twisted.front)
  const root: Vec3 = [0, body.shoulderY, side * body.shoulderZ]
  const elbow = travel(root, upperDir, body.upper)
  const wrist = travel(elbow, foreDir, body.fore)
  band(mesh, root, upperDir, 0.034 * body.height)
  segment(mesh, travel(root, upperDir, body.gap), travel(elbow, upperDir, -body.gap * 0.6), 0.03 * body.height, 0.026 * body.height)
  band(mesh, elbow, upperDir, 0.028 * body.height)
  segment(mesh, travel(elbow, foreDir, body.gap * 0.7), travel(wrist, foreDir, -body.gap * 0.5), 0.024 * body.height, 0.02 * body.height)
  band(mesh, wrist, foreDir, 0.02 * body.height)
  addHand(mesh, body, wrist, handDir, basis.up, basis.front)
}

function addHand(mesh: MeshBuilder, body: Body, wrist: Vec3, dir: Vec3, up: Vec3, front: Vec3): void {
  const palmLen = body.hand * 0.42
  const fingerLen = body.hand - palmLen
  const palmEnd = travel(wrist, dir, palmLen)
  mesh.use(CLAY)
  addTube(
    mesh,
    [wrist, midpoint(wrist, palmEnd), palmEnd],
    [0.02 * body.height, 0.026 * body.height, 0.022 * body.height],
    [0.012 * body.height, 0.011 * body.height, 0.01 * body.height],
    TUBE_SIDES,
  )
  const fingerR = 0.007 * body.height
  for (let finger = 0; finger < 4; finger += 1) {
    const spread = (finger / 3 - 0.5) * 0.04 * body.height
    const lift = (finger - 1.5) * 0.004 * body.height
    const root = add(add(palmEnd, mul(up, spread)), mul(front, lift))
    const tip = travel(add(root, mul(dir, -fingerR)), dir, fingerLen)
    addTube(mesh, [root, tip], [fingerR, fingerR * 0.62], circular, TUBE_SIDES)
  }
  const thumbLen = body.hand * 0.28
  const thumbDir = norm(add(add(mul(dir, 0.45), mul(up, -0.75)), mul(front, 0.35)))
  const thumbRoot = add(add(midpoint(wrist, palmEnd), mul(up, -0.016 * body.height)), mul(front, 0.006 * body.height))
  const thumbTip = travel(thumbRoot, thumbDir, thumbLen)
  addTube(mesh, [thumbRoot, thumbTip], [fingerR * 1.25, fingerR * 0.7], circular, TUBE_SIDES)
}

function addLeg(mesh: MeshBuilder, body: Body, side: 1 | -1, flex: number, abd: number, rot: number, kneeAngle: number): Vec3 {
  const hip: Vec3 = [0, body.hipY, side * body.hipZ]
  const thighDir = thighDirection(side, flex, abd)
  const knee = travel(hip, thighDir, body.thigh)
  const shinDir = kneeDirection(thighDir, kneeAngle, rot)
  const ankle = travel(knee, shinDir, body.shin)
  band(mesh, travel(hip, thighDir, body.gap), thighDir, 0.046 * body.height)
  segment(mesh, travel(hip, thighDir, body.gap * 1.8), travel(knee, thighDir, -body.gap), 0.046 * body.height, 0.034 * body.height)
  band(mesh, knee, thighDir, 0.034 * body.height)
  segment(mesh, travel(knee, shinDir, body.gap), travel(ankle, shinDir, -body.gap * 0.4), 0.032 * body.height, 0.022 * body.height)
  band(mesh, ankle, shinDir, 0.022 * body.height)
  return ankle
}

function addFoot(mesh: MeshBuilder, body: Body, pitch: number, roll: number, hipRot: number, ankle: Vec3, side: 1 | -1): void {
  const length = 0.15 * body.height
  const heel = -0.22 * length
  const width = 0.046 * body.height
  const sole = body.ankleY
  const yaw = side * (0.42 + hipRot)
  const inversion = side * roll
  const stations: { x: number; y: number; rx: number; rz: number }[] = [
    { x: heel, y: 0.02 * body.height, rx: 0.018 * body.height, rz: width * 0.72 },
    { x: 0.02 * length, y: 0.028 * body.height, rx: 0.024 * body.height, rz: width * 0.9 },
    { x: length * 0.5, y: 0.024 * body.height, rx: 0.02 * body.height, rz: width },
    { x: length * 0.82, y: 0.016 * body.height, rx: 0.014 * body.height, rz: width * 0.86 },
    { x: length, y: 0.012 * body.height, rx: 0.01 * body.height, rz: width * 0.62 },
  ]
  const centers = stations.map((station) => yawFoot(ankle, station.x, station.y - sole, pitch, yaw))
  mesh.use(CLAY)
  addTube(
    mesh,
    centers,
    stations.map((station) => station.rx),
    stations.map((station) => station.rz),
    TUBE_SIDES,
    inversion,
  )
  const toe = sub(yawFoot(ankle, 1, 0, pitch, yaw), ankle)
  const rolled = rollFrame(armFrame(toe), inversion)
  const last = stations[stations.length - 1]!
  addFan(mesh, centers[centers.length - 1]!, toe, rolled.side, rolled.front, last.rz, last.rx, TUBE_SIDES)
}

type Stop = { y: number; z: number; x: number }

function addProfile(mesh: MeshBuilder, samples: readonly Stop[], sides: number): void {
  addTube(
    mesh,
    samples.map((sample) => [0, sample.y, 0] as Vec3),
    samples.map((sample) => sample.z),
    samples.map((sample) => sample.x),
    sides,
  )
}

function segment(mesh: MeshBuilder, from: Vec3, to: Vec3, radius0: number, radius1: number): void {
  mesh.use(CLAY)
  addTube(mesh, [from, to], [radius0, radius1], circular, TUBE_SIDES)
}

function band(mesh: MeshBuilder, center: Vec3, axis: Vec3, radius: number): void {
  mesh.use(JOINT)
  const half = radius * 0.22
  addTube(mesh, [travel(center, axis, -half), travel(center, axis, half)], [radius, radius], circular, TUBE_SIDES)
  mesh.use(CLAY)
}

function addTube(
  mesh: MeshBuilder,
  centers: readonly Vec3[],
  radiusSide: readonly number[],
  radiusFront: ((side: number) => number) | readonly number[],
  sides: number,
  roll = 0,
): void {
  const from = mesh.quadCount
  const rows: number[][] = []
  for (let i = 0; i < centers.length; i += 1) {
    const { side, front } = rollFrame(armFrame(tangentAt(centers, i)), roll)
    const rz = radiusSide[i]!
    const rx = typeof radiusFront === 'function' ? radiusFront(rz) : radiusFront[i]!
    const row: number[] = []
    for (let j = 0; j < sides; j += 1) {
      row.push(mesh.vertex(ring(centers[i]!, side, front, rz, rx, (j / sides) * Math.PI * 2)))
    }
    rows.push(row)
  }
  for (let i = 0; i < centers.length - 1; i += 1) {
    for (let j = 0; j < sides; j += 1) {
      const j2 = (j + 1) % sides
      mesh.quad(rows[i]![j]!, rows[i]![j2]!, rows[i + 1]![j2]!, rows[i + 1]![j]!)
    }
  }
  mesh.orient(from, (mid) => nearest(centers, mid))
}

function circular(side: number): number {
  return side
}

function addFan(
  mesh: MeshBuilder,
  center: Vec3,
  axis: Vec3,
  side: Vec3,
  front: Vec3,
  rx: number,
  rz: number,
  sides: number,
): void {
  const from = mesh.quadCount
  const tip = mesh.vertex(travel(center, axis, Math.min(rx, rz) * 0.2))
  const row: number[] = []
  for (let j = 0; j < sides; j += 1) row.push(mesh.vertex(ring(center, side, front, rz, rx, (j / sides) * Math.PI * 2)))
  for (let j = 0; j < sides; j += 1) mesh.quad(row[j]!, row[(j + 1) % sides]!, tip, tip)
  mesh.orient(from, () => center)
}

function addEllipsoid(
  mesh: MeshBuilder,
  center: Vec3,
  radii: readonly [number, number, number],
  zSign: 1 | -1,
  lat: number,
  lon: number,
): void {
  const from = mesh.quadCount
  const rows: number[][] = []
  for (let i = 0; i <= lat; i += 1) {
    const theta = (i / lat) * Math.PI
    const count = i === 0 || i === lat ? 1 : lon
    const row: number[] = []
    for (let j = 0; j < count; j += 1) {
      const phi = (j / lon) * Math.PI * 2
      row.push(
        mesh.vertex([
          center[0] + radii[0] * Math.sin(theta) * Math.cos(phi),
          center[1] + radii[1] * Math.cos(theta),
          center[2] + zSign * radii[2] * Math.sin(theta) * Math.sin(phi),
        ]),
      )
    }
    rows.push(row)
  }
  for (let i = 0; i < lat; i += 1) {
    const top = rows[i]!
    const bottom = rows[i + 1]!
    if (top.length === 1) {
      const pole = top[0]!
      for (let j = 0; j < lon; j += 1) mesh.quad(pole, bottom[j]!, bottom[(j + 1) % lon]!, pole)
    } else if (bottom.length === 1) {
      const pole = bottom[0]!
      for (let j = 0; j < lon; j += 1) mesh.quad(top[j]!, top[(j + 1) % lon]!, pole, pole)
    } else {
      for (let j = 0; j < lon; j += 1) {
        const j2 = (j + 1) % lon
        mesh.quad(top[j]!, top[j2]!, bottom[j2]!, bottom[j]!)
      }
    }
  }
  mesh.orient(from, () => center)
}

/** 外展在额状面里抬臂，屈曲再把臂朝前（+x）送。0° 仍是平举。 */
function shoulderDirection(side: 1 | -1, flex: number, abd: number): Vec3 {
  const frontal: Vec3 = [0, Math.sin(abd), side * Math.cos(abd)]
  return bendToward(frontal, [1, 0, 0], flex)
}

/** 负的肘角朝前弯。肩旋转把这条屈轴绕上臂转开。 */
function flexForearm(upper: Vec3, elbowAngle: number, shoulderRot: number): Vec3 {
  let hinge = cross(upper, [1, 0, 0])
  if (length(hinge) < 1e-4) hinge = cross(upper, [0, 1, 0])
  hinge = rotateAround(hinge, upper, shoulderRot)
  return rotateAround(upper, hinge, -elbowAngle)
}

function handAxes(fore: Vec3, twist: number): { up: Vec3; front: Vec3 } {
  const up = rotateAround(perpendicular(fore, [0, 1, 0]), fore, twist)
  const front = rotateAround(perpendicular(fore, [1, 0, 0]), fore, twist)
  return { up, front }
}

function alignBasis(dir: Vec3, upHint: Vec3, frontHint: Vec3): { up: Vec3; front: Vec3 } {
  const front = perpendicular(dir, frontHint)
  let up = cross(front, dir)
  if (dot(up, upHint) < 0) up = mul(up, -1)
  return { up, front }
}

/** 正屈曲朝前，正外展向外。 */
function thighDirection(side: 1 | -1, flex: number, abd: number): Vec3 {
  return bendToward(rotateSagittal([0, -1, 0], flex), [0, 0, side], abd)
}

/** 负的膝角朝后弯。髋旋转带着膝轴一起转，脚尖才跟着外展。 */
function kneeDirection(thigh: Vec3, kneeAngle: number, hipRot: number): Vec3 {
  const vertical: Vec3 = [0, -1, 0]
  let hinge = rotateAround([0, 0, 1], vertical, hipRot)
  hinge = carry(hinge, vertical, thigh)
  if (length(cross(hinge, thigh)) < 1e-4) hinge = [0, 0, 1]
  return rotateAround(thigh, hinge, kneeAngle)
}

function carry(vector: Vec3, from: Vec3, to: Vec3): Vec3 {
  const axis = cross(from, to)
  const len = length(axis)
  if (len < 1e-6) return dot(from, to) >= 0 ? vector : mul(vector, -1)
  return rotateAround(vector, axis, Math.atan2(len, dot(from, to)))
}

function bendToward(direction: Vec3, target: Vec3, angle: number): Vec3 {
  const parallel = dot(direction, target)
  const px = target[0] - direction[0] * parallel
  const py = target[1] - direction[1] * parallel
  const pz = target[2] - direction[2] * parallel
  const len = Math.hypot(px, py, pz)
  if (len < 1e-4) return direction
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [direction[0] * c + (px / len) * s, direction[1] * c + (py / len) * s, direction[2] * c + (pz / len) * s]
}

function rotateAround(vector: Vec3, axis: Vec3, angle: number): Vec3 {
  const unit = norm(axis)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const crossed = cross(unit, vector)
  const along = dot(unit, vector)
  return add(add(mul(vector, c), mul(crossed, s)), mul(unit, along * (1 - c)))
}

function rollFrame(frame: { side: Vec3; front: Vec3 }, roll: number): { side: Vec3; front: Vec3 } {
  const c = Math.cos(roll)
  const s = Math.sin(roll)
  return {
    side: add(mul(frame.side, c), mul(frame.front, s)),
    front: add(mul(frame.front, c), mul(frame.side, -s)),
  }
}

function rotateSagittal(direction: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [direction[0] * c - direction[1] * s, direction[0] * s + direction[1] * c, direction[2]]
}

function placeFoot(ankle: Vec3, localX: number, localY: number, pitch: number): Vec3 {
  const c = Math.cos(pitch)
  const s = Math.sin(pitch)
  return [ankle[0] + c * localX - s * localY, ankle[1] + s * localX + c * localY, ankle[2]]
}

/** 先绕脚踝做脚掌俯仰，再向外转一点，正面才能看见鞋的长度。 */
function yawFoot(ankle: Vec3, localX: number, localY: number, pitch: number, yaw: number): Vec3 {
  const placed = placeFoot(ankle, localX, localY, pitch)
  const dx = placed[0] - ankle[0]
  return [ankle[0] + dx * Math.cos(yaw), placed[1], ankle[2] + dx * Math.sin(yaw)]
}

function armFrame(direction: Vec3): { side: Vec3; front: Vec3 } {
  const tangent = norm(direction)
  let front = sub([1, 0, 0], mul(tangent, tangent[0]))
  if (length(front) < 1e-4) front = [0, 1, 0]
  front = norm(front)
  if (front[0] < 0) front = mul(front, -1)
  return { side: cross(tangent, front), front }
}

function ring(center: Vec3, side: Vec3, front: Vec3, radiusSide: number, radiusFront: number, phi: number): Vec3 {
  const lateral = Math.sin(phi) * radiusSide
  const forward = Math.cos(phi) * radiusFront
  return [
    center[0] + front[0] * forward + side[0] * lateral,
    center[1] + front[1] * forward + side[1] * lateral,
    center[2] + front[2] * forward + side[2] * lateral,
  ]
}

function tangentAt(centers: readonly Vec3[], index: number): Vec3 {
  return sub(centers[Math.min(index + 1, centers.length - 1)]!, centers[Math.max(index - 1, 0)]!)
}

function nearest(centers: readonly Vec3[], point: Vec3): Vec3 {
  let best = centers[0]!
  let bestD = Infinity
  for (let i = 0; i < centers.length; i += 1) {
    const center = centers[i]!
    const d = distanceSq(center, point)
    if (d < bestD) {
      best = center
      bestD = d
    }
  }
  return best
}

function perpendicular(direction: Vec3, hint: Vec3): Vec3 {
  const tangent = norm(direction)
  const along = dot(tangent, hint)
  const side = sub(hint, mul(tangent, along))
  if (length(side) >= 1e-4) return norm(side)
  const fallback: Vec3 = Math.abs(tangent[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const alongFallback = dot(tangent, fallback)
  return norm(sub(fallback, mul(tangent, alongFallback)))
}

function quadNormal(xyz: readonly number[], a: number, b: number, c: number, d: number): Vec3 | null {
  const tail = d === c || d === a ? c : d
  const ax = xyz[a * 3]!
  const ay = xyz[a * 3 + 1]!
  const az = xyz[a * 3 + 2]!
  const ux = xyz[b * 3]! - ax
  const uy = xyz[b * 3 + 1]! - ay
  const uz = xyz[b * 3 + 2]! - az
  const vx = xyz[tail * 3]! - ax
  const vy = xyz[tail * 3 + 1]! - ay
  const vz = xyz[tail * 3 + 2]! - az
  const normal: Vec3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
  const len = length(normal)
  return len < 1e-8 ? null : mul(normal, 1 / len)
}

function centroid(xyz: readonly number[], a: number, b: number, c: number, d: number): Vec3 {
  const ids = d === a || d === c ? [a, b, c] : [a, b, c, d]
  let x = 0
  let y = 0
  let z = 0
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i]!
    x += xyz[id * 3]!
    y += xyz[id * 3 + 1]!
    z += xyz[id * 3 + 2]!
  }
  return [x / ids.length, y / ids.length, z / ids.length]
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function mul(a: Vec3, scale: number): Vec3 {
  return [a[0] * scale, a[1] * scale, a[2] * scale]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2])
}

function norm(a: Vec3): Vec3 {
  const len = length(a)
  return len < 1e-8 ? [0, 1, 0] : mul(a, 1 / len)
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
}

function travel(origin: Vec3, direction: Vec3, distance: number): Vec3 {
  const step = norm(direction)
  return [origin[0] + step[0] * distance, origin[1] + step[1] * distance, origin[2] + step[2] * distance]
}

function distanceSq(a: Vec3, b: Vec3): number {
  const delta = sub(a, b)
  return dot(delta, delta)
}
