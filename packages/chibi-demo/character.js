import { importSpine } from '/engine/asset/importer.js';

async function checked(url, kind = 'json') {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}，请先运行素材下载和拆分脚本`);
  return response[kind]();
}

// Files remain separate on disk; only GPU upload uses a temporary combined
// texture, keeping all skins within the engine's four-page texture limit.
export async function loadCharacter() {
  const root = '/assets/';
  const parts = await checked(root + 'parts.json');
  if (parts.version !== 1 || !parts.regions.length) throw new Error('不支持的部件索引');
  const [source, images] = await Promise.all([
    checked(root + parts.skeleton),
    Promise.all(parts.regions.map(async part => {
      const blob = await checked(root + part.file, 'blob');
      return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    })),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = parts.width;
  canvas.height = parts.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const regions = new Map();
  try {
    parts.regions.forEach((part, index) => {
      const image = images[index];
      const { x, y, width, height } = part;
      if (image.width !== width || image.height !== height) throw new Error(`部件尺寸不符：${part.file}`);
      // Extend edge pixels into the padding to avoid seams with linear filtering.
      const p = parts.padding;
      const columns = [[0, 1, x - p, p], [0, width, x, width], [width - 1, 1, x + width, p]];
      const rows = [[0, 1, y - p, p], [0, height, y, height], [height - 1, 1, y + height, p]];
      for (const [sx, sw, dx, dw] of columns) {
        for (const [sy, sh, dy, dh] of rows) context.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
      }
      regions.set(part.name, { id: part.name, page: 0, x, y, width, height,
        uvMatrix: new Float32Array([width / canvas.width, 0, 0, height / canvas.height,
          x / canvas.width, y / canvas.height]),
        trim: { offsetX: 0, offsetY: 0, sourceWidth: width, sourceHeight: height }, maxMip: 0 });
    });
  } finally {
    images.forEach(image => image.close());
  }
  const atlas = { format: 'dsh-2d-atlas', version: 1,
    hash: `${parts.sourceCommit}:split:${parts.regions.map(part => part.sha256).join(':')}`,
    regions, pma: false, colorSpace: 'srgb', padding: parts.padding, bleed: parts.padding, source: 'file',
    pages: [{ index: 0, name: 'chibi-parts', minFilter: 'Linear', magFilter: 'Linear',
      width: canvas.width, height: canvas.height, pma: false,
      image: { width: canvas.width, height: canvas.height,
        data: new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data) } }] };
  const asset = importSpine(source, { atlas, unitScale: 1, sourceYDown: false });
  if (asset.report.errors) throw new Error(asset.report.issues.filter(issue => issue.severity === 'error')
    .map(issue => `${issue.path}: ${issue.message}`).join('\n'));
  // Spine resolves missing skin attachments from the default skin. The engine's
  // flat SkinData map expects that fallback to be materialized by the caller.
  const defaults = asset.skins.get('default');
  const skins = new Map([...asset.skins].map(([name, skin]) => [name, { ...skin,
    attachments: new Map([...(defaults?.attachments ?? []), ...skin.attachments]) }]));
  return { asset: { ...asset, skins }, source };
}
