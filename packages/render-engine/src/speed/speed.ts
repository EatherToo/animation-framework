export const GRAVITY = 9.81
export const WALK_FROUDE = 0.5
export const PREFERRED_STEP_RATIO = 0.8
export const WALK_DUTY = 0.62
export const RUN_DUTY = 0.4
export const STAND_SPEED = 0.05

export type SpeedCandidate = {
  cadence: number
  stepLength: number
  duty: number
  froude: number
}

export function speedCandidate(
  speed: number,
  cadenceStyle: number,
  legLength: number,
): SpeedCandidate {
  if (!Number.isFinite(speed)) throw new Error('speed')
  if (!Number.isFinite(cadenceStyle) || cadenceStyle <= 0) throw new Error('cadenceStyle')
  if (!Number.isFinite(legLength) || legLength <= 0) throw new Error('legLength')
  const froude = (speed * speed) / (GRAVITY * legLength)
  const duty = Math.abs(froude) < WALK_FROUDE ? WALK_DUTY : RUN_DUTY
  if (Math.abs(speed) < STAND_SPEED) {
    return { cadence: 0, stepLength: 0, duty: WALK_DUTY, froude }
  }
  const stepLength = Math.sign(speed) * ((PREFERRED_STEP_RATIO * legLength) / cadenceStyle)
  const cadence = Math.abs(speed) / Math.abs(stepLength)
  return { cadence, stepLength, duty, froude }
}
