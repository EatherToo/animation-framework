import { describe, expect, it } from '@jest/globals'
import { WebGL2Backend, type WebGL2Like } from '@/backend/backend'
import { batchPackets, buildRegionPacket, sortPackets } from '@/render/render'

const canvas = typeof document === 'undefined' ? null : document.createElement('canvas')
const realGl = canvas?.getContext('webgl2', { stencil: true }) ?? null
const rendererInfo = realGl?.getExtension('WEBGL_debug_renderer_info')
const renderer = realGl && rendererInfo
  ? String(realGl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)) : ''
const timer = realGl?.getExtension('EXT_disjoint_timer_query_webgl2') ?? null
const gpuUnavailable = realGl === null ? 'no WebGL2 context' :
  !rendererInfo ? 'no unmasked renderer extension' :
    /swiftshader|llvmpipe|software/i.test(renderer) ? `software renderer: ${renderer}` :
      timer === null ? 'no EXT_disjoint_timer_query_webgl2' : ''
if (gpuUnavailable) console.warn(`[A33b SKIP] ${gpuUnavailable}; GPU p95 not measured`)

function mockGl(): WebGL2Like {
  let next = 1
  return {
    createBuffer: () => ({ id: next++ }),
    bindBuffer: () => {}, bufferData: () => {}, bufferSubData: () => {},
    getAttribLocation: () => 0, enableVertexAttribArray: () => {}, vertexAttribPointer: () => {},
    useProgram: () => {}, drawElements: () => {}, getUniformLocation: () => null,
  } as WebGL2Like
}

function frame(packetCount: number) {
  const packets = Array.from({ length: packetCount }, (_, i) => buildRegionPacket({
    id: i,
    positions: new Float32Array([0, 0, 8, 0, 8, 8, 0, 8]),
    color: [1, 1, 1, 1], materialId: 0, order: i, depthKey: 0, seq: i,
  }))
  return { packets: batchPackets(sortPackets(packets)), width: 1920, height: 1080 }
}

describe('performance budget: 1080p frame submission', () => {
  it('keeps draw calls bounded and CPU submission under 16.6ms', () => {
    const f = frame(512)
    expect(f.packets.length).toBeLessThanOrEqual(50)
    const backend = new WebGL2Backend(mockGl())
    const start = performance.now()
    backend.draw(f)
    const elapsed = performance.now() - start
    expect(backend.stats.drawCalls).toBe(f.packets.length)
    expect(elapsed).toBeLessThan(16.6)
    backend.dispose()
  })

  // A33b is deliberately conditional: a mocked GL cannot measure GPU execution.
  const gpuIt = gpuUnavailable ? it.skip : it
  gpuIt('gates real GPU timer-query p95 and draw calls', async () => {
    const gl = realGl!
    const ext = timer!
    const backend = new WebGL2Backend(gl)
    const f = frame(400)
    const samples: number[] = []
    try {
      for (let i = 0; i < 60; i += 1) backend.draw(f)
      for (let i = 0; i < 60; i += 1) {
        const query = gl.createQuery()
        expect(query).not.toBeNull()
        gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
        backend.draw(f)
        gl.endQuery(ext.TIME_ELAPSED_EXT)
        try {
          const deadline = performance.now() + 5000
          while (!gl.getQueryParameter(query!, gl.QUERY_RESULT_AVAILABLE)) {
            if (gl.getParameter(ext.GPU_DISJOINT_EXT)) throw new Error('A33b GPU timer disjoint')
            if (performance.now() >= deadline) throw new Error('A33b GPU timer query timed out')
            await new Promise<void>((resolve) => setTimeout(resolve, 1))
          }
          if (gl.getParameter(ext.GPU_DISJOINT_EXT)) throw new Error('A33b GPU timer disjoint')
          samples.push(Number(gl.getQueryParameter(query!, gl.QUERY_RESULT)) / 1e6)
          expect(backend.stats.drawCalls).toBeLessThanOrEqual(50)
        } finally {
          gl.deleteQuery(query)
        }
      }
      samples.sort((a, b) => a - b)
      const p95 = samples[56]!
      console.log(`[A33b] ${renderer} GPU p95=${p95.toFixed(2)}ms drawCalls=${backend.stats.drawCalls}`)
      expect(p95).toBeLessThanOrEqual(16.6)
    } finally {
      backend.dispose()
    }
  }, 120000)

  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc
  const memoryIt = gpuUnavailable || !gc || typeof process === 'undefined' ||
    typeof process.memoryUsage !== 'function' ? it.skip : it
  if (!gpuUnavailable && !gc) {
    console.warn('[A33b SKIP] --expose-gc unavailable; arrayBuffers/external growth not measured')
  }
  memoryIt('bounds retained arrayBuffers and external bytes below 1KB/frame', () => {
    const backend = new WebGL2Backend(realGl!)
    const f = frame(400)
    const deltas: number[] = []
    try {
      for (let i = 0; i < 60; i += 1) backend.draw(f)
      for (let round = 0; round < 3; round += 1) {
        gc!()
        const before = process.memoryUsage()
        for (let i = 0; i < 600; i += 1) backend.draw(f)
        gc!()
        const after = process.memoryUsage()
        // external includes arrayBuffers on Node; report both, gate the larger delta.
        const arrayBuffers = (after.arrayBuffers - before.arrayBuffers) / 600
        const external = (after.external - before.external) / 600
        console.log(`[A33b] round=${round} arrayBuffers=${arrayBuffers.toFixed(1)} ` +
          `external=${external.toFixed(1)} bytes/frame`)
        deltas.push(Math.max(arrayBuffers, external))
      }
      deltas.sort((a, b) => a - b)
      expect(deltas[1]).toBeLessThan(1024)
    } finally {
      backend.dispose()
    }
  }, 120000)
})
