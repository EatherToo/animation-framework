import { createWorldPoint, setWorldPoint, type WorldPoint } from '../space/world-point'

export type Placement = {
  origin: WorldPoint
  groundY: number
  generation: number
}

export function createPlacement(): Placement {
  return { origin: createWorldPoint(), groundY: 0, generation: 0 }
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(name)
}

export function setPlacement(
  placement: Placement,
  originX: number,
  originY: number,
  groundY: number,
  generation: number,
): void {
  finite('originX', originX)
  finite('originY', originY)
  finite('groundY', groundY)
  if (!Number.isInteger(generation) || generation < placement.generation) {
    throw new Error('generation')
  }
  setWorldPoint(placement.origin, originX, originY)
  placement.groundY = groundY
  placement.generation = generation
}

export function characterGroundY(placement: Placement): number {
  return placement.groundY - placement.origin[1]!
}

export function movedGeneration(previous: number, next: number): boolean {
  return next > previous
}
