// Front-facing weighted character rendered entirely by render-engine.
import { skinMesh2D } from '/engine/mesh/mesh.js';
import { buildMeshPacket, batchPackets } from '/engine/render/render.js';
import { clipTriangles } from '/engine/render/clipping.js';
import { WebGL2Backend } from '/engine/backend/backend.js';
import { EditablePose } from '/chongyue-pose.js';
import { packImageParts, mapPartUVs } from '/chongyue-images.js';

const ROOT = '/assets/chongyue/front/';
async function fetchChecked(url, kind) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return kind === 'json' ? response.json() : response.arrayBuffer();
}

async function loadImageParts(textures, root) {
  const images = new Array(textures.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(8, textures.length) }, async () => {
    const source = document.createElement('canvas');
    const context = source.getContext('2d', { willReadFrequently: true });
    while (cursor < textures.length) {
      const index = cursor++, spec = textures[index];
      const response = await fetch(root + spec.url);
      if (!response.ok) throw new Error(`人物素材载入失败: ${spec.name} HTTP ${response.status}`);
      const image = await createImageBitmap(await response.blob(), {
        premultiplyAlpha: 'none', colorSpaceConversion: 'none',
      });
      if (image.width !== spec.width || image.height !== spec.height) {
        image.close(); throw new Error(`人物素材尺寸错误: ${spec.name}`);
      }
      source.width = image.width; source.height = image.height;
      context.drawImage(image, 0, 0); image.close();
      images[index] = { width: source.width, height: source.height,
        data: new Uint8Array(context.getImageData(0, 0, source.width, source.height).data) };
    }
  }));
  // The overlay samples the center of an opaque white patch. Its guard pixels
  // prevent linear filtering and mipmaps from borrowing adjacent artwork.
  images.push({ width: 8, height: 8, data: new Uint8Array(8 * 8 * 4).fill(255) });
  return packImageParts(images);
}

export async function loadCharacter(root = ROOT) {
  const data = await fetchChecked(`${root}character-native.json`, 'json');
  const spec = data.pose;
  if (data.format !== 'render-engine-native-static' || data.version !== 2 || !spec) throw new Error('人物静态姿态格式错误');
  const [skeleton, buffer, assets] = await Promise.all([
    fetchChecked(root + data.skeletonUrl, 'json'),
    fetchChecked(root + spec.url, 'binary'), loadImageParts(data.textures, root),
  ]);
  if (buffer.byteLength !== spec.floatCount * 4) throw new Error('人物静态姿态长度错误');
  if (skeleton.format !== 'render-engine-skeleton2d') throw new Error('人物骨骼格式错误');
  const rect = assets.layouts[data.textures.length], page = assets.pages[rect.page];
  return { data: { ...data, bones: skeleton.bones, slots: skeleton.slots,
    attachments: data.attachments.map(attachment => mapPartUVs(attachment, assets)) },
    assets, poseValues: new Float32Array(buffer),
    boneTexture: { page: rect.page, uv: [(rect.x + rect.width / 2) / page.width, (rect.y + rect.height / 2) / page.height] } };
}

export class CharacterRenderer {
  constructor(canvas, character) {
    this.canvas = canvas;
    this.character = character;
    this.showSkeleton = false;
    this.gl = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: true,
      stencil: true, preserveDrawingBuffer: true,
    });
    if (!this.gl) throw new Error('浏览器未能创建 WebGL2 上下文');
    this.backend = new WebGL2Backend(this.gl);
    this.backend.prepare(character.assets);
    const spec = character.data.pose, values = character.poseValues;
    this.pose = new EditablePose(character.data.bones,
      values.subarray(spec.matrixOffset, spec.matrixOffset + spec.matrixFloatCount));
    this.slots = character.data.slots.map((slot, index) => {
      const offset = spec.slotOffset + index * spec.slotStride;
      return { slot: slot.id, attachmentId: Math.round(values[offset]), order: values[offset + 1],
        color: Array.from(values.subarray(offset + 2, offset + 6)) };
    }).sort((a, b) => a.order - b.order);
    this.inverseBind = new Float32Array(0);
    this.meshes = character.data.attachments.map(attachment => {
      const mesh = { ...attachment,
        positions: Float32Array.from(attachment.positions),
        uvs: Float32Array.from(attachment.uvs), indices: Uint16Array.from(attachment.indices) };
      if (attachment.weights) {
        mesh.weights = Float32Array.from(attachment.weights);
        mesh.boneIndices = Uint16Array.from(attachment.boneIndices);
        mesh.influencePositions = Float32Array.from(attachment.influencePositions);
        mesh.influenceSourceIndices = Int32Array.from(attachment.influenceSourceIndices);
      }
      return { mesh, world: new Float32Array(mesh.positions.length) };
    });
    this.deforms = new Map((spec.deforms ?? []).map(deform =>
      [deform.attachmentId, values.subarray(deform.offset, deform.offset + deform.length)]));
    this.visibleBones = character.data.bones.filter(bone => bone.name.startsWith('CY_'));
    this.stats = {};
    this.updateMeshes(); // Fit has valid skinned geometry before the first draw.
  }

  updateMeshes() {
    for (let id = 0; id < this.meshes.length; id++) {
      const { mesh, world } = this.meshes[id];
      skinMesh2D(mesh, this.pose, this.inverseBind, world, this.deforms.get(id));
    }
  }

  bounds() {
    this.updateMeshes();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const slot of this.slots) {
      const entry = this.meshes[slot.attachmentId];
      if (!entry || entry.mesh.kind === 'clipping' || slot.color[3] <= 0) continue;
      for (let i = 0; i < entry.world.length; i += 2) {
        minX = Math.min(minX, entry.world[i]); maxX = Math.max(maxX, entry.world[i]);
        minY = Math.min(minY, entry.world[i + 1]); maxY = Math.max(maxY, entry.world[i + 1]);
      }
    }
    if (!Number.isFinite(minX)) return this.character.data.pose.bounds;
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2,
      width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  bonePackets(scale, order) {
    const packets = [], texture = this.character.boneTexture;
    const add = (positions, indices) => {
      const uvs = new Float32Array(positions.length);
      for (let i = 0; i < uvs.length; i += 2) uvs.set(texture.uv, i);
      packets.push(buildMeshPacket({ id: this.meshes.length + packets.length,
        positions: Float32Array.from(positions), indices: Uint16Array.from(indices), uvs,
        color: [1, .34, .12, 1], pma: true, materialId: texture.page, page: texture.page,
        blend: 'normal', maskPath: -1, order: order + packets.length, depthKey: 0, seq: order + packets.length }));
    };
    for (const bone of this.visibleBones) {
      const i = bone.id * 6, w = this.pose.world, x = w[i + 4], y = w[i + 5];
      const dx = w[i] * (bone.length ?? 0), dy = w[i + 1] * (bone.length ?? 0);
      const length = Math.hypot(dx, dy);
      if (length > .01) {
        const radius = Math.min(length * .12, 3 / scale);
        const nx = -dy / length * radius, ny = dx / length * radius;
        add([x, y, x + dx * .2 + nx, y + dy * .2 + ny,
          x + dx, y + dy, x + dx * .2 - nx, y + dy * .2 - ny], [0, 1, 2, 0, 2, 3]);
      }
      const radius = 3 / scale, circle = [x, y], indices = [];
      for (let j = 0; j < 10; j++) {
        const angle = j * Math.PI / 5;
        circle.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
        indices.push(0, j + 1, (j + 1) % 10 + 1);
      }
      add(circle, indices);
    }
    return packets;
  }

  packets(scale) {
    this.updateMeshes();
    const packets = [];
    let clip = null, vertices = 0;
    for (const slot of this.slots) {
      const entry = this.meshes[slot.attachmentId];
      if (entry) {
        const { mesh, world } = entry;
        if (mesh.kind === 'clipping') {
          if (!clip) clip = { positions: world, end: mesh.clippingEnd };
        } else if (slot.color[3] > 0) {
          const geometry = clip ? clipTriangles(world, mesh.uvs, mesh.indices, [clip.positions])
            : { positions: world, uvs: mesh.uvs, indices: mesh.indices };
          if (geometry.indices.length) {
            packets.push(buildMeshPacket({ id: slot.attachmentId, ...geometry,
              color: slot.color, pma: true, materialId: mesh.materialId, page: mesh.page,
              blend: 'normal', maskPath: -1, order: slot.order, depthKey: 0, seq: packets.length }));
            vertices += world.length / 2;
          }
        }
      }
      if (clip?.end === slot.slot) clip = null;
    }
    const skinMeshes = packets.length;
    if (this.showSkeleton) packets.push(...this.bonePackets(scale,
      Math.max(0, ...this.slots.map(slot => slot.order)) + 1));
    this.stats = { bones: this.visibleBones.length, skinMeshes, imageTextures: this.character.data.textures.length,
      sourcePackets: packets.length, vertices, skeletonOverlay: this.showSkeleton };
    return batchPackets(packets);
  }

  draw(width, height, camera) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
    }
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    const scale = camera.scale;
    const frame = { width, height, packets: this.packets(scale),
      assets: this.character.assets, depthMode: 'none',
      viewProjection: new Float32Array([scale, 0, 0, 0, -scale, 0,
        width / 2 - camera.x * scale, height / 2 + camera.y * scale, 1]) };
    this.backend.draw(frame);
    this.frame = frame;
    return { ...this.stats, ...this.backend.stats };
  }

  dispose() { this.backend.dispose(); }
}

export function fitCamera(bounds, width, height) {
  return { x: bounds.x, y: bounds.y,
    scale: Math.min(width / bounds.width, height / bounds.height) / 1.08 };
}
