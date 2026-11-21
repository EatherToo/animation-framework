/**
 * M8 工具层：快照/恢复、固定步时钟、只读诊断、引擎门面。
 * 权威：docs/20-工具层 及其子文档。门面只组合 app 与 core2d 模块，不复制其逻辑。
 */
import {
  createMotionState,
  modulatePose,
  planMotion,
  type MotionInput,
  type MotionParams,
  type MotionState,
} from '../app/app'
import { createPose, markAllDirty, updateWorld, type Pose } from '../core/pose'
import type { CompiledSkeleton } from '../core/skeleton'

// ---------------------------------------------------------------------------
// 快照（20）
// ---------------------------------------------------------------------------

/** 运行时状态快照：整份复制、整份恢复；不含任何渲染/GPU 资源。 */
export type Snapshot = {
  version: 1
  local: Float32Array
  constraintState: Uint8Array
  params: { target: MotionParams; current: MotionParams }
  tick: number
}

function copyParams(p: MotionParams): MotionParams {
  return { speed: p.speed, turn: p.turn, gait: p.gait, amplitude: p.amplitude }
}

function isParams(p: unknown): p is MotionParams {
  if (p === null || typeof p !== 'object') return false
  const q = p as MotionParams
  return Number.isFinite(q.speed) && Number.isFinite(q.turn) && Number.isFinite(q.amplitude)
    && (q.gait === 0 || q.gait === 1 || q.gait === 2)
}

/** 整份复制：typed array 用 slice，参数用值拷贝。 */
export function captureSnapshot(state: MotionState, pose: Pose, tick: number): Snapshot {
  return {
    version: 1,
    local: pose.local.slice(),
    constraintState: pose.dirty.slice(),
    params: { target: copyParams(state.params), current: copyParams(state.params) },
    tick,
  }
}

/**
 * 先校验版本/长度/字段，失败返回 false 且状态不变；
 * 成功后整份写回并标脏（世界缓存失效）。
 */
export function restoreSnapshot(state: MotionState, pose: Pose, s: Snapshot): boolean {
  if (!s || s.version !== 1) return false
  if (!(s.local instanceof Float32Array) || s.local.length !== pose.local.length) return false
  if (!(s.constraintState instanceof Uint8Array) || s.constraintState.length !== pose.dirty.length) return false
  if (!Number.isFinite(s.tick) || !s.params || !isParams(s.params.current)) return false

  pose.local.set(s.local)
  pose.dirty.set(s.constraintState)
  state.params = copyParams(s.params.current)
  pose.version = s.tick
  markAllDirty(pose) // 恢复后缓存失效：整树标脏
  return true
}

// ---------------------------------------------------------------------------
// 时钟（20）
// ---------------------------------------------------------------------------

const DEFAULT_FIXED_DT = 1 / 60
const DEFAULT_MAX_FRAME_DT = 0.25
const DEFAULT_MAX_SUB_STEPS = 4
const EPS = 1e-12

/** 固定步累加器：够一步才推进，余数保留；大 dt 截断 + 子步上限防死亡螺旋。 */
export class Clock {
  private readonly fixedDt: number
  private readonly maxFrameDt: number
  private readonly maxSubSteps: number
  private acc = 0

  constructor(opts?: { fixedDt?: number; maxFrameDt?: number; maxSubSteps?: number }) {
    this.fixedDt = opts?.fixedDt ?? DEFAULT_FIXED_DT
    this.maxFrameDt = opts?.maxFrameDt ?? DEFAULT_MAX_FRAME_DT
    this.maxSubSteps = opts?.maxSubSteps ?? DEFAULT_MAX_SUB_STEPS
    if (!Number.isFinite(this.fixedDt) || this.fixedDt <= 0) throw new Error('clock.fixedDt')
    if (!Number.isFinite(this.maxFrameDt) || this.maxFrameDt <= 0) throw new Error('clock.maxFrameDt')
    if (!Number.isInteger(this.maxSubSteps) || this.maxSubSteps < 1) throw new Error('clock.maxSubSteps')
  }

  get accumulator(): number {
    return this.acc
  }

  /** 返回本次应执行的子步数（0..maxSubSteps）。 */
  step(frameDt: number): number {
    if (!Number.isFinite(frameDt) || frameDt < 0) return 0
    this.acc += Math.min(frameDt, this.maxFrameDt)
    let steps = 0
    while (this.acc + EPS >= this.fixedDt && steps < this.maxSubSteps) {
      this.acc -= this.fixedDt
      steps += 1
    }
    // 触顶仍有余额则丢弃，避免下一帧继续补步形成螺旋。
    if (steps >= this.maxSubSteps && this.acc + EPS >= this.fixedDt) this.acc = 0
    if (this.acc < 0) this.acc = 0
    return steps
  }
}

// ---------------------------------------------------------------------------
// 诊断（20）
// ---------------------------------------------------------------------------

export type DiagnosticRecord = {
  id: string
  message: string
  data?: unknown
}

/** 只读诊断缓冲：不写 pose/场景，drain 拉取后清空。 */
export class Diagnostics {
  private readonly records: DiagnosticRecord[] = []

  push(id: string, message: string, data?: unknown): void {
    this.records.push(data === undefined ? { id, message } : { id, message, data })
  }

  drain(): DiagnosticRecord[] {
    const out = this.records.slice()
    this.records.length = 0
    return out
  }

  get size(): number {
    return this.records.length
  }
}

// ---------------------------------------------------------------------------
// 引擎门面（20）
// ---------------------------------------------------------------------------

/**
 * 组合 pose + motion + clock；不创建画布/场景。
 * update 顺序：Clock → planMotion → modulatePose → updateWorld。
 * dispose 幂等，之后 update 抛 E_DISPOSED。
 */
export class EngineFacade {
  private readonly ownedPose: Pose
  private readonly ownedMotion: MotionState
  private readonly clock: Clock
  private simTime = 0
  private disposedFlag = false

  constructor(skeleton: CompiledSkeleton) {
    this.ownedPose = createPose(skeleton)
    this.ownedMotion = createMotionState(skeleton)
    this.ownedMotion.pose = this.ownedPose
    this.clock = new Clock()
  }

  get pose(): Pose {
    return this.ownedPose
  }

  get motion(): MotionState {
    return this.ownedMotion
  }

  get disposed(): boolean {
    return this.disposedFlag
  }

  update(dt: number): void {
    if (this.disposedFlag) throw new Error('E_DISPOSED')
    const steps = this.clock.step(dt)
    if (steps === 0) return
    for (let i = 0; i < steps; i += 1) {
      this.simTime += DEFAULT_FIXED_DT
      const input: MotionInput = {
        dt: DEFAULT_FIXED_DT,
        time: this.simTime,
        speed: 0,
        turn: 0,
        groundY: 0,
      }
      planMotion(this.ownedMotion, input)
      modulatePose(this.ownedPose, this.ownedPose.skeleton, this.ownedMotion.params, 1)
    }
    updateWorld(this.ownedPose)
  }

  dispose(): void {
    this.disposedFlag = true
  }
}
