import { describe, expect, it } from '@jest/globals'
import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(__dirname, '../../../..')
const doc = readFileSync(resolve(root, 'docs/22-Spine渲染对标.md'), 'utf8')
const section = doc.split('## 2. 当前差距（量化）')[1]?.split('## 3. 对标能力矩阵')[0]

const obsoleteClaims: ReadonlyArray<readonly [string, RegExp]> = [
  ['WebGL2 blend state absent', /WebGL2\s*没有混合状态|(?:backend\.ts|WebGL2)[^\n]{0,50}(?:没有|未)(?:[^\n]{0,20})?(?:enable\(BLEND\)|blendFunc)/i],
  ['region is a unit square', /region\s*(?:画成|仍(?:然)?(?:画成|是))\s*1\s*[×x]\s*1\s*单位方块|`runtime\.ts`[^\n]{0,30}固定用\s*`\[-0\.5,\s*0\.5\]`/i],
  ['pixel gate still skipped', /(?:diff|像素[^\n]{0,12}(?:测试|门禁))[^\n]{0,35}(?:仍为|保持|显式|仍然)?\s*skipped/i],
  ['obsolete setup diagnostic', /当前\s*setup\s*诊断(?:值约|残差量级)/i],
  ['unconditional texture binding cap', /(?:纹理绑定|页绑定|bindTexture)[^\n]{0,20}≤\s*4(?:\s*次)?|≤\s*4(?:\s*次)?[^\n]{0,20}(?:纹理绑定|页绑定)/i],
  ['default influence cap', /(?:maxInfluences|每个顶点|每顶点|影响)[^\n]{0,35}(?:默认[^\n]{0,8}≤\s*4|最多\s*4\s*影响|≤\s*4\s*影响)|maxInfluences:\s*number\s*\/\/\s*≤\s*4/i],
  ['binary already complete', /(?:Spine\s*)?binary\s*(?:4\.2)?[^\n]{0,12}(?:完整读入|已经完整|已完整|完整支持)|二进制\s*4\.2[^\n]{0,12}(?:完整读入|已经完整|已完整)/i],
  ['3.8 fixture already present', /3\.8\s*fixture\s*存在/i],
]

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? markdownFiles(path) : entry.isFile() && entry.name.endsWith('.md') ? [path] : []
  })
}

function violations(path: string, text: string): string[] {
  let inCodeBlock = false
  return text.split('\n').flatMap((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inCodeBlock = !inCodeBlock
      return []
    }
    if (inCodeBlock || /^\s*#{1,6}\s/.test(line)) return []
    // Historical explanations and conditional corrections must not become new violations.
    if (/(?:旧文档中|立项时|历史基线|原始缺口|去掉[“"']|不再把旧的|若文档坚持[^\n]*需证明|≤\s*4\s*→\s*0=不限制)/.test(line)) return []
    return obsoleteClaims.filter(([description, pattern]) => {
      if (!pattern.test(line)) return false
      // A proposed cap or supported-format target is not evidence that the runtime has it now.
      if (description === 'default influence cap' && /maxInfluences[^\n]{0,18}默认[^\n]{0,8}`?0`?（不限制）/.test(line)) return false
      if (description === 'unconditional texture binding cap'
        && /≤\s*4[^\n]{0,15}(?:是目标|仅为目标)[^\n]{0,35}实际次数取决于/.test(line)) return false
      if (/(?:texture binding cap|influence cap|binary already complete)/.test(description)) {
        return /(?:现状|当前|目前|已经|已实现|默认|绑定\s*[=是])/.test(line)
      }
      return true
    }).map(([description]) => `${path}:${index + 1}: ${description}: ${line.trim()}`)
  })
}

function declaredFields(relativePath: string, typeName: string): string[] {
  const source = readFileSync(resolve(root, relativePath), 'utf8')
  const start = source.indexOf(`export type ${typeName} = `)
  if (start < 0) throw new Error(`Missing source type ${typeName}`)
  const opening = source.indexOf('{', start)
  const closing = source.indexOf('\n}', opening)
  if (opening < 0 || closing < 0) throw new Error(`Missing type literal for ${typeName}`)
  return [...source.slice(opening + 1, closing).matchAll(/^\s*(?:readonly\s+)?([a-zA-Z][\w]*)\??:/gm)]
    .map(match => match[1]!).filter(name => name !== 'kind')
}

function snapshotFields(typeName: string): string[] {
  const row = section?.split('\n').find(line => line.startsWith(`| \`${typeName}\` |`))
  if (!row) throw new Error(`Missing documentation snapshot for ${typeName}`)
  return [...row.matchAll(/`([^`]+)`/g)].map(match => match[1]!).slice(1)
}

describe('N13 docs/code consistency', () => {
  it('keeps public field snapshots synchronized with TypeScript declarations', () => {
    expect(snapshotFields('FrameStats')).toEqual(declaredFields('packages/render-engine/src/debug/overlay.ts', 'FrameStats'))
    expect(snapshotFields('PhysicsConstraint')).toEqual(declaredFields('packages/render-engine/src/constraint/constraint.ts', 'PhysicsConstraint'))
  })

  it('rejects stale source and pixel-gate claims in the current-gap section', () => {
    expect(section).toBeDefined()
    expect(section).toContain('官方 `spine-core@4.3.13` RenderCommand 经同一 CPU 光栅器六帧实测')
    expect(section).toContain('mean=0.000004–0.000030 LSB')
    expect(section).toContain('max=1 LSB')
    expect(section).toContain('p95=7.27ms')
    expect(section).toContain('本机无 WebGL2 上下文跳过，不是通过')
    expect(section).toContain('10,488 个采样分量的最大差为 0.00266648 世界单位')
  })

  it('detects every forbidden claim while allowing explicit corrections', () => {
    const examples = [
      'WebGL2 没有混合状态', 'region 画成 1×1 单位方块', 'diff 仍为 skipped',
      '当前 setup 诊断值约', '当前纹理绑定 ≤4', '默认 maxInfluences ≤4 影响',
      '目前 Spine binary 4.2 完整读入', '3.8 fixture 存在',
    ]
    expect(obsoleteClaims).toHaveLength(examples.length)
    for (const [index, [description]] of obsoleteClaims.entries()) {
      expect(violations('fixture.md', examples[index]!)).toEqual([`fixture.md:1: ${description}: ${examples[index]}`])
    }
    expect(violations('fixture.md', '旧文档中“纹理绑定 ≤4”不能作为代码事实')).toEqual([])
    expect(violations('fixture.md', '- `import-compat.md` 去掉"binary 完整/3.8 fixture 存在"的表述')).toEqual([])
    expect(violations('fixture.md', '### 硬伤 H1：WebGL2 没有混合状态')).toEqual([])
    expect(violations('fixture.md', '| 纹理绑定 | 单角色 ≤4（页数） |')).toEqual([])
    expect(violations('fixture.md', '| Spine binary 4.2 | 完整读入 | 目标格式 |')).toEqual([])
    expect(violations('fixture.md', '```ts\nreadonly maxInfluences: number // ≤4\n```')).toEqual([])
    expect(violations('fixture.md', '当前 setup 诊断残差量级：约 15–34/255')).toHaveLength(1)
  })

  it('scans all Markdown documentation for obsolete current claims', () => {
    const files = markdownFiles(resolve(root, 'docs'))
    expect(files).toContain(resolve(root, 'docs/22-Spine渲染对标.md'))
    expect(files).toContain(resolve(root, 'docs/22-Spine渲染对标/acceptance.md'))
    expect(files).toContain(resolve(root, 'docs/08-渲染管线.md'))
    expect(files).toContain(resolve(root, 'docs/09-后端与性能.md'))
    const found = files.flatMap(file => violations(relative(root, file), readFileSync(file, 'utf8')))
    expect(found).toEqual([])
  })
})
