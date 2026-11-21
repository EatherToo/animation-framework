/** M10 测试用最小 WebGL2 mock：记录调用序列，便于断言纹理/掩码/绘制顺序。 */

import type { WebGL2Like } from '@/backend/backend'

export interface GLCall {
  readonly op: string
  readonly args: readonly unknown[]
}

/** 只实现 WebGL2Like 里的可观测方法；未列出的方法保持缺省，后端应优雅降级。 */
export class FakeWebGL implements WebGL2Like {
  readonly calls: GLCall[] = []
  private nextBuffer = 1
  private nextTexture = 1
  private lastColors: number[] = []

  private push(op: string, ...args: unknown[]): void {
    this.calls.push({ op, args })
  }

  createBuffer(): number {
    const id = this.nextBuffer++
    this.push('createBuffer', id)
    return id
  }

  deleteBuffer(buffer: unknown): void {
    this.push('deleteBuffer', buffer)
  }

  bindBuffer(target: number, buffer: unknown): void {
    this.push('bindBuffer', target, buffer)
  }

  bufferData(target: number, data: ArrayBufferView | number, usage: number): void {
    this.push('bufferData', target, data, usage)
  }

  bufferSubData(target: number, offset: number, data: ArrayBufferView): void {
    const bytes = Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    if (offset === 0) {
      // 后端每包按 positions/uvs/colors/indices 顺序上传，第三个即颜色。
      const colorLike = bytes.length % 4 === 0 && bytes.length <= 64
      if (colorLike) this.lastColors = bytes
    }
    this.push('bufferSubData', target, offset, bytes.length)
  }

  getAttribLocation(_program: unknown, name: string): number {
    this.push('getAttribLocation', name)
    return name === 'aPosition' ? 0 : name === 'aUv' ? 1 : 2
  }

  enableVertexAttribArray(index: number): void {
    this.push('enableVertexAttribArray', index)
  }

  vertexAttribPointer(
    index: number,
    size: number,
    type: number,
    normalized: boolean,
    stride: number,
    offset: number,
  ): void {
    this.push('vertexAttribPointer', index, size, type, normalized, stride, offset)
  }

  getUniformLocation(_program: unknown, name: string): string {
    this.push('getUniformLocation', name)
    return name
  }

  uniformMatrix3fv(location: unknown, transpose: boolean, value: ArrayLike<number>): void {
    this.push('uniformMatrix3fv', location, transpose, Array.from(value))
  }

  uniformMatrix4fv(location: unknown, transpose: boolean, value: ArrayLike<number>): void {
    this.push('uniformMatrix4fv', location, transpose, Array.from(value))
  }

  uniform1i(location: unknown, value: number): void {
    this.push('uniform1i', location, value)
  }

  uniform1f(location: unknown, value: number): void {
    this.push('uniform1f', location, value)
  }

  uniform2f(location: unknown, x: number, y: number): void {
    this.push('uniform2f', location, x, y)
  }

  useProgram(program: unknown): void {
    this.push('useProgram', program)
  }

  createTexture(): number {
    const id = this.nextTexture++
    this.push('createTexture', id)
    return id
  }

  deleteTexture(texture: unknown): void {
    this.push('deleteTexture', texture)
  }

  bindTexture(target: number, texture: unknown): void {
    this.push('bindTexture', target, texture)
  }

  activeTexture(unit: number): void {
    this.push('activeTexture', unit)
  }

  texImage2D(
    target: number,
    level: number,
    internalformat: number,
    width: number,
    height: number,
    border: number,
    format: number,
    type: number,
    pixels: ArrayBufferView | null,
  ): void {
    this.push('texImage2D', target, level, internalformat, width, height, border, format, type, pixels)
  }

  texParameteri(target: number, pname: number, param: number): void {
    this.push('texParameteri', target, pname, param)
  }

  drawElements(mode: number, count: number, type: number, offset: number): void {
    this.push('drawElements', mode, count, type, offset, this.lastColors.slice())
  }

  scissor(x: number, y: number, width: number, height: number): void {
    this.push('scissor', x, y, width, height)
  }

  enable(cap: number): void {
    this.push('enable', cap)
  }

  disable(cap: number): void {
    this.push('disable', cap)
  }

  stencilFunc(func: number, ref: number, mask: number): void {
    this.push('stencilFunc', func, ref, mask)
  }

  stencilOp(fail: number, zfail: number, zpass: number): void {
    this.push('stencilOp', fail, zfail, zpass)
  }

  clearStencil(s: number): void {
    this.push('clearStencil', s)
  }

  colorMask(r: boolean, g: boolean, b: boolean, a: boolean): void {
    this.push('colorMask', r, g, b, a)
  }

  depthFunc(func: number): void {
    this.push('depthFunc', func)
  }

  depthMask(flag: boolean): void {
    this.push('depthMask', flag)
  }

  clear(mask: number): void {
    this.push('clear', mask)
  }

  /** 便捷查询：某个操作的次数。 */
  count(op: string): number {
    return this.calls.filter((c) => c.op === op).length
  }

  /** 便捷查询：某操作第一次出现的下标，找不到返回 -1。 */
  indexOf(op: string): number {
    return this.calls.findIndex((c) => c.op === op)
  }

  /** 便捷查询：按操作名取出调用参数。 */
  argsOf(op: string): readonly unknown[][] {
    return this.calls.filter((c) => c.op === op).map((c) => [...c.args])
  }
}
