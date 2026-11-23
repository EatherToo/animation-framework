import { updateWorld, WORLD_STRIDE, type Pose } from './pose'
import { resolveAttachment, type Attachment, type SlotSet } from '../slot/slot'

type BoundingBox = Extract<Attachment, { kind: 'boundingBox' | 'path' }> & { kind: 'boundingBox' }
export type BoundsRect = { x: number; y: number; width: number; height: number }

function onSegment(ax: number, ay: number, bx: number, by: number, x: number, y: number): boolean {
  // World vertices are Float32; a query derived from the same matrix may differ by one rounding step.
  const tolerance = 2e-7 * Math.max(1, Math.abs(ax), Math.abs(ay), Math.abs(bx), Math.abs(by))
  const length = Math.hypot(bx - ax, by - ay)
  if (length === 0) return Math.hypot(x - ax, y - ay) <= tolerance
  return Math.abs(cross(ax, ay, bx, by, x, y)) <= tolerance * length
    && x >= Math.min(ax, bx) - tolerance && x <= Math.max(ax, bx) + tolerance
    && y >= Math.min(ay, by) - tolerance && y <= Math.max(ay, by) + tolerance
}

function pointInPolygon(polygon: Float32Array, x: number, y: number): boolean {
  let inside = false
  const count = polygon.length / 2
  for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
    const ax = polygon[j * 2]!, ay = polygon[j * 2 + 1]!
    const bx = polygon[i * 2]!, by = polygon[i * 2 + 1]!
    if (onSegment(ax, ay, bx, by, x, y)) return true
    if ((ay > y) !== (by > y) && x < ax + (y - ay) * (bx - ax) / (by - ay)) inside = !inside
  }
  return inside
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

function edgesIntersect(ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number): boolean {
  const abC = cross(ax, ay, bx, by, cx, cy)
  const abD = cross(ax, ay, bx, by, dx, dy)
  const cdA = cross(cx, cy, dx, dy, ax, ay)
  const cdB = cross(cx, cy, dx, dy, bx, by)
  if (onSegment(ax, ay, bx, by, cx, cy)) return true
  if (onSegment(ax, ay, bx, by, dx, dy)) return true
  if (onSegment(cx, cy, dx, dy, ax, ay)) return true
  if (onSegment(cx, cy, dx, dy, bx, by)) return true
  return ((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
}

/** World-space bounding-box polygons for the active slot attachments. Queries include boundaries. */
export class SkeletonBounds {
  readonly boundingBoxes: BoundingBox[] = []
  readonly polygons: Float32Array[] = []
  minX = 0
  minY = 0
  maxX = 0
  maxY = 0

  update(pose: Pose, slotSet: SlotSet): void {
    updateWorld(pose)
    this.boundingBoxes.length = 0
    this.polygons.length = 0
    let hasVertex = false
    for (const slotIndex of slotSet.drawOrder) {
      const attachment = resolveAttachment(slotSet, slotIndex)
      if (attachment?.kind !== 'boundingBox') continue
      const source = attachment.polygon
      if (source.length < 6 || source.length % 2 !== 0) continue
      const bone = slotSet.slots[slotIndex]!.data.bone
      const offset = bone * WORLD_STRIDE
      const m = pose.world
      const polygon = new Float32Array(source.length)
      for (let i = 0; i < source.length; i += 2) {
        const x = source[i]!, y = source[i + 1]!
        const wx = m[offset]! * x + m[offset + 2]! * y + m[offset + 4]!
        const wy = m[offset + 1]! * x + m[offset + 3]! * y + m[offset + 5]!
        polygon[i] = wx
        polygon[i + 1] = wy
        if (!hasVertex) {
          this.minX = this.maxX = wx
          this.minY = this.maxY = wy
          hasVertex = true
        } else {
          this.minX = Math.min(this.minX, wx)
          this.minY = Math.min(this.minY, wy)
          this.maxX = Math.max(this.maxX, wx)
          this.maxY = Math.max(this.maxY, wy)
        }
      }
      this.boundingBoxes.push(attachment as BoundingBox)
      this.polygons.push(polygon)
    }
    if (!hasVertex) this.minX = this.minY = this.maxX = this.maxY = 0
  }

  getBoundsRect(): BoundsRect {
    return { x: this.minX, y: this.minY, width: this.maxX - this.minX, height: this.maxY - this.minY }
  }

  getWidth(): number { return this.maxX - this.minX }

  getHeight(): number { return this.maxY - this.minY }

  getPolygon(boundingBox: BoundingBox): Float32Array | null {
    const index = this.boundingBoxes.indexOf(boundingBox)
    return index < 0 ? null : this.polygons[index]!
  }

  aabbContainsPoint(x: number, y: number): boolean {
    return this.polygons.length > 0 && x >= this.minX && x <= this.maxX && y >= this.minY && y <= this.maxY
  }

  aabbIntersectsSegment(x1: number, y1: number, x2: number, y2: number): boolean {
    if (this.polygons.length === 0) return false
    const { minX, minY, maxX, maxY } = this
    if ((x1 <= minX && x2 <= minX) || (y1 <= minY && y2 <= minY)
      || (x1 >= maxX && x2 >= maxX) || (y1 >= maxY && y2 >= maxY)) return false
    const slope = (y2 - y1) / (x2 - x1)
    let y = slope * (minX - x1) + y1
    if (y > minY && y < maxY) return true
    y = slope * (maxX - x1) + y1
    if (y > minY && y < maxY) return true
    let x = (minY - y1) / slope + x1
    if (x > minX && x < maxX) return true
    x = (maxY - y1) / slope + x1
    return x > minX && x < maxX
  }

  aabbIntersectsSkeleton(bounds: Pick<SkeletonBounds, 'minX' | 'minY' | 'maxX' | 'maxY'>): boolean {
    return this.polygons.length > 0 && this.minX < bounds.maxX && this.maxX > bounds.minX
      && this.minY < bounds.maxY && this.maxY > bounds.minY
  }

  containsPointPolygon(polygon: Float32Array, x: number, y: number): boolean {
    return pointInPolygon(polygon, x, y)
  }

  intersectsSegmentPolygon(polygon: Float32Array, x1: number, y1: number, x2: number, y2: number): boolean {
    const count = polygon.length / 2
    for (let j = 0; j < count; j += 1) {
      const next = (j + 1) % count
      if (edgesIntersect(x1, y1, x2, y2,
        polygon[j * 2]!, polygon[j * 2 + 1]!, polygon[next * 2]!, polygon[next * 2 + 1]!)) return true
    }
    return false
  }

  containsPoint(x: number, y: number): BoundingBox | null {
    for (let i = 0; i < this.polygons.length; i += 1) {
      if (this.containsPointPolygon(this.polygons[i]!, x, y)) return this.boundingBoxes[i]!
    }
    return null
  }

  intersectsSegment(x1: number, y1: number, x2: number, y2: number): BoundingBox | null {
    for (let i = 0; i < this.polygons.length; i += 1) {
      // As in Spine's SkeletonBounds, this tests boundary crossings, not full containment.
      if (this.intersectsSegmentPolygon(this.polygons[i]!, x1, y1, x2, y2)) return this.boundingBoxes[i]!
    }
    return null
  }
}
