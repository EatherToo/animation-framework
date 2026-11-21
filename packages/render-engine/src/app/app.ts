/**
 * M8 应用层：人形模板、足部接触、运动规划与姿态调制。
 * 权威：docs/16-20 及其子文档。只依赖 core2d 骨架/姿态/数学，不碰渲染或核心 01-15。
 *
 * 设计要点：
 * - 生成确定性：同参数逐位一致，左右用 sideSign 镜像；
 * - 规划事务式：先复制 local/contacts 到工作副本，校验通过才提交；
 * - 参数平滑 alpha=1-exp(-dt/tau)，与帧率解耦；
 * - 调制只写 spine/chest/head 旋转，且缺骨时整体不写。
 */
import { CH_ROT, POSE_STRIDE } from '../core/math'
import { addRotation, markAllDirty, type Pose } from '../core/pose'
import {
  compileSkeleton,
  type BoneSpec,
  type CompiledSkeleton,
  type SkeletonSpec,
} from '../core/skeleton'

// ---------------------------------------------------------------------------
// 人形模板（16）
// ---------------------------------------------------------------------------

/** 每手手指骨数：无 / 一根示意 / 14 根（拇指 2 + 其余四指各 3）。 */
export type HandLod = 'none' | 'simple' | 'full'

const DEFAULT_HEIGHT = 1.7
const GRAVITY = 9.81

/** average 成人比例表（身高倍数），集中管理，不散落在装配代码里。 */
const P = {
  pelvisHeight: 0.53,
  spine: 0.17,
  chest: 0.20,
  neck: 0.06,
  head: 0.15, // 2 × headRadius(0.075)
  shoulderWidth: 0.23,
  hipWidth: 0.11,
  upperArm: 0.19,
  lowerArm: 0.16,
  hand: 0.11,
  thigh: 0.24,
  shin: 0.23,
  ankleHeight: 0.04,
  foot: 0.15,
  clavicle: 0.05,
} as const

/** 指骨长度系数（相对手长）与横向铺开比例；顺序固定，保证确定性。 */
const FINGERS = [
  { name: 'thumb', segments: [0.30, 0.25], spread: 0.10 },
  { name: 'index', segments: [0.22, 0.16, 0.12], spread: 0.045 },
  { name: 'middle', segments: [0.24, 0.18, 0.13], spread: 0.015 },
  { name: 'ring', segments: [0.22, 0.17, 0.12], spread: -0.015 },
  { name: 'pinky', segments: [0.18, 0.14, 0.10], spread: -0.045 },
] as const

type Side = 'L' | 'R'
const SIDES: readonly { tag: Side; sign: 1 | -1 }[] = [
  { tag: 'L', sign: -1 },
  { tag: 'R', sign: 1 },
]

/** 由身高生成骨骼规格；simple2d 强制无指骨（核心编译器也禁止 finger/2DOF）。 */
export function humanoidSpec(
  profile: 'simple2d' | 'full2d',
  opts?: { height?: number; handLod?: HandLod },
): SkeletonSpec {
  const height = opts?.height ?? DEFAULT_HEIGHT
  if (!Number.isFinite(height) || height <= 0) throw new Error('app.height')
  const handLod: HandLod = profile === 'simple2d' ? 'none' : (opts?.handLod ?? 'none')

  // 先算所有骨长（Float64 语义），再组装关节，避免边算边写产生累计误差。
  const m = {
    pelvisHeight: height * P.pelvisHeight,
    spine: height * P.spine,
    chest: height * P.chest,
    neck: height * P.neck,
    head: height * P.head,
    shoulderHalf: height * P.shoulderWidth * 0.5,
    hipHalf: height * P.hipWidth * 0.5,
    upperArm: height * P.upperArm,
    lowerArm: height * P.lowerArm,
    hand: height * P.hand,
    thigh: height * P.thigh,
    shin: height * P.shin,
    ankleHeight: height * P.ankleHeight,
    foot: height * P.foot,
    clavicle: height * P.clavicle,
  }

  const bones: BoneSpec[] = []
  const add = (
    name: string,
    parent: number,
    length: number,
    rest?: { x?: number; y?: number; rotation?: number },
    tags?: readonly string[],
  ): number => {
    bones.push({
      name,
      parent,
      length,
      rest: {
        x: rest?.x ?? 0,
        y: rest?.y ?? 0,
        rotation: rest?.rotation ?? 0,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
      },
      ...(tags ? { tags } : {}),
    })
    return bones.length - 1
  }

  // 核心 18 骨：下标 0..17 稳定。
  const root = add('root', -1, 0)
  const pelvis = add('pelvis', root, 0, { y: m.pelvisHeight })
  const spine = add('spine', pelvis, m.spine)
  const chest = add('chest', spine, m.chest)
  const neckId = add('neck', chest, m.neck)
  add('head', neckId, m.head)

  const handIds: number[] = []
  for (const { tag, sign } of SIDES) {
    let armParent = chest
    let upperX = sign * m.shoulderHalf
    if (profile === 'full2d') {
      // full2d 的 2 根 yoke（肩带骨）插在胸与upperArm之间。
      armParent = add(`clavicle${tag}`, chest, m.clavicle, { x: sign * m.shoulderHalf })
      upperX = 0
    }
    const upper = add(`upperArm${tag}`, armParent, m.upperArm, { x: upperX, rotation: sign * 0.06 })
    const lower = add(`lowerArm${tag}`, upper, m.lowerArm, { rotation: sign * 0.05 })
    handIds.push(add(`hand${tag}`, lower, m.hand))
  }

  for (const { tag, sign } of SIDES) {
    const thigh = add(`thigh${tag}`, pelvis, m.thigh, { x: sign * m.hipHalf })
    const shin = add(`shin${tag}`, thigh, m.shin)
    add(`foot${tag}`, shin, m.foot, { y: -m.ankleHeight, rotation: sign * 0.02 })
  }

  // 指骨只在 full2d 生成；simple 每手 1 根示意骨，full 每手 14 根。
  if (profile === 'full2d' && handLod !== 'none') {
    for (let s = 0; s < SIDES.length; s += 1) {
      const { tag, sign } = SIDES[s]!
      if (handLod === 'simple') {
        add(`index1${tag}`, handIds[s]!, m.hand * 0.5, { rotation: sign * 0.03 }, ['finger'])
        continue
      }
      let parent = handIds[s]!
      for (const finger of FINGERS) {
        for (let seg = 0; seg < finger.segments.length; seg += 1) {
          parent = add(
            `${finger.name}${seg + 1}${tag}`,
            parent,
            m.hand * finger.segments[seg]!,
            { x: sign * finger.spread * m.hand, rotation: sign * 0.03 },
            ['finger'],
          )
        }
      }
    }
  }

  return {
    name: `humanoid-${profile}-${handLod}`,
    profile,
    bones,
    rootMotion: 'entity',
  }
}

/** 编译人形骨架；同输入逐位一致。 */
export function createHumanoid(
  profile: 'simple2d' | 'full2d',
  opts?: { height?: number; handLod?: HandLod },
): CompiledSkeleton {
  return compileSkeleton(humanoidSpec(profile, opts))
}

// ---------------------------------------------------------------------------
// 足部与接触（17）
// ---------------------------------------------------------------------------

export type ContactMark = {
  x: number
  y: number
  frame: number
  kind: 'heel' | 'flat' | 'toe' | 'liftoff' | 'landing'
}

/** 脚底线段的固定尺度（米）；soleLocal 只接受归一化 u，故用成人基准尺寸。 */
const HEEL_BACK = 0.045
const FOOT_LENGTH = 0.15
const SOLE_LENGTH = HEEL_BACK + FOOT_LENGTH // 0.195
const SOLE_RISE = 0.08 // heel → toe 的 y 抬升，保证 y 单调递增
const ANKLE_HEIGHT = 0.04
const SOLE_MID_X = -HEEL_BACK + 0.5 * SOLE_LENGTH

/** 脚底站点：u=0 跟、0.5 平足、1 趾；x 与 y 都随 u 单调增。 */
export function soleLocal(u: number): [number, number] {
  return [-HEEL_BACK + u * SOLE_LENGTH, -SOLE_RISE * 0.5 + u * SOLE_RISE]
}

/**
 * 接触点 → 踝：接触点位于脚底，踝在中足上方 soleY + 踝高处。
 * soleY 表示当前接触所在的水平地面高度。
 */
export function ankleFromContact(c: ContactMark, soleY: number): { x: number; y: number } {
  return { x: c.x - SOLE_MID_X, y: soleY + ANKLE_HEIGHT }
}

/** 踝 → 接触点；与 ankleFromContact 在 soleY 一致时互逆（1e-9）。 */
export function contactFromAnkle(a: { x: number; y: number }, soleY: number): { x: number; y: number } {
  return { x: a.x + SOLE_MID_X, y: soleY }
}

// ---------------------------------------------------------------------------
// 参数与运动规划（18/19）
// ---------------------------------------------------------------------------

export type MotionParams = {
  speed: number
  turn: number
  gait: 0 | 1 | 2
  amplitude: number
}

export type MotionInput = {
  dt: number
  time: number
  speed: number
  turn: number
  groundY: number
}

export type MotionState = {
  params: MotionParams
  contacts: ContactMark[]
  pose: Pose | null
}

/** Froude 数 Fr = v²/(gL)，阈值 0.5 / 2.5；后退取绝对值。 */
export function speedToGait(speed: number, height: number): 0 | 1 | 2 {
  if (!Number.isFinite(height) || height <= 0) throw new Error('app.height')
  const fr = (speed * speed) / (GRAVITY * height)
  if (fr < 0.5) return 0
  if (fr < 2.5) return 1
  return 2
}

/** 一阶低通系数，帧率无关。 */
function alpha(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau)
}

const TAU_SPEED = 0.12
const TAU_TURN = 0.16
const TAU_AMPLITUDE = 0.20
const STEP_PERIOD = 0.8
const STEP_LENGTH = 0.7
const EVENT_OFFSETS = [0, 0.2, 0.4, 0.6, 0.8] as const
const EVENT_KINDS: readonly ContactMark['kind'][] = ['heel', 'flat', 'toe', 'liftoff', 'landing']

/** 骨架关联（createMotionState 的入参在此消费），并给出腿长/身高估计。 */
const skeletonByState = new WeakMap<MotionState, CompiledSkeleton>()

function metricsOf(skeleton: CompiledSkeleton): { height: number; legLength: number } {
  const thigh = skeleton.boneIdByName.get('thighL')
  const shin = skeleton.boneIdByName.get('shinL')
  const legLength = thigh !== undefined && shin !== undefined
    ? skeleton.bones[thigh]!.length + skeleton.bones[shin]!.length
    : 0.47 * DEFAULT_HEIGHT
  return { height: legLength / 0.47, legLength }
}

export function createMotionState(skeleton: CompiledSkeleton): MotionState {
  const state: MotionState = {
    params: { speed: 0, turn: 0, gait: 0, amplitude: 0 },
    contacts: [],
    pose: null,
  }
  skeletonByState.set(state, skeleton)
  return state
}

/**
 * 事务式规划：先复制 local 与 contacts，所有校验通过才写回；失败不改原状态。
 * local 从 setup 基线重算，使结果只依赖 (time, params)，与调用帧率无关。
 */
export function planMotion(
  state: MotionState,
  input: MotionInput,
): { committed: boolean; reason?: string } {
  const fail = (reason: string): { committed: boolean; reason: string } => ({ committed: false, reason })
  if (!Number.isFinite(input.dt) || input.dt <= 0) return fail('dt')
  if (!Number.isFinite(input.time) || !Number.isFinite(input.speed)
    || !Number.isFinite(input.turn) || !Number.isFinite(input.groundY)) return fail('input')

  const pose = state.pose
  if (!pose) return fail('no-pose')
  const skeleton = skeletonByState.get(state) ?? pose.skeleton
  if (!Array.from(pose.local).every(Number.isFinite)) return fail('pose-local')

  const { height } = metricsOf(skeleton)
  const work = skeleton.setupLocal.slice()

  // 参数一阶平滑；gait 离散量取目标速度，不做低通。
  const targetAmplitude = Math.min(1, Math.abs(input.speed) / 3)
  const next: MotionParams = {
    speed: state.params.speed + (input.speed - state.params.speed) * alpha(input.dt, TAU_SPEED),
    turn: state.params.turn + (input.turn - state.params.turn) * alpha(input.dt, TAU_TURN),
    gait: speedToGait(input.speed, height),
    amplitude: state.params.amplitude + (targetAmplitude - state.params.amplitude) * alpha(input.dt, TAU_AMPLITUDE),
  }

  // 腿部确定性摆动（只写腿骨旋转，幅度按腿长归一）。
  const { legLength } = metricsOf(skeleton)
  const swing = next.amplitude * 0.35 * (legLength / (0.47 * DEFAULT_HEIGHT))
  const phase = (input.time / STEP_PERIOD) * Math.PI * 2
  const pairs: readonly [string, string, number][] = [
    ['thighL', 'thighR', -Math.sin(phase)],
    ['shinL', 'shinR', Math.max(0, Math.sin(phase + 0.8))],
    ['footL', 'footR', Math.min(0, Math.sin(phase + 1.6))],
  ]
  for (const [lName, rName, s] of pairs) {
    const l = skeleton.boneIdByName.get(lName)
    const r = skeleton.boneIdByName.get(rName)
    if (l !== undefined) work[l * POSE_STRIDE + CH_ROT]! += swing * s
    if (r !== undefined) work[r * POSE_STRIDE + CH_ROT]! -= swing * s
  }

  // 接触点按时间阈值生成：阈值相同则 60/30 帧率得到完全一致的集合；
  // 已提交的接触点原样保留，支撑期不重算 → 不打滑。
  const contacts = state.contacts.slice()
  const cycles = Math.floor(input.time / STEP_PERIOD)
  for (let k = 1; k <= cycles; k += 1) {
    for (let j = 0; j < EVENT_KINDS.length; j += 1) {
      const stamp = k * STEP_PERIOD + EVENT_OFFSETS[j]! * STEP_PERIOD
      if (stamp > input.time + 1e-12) continue
      const kind = EVENT_KINDS[j]!
      const duplicate = contacts.some((c) => c.kind === kind && Math.abs(c.frame - stamp) < 1e-9)
      if (duplicate) continue
      contacts.push({ x: k * STEP_LENGTH, y: input.groundY, frame: stamp, kind })
    }
  }

  // 全部检查通过才提交。
  if (!Array.from(work).every(Number.isFinite)) return fail('solve')
  if (contacts.some((c) => !Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.frame))) {
    return fail('contact')
  }

  pose.local.set(work)
  markAllDirty(pose)
  pose.version += 1
  state.params = next
  state.contacts = contacts
  return { committed: true }
}

/**
 * 上身调制：只写 spine/chest/head 的旋转增量，不覆盖腿 IK。
 * 三个骨必须同时存在，否则整体不写（缺骨不半写）。
 */
export function modulatePose(
  pose: Pose,
  skeleton: CompiledSkeleton,
  params: MotionParams,
  amount: number,
): void {
  const names = ['spine', 'chest', 'head'] as const
  const ids: number[] = []
  for (const name of names) {
    const id = skeleton.boneIdByName.get(name)
    if (id === undefined || id < 0 || id >= skeleton.count) return
    ids.push(id)
  }
  if (!Number.isFinite(amount) || amount === 0) return

  const { legLength } = metricsOf(skeleton)
  const scale = amount * (legLength / (0.47 * DEFAULT_HEIGHT))
  const turn = Number.isFinite(params.turn) ? params.turn : 0
  const amplitude = Number.isFinite(params.amplitude) ? Math.min(1, Math.max(0, params.amplitude)) : 0
  const base = 0.01 * scale
  const lean = (0.6 * turn + 0.4 * amplitude) * scale
  const deltas = [base + 0.3 * lean, 0.5 * lean - 0.5 * base, -0.2 * lean]
  for (let i = 0; i < ids.length; i += 1) addRotation(pose, ids[i]!, deltas[i]!)
}
