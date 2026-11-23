/**
 * Shader 变体键与程序缓存：材质/掩码只决定 variant，绘制时不再编译。
 * 说明：本模块只负责 GLSL 程序生命周期；属性/uniform 由后端设置。
 */
export type ShaderVariant = {
  readonly pma: boolean
  readonly twoColor: boolean
  readonly tintBlack: boolean
  readonly alphaMask: boolean
  readonly stencil: boolean
}

export type MaterialVariantInput = {
  readonly pma?: boolean
  readonly twoColor?: boolean
  readonly tintBlack?: boolean
  readonly kind?: 'flat' | 'sprite'
}

export function variantOf(material: MaterialVariantInput, maskMode: 'none' | 'scissor' | 'stencil' | 'alpha'): ShaderVariant {
  return {
    pma: material.pma ?? true,
    twoColor: material.twoColor ?? false,
    tintBlack: material.tintBlack ?? false,
    alphaMask: maskMode === 'alpha',
    stencil: maskMode === 'stencil',
  }
}

export function variantKey(v: ShaderVariant): string {
  return `pma=${v.pma ? 1 : 0};two=${v.twoColor ? 1 : 0};black=${v.tintBlack ? 1 : 0};alpha=${v.alphaMask ? 1 : 0};stencil=${v.stencil ? 1 : 0}`
}

export const VERTEX = `#version 300 es
in vec2 aPosition; in vec2 aUv; in vec4 aColor; in vec4 aDark;
uniform mat3 viewProjection; uniform vec2 uResolution;
out vec2 vUv; out vec4 vColor; out vec4 vDark; out vec2 vScreen;
void main() {
  vec3 p = viewProjection * vec3(aPosition, 1.0);
  gl_Position = vec4(p.x / uResolution.x * 2.0 - 1.0, 1.0 - p.y / uResolution.y * 2.0, 0.0, 1.0);
  vUv = aUv; vColor = aColor; vDark = aDark; vScreen = p.xy;
}`

export const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 vUv; in vec4 vColor; in vec4 vDark; in vec2 vScreen;
uniform sampler2D uTexture; uniform float uUseTexture; uniform float uTwoColor; uniform float uTintBlack;
#ifdef ALPHA_MASK
uniform sampler2D uMask;
uniform float uAlphaMask;
uniform vec4 uMaskBounds;
uniform mat3 uMaskUvMatrix;
uniform float uMaskInvert;
uniform float uMaskFeather;
#endif
out vec4 outColor;
void main() {
  vec4 texel = uUseTexture > 0.5 ? texture(uTexture, vUv) : vec4(1.0);
  vec4 c = vColor * texel;
#ifdef TWO_COLOR
  if (uTwoColor > 0.5) {
    vec4 dark = uTintBlack > 0.5 ? vec4(0.0, 0.0, 0.0, 1.0) : vDark;
    c.rgb = ((texel.a - 1.0) * dark.a + 1.0 - texel.rgb) * dark.rgb + texel.rgb * vColor.rgb;
  }
#endif
#ifdef ALPHA_MASK
  if (uAlphaMask > 0.5) {
    vec2 local = (vScreen - uMaskBounds.xy) / uMaskBounds.zw;
    float coverage = 0.0;
    if (all(greaterThanEqual(local, vec2(0.0))) && all(lessThanEqual(local, vec2(1.0)))) {
      vec2 uv = (uMaskUvMatrix * vec3(local, 1.0)).xy;
      float alpha = texture(uMask, uv).a;
      coverage = uMaskFeather > 0.0 ? alpha : step(0.5, alpha);
    }
    c *= uMaskInvert > 0.5 ? 1.0 - coverage : coverage;
  }
#endif
  outColor = c;
}`

export interface ProgramGL {
  createShader(type: number): unknown
  shaderSource(shader: unknown, source: string): void
  compileShader(shader: unknown): void
  getShaderParameter(shader: unknown, pname: number): boolean
  deleteShader?(shader: unknown): void
  createProgram(): unknown
  attachShader(program: unknown, shader: unknown): void
  linkProgram(program: unknown): void
  getProgramParameter(program: unknown, pname: number): boolean
  useProgram?(program: unknown): void
  deleteProgram?(program: unknown): void
}

const VERTEX_SHADER = 0x8b31
const FRAGMENT_SHADER = 0x8b30
const COMPILE_STATUS = 0x8b81
const LINK_STATUS = 0x8b82

function withDefines(source: string, variant: ShaderVariant): string {
  const defines: string[] = []
  if (variant.pma) defines.push('#define PMA 1')
  if (variant.twoColor) defines.push('#define TWO_COLOR 1')
  if (variant.tintBlack) defines.push('#define TINT_BLACK 1')
  if (variant.alphaMask) defines.push('#define ALPHA_MASK 1')
  if (variant.stencil) defines.push('#define STENCIL 1')
  return defines.length === 0 ? source : source.replace('#version 300 es', `#version 300 es\n${defines.join('\n')}`)
}

/** 程序缓存：同 variant 只编译一次；dispose 后拒绝使用。 */
export class ProgramCache {
  private readonly gl: ProgramGL
  private readonly programs = new Map<string, unknown>()
  private disposed = false

  constructor(gl: ProgramGL) {
    this.gl = gl
  }

  get size(): number {
    return this.programs.size
  }

  private compile(variant: ShaderVariant): unknown {
    const gl = this.gl
    const vs = gl.createShader(VERTEX_SHADER)
    const fs = gl.createShader(FRAGMENT_SHADER)
    gl.shaderSource(vs, withDefines(VERTEX, variant))
    gl.shaderSource(fs, withDefines(FRAGMENT, variant))
    gl.compileShader(vs)
    gl.compileShader(fs)
    if (!gl.getShaderParameter(vs, COMPILE_STATUS) || !gl.getShaderParameter(fs, COMPILE_STATUS)) {
      throw new Error('E_SHADER')
    }
    const program = gl.createProgram()
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, LINK_STATUS)) throw new Error('E_SHADER_LINK')
    gl.deleteShader?.(vs)
    gl.deleteShader?.(fs)
    return program
  }

  get(variant: ShaderVariant): unknown {
    if (this.disposed) throw new Error('E_DISPOSED')
    const key = variantKey(variant)
    const found = this.programs.get(key)
    if (found !== undefined) return found
    const program = this.compile(variant)
    this.programs.set(key, program)
    return program
  }

  precompile(variants: readonly ShaderVariant[]): void {
    for (const variant of variants) this.get(variant)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const program of this.programs.values()) this.gl.deleteProgram?.(program)
    this.programs.clear()
  }
}
