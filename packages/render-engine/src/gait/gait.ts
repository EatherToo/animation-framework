import { isFacing, type Facing } from '../space/facing'
import { STAND_SPEED, WALK_FROUDE } from '../speed/speed'

export type GaitMode = 'stand' | 'start' | 'walk' | 'run' | 'stop' | 'recover'

export type Gait = {
  mode: GaitMode
  sign: -1 | 0 | 1
  facing: Facing
}

export type GaitInput = {
  speed: number
  facing: Facing
  contactHeld: boolean
  stepFinished: boolean
  requestRecover: boolean
  froude: number
}

export function createGait(): Gait {
  return { mode: 'stand', sign: 0, facing: 1 }
}

function moving(mode: GaitMode): boolean {
  return mode === 'start' || mode === 'walk' || mode === 'run'
}

export function stepGait(gait: Gait, input: GaitInput): void {
  if (!Number.isFinite(input.speed)) throw new Error('speed')
  if (!isFacing(input.facing)) throw new Error('facing')
  if (typeof input.contactHeld !== 'boolean') throw new Error('contactHeld')
  if (typeof input.stepFinished !== 'boolean') throw new Error('stepFinished')
  if (typeof input.requestRecover !== 'boolean') throw new Error('requestRecover')
  if (!Number.isFinite(input.froude)) throw new Error('froude')

  if (input.requestRecover && gait.mode !== 'recover') {
    gait.mode = 'recover'
    return
  }
  if (gait.mode === 'recover') {
    if (input.stepFinished && input.contactHeld) {
      gait.mode = 'stand'
      gait.sign = 0
    }
    return
  }

  const wantSign: -1 | 0 | 1 =
    Math.abs(input.speed) < STAND_SPEED ? 0 : input.speed > 0 ? 1 : -1
  const facingChanged = input.facing !== gait.facing
  const reversed = gait.sign !== 0 && wantSign !== 0 && wantSign !== gait.sign
  if (moving(gait.mode) && (reversed || facingChanged || wantSign === 0)) {
    gait.mode = 'stop'
    gait.facing = input.facing
    return
  }
  if (gait.mode === 'stand') {
    gait.facing = input.facing
    if (wantSign !== 0) {
      gait.mode = 'start'
      gait.sign = wantSign
    }
    return
  }
  if (gait.mode === 'stop') {
    gait.facing = input.facing
    if (input.stepFinished && input.contactHeld) {
      gait.mode = 'stand'
      gait.sign = 0
    }
    return
  }
  if (gait.mode === 'start' && input.stepFinished && input.contactHeld) {
    gait.mode = Math.abs(input.froude) < WALK_FROUDE ? 'walk' : 'run'
    return
  }
  if (gait.mode === 'walk' || gait.mode === 'run') {
    gait.mode = Math.abs(input.froude) < WALK_FROUDE ? 'walk' : 'run'
    gait.sign = wantSign
  }
}
