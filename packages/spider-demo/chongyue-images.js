// Assemble decoded independent PNGs into <=4 transient GPU pages for render-engine.
// Input images and persisted mesh UVs remain independent, upright components.
export function packImageParts(images, size = 2048) {
  const layouts = new Array(images.length), extents = [];
  let page = -1, x = 0, y = 0, rowHeight = 0;
  const newPage = () => {
    if (++page >= 4) throw new Error('人物素材超过四个纹理页');
    extents.push({ width: 0, height: 0 }); x = y = rowHeight = 0;
  };
  for (const { image, index } of images.map((image, index) => ({ image, index }))
    .sort((a, b) => b.image.height - a.image.height || b.image.width - a.image.width || a.index - b.index)) {
    if (image.width > size || image.height > size) throw new Error('人物素材尺寸超过纹理页');
    if (page < 0) newPage();
    if (x + image.width > size) { x = 0; y += rowHeight; rowHeight = 0; }
    if (y + image.height > size) newPage();
    layouts[index] = { page, x, y, width: image.width, height: image.height };
    extents[page].width = Math.max(extents[page].width, x + image.width);
    extents[page].height = Math.max(extents[page].height, y + image.height);
    x += image.width; rowHeight = Math.max(rowHeight, image.height);
  }
  const pages = extents.map(({ width, height }) => ({ width, height,
    data: new Uint8Array(width * height * 4), pma: false, filter: 'linear', mipmap: true }));
  for (let index = 0; index < images.length; index++) {
    const image = images[index], rect = layouts[index], target = pages[rect.page];
    for (let row = 0; row < image.height; row++) {
      target.data.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4),
        ((row + rect.y) * target.width + rect.x) * 4);
    }
  }
  return { layouts, pages, materials: pages.map((_, id) => ({ id, kind: 'sprite', page: id, filter: 'linear', pma: true })) };
}

export function mapPartUVs(attachment, packed) {
  if (attachment.kind === 'clipping') return attachment;
  const rect = packed.layouts[attachment.textureId];
  if (!rect) throw new Error(`人物素材引用错误: ${attachment.name}`);
  const page = packed.pages[rect.page];
  return { ...attachment, page: rect.page, materialId: rect.page,
    uvs: attachment.uvs.map((value, i) => i % 2 ? (rect.y + value * rect.height) / page.height
      : (rect.x + value * rect.width) / page.width) };
}
