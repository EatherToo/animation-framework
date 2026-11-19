import { isFacing, type Facing } from '../space/facing'

export type ParamValues = {
  speed: number
  cadenceStyle: number
  crouch: number
  lean: number
  facing: Facing
  armSwing: number
  spineBend: number
  breath: number
}

export type Params = {
  target: ParamValues
  current: ParamValues
}

const TAU = 0.25

function values(speed: number, facing: Facing): ParamValues {
  return {
    speed,
    cadenceStyle: 1,
    crouch: 0,
    lean: 0,
    facing,
    armSwing: 0,
    spineBend: 0,
    breath: 0,
  }
}

export function createParams(): Params {
  return { target: values(0, 1), current: values(0, 1) }
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(name)
}

function unit(name: string, value: number): void {
  finite(name, value)
  if (value < 0 || value > 1) throw new Error(name)
}

export function setSpeed(params: Params, speed: number): void {
  finite('speed', speed)
  params.target.speed = speed
}

export function setCadenceStyle(params: Params, style: number): void {
  finite('cadenceStyle', style)
  if (style <= 0) throw new Error('cadenceStyle')
  params.target.cadenceStyle = style
}

export function setCrouch(params: Params, crouch: number): void {
  unit('crouch', crouch)
  params.target.crouch = crouch
}

export function setLean(params: Params, lean: number): void {
  finite('lean', lean)
  params.target.lean = lean
}

export function setFacing(params: Params, facing: Facing): void {
  if (!isFacing(facing)) throw new Error('facing')
  params.target.facing = facing
  params.current.facing = facing
}

export function setArmSwing(params: Params, amount: number): void {
  unit('armSwing', amount)
  params.target.armSwing = amount
}

export function setSpineBend(params: Params, amount: number): void {
  unit('spineBend', amount)
  params.target.spineBend = amount
}

export function setBreath(params: Params, amount: number): void {
  unit('breath', amount)
  params.target.breath = amount
}

export function applyPreset(params: Params, preset: 'stand' | 'walk' | 'run'): void {
  const speed = preset === 'walk' ? 1.2 : preset === 'run' ? 3 : preset === 'stand' ? 0 : NaN
  if (!Number.isFinite(speed)) throw new Error('preset')
  const facing = params.target.facing
  params.target = values(speed, facing)
}

export function stepParams(params: Params, dt: number): void {
  finite('dt', dt)
  if (dt <= 0) throw new Error('dt')
  const k = 1 - Math.exp(-dt / TAU)
  const keys = ['speed', 'cadenceStyle', 'crouch', 'lean', 'armSwing', 'spineBend', 'breath'] as const
  for (const key of keys) {
    params.current[key] += (params.target[key] - params.current[key]) * k
  }
}
