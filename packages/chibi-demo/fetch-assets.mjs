import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Resolve 4.2 once, then keep every asset (including LICENSE) on this commit.
const repository = 'https://github.com/EsotericSoftware/spine-runtimes';
const commit = '5cb78e77d3711ddcd80c7bd043bb11cf70fcc88c';
const exportPath = 'examples/chibi-stickers/export';
const rawBase = `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/${commit}`;
const assets = new URL('./assets/source/', import.meta.url);
const manifestUrl = new URL('manifest.json', assets);
const pngNames = Array.from({ length: 10 }, (_, i) => `chibi-stickers${i ? `_${i + 1}` : ''}.png`);
const names = ['chibi-stickers.atlas', 'chibi-stickers.json', ...pngNames, 'LICENSE'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

await mkdir(assets, { recursive: true });
let previous;
try {
  previous = JSON.parse(await readFile(manifestUrl, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (previous && previous.commit !== commit) throw new Error('Existing manifest belongs to a different commit');

// Fetch and validate everything before replacing any asset files.
const files = [];
const downloads = new Map();
for (const name of names) {
  // The official repository has a root LICENSE (no .txt extension).
  const sourcePath = name === 'LICENSE' ? 'LICENSE' : `${exportPath}/${name}`;
  const url = `${rawBase}/${sourcePath}`;
  const bytes = await download(url);
  const digest = sha256(bytes);
  const recorded = previous?.files.find((file) => file.name === name);
  if (recorded && recorded.sha256 !== digest) throw new Error(`SHA-256 mismatch: ${name}`);
  if (name.endsWith('.png') && !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    throw new Error(`Invalid PNG: ${name}`);
  }
  downloads.set(name, bytes);
  files.push({ name, sourcePath, url, bytes: bytes.length, sha256: digest });
  console.log(`${name}: ${bytes.length} bytes, sha256 ${digest}`);
}
const atlas = downloads.get('chibi-stickers.atlas').toString('utf8');
const pages = atlas.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.endsWith('.png'));
if (pages.length !== 10 || pages.some((page) => !pngNames.includes(page)) || new Set(pages).size !== 10) {
  throw new Error('Atlas must reference exactly the ten straight-alpha PNG pages');
}
if (/^pma:\s*true\s*$/m.test(atlas)) throw new Error('Unexpected premultiplied alpha atlas');
const skeleton = JSON.parse(downloads.get('chibi-stickers.json').toString('utf8'));
if (!skeleton.skeleton.spine.startsWith('4.2.')) throw new Error('Expected a Spine 4.2 skeleton');
const summary = {
  spine: skeleton.skeleton.spine,
  skins: skeleton.skins.map((skin) => skin.name),
  animations: Object.keys(skeleton.animations),
  bones: skeleton.bones.length,
  slots: skeleton.slots.length,
  constraints: Object.fromEntries(['ik', 'transform', 'path', 'physics'].map((kind) => [kind, (skeleton[kind] ?? []).length])),
};
for (const [name, bytes] of downloads) await writeFile(new URL(name, assets), bytes);
await writeFile(manifestUrl, `${JSON.stringify({
  repository,
  branch: '4.2',
  commit,
  exportPath,
  alpha: 'straight',
  hashAlgorithm: 'sha256',
  summary,
  files,
}, null, 2)}\n`);
console.log(`Saved ${files.length} source files to ${fileURLToPath(assets)}`);
console.log(JSON.stringify(summary, null, 2));
