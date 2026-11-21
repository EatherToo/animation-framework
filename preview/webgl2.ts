import type { HumanoidAtlas, RenderPacket } from '@animation-framework/render-engine/pipeline2d'

type Frame = { scale: number; originX: number; originY: number }

const VERT = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
in vec4 a_color;
out vec2 v_uv;
out vec4 v_color;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
}`

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
uniform sampler2D u_atlas;
uniform sampler2D u_mask;
uniform bool u_useAtlas;
uniform bool u_useMask;
uniform vec2 u_res;
out vec4 outColor;
void main() {
  vec4 c = u_useAtlas ? texture(u_atlas, v_uv) * v_color : v_color;
  if (u_useMask) {
    vec2 muv = vec2(gl_FragCoord.x / u_res.x, 1.0 - gl_FragCoord.y / u_res.y);
    if (texture(u_mask, muv).r < 0.5) discard;
  }
  outColor = c;
}`

type DrawRange = { first: number; count: number; hasAtlas: boolean; useMask: boolean }

/** 浏览器 WebGL2 后端：把 RenderPacket 直接画到离屏 canvas，再交给 2D canvas 显示。 */
export class PacketWebGLRenderer {
  readonly canvas: HTMLCanvasElement
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly vao: WebGLVertexArrayObject
  private readonly vbo: WebGLBuffer
  private readonly ibo: WebGLBuffer
  private readonly edgeVao: WebGLVertexArrayObject
  private readonly edgeVbo: WebGLBuffer
  private readonly atlasTextures: WebGLTexture[] = []
  private readonly mask: WebGLTexture
  private readonly ranges: DrawRange[] = []
  private readonly edgeRanges: number[] = []
  private readonly uRes: WebGLUniformLocation
  private readonly uUseAtlas: WebGLUniformLocation
  private readonly uUseMask: WebGLUniformLocation
  lastFill: Float32Array = new Float32Array(0)
  readonly stats = { packets: 0, vertices: 0, edgeVertices: 0, error: 0, viewport: [] as number[], uRes: [] as number[], uScale: 0, uOrigin: [] as number[], buffer: [] as number[], scissor: false, scissorBox: [] as number[] }

  constructor() {
    this.canvas = document.createElement('canvas')
    const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true })
    if (gl === null) throw new Error('webgl2')
    this.gl = gl
    this.program = program(gl)
    this.vao = vao(gl)
    this.vbo = buffer(gl)
    this.ibo = buffer(gl)
    this.edgeVao = vao(gl)
    this.edgeVbo = buffer(gl)
    for (let i = 0; i < 4; i += 1) this.atlasTextures.push(texture(gl))
    this.mask = texture(gl)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 8)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo)
    gl.bindVertexArray(this.edgeVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeVbo)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 8)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16)
    gl.bindVertexArray(null)
    gl.useProgram(this.program)
    this.uRes = loc(gl, this.program, 'u_res')
    this.uUseAtlas = loc(gl, this.program, 'u_useAtlas')
    this.uUseMask = loc(gl, this.program, 'u_useMask')
    gl.uniform1i(loc(gl, this.program, 'u_atlas'), 0)
    gl.uniform1i(loc(gl, this.program, 'u_mask'), 1)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.disable(gl.DEPTH_TEST)
  }

  render(
    packets: readonly RenderPacket[],
    atlas: HumanoidAtlas,
    frame: Frame,
    width: number,
    height: number,
    mask: Uint8Array | null,
  ): void {
    const gl = this.gl
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    gl.viewport(0, 0, width, height)
    gl.disable(gl.SCISSOR_TEST)
    gl.clearColor(92 / 255, 92 / 255, 92 / 255, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.uploadAtlas(atlas)
    if (mask !== null) this.uploadMask(mask, width, height)
    gl.useProgram(this.program)
    gl.uniform2f(this.uRes, width, height)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.mask)
    let vertices = 0
    let edgeVertices = 0
    for (const packet of packets) {
      const count = packet.vertices.length / 2
      const ref = atlas.regions.get(packet.atlasKey)
      const region = ref?.region
      const page = ref === undefined ? undefined : atlas.pages[ref.page]
      const fill = new Float32Array(count * 8)
      for (let v = 0; v < count; v += 1) {
        const px = packet.vertices[v * 2]! * frame.scale + frame.originX
        const py = frame.originY - packet.vertices[v * 2 + 1]! * frame.scale
        fill[v * 8] = (px / width) * 2 - 1
        fill[v * 8 + 1] = 1 - (py / height) * 2
        const localU = packet.uvs[v * 2] ?? 0
        const localV = packet.uvs[v * 2 + 1] ?? 0
        fill[v * 8 + 2] = region === undefined || page === undefined
          ? localU
          : (region.x + localU * region.width) / page.atlas.width
        fill[v * 8 + 3] = region === undefined || page === undefined
          ? localV
          : (region.y + localV * region.height) / page.atlas.height
        fill[v * 8 + 4] = (packet.colors[v * 4] ?? 255) / 255
        fill[v * 8 + 5] = (packet.colors[v * 4 + 1] ?? 255) / 255
        fill[v * 8 + 6] = (packet.colors[v * 4 + 2] ?? 255) / 255
        fill[v * 8 + 7] = (packet.colors[v * 4 + 3] ?? 255) / 255
      }
      this.lastFill = fill
      gl.bindVertexArray(this.vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
      gl.bufferData(gl.ARRAY_BUFFER, fill, gl.DYNAMIC_DRAW)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(packet.indices), gl.DYNAMIC_DRAW)
      if (ref !== undefined && page !== undefined) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this.atlasTextures[ref.page]!)
      }
      gl.uniform1i(this.uUseAtlas, ref !== undefined && page !== undefined && packet.atlasPage >= 0 ? 1 : 0)
      gl.uniform1i(this.uUseMask, packet.mask !== null && mask !== null ? 1 : 0)
      gl.drawElements(gl.TRIANGLES, packet.indices.length, gl.UNSIGNED_SHORT, 0)
      vertices += count

      const edge: number[] = []
      const seen = new Set<string>()
      for (let t = 0; t < packet.indices.length; t += 3) {
        for (let e = 0; e < 3; e += 1) {
          const a = packet.indices[t + e]!
          const b = packet.indices[t + ((e + 1) % 3)]!
          const lo = Math.min(a, b)
          const hi = Math.max(a, b)
          const key = `${lo}:${hi}`
          if (seen.has(key)) continue
          seen.add(key)
          if (packet.seam[lo] === 1 && packet.seam[hi] === 1) continue
          const lx = ((packet.vertices[lo * 2]! * frame.scale + frame.originX) / width) * 2 - 1
          const ly = 1 - ((frame.originY - packet.vertices[lo * 2 + 1]! * frame.scale) / height) * 2
          const hx = ((packet.vertices[hi * 2]! * frame.scale + frame.originX) / width) * 2 - 1
          const hy = 1 - ((frame.originY - packet.vertices[hi * 2 + 1]! * frame.scale) / height) * 2
          edge.push(
            lx, ly, 0, 0, 0.08, 0.08, 0.08, 1,
            hx, hy, 0, 0, 0.08, 0.08, 0.08, 1,
          )
        }
      }
      if (edge.length > 0) {
        gl.bindVertexArray(this.edgeVao)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeVbo)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(edge), gl.DYNAMIC_DRAW)
        gl.uniform1i(this.uUseAtlas, 0)
        gl.uniform1i(this.uUseMask, 0)
        gl.drawArrays(gl.LINES, 0, edge.length / 8)
        edgeVertices += edge.length / 8
      }
    }
    gl.bindVertexArray(null)
    this.stats.packets = packets.length
    this.stats.vertices = vertices
    this.stats.edgeVertices = edgeVertices
    this.stats.error = gl.getError()
    this.stats.viewport = Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array)
    this.stats.uRes = Array.from((gl.getUniform(this.program, this.uRes) as Float32Array | null) ?? [])
    this.stats.buffer = [gl.drawingBufferWidth, gl.drawingBufferHeight]
    this.stats.scissor = gl.isEnabled(gl.SCISSOR_TEST)
    this.stats.scissorBox = Array.from(gl.getParameter(gl.SCISSOR_BOX) as Int32Array)
  }

  private uploadAtlas(atlas: HumanoidAtlas): void {
    const gl = this.gl
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    for (let i = 0; i < atlas.pages.length && i < this.atlasTextures.length; i += 1) {
      const page = atlas.pages[i]!
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTextures[i]!)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        page.atlas.width,
        page.atlas.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        page.image.rgba,
      )
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
  }

  private uploadMask(mask: Uint8Array, width: number, height: number): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.mask)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, mask)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }
}

function program(gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = shader(gl, gl.VERTEX_SHADER, VERT)
  const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAG)
  const result = gl.createProgram()
  if (result === null) throw new Error('program')
  gl.attachShader(result, vertex)
  gl.attachShader(result, fragment)
  gl.bindAttribLocation(result, 0, 'a_pos')
  gl.bindAttribLocation(result, 1, 'a_uv')
  gl.bindAttribLocation(result, 2, 'a_color')
  gl.linkProgram(result)
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result) ?? 'link')
  return result
}

function shader(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
  const result = gl.createShader(kind)
  if (result === null) throw new Error('shader')
  gl.shaderSource(result, source)
  gl.compileShader(result)
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result) ?? 'compile')
  return result
}

function vao(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const result = gl.createVertexArray()
  if (result === null) throw new Error('vao')
  return result
}

function buffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const result = gl.createBuffer()
  if (result === null) throw new Error('buffer')
  return result
}

function texture(gl: WebGL2RenderingContext): WebGLTexture {
  const result = gl.createTexture()
  if (result === null) throw new Error('texture')
  return result
}

function loc(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  const result = gl.getUniformLocation(program, name)
  if (result === null) throw new Error('uniform')
  return result
}
