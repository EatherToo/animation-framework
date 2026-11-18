import { setVec2, type Vec2 } from '../math'
import type { FootShape } from './shape'

/**
 * 把脚底局部点绕踝转到踝所在的空间。
 * @param out 输出缓冲
 * @param soleLocal 脚局部中的脚底点
 * @param pitch 脚尖相对该空间 `+X` 的角，弧度，逆时针为正
 * @returns `out`
 */
export function soleOffset(out: Vec2, soleLocal: Vec2, pitch: number): Vec2 {
  assertPitch(pitch)
  assertPoint(soleLocal)
  return writeRotated(out, soleLocal[0]!, soleLocal[1]!, pitch, 0, 0, 1)
}

/**
 * 由踝和脚底局部点得到接触点。
 * @param out 输出缓冲
 * @param ankle 踝的位置
 * @param soleLocal 脚局部中的脚底点
 * @param pitch 脚的俯仰，弧度
 * @returns `out`
 */
export function contactFromAnkle(out: Vec2, ankle: Vec2, soleLocal: Vec2, pitch: number): Vec2 {
  assertPitch(pitch)
  assertPoint(ankle)
  assertPoint(soleLocal)
  return writeRotated(out, soleLocal[0]!, soleLocal[1]!, pitch, ankle[0]!, ankle[1]!, 1)
}

/**
 * 由接触点和脚底局部点得到踝。
 * @param out 输出缓冲
 * @param contact 接触点
 * @param soleLocal 脚局部中的脚底点
 * @param pitch 脚的俯仰，弧度
 * @returns `out`
 */
export function ankleFromContact(out: Vec2, contact: Vec2, soleLocal: Vec2, pitch: number): Vec2 {
  assertPitch(pitch)
  assertPoint(contact)
  assertPoint(soleLocal)
  return writeRotated(out, soleLocal[0]!, soleLocal[1]!, pitch, contact[0]!, contact[1]!, -1)
}

/**
 * 整段脚底在该俯仰下的最低点，写成相对踝的向量。
 * `sin(pitch) < 0` 时取脚尖，否则取脚跟。
 * @param out 输出缓冲
 * @param shape 脚底外形
 * @param pitch 脚的俯仰，弧度
 * @returns `out`
 */
export function lowestSoleOffset(out: Vec2, shape: FootShape, pitch: number): Vec2 {
  assertPitch(pitch)
  const soleY = shape.ankleHeight === 0 ? 0 : -shape.ankleHeight
  const qx = Math.fround(Math.sin(pitch) < 0 ? shape.toeForward : -shape.heelBack)
  const qy = Math.fround(soleY)
  return writeRotated(out, qx, qy, pitch, 0, 0, 1)
}

function writeRotated(
  out: Vec2,
  qx: number,
  qy: number,
  pitch: number,
  originX: number,
  originY: number,
  sign: 1 | -1,
): Vec2 {
  const c = Math.cos(pitch)
  const s = Math.sin(pitch)
  const rx = c * qx - s * qy
  const ry = s * qx + c * qy
  return setVec2(out, originX + sign * rx, originY + sign * ry)
}

function assertPitch(pitch: number): void {
  if (!Number.isFinite(pitch)) throw new Error('pitch')
}

function assertPoint(point: Vec2): void {
  if (!Number.isFinite(point[0]!) || !Number.isFinite(point[1]!)) {
    throw new Error('point')
  }
}
