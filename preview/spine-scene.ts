/** Optional locally served Spine samples for the preview's existing frame backends. */
import {
  DEFAULT_CAMERA,
  Engine,
  importSpine,
  importSpineAtlas,
  type RenderBackend,
  type RenderFrame,
} from '@animation-framework/render-engine'

export const SPINE_SAMPLES = {
  spineboy: { label: 'Spineboy', json: 'spineboy-pro.json', atlas: 'spineboy.atlas' },
  raptor: { label: 'Raptor', json: 'raptor-pro.json', atlas: 'raptor.atlas' },
  stretchyman: { label: 'Stretchyman', json: 'stretchyman-pro.json', atlas: 'stretchyman.atlas' },
} as const

export type SpineSample = keyof typeof SPINE_SAMPLES
export type SpineScene = {
  readonly sample: SpineSample
  readonly animations: readonly string[]
  readonly animation: string | null
  readonly boneNames: readonly string[]
  /** Adjust a bone relative to its setup rotation, in degrees. */
  setBoneRotation(name: string, degrees: number): void
  resetBoneRotations(): void
  /** null selects the setup pose; selecting an animation restarts it at time zero. */
  setAnimation(name: string | null): void
  /** Restart the current animation, or reset the setup pose. */
  reset(): void
  /** Advance and build a frame for either CpuBackend or WebGL2Backend. */
  frame(width: number, height: number, dt?: number): RenderFrame
  dispose(): void
}

// Engine assembles packets and resolves animation/constraints; the host draws
// the resulting frame with its own CPU or WebGL2 backend.
function frameOnlyBackend(): RenderBackend {
  return {
    kind: 'cpu',
    draw: () => {},
    readPixels: () => new Uint8ClampedArray(0),
    resize: () => {},
    dispose: () => {},
  }
}

async function fetchOptional(url: URL): Promise<Response | null> {
  const response = await fetch(url)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Spine asset ${url.pathname}: HTTP ${response.status}`)
  return response
}

async function pagePixels(url: URL): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  const response = await fetchOptional(url)
  if (response === null) return null
  const bitmap = await createImageBitmap(await response.blob())
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) throw new Error('Spine atlas image: 2D canvas unavailable')
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data
    return { width: bitmap.width, height: bitmap.height, data: new Uint8Array(pixels) }
  } finally {
    bitmap.close()
  }
}

/** Load unbundled samples; missing JSON, atlas, or image returns null. */
export async function loadSpineScene(
  sample: SpineSample,
  baseUrl = '/samples/',
): Promise<SpineScene | null> {
  const files = SPINE_SAMPLES[sample]
  if (files === undefined) throw new Error(`Unknown Spine sample: ${sample}`)
  const directory = new URL(`${sample}/`, new URL(baseUrl, document.baseURI))
  const [jsonResponse, atlasResponse] = await Promise.all([
    fetchOptional(new URL(files.json, directory)),
    fetchOptional(new URL(files.atlas, directory)),
  ])
  if (jsonResponse === null || atlasResponse === null) return null
  const [json, atlasText] = await Promise.all([jsonResponse.json(), atlasResponse.text()])
  const parsed = importSpineAtlas(atlasText)
  const pages = await Promise.all(parsed.pages.map(async (page) => {
    if (!page.name || page.name.includes('/') || page.name.includes('\\') || page.name === '..') {
      throw new Error(`Invalid Spine atlas page name: ${page.name ?? '(missing)'}`)
    }
    const image = await pagePixels(new URL(page.name, directory))
    return image === null ? null : { ...page, image }
  }))
  if (pages.some((page) => page === null)) return null
  const atlas = { ...parsed, pages: pages as NonNullable<typeof pages[number]>[] }
  const asset = importSpine(json, { atlas, unitScale: 0.01, sourceYDown: false })
  if (asset.report.errors > 0) {
    throw new Error(`Spine ${sample}: ${asset.report.errors} import errors: ${asset.report.issues
      .filter((issue) => issue.severity === 'error').slice(0, 3).map((issue) => issue.code).join(', ')}`)
  }
  const animations = [...asset.animations.keys()]
  const meta = (json as { skeleton?: { x?: number; y?: number; width?: number; height?: number } }).skeleton ?? {}
  const bounds = [meta.x, meta.y, meta.width, meta.height]
  const hasBounds = bounds.every((value) => typeof value === 'number' && Number.isFinite(value))
    && (meta.width ?? 0) > 0 && (meta.height ?? 0) > 0
  const engine = new Engine({ backend: 'cpu' }, { backendFactory: frameOnlyBackend })
  engine.load(asset)
  let selected: string | null = null
  const boneOffsets = new Map<string, number>()
  let disposed = false
  function assertLive(): void {
    if (disposed) throw new Error('Spine scene disposed')
  }
  const scene: SpineScene = {
    sample,
    animations,
    get animation() { return selected },
    boneNames: engine.skeleton.bones.map((bone) => bone.name),
    setBoneRotation(name, degrees) {
      assertLive()
      if (!Number.isFinite(degrees) || !engine.skeleton.findBone(name)) throw new Error(`Invalid bone rotation: ${name}`)
      boneOffsets.set(name, degrees)
    },
    resetBoneRotations() {
      for (const name of boneOffsets.keys()) {
        const bone = engine.skeleton.findBone(name)!
        bone.rotation = bone.data.setup.rotation
      }
      boneOffsets.clear()
      engine.skeleton.updateWorldTransform()
    },
    setAnimation(name) {
      assertLive()
      if (name !== null && !asset.animations.has(name)) throw new Error(`Unknown Spine animation: ${name}`)
      engine.load(asset)
      selected = name
      if (name !== null) engine.play(name)
    },
    reset() {
      scene.setAnimation(selected)
    },
    frame(width, height, dt = 0) {
      assertLive()
      if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
        throw new Error('Spine frame needs positive integer dimensions')
      }
      if (!Number.isFinite(dt) || dt < 0) throw new Error('Spine frame needs nonnegative dt')
      const aspect = width / height
      const figureHeight = hasBounds ? meta.height! * 0.01 : 4
      const figureWidth = hasBounds ? meta.width! * 0.01 : 3
      const orthoHeight = Math.max(figureHeight, figureWidth / aspect) * 1.2
      engine.setCamera({ ...DEFAULT_CAMERA,
        target: hasBounds
          ? [(meta.x! + meta.width! / 2) * 0.01, (meta.y! + meta.height! / 2) * 0.01, 0]
          : [0, 0, 0],
        orthoHeight,
        viewport: { width, height, dpr: 1 },
      })
      if (dt > 0 && selected !== null) engine.update(Math.min(dt, 0.1))
      if (boneOffsets.size > 0) {
        for (const [name, degrees] of boneOffsets) {
          const bone = engine.skeleton.findBone(name)!
          bone.rotation = bone.data.setup.rotation + degrees * Math.PI / 180
        }
        engine.skeleton.updateWorldTransform()
      }
      return { ...engine.render(), width, height }
    },
    dispose() {
      if (disposed) return
      disposed = true
      engine.dispose()
    },
  }
  return scene
}
