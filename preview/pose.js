"use strict";
(() => {
  // ../packages/render-engine/src/core/math.ts
  var CH_X = 0;
  var CH_Y = 1;
  var CH_ROT = 2;
  var CH_SX = 3;
  var CH_SY = 4;
  var CH_SHX = 5;
  var CH_SHY = 6;
  var POSE_STRIDE = 7;
  var WORLD_STRIDE = 6;
  var TAU = Math.PI * 2;
  var EPS = 1e-12;
  function createAffine() {
    const out = new Float64Array(WORLD_STRIDE);
    out[0] = 1;
    out[3] = 1;
    return out;
  }
  function multiplyAffine(a, b, out = createAffine()) {
    const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5];
    const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5];
    out[0] = a0 * b0 + a2 * b1;
    out[1] = a1 * b0 + a3 * b1;
    out[2] = a0 * b2 + a2 * b3;
    out[3] = a1 * b2 + a3 * b3;
    out[4] = a0 * b4 + a2 * b5 + a4;
    out[5] = a1 * b4 + a3 * b5 + a5;
    return out;
  }
  function detAffine(m) {
    return m[0] * m[3] - m[1] * m[2];
  }
  function invertAffine(m, out = createAffine()) {
    for (let i = 0; i < WORLD_STRIDE; i += 1) {
      if (!Number.isFinite(m[i])) return null;
    }
    const det = detAffine(m);
    if (!Number.isFinite(det) || Math.abs(det) < EPS) return null;
    const inv = 1 / det;
    const a = m[0], b = m[1], c = m[2], d = m[3], tx = m[4], ty = m[5];
    out[0] = d * inv;
    out[1] = -b * inv;
    out[2] = -c * inv;
    out[3] = a * inv;
    out[4] = (c * ty - d * tx) * inv;
    out[5] = (b * tx - a * ty) * inv;
    return out;
  }
  function parentBasis(mode, p, out = createAffine()) {
    const tx = p[4];
    const ty = p[5];
    if (mode === "normal") {
      for (let i = 0; i < WORLD_STRIDE; i += 1) out[i] = p[i];
      return out;
    }
    if (mode === "onlyTranslation") {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
    } else if (mode === "noRotationOrReflection") {
      const pa = p[0];
      const pc = p[1];
      const pb = p[2];
      const pd = p[3];
      const len2 = pa * pa + pc * pc;
      if (len2 > EPS * EPS) {
        const s = Math.abs(pa * pd - pb * pc) / len2;
        out[0] = pa;
        out[1] = pc;
        out[2] = -pc * s;
        out[3] = pa * s;
      } else {
        out[0] = 1;
        out[1] = 0;
        out[2] = 0;
        out[3] = 1;
      }
    } else if (mode === "noScale" || mode === "noScaleOrReflection") {
      const lx = Math.hypot(p[0], p[1]);
      const ly = Math.hypot(p[2], p[3]);
      const nx = lx <= EPS ? 1 : p[0] / lx;
      const ny = lx <= EPS ? 0 : p[1] / lx;
      let mx = ly <= EPS ? 0 : p[2] / ly;
      let my = ly <= EPS ? 1 : p[3] / ly;
      if (mode === "noScaleOrReflection" && nx * my - ny * mx < 0) {
        mx = -mx;
        my = -my;
      }
      out[0] = nx;
      out[1] = ny;
      out[2] = mx;
      out[3] = my;
    } else {
      throw new Error(`inherit.mode: ${String(mode)}`);
    }
    out[4] = tx;
    out[5] = ty;
    return out;
  }
  function normalizeAngle(rad) {
    if (!Number.isFinite(rad)) return rad;
    const r = ((rad + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return r === -Math.PI ? -Math.PI : r;
  }
  function angleDelta(from, to) {
    return normalizeAngle(to - from);
  }
  function decomposeAffine(m) {
    const sx = Math.hypot(m[0], m[1]);
    const rotation = Math.atan2(m[1], m[0]);
    if (sx <= EPS) {
      throw new Error("affine.decompose: singular");
    }
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    const sy = -s * m[2] + c * m[3];
    if (Math.abs(sy) <= EPS) {
      throw new Error("affine.decompose: singular");
    }
    return {
      x: m[4],
      y: m[5],
      rotation,
      scaleX: sx,
      scaleY: sy,
      shearX: (c * m[2] + s * m[3]) / sy,
      shearY: 0
    };
  }

  // ../packages/render-engine/src/core/skeleton.ts
  var PROFILE_BONE_LIMITS = {
    simple2d: 19,
    // 官方 Spine 样例可到 76 骨；导入资产需要高于人形模板的 64 骨预算。
    full2d: 128,
    volume3d: 128
  };
  var DEFAULT_TRANSFORM = {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0
  };
  var INHERITS = [
    "normal",
    "onlyTranslation",
    "noRotationOrReflection",
    "noScale",
    "noScaleOrReflection"
  ];
  function transformOf(partial, from) {
    const base = { ...DEFAULT_TRANSFORM, ...from ?? {} };
    const out = { ...base, ...partial ?? {} };
    for (const key of ["x", "y", "rotation", "scaleX", "scaleY", "shearX", "shearY"]) {
      if (!Number.isFinite(out[key])) throw new Error(`skeleton.transform: ${key}`);
    }
    out.rotation = normalizeAngle(out.rotation);
    return out;
  }
  function writeTransform(out, id, t) {
    const i = id * POSE_STRIDE;
    out[i] = t.x;
    out[i + 1] = t.y;
    out[i + 2] = t.rotation;
    out[i + 3] = t.scaleX;
    out[i + 4] = t.scaleY;
    out[i + 5] = t.shearX;
    out[i + 6] = t.shearY;
  }
  function compileSkeleton(spec) {
    if (!spec || typeof spec.name !== "string" || spec.name.length === 0) throw new Error("skeleton.name");
    const profile = spec.profile;
    const limit = PROFILE_BONE_LIMITS[profile];
    if (limit === void 0) throw new Error("skeleton.profile");
    const input = spec.bones;
    if (!Array.isArray(input) || input.length === 0 || input.length > limit) {
      throw new Error("skeleton.boneCount");
    }
    const names = /* @__PURE__ */ new Set();
    for (const b of input) {
      if (!b || typeof b.name !== "string" || b.name.length === 0) throw new Error("skeleton.boneName");
      if (names.has(b.name)) throw new Error("duplicate bone name");
      names.add(b.name);
      if (!Number.isInteger(b.parent) || b.parent < -1 || b.parent >= input.length) throw new Error("skeleton.parent");
      if ("swing" in b || "twist" in b || "quaternion" in b) {
        throw new Error("skeleton.3d-fields: 2D bones cannot carry swing/twist/quaternion");
      }
      if (b.inherit !== void 0 && !INHERITS.includes(b.inherit)) throw new Error("skeleton.inherit");
      if (b.volume && profile !== "volume3d") throw new Error("skeleton.volume: only volume3d");
      const tags = b.tags ?? [];
      if (profile === "simple2d" && (tags.includes("finger") || b.joint?.dof === 2)) {
        throw new Error("skeleton.profile: simple2d forbids fingers and 2-DOF yokes");
      }
      if (b.joint) {
        const j = b.joint;
        if (j.dof === 1 && j.yoke !== null) throw new Error("skeleton.joint: dof=1 requires null yoke");
        if (j.dof === 2 && j.yoke === null) throw new Error("skeleton.joint: dof=2 requires yoke");
        if (!Number.isFinite(j.min) || !Number.isFinite(j.max) || j.min > j.max) throw new Error("skeleton.joint.range");
        if (j.rest < j.min || j.rest > j.max) throw new Error("skeleton.joint.rest");
        if (j.bendSign !== 1 && j.bendSign !== -1) throw new Error("skeleton.joint.bendSign");
      }
      if (!Number.isFinite(b.length ?? 0) || (b.length ?? 0) < 0) throw new Error("skeleton.length");
    }
    const indegree = input.map((b) => b.parent === -1 ? 0 : 1);
    const childrenOfInput = input.map(() => []);
    for (let i = 0; i < input.length; i += 1) {
      if (input[i].parent >= 0) childrenOfInput[input[i].parent].push(i);
    }
    const queue = [];
    for (let i = 0; i < input.length; i += 1) if (indegree[i] === 0) queue.push(i);
    const order = [];
    const remap = new Int32Array(input.length).fill(-1);
    while (queue.length > 0) {
      const cur = queue.shift();
      remap[cur] = order.length;
      order.push(cur);
      for (const child of childrenOfInput[cur]) {
        indegree[child] -= 1;
        if (indegree[child] === 0) queue.push(child);
      }
    }
    if (order.length !== input.length) throw new Error("skeleton.cycle");
    const count = input.length;
    const bones = new Array(count);
    const parent = new Int16Array(count);
    const inherit = new Array(count);
    const children = Array.from({ length: count }, () => []);
    const boneIdByName = /* @__PURE__ */ new Map();
    const setupLocal = new Float32Array(count * POSE_STRIDE);
    const restLocal = new Float32Array(count * POSE_STRIDE);
    for (let id = 0; id < count; id += 1) {
      const src = input[order[id]];
      const rest = transformOf(src.rest);
      const setup = transformOf(src.setup, rest);
      const joint = src.joint ? { ...src.joint, yoke: src.joint.yoke === null ? null : remap[src.joint.yoke] } : null;
      const p = src.parent === -1 ? -1 : remap[src.parent];
      if (p >= id) throw new Error("skeleton.topology");
      const bone = {
        id,
        name: src.name,
        parent: p,
        length: src.length ?? 0,
        rest,
        setup,
        inherit: src.inherit ?? "normal",
        joint,
        volume: src.volume ?? null,
        tags: src.tags ?? []
      };
      bones[id] = bone;
      parent[id] = p;
      inherit[id] = bone.inherit;
      boneIdByName.set(bone.name, id);
      writeTransform(restLocal, id, rest);
      writeTransform(setupLocal, id, setup);
      if (p >= 0) children[p].push(id);
    }
    return {
      name: spec.name,
      profile,
      rootMotion: spec.rootMotion ?? "entity",
      count,
      bones,
      order: Array.from({ length: count }, (_, i) => i),
      roots: children.flatMap((_, i) => parent[i] === -1 ? [i] : []),
      parent,
      inherit,
      children,
      boneIdByName,
      setupLocal,
      restLocal
    };
  }

  // ../packages/render-engine/src/core/pose.ts
  function createPose(skeleton) {
    const pose = {
      skeleton,
      local: skeleton.setupLocal.slice(),
      world: new Float64Array(skeleton.count * WORLD_STRIDE),
      worldOverrides: new Float64Array(skeleton.count * WORLD_STRIDE),
      overrideActive: new Uint8Array(skeleton.count),
      dirty: new Uint8Array(skeleton.count),
      dirtyCount: 0,
      worldValid: false,
      scratch: new Float32Array(WORLD_STRIDE * 2),
      version: 0,
      skeletonX: 0,
      skeletonY: 0,
      skeletonScaleX: 1,
      skeletonScaleY: 1
    };
    markAllDirty(pose);
    return pose;
  }
  function markAllDirty(pose) {
    pose.overrideActive.fill(0);
    pose.dirty.fill(1);
    pose.dirtyCount = pose.skeleton.count;
    pose.worldValid = false;
  }
  function markDirty(pose, bone) {
    const { skeleton, dirty } = pose;
    if (bone < 0 || bone >= skeleton.count) throw new Error("pose.bone");
    if (dirty[bone] !== 0) return;
    const stack = [bone];
    while (stack.length > 0) {
      const id = stack.pop();
      if (dirty[id] !== 0) continue;
      dirty[id] = 1;
      pose.dirtyCount += 1;
      for (const child of skeleton.children[id]) stack.push(child);
    }
    pose.worldValid = false;
  }
  function setWorldOverride(pose, bone, matrix) {
    if (bone < 0 || bone >= pose.skeleton.count) throw new Error("pose.bone");
    updateWorld(pose);
    const offset = bone * WORLD_STRIDE;
    for (let i = 0; i < WORLD_STRIDE; i += 1) {
      const value = matrix[i];
      if (value === void 0 || !Number.isFinite(value)) throw new Error("pose.worldOverride");
      pose.worldOverrides[offset + i] = value;
    }
    pose.overrideActive[bone] = 1;
    markDirty(pose, bone);
    pose.version += 1;
  }
  function checkChannel(channel) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= POSE_STRIDE) {
      throw new Error("pose.channel");
    }
  }
  function setLocal(pose, bone, channel, value) {
    if (!Number.isFinite(value)) throw new Error("pose.value");
    checkChannel(channel);
    if (bone < 0 || bone >= pose.skeleton.count) throw new Error("pose.bone");
    pose.local[bone * POSE_STRIDE + channel] = value;
    pose.overrideActive[bone] = 0;
    pose.version += 1;
    markDirty(pose, bone);
  }
  function addRotation(pose, bone, delta2) {
    if (!Number.isFinite(delta2)) throw new Error("pose.value");
    if (bone < 0 || bone >= pose.skeleton.count) throw new Error("pose.bone");
    const i = bone * POSE_STRIDE + CH_ROT;
    pose.local[i] = pose.local[i] + delta2;
    pose.overrideActive[bone] = 0;
    pose.version += 1;
    markDirty(pose, bone);
  }
  function getRotation(pose, bone) {
    return pose.local[bone * POSE_STRIDE + CH_ROT];
  }
  var scratchLocal = createAffine();
  var scratchParent = createAffine();
  function composeSpineLocal(local, id, out) {
    const i = id * POSE_STRIDE;
    const rotation = local[i + CH_ROT];
    const rx = rotation + local[i + 5];
    const ry = rotation + local[i + 6];
    const sx = local[i + 3], sy = local[i + 4];
    out[0] = Math.cos(rx) * sx;
    out[1] = Math.sin(rx) * sx;
    out[2] = -Math.sin(ry) * sy;
    out[3] = Math.cos(ry) * sy;
    out[4] = local[i + CH_X];
    out[5] = local[i + CH_Y];
  }
  function inheritLinear(mode, parent, local, rotation, sx, sy) {
    const pa = parent[0], pc = parent[1], pb = parent[2], pd = parent[3];
    if (mode === "onlyTranslation") {
      local[0] = local[0] * sx;
      local[2] = local[2] * sx;
      local[1] = local[1] * sy;
      local[3] = local[3] * sy;
      return;
    }
    let a, b, c, d;
    let angle = 0;
    if (mode === "noRotationOrReflection") {
      const pxa = pa / sx, pya = pc / sy, pxb = pb / sx, pyb = pd / sy;
      const len2 = pxa * pxa + pya * pya;
      if (len2 > 1e-12) {
        const s = Math.abs(pxa * pyb - pxb * pya) / len2;
        a = pxa;
        b = pya;
        c = -pya * s;
        d = pxa * s;
        angle = Math.atan2(pya, pxa);
      } else {
        a = 0;
        b = 0;
        c = -pxb;
        d = pyb;
        angle = Math.PI / 2 - Math.atan2(pyb, pxb);
      }
    } else if (mode === "noScale" || mode === "noScaleOrReflection") {
      const cos2 = Math.cos(rotation), sin2 = Math.sin(rotation);
      let za = (pa * cos2 + pb * sin2) / sx;
      let zc = (pc * cos2 + pd * sin2) / sy;
      const invLength = 1 / Math.hypot(za, zc);
      za *= invLength;
      zc *= invLength;
      const reflection = mode === "noScale" && pa * pd - pb * pc < 0 !== (sx < 0 !== sy < 0) ? -1 : 1;
      a = za;
      b = zc;
      c = -zc * reflection;
      d = za * reflection;
      angle = rotation;
    } else {
      throw new Error(`inherit.mode: ${mode}`);
    }
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const x0 = cos * local[0] + sin * local[1];
    const y0 = -sin * local[0] + cos * local[1];
    const x1 = cos * local[2] + sin * local[3];
    const y1 = -sin * local[2] + cos * local[3];
    local[0] = a * x0 + c * y0;
    local[1] = b * x0 + d * y0;
    local[2] = a * x1 + c * y1;
    local[3] = b * x1 + d * y1;
    local[0] = local[0] * sx;
    local[2] = local[2] * sx;
    local[1] = local[1] * sy;
    local[3] = local[3] * sy;
  }
  function setSkeletonTransform(pose, x, y, scaleX, scaleY) {
    if (![x, y, scaleX, scaleY].every(Number.isFinite) || scaleX === 0 || scaleY === 0) throw new Error("pose.skeletonTransform");
    if (pose.skeletonX === x && pose.skeletonY === y && pose.skeletonScaleX === scaleX && pose.skeletonScaleY === scaleY) return;
    pose.skeletonX = x;
    pose.skeletonY = y;
    pose.skeletonScaleX = scaleX;
    pose.skeletonScaleY = scaleY;
    markAllDirty(pose);
    pose.version += 1;
  }
  function updateWorld(pose) {
    if (pose.worldValid && pose.dirtyCount === 0) return;
    const { skeleton, local, world, dirty } = pose;
    for (const id of skeleton.order) {
      if (dirty[id] === 0 && pose.worldValid) continue;
      if (pose.overrideActive[id] !== 0) {
        const offset = id * WORLD_STRIDE;
        for (let k = 0; k < WORLD_STRIDE; k += 1) world[offset + k] = pose.worldOverrides[offset + k];
        dirty[id] = 0;
        continue;
      }
      composeSpineLocal(local, id, scratchLocal);
      const parent = skeleton.parent[id];
      if (parent < 0) {
        scratchLocal[0] = scratchLocal[0] * pose.skeletonScaleX;
        scratchLocal[2] = scratchLocal[2] * pose.skeletonScaleX;
        scratchLocal[1] = scratchLocal[1] * pose.skeletonScaleY;
        scratchLocal[3] = scratchLocal[3] * pose.skeletonScaleY;
        scratchLocal[4] = scratchLocal[4] * pose.skeletonScaleX + pose.skeletonX;
        scratchLocal[5] = scratchLocal[5] * pose.skeletonScaleY + pose.skeletonY;
        for (let k = 0; k < WORLD_STRIDE; k += 1) world[id * WORLD_STRIDE + k] = scratchLocal[k];
      } else {
        for (let k = 0; k < WORLD_STRIDE; k += 1) scratchParent[k] = world[parent * WORLD_STRIDE + k];
        const tx = scratchParent[0] * scratchLocal[4] + scratchParent[2] * scratchLocal[5] + scratchParent[4];
        const ty = scratchParent[1] * scratchLocal[4] + scratchParent[3] * scratchLocal[5] + scratchParent[5];
        const mode = skeleton.inherit[id];
        if (mode === "normal") multiplyAffine(scratchParent, scratchLocal, scratchLocal);
        else inheritLinear(mode, scratchParent, scratchLocal, local[id * POSE_STRIDE + CH_ROT], pose.skeletonScaleX, pose.skeletonScaleY);
        scratchLocal[4] = tx;
        scratchLocal[5] = ty;
        for (let k = 0; k < WORLD_STRIDE; k += 1) world[id * WORLD_STRIDE + k] = scratchLocal[k];
      }
      dirty[id] = 0;
    }
    pose.dirtyCount = 0;
    pose.worldValid = true;
  }
  function boneMatrixOffset(pose, bone) {
    if (!Number.isInteger(bone) || bone < 0 || bone >= pose.skeleton.count) throw new Error("pose.bone");
    updateWorld(pose);
    return bone * WORLD_STRIDE;
  }
  function localToWorld(pose, bone, x, y) {
    const i = boneMatrixOffset(pose, bone);
    const m = pose.world;
    return [
      m[i] * x + m[i + 2] * y + m[i + 4],
      m[i + 1] * x + m[i + 3] * y + m[i + 5]
    ];
  }
  function worldToLocal(pose, bone, x, y) {
    const i = boneMatrixOffset(pose, bone);
    const m = pose.world;
    const a = m[i], b = m[i + 1], c = m[i + 2], d = m[i + 3];
    const determinant = a * d - b * c;
    if (Math.abs(determinant) < 1e-12) throw new Error("pose.worldToLocal: singular");
    const dx = x - m[i + 4], dy = y - m[i + 5];
    return [(d * dx - c * dy) / determinant, (a * dy - b * dx) / determinant];
  }
  function localToWorldRotation(pose, bone, angle) {
    const i = boneMatrixOffset(pose, bone);
    const m = pose.world;
    const x = Math.cos(angle), y = Math.sin(angle);
    return Math.atan2(m[i + 1] * x + m[i + 3] * y, m[i] * x + m[i + 2] * y);
  }
  function worldToLocalRotation(pose, bone, angle) {
    const i = boneMatrixOffset(pose, bone);
    const m = pose.world;
    const a = m[i], b = m[i + 1], c = m[i + 2], d = m[i + 3];
    const determinant = a * d - b * c;
    if (Math.abs(determinant) < 1e-12) throw new Error("pose.worldToLocal: singular");
    const x = Math.cos(angle), y = Math.sin(angle);
    return Math.atan2((a * y - b * x) / determinant, (d * x - c * y) / determinant);
  }

  // ../packages/render-engine/src/slot/slot.ts
  function whiteSkeletonColor() {
    return { r: 1, g: 1, b: 1, a: 1 };
  }
  function createSlotSet(slots, skins, defaultSkinId) {
    if (!skins.has(defaultSkinId)) throw new Error("slot.skin");
    return {
      slots: slots.map((data) => ({
        data,
        skinId: defaultSkinId,
        attachmentId: data.attachment,
        color: data.color
      })),
      skins,
      drawOrder: slots.map((_, i) => i).sort((a, b) => slots[a].order - slots[b].order)
    };
  }
  function setSkin(set, skinId) {
    if (!set.skins.has(skinId)) throw new Error("slot.skin");
    for (const slot of set.slots) slot.skinId = skinId;
  }
  function setSlotAttachment(set, slotIndex, attachmentId) {
    const slot = set.slots[slotIndex];
    if (!slot) throw new Error("slot.index");
    slot.attachmentId = attachmentId;
  }
  function setSlotColor(set, slotIndex, packed) {
    const slot = set.slots[slotIndex];
    if (!slot) throw new Error("slot.index");
    if (!Number.isInteger(packed) || packed < 0 || packed > 4294967295) throw new Error("slot.color");
    slot.color = {
      a: (packed >>> 24 & 255) / 255,
      r: (packed >>> 16 & 255) / 255,
      g: (packed >>> 8 & 255) / 255,
      b: (packed & 255) / 255
    };
  }
  function resolveAttachment(set, slotIndex) {
    const slot = set.slots[slotIndex];
    if (!slot || slot.attachmentId === null) return null;
    const skin = set.skins.get(slot.skinId);
    return skin?.attachments.get(slot.attachmentId) ?? null;
  }
  function isRenderable(a) {
    return a.kind === "region" || a.kind === "mesh" || a.kind === "weightedMesh";
  }
  function validateDrawOrder(order, slotCount) {
    if (order.length !== slotCount) return false;
    const seen = new Uint8Array(slotCount);
    for (const id of order) {
      if (!Number.isInteger(id) || id < 0 || id >= slotCount || seen[id] !== 0) return false;
      seen[id] = 1;
    }
    return true;
  }
  function setDrawOrder(set, order) {
    if (!validateDrawOrder(order, set.slots.length)) throw new Error("slot.drawOrder");
    set.drawOrder.length = 0;
    set.drawOrder.push(...order);
  }

  // ../packages/render-engine/src/mesh/mesh.ts
  function buildInverseBind(pose) {
    const setupPose = createPose(pose.skeleton);
    updateWorld(setupPose);
    const out = new Float32Array(pose.skeleton.count * WORLD_STRIDE);
    const m = createAffine();
    const inv = createAffine();
    for (let i = 0; i < pose.skeleton.count; i += 1) {
      for (let k = 0; k < WORLD_STRIDE; k += 1) m[k] = setupPose.world[i * WORLD_STRIDE + k];
      const result = invertAffine(m, inv);
      if (result === null) throw new Error(`mesh.inverseBind: bone ${i}`);
      out.set(result, i * WORLD_STRIDE);
    }
    return out;
  }
  var delta = createAffine();
  var temp = createAffine();
  function skinMesh2D(mesh, pose, inverseBind, out = new Float32Array(mesh.positions.length), deform) {
    const positions = mesh.positions;
    if (out.length !== positions.length) throw new Error("mesh.output.length");
    const weighted = "boneIndices" in mesh && "weights" in mesh;
    const stride = weighted ? mesh.influencesPerVertex ?? 4 : 0;
    const invOff = (bone) => bone * WORLD_STRIDE;
    for (let v = 0; v < positions.length / 2; v += 1) {
      const px = positions[v * 2];
      const py = positions[v * 2 + 1];
      if (!weighted) {
        const bone = mesh.bone;
        const off = bone * WORLD_STRIDE;
        for (let k = 0; k < WORLD_STRIDE; k += 1) temp[k] = pose.world[off + k];
        if (mesh.vertexSpace === "boneLocal") {
          out[v * 2] = temp[0] * px + temp[2] * py + temp[4];
          out[v * 2 + 1] = temp[1] * px + temp[3] * py + temp[5];
        } else {
          for (let k = 0; k < WORLD_STRIDE; k += 1) delta[k] = inverseBind[invOff(bone) + k];
          multiplyAffine(temp, delta, delta);
          out[v * 2] = delta[0] * px + delta[2] * py + delta[4];
          out[v * 2 + 1] = delta[1] * px + delta[3] * py + delta[5];
        }
        continue;
      }
      const influencePositions = mesh.influencePositions;
      if (influencePositions !== void 0) {
        let wx2 = 0;
        let wy2 = 0;
        for (let j = 0; j < stride; j += 1) {
          const influence = v * stride + j;
          const w = mesh.weights[influence];
          if (w === 0) continue;
          const bone = mesh.boneIndices[influence];
          if (bone >= pose.skeleton.count) throw new Error("mesh.boneIndex");
          const off = bone * WORLD_STRIDE;
          const local = influence * 2;
          const x = influencePositions[local] + (deform?.[local] ?? 0);
          const y = influencePositions[local + 1] + (deform?.[local + 1] ?? 0);
          wx2 += w * (pose.world[off] * x + pose.world[off + 2] * y + pose.world[off + 4]);
          wy2 += w * (pose.world[off + 1] * x + pose.world[off + 3] * y + pose.world[off + 5]);
        }
        out[v * 2] = wx2;
        out[v * 2 + 1] = wy2;
        continue;
      }
      if (mesh.vertexSpace === "boneLocal") {
        const bone = mesh.boneIndices[v * stride];
        const off = bone * WORLD_STRIDE;
        for (let k = 0; k < WORLD_STRIDE; k += 1) temp[k] = pose.world[off + k];
        out[v * 2] = temp[0] * px + temp[2] * py + temp[4];
        out[v * 2 + 1] = temp[1] * px + temp[3] * py + temp[5];
        continue;
      }
      let wx = 0;
      let wy = 0;
      for (let j = 0; j < stride; j += 1) {
        const w = mesh.weights[v * stride + j];
        if (w === 0) continue;
        const bone = mesh.boneIndices[v * stride + j];
        if (bone < 0 || bone >= pose.skeleton.count) throw new Error("mesh.boneIndex");
        const off = bone * WORLD_STRIDE;
        for (let k = 0; k < WORLD_STRIDE; k += 1) temp[k] = pose.world[off + k];
        for (let k = 0; k < WORLD_STRIDE; k += 1) delta[k] = inverseBind[invOff(bone) + k];
        multiplyAffine(temp, delta, delta);
        wx += w * (delta[0] * px + delta[2] * py + delta[4]);
        wy += w * (delta[1] * px + delta[3] * py + delta[5]);
      }
      out[v * 2] = wx;
      out[v * 2 + 1] = wy;
    }
    return out;
  }

  // ../packages/render-engine/src/animation/animation.ts
  var TAU2 = Math.PI * 2;
  var IDENTITY_BEZIER = [1 / 3, 1 / 3, 2 / 3, 2 / 3];
  var ZERO_DARK = { r: 0, g: 0, b: 0, a: 0 };
  var curveDiagnosticSink = null;
  function warnCurve(message) {
    if (curveDiagnosticSink !== null) curveDiagnosticSink({ code: "W_CURVE", message });
  }
  var EMPTY_CLIP = { name: "__empty", duration: 0, timelines: [] };
  var AnimationStateData = class {
    constructor(clips) {
      this.clips = clips;
    }
    clips;
    defaultMix = 0;
    mixes = /* @__PURE__ */ new Map();
    setMix(from, to, duration) {
      const fromName = this.nameOf(from);
      const toName = this.nameOf(to);
      let destinations = this.mixes.get(fromName);
      if (destinations === void 0) {
        destinations = /* @__PURE__ */ new Map();
        this.mixes.set(fromName, destinations);
      }
      destinations.set(toName, duration);
    }
    getMix(from, to) {
      return this.mixes.get(this.nameOf(from))?.get(this.nameOf(to)) ?? this.defaultMix;
    }
    nameOf(clip) {
      if (typeof clip !== "string") return clip.name;
      if (!this.clips.has(clip)) throw new Error("E_ANIM");
      return clip;
    }
  };
  var AnimationState = class {
    data;
    clips;
    pose;
    slotSet;
    listeners = /* @__PURE__ */ new Map();
    savedSpeed = /* @__PURE__ */ new WeakMap();
    _tracks = [];
    timeScale = 1;
    disposed = false;
    constructor(clips, pose, slotSet, data) {
      this.clips = clips;
      this.pose = pose;
      this.slotSet = slotSet;
      this.data = data ?? new AnimationStateData(clips);
    }
    get tracks() {
      return this._tracks;
    }
    assertLive() {
      if (this.disposed) throw new Error("E_DISPOSED");
    }
    play(name, options = {}) {
      this.assertLive();
      const clip = this.clips.get(name);
      if (clip === void 0) throw new Error("E_ANIM");
      const index = Math.max(0, Math.floor(options.track ?? 0));
      while (this._tracks.length <= index) this._tracks.push(createTrack(EMPTY_CLIP));
      const targetAlpha = options.alpha ?? 1;
      const outgoing = this._tracks[index];
      const previous = outgoing?.clip;
      const mixDuration = options.mixDuration ?? (previous === void 0 || previous === EMPTY_CLIP ? 0 : this.data.getMix(previous, clip));
      const track = createTrack(clip, {
        loop: options.loop ?? true,
        speed: options.speed ?? 1,
        alpha: mixDuration > 0 ? 0 : targetAlpha,
        delay: options.delay ?? 0,
        mixDuration,
        targetAlpha,
        reverse: options.reverse ?? false,
        ...options.blendMode === void 0 ? {} : { blendMode: options.blendMode }
      });
      if (mixDuration > 0 && outgoing !== void 0 && outgoing.clip !== EMPTY_CLIP) track.mixingFrom = outgoing;
      this._tracks[index] = track;
      this.dispatch({ type: "start", name, time: 0, track: index });
      return track;
    }
    /** 把动画排到指定 track 末尾；非循环播放结束后自动接续。 */
    queue(name, options = {}) {
      this.assertLive();
      const clip = this.clips.get(name);
      if (clip === void 0) throw new Error("E_ANIM");
      const index = Math.max(0, Math.floor(options.track ?? 0));
      while (this._tracks.length <= index) this._tracks.push(createTrack(EMPTY_CLIP));
      const track = this._tracks[index];
      if (track.clip === EMPTY_CLIP || track.clip.duration === 0) return this.play(name, options);
      const last = track.queue[track.queue.length - 1];
      const previous = last?.clip ?? track.clip;
      const mixDuration = options.mixDuration ?? this.data.getMix(previous, clip);
      const start2 = last === void 0 ? track.time : 0;
      const complete = track.loop && last === void 0 && track.clip.duration > 0 ? (Math.floor(start2 / track.clip.duration) + 1) * track.clip.duration : previous.duration;
      track.queue.push({
        clip,
        loop: options.loop ?? true,
        speed: options.speed ?? 1,
        alpha: options.alpha ?? 1,
        delay: options.delay !== void 0 && options.delay > 0 ? options.delay : Math.max(0, complete - mixDuration + (options.delay ?? 0)),
        mixDuration,
        blendMode: options.blendMode ?? "replace",
        reverse: options.reverse ?? false
      });
      return track;
    }
    stop(track) {
      this.assertLive();
      if (track === void 0) {
        this._tracks.length = 0;
        return;
      }
      const index = this._tracks.indexOf(track);
      if (index >= 0) this._tracks.splice(index, 1);
    }
    pause(track) {
      this.assertLive();
      const list = track === void 0 ? this._tracks : [track];
      for (const t of list) {
        if (!this.savedSpeed.has(t)) this.savedSpeed.set(t, t.speed);
        t.speed = 0;
      }
    }
    resume(track) {
      this.assertLive();
      const list = track === void 0 ? this._tracks : [track];
      for (const t of list) {
        const saved = this.savedSpeed.get(t);
        if (saved !== void 0) {
          t.speed = saved;
          this.savedSpeed.delete(t);
        }
      }
    }
    setTimeScale(scale) {
      this.assertLive();
      if (!Number.isFinite(scale) || scale < 0) throw new Error("E_TRACK");
      this.timeScale = scale;
    }
    addListener(type, fn) {
      this.assertLive();
      let set = this.listeners.get(type);
      if (set === void 0) {
        set = /* @__PURE__ */ new Set();
        this.listeners.set(type, set);
      }
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    }
    dispatch(event) {
      const set = this.listeners.get(event.type);
      if (set === void 0) return;
      for (const fn of set) {
        try {
          fn(event);
        } catch {
        }
      }
    }
    update(dt) {
      this.assertLive();
      if (!Number.isFinite(dt) || dt < 0) throw new Error("E_TRACK");
      const scaled = dt * this.timeScale;
      this._tracks.forEach((track, index) => {
        const next = track.queue[0];
        if (next === void 0) return;
        const elapsed = track.lastTime + track.loopCount * track.clip.duration;
        if (elapsed < next.delay) return;
        track.queue.shift();
        const outgoing = { ...track, queue: [] };
        applyQueueEntry(track, next);
        track.time = Math.max(0, elapsed - next.delay);
        track.lastTime = track.time;
        if (next.mixDuration > 0) track.mixingFrom = outgoing;
        this.dispatch({ type: "start", name: next.clip.name, time: 0, track: index });
      });
      const prevLast = this._tracks.map((track) => track.lastTime);
      const active = [];
      const indices = [];
      for (let index = 0; index < this._tracks.length; index += 1) {
        const track = this._tracks[index];
        const chain = [];
        for (let entry = track.mixingFrom; entry !== void 0; entry = entry.mixingFrom) chain.unshift(entry);
        for (const entry of chain) {
          if (entry.mixDuration > 0) entry.mixTime = Math.min(entry.mixDuration, entry.mixTime + scaled);
        }
        for (let i = 0; i < chain.length; i += 1) {
          const from = chain[i];
          const to = chain[i + 1] ?? track;
          const mix = to.mixDuration > 0 ? Math.min(1, (to.mixTime + scaled) / to.mixDuration) : 1;
          const fromMix = i === 0 ? 1 : from.mixDuration > 0 ? Math.min(1, from.mixTime / from.mixDuration) : 1;
          const a = from.targetAlpha * fromMix;
          const alphaMix = a * (1 - mix);
          const keep = 1 - mix * to.targetAlpha;
          const alphaHold = keep > 0 ? alphaMix / keep : a;
          from.timelineAlphas = from.clip.timelines.map((timeline) => {
            if (timeline.kind === "event" || !to.clip.timelines.some((other) => timelineId(other) === timelineId(timeline)))
              return alphaMix;
            for (let j = i + 2; j <= chain.length; j += 1) {
              const next = chain[j] ?? track;
              if (!next.clip.timelines.some((other) => timelineId(other) === timelineId(timeline))) {
                const nextMix = next.mixDuration > 0 ? Math.min(1, (next.mixTime + scaled) / next.mixDuration) : 1;
                return alphaHold * (1 - nextMix);
              }
            }
            return alphaHold;
          });
          from.alpha = Math.max(0, ...from.timelineAlphas);
          from.mixingOutMix = mix;
          active.push(from);
          indices.push(index);
        }
        active.push(track);
        indices.push(index);
      }
      const result = sampleAnimation(active, this.pose, this.slotSet, scaled);
      if (this._tracks.length === 1 && this._tracks[0]?.clip === EMPTY_CLIP && this._tracks[0].mixTime >= this._tracks[0].mixDuration) {
        for (let bone = 0; bone < this.pose.skeleton.setupLocal.length / POSE_STRIDE; bone += 1) {
          for (let channel = 0; channel < POSE_STRIDE; channel += 1) {
            setLocal(this.pose, bone, channel, this.pose.skeleton.setupLocal[bone * POSE_STRIDE + channel]);
          }
        }
      }
      result.eventData = result.eventData.map((event) => ({ ...event, track: indices[event.track] ?? event.track }));
      for (const [index, track] of this._tracks.entries()) {
        if (track.mixingFrom !== void 0 && track.mixTime >= track.mixDuration) delete track.mixingFrom;
        if (track.clip === EMPTY_CLIP && (prevLast[index] ?? 0) > track.mixDuration) {
          this._tracks[index] = createTrack(EMPTY_CLIP, { alpha: 0, speed: 0 });
        }
      }
      const pending = [];
      for (const event of result.eventData) {
        pending.push({
          type: "event",
          name: event.name,
          time: event.time,
          track: event.track,
          ...event.int === void 0 ? {} : { int: event.int },
          ...event.float === void 0 ? {} : { float: event.float },
          ...event.string === void 0 ? {} : { string: event.string }
        });
      }
      this._tracks.forEach((track, index) => {
        const duration = track.clip.duration;
        if (!track.loop && duration > 0 && track.time >= duration && (prevLast[index] ?? 0) < duration) {
          pending.push({ type: "complete", name: track.clip.name, time: track.time, track: index });
        }
      });
      for (const event of pending) this.dispatch(event);
      return result;
    }
    /** Transition a track to setup pose; zero duration takes effect on the next update. */
    setEmptyAnimation(index, mixDuration = 0) {
      this.assertLive();
      while (this._tracks.length <= index) this._tracks.push(createTrack(EMPTY_CLIP));
      const previous = this._tracks[index];
      const empty = createTrack(EMPTY_CLIP, {
        loop: false,
        mixDuration,
        alpha: mixDuration > 0 ? 0 : 1,
        targetAlpha: 1
      });
      if (mixDuration > 0 && previous.clip !== EMPTY_CLIP) empty.mixingFrom = previous;
      this._tracks[index] = empty;
      return empty;
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this._tracks.length = 0;
      this.listeners.clear();
    }
  };
  function timelineId(timeline) {
    if (timeline.kind === "event") return "event";
    const target = timeline.bone ?? timeline.slot ?? timeline.constraint ?? timeline.path ?? "";
    const component = timeline.axis ?? (timeline.path === void 0 ? "" : targetOf(timeline.path).component);
    return `${timeline.kind}:${target}:${component}:${timeline.channel ?? ""}:${timeline.skin ?? ""}:${timeline.attachment ?? ""}`;
  }
  function applyQueueEntry(track, entry) {
    track.clip = entry.clip;
    track.time = 0;
    track.lastTime = 0;
    track.loopCount = 0;
    track.loop = entry.loop;
    track.speed = entry.speed;
    track.delay = 0;
    track.mixDuration = entry.mixDuration;
    track.mixTime = 0;
    track.targetAlpha = entry.alpha;
    track.alpha = entry.mixDuration > 0 ? 0 : entry.alpha;
    track.blendMode = entry.blendMode;
    track.reverse = entry.reverse;
  }
  function createTrack(clip, options) {
    const alpha = options?.alpha ?? 1;
    return {
      clip,
      time: options?.time ?? 0,
      alpha,
      speed: options?.speed ?? 1,
      loop: options?.loop ?? true,
      blendMode: options?.blendMode ?? "replace",
      lastTime: options?.time ?? 0,
      loopCount: 0,
      mixDuration: options?.mixDuration ?? 0,
      mixTime: 0,
      delay: options?.delay ?? 0,
      targetAlpha: options?.targetAlpha ?? alpha,
      eventThreshold: options?.eventThreshold ?? 0,
      reverse: options?.reverse ?? false,
      queue: []
    };
  }
  function clamp01(v) {
    if (v <= 0) return 0;
    if (v >= 1) return 1;
    return v;
  }
  function validSegment(segment) {
    if (segment.length !== 4) return false;
    for (let i = 0; i < 4; i += 1) {
      if (!Number.isFinite(segment[i])) return false;
    }
    return true;
  }
  var segmentCache = /* @__PURE__ */ new WeakMap();
  function curveSegments(curve, bezier) {
    if (curve === "bezier") {
      const b = bezier ?? IDENTITY_BEZIER;
      const cached = segmentCache.get(b);
      if (cached !== void 0) return cached;
      const result = validSegment(b) ? b : null;
      segmentCache.set(b, result);
      return result;
    }
    if (Array.isArray(curve)) {
      const cached = segmentCache.get(curve);
      if (cached !== void 0) return cached;
      let result = curve.length >= 4 && curve.length % 4 === 0 ? curve : null;
      if (result !== null) {
        for (let i = 0; i < curve.length; i += 4) {
          if (!validSegment(curve.slice(i, i + 4))) {
            result = null;
            break;
          }
        }
      }
      segmentCache.set(curve, result);
      return result;
    }
    if (typeof curve === "object" && curve !== null && "bezier" in curve) {
      const cached = segmentCache.get(curve);
      if (cached !== void 0) return cached;
      const result = validSegment(curve.bezier) ? curve.bezier : null;
      segmentCache.set(curve, result);
      return result;
    }
    return null;
  }
  function wantsBezier(curve) {
    return curve === "bezier" || Array.isArray(curve) || typeof curve === "object" && curve !== null && "bezier" in curve;
  }
  var bezierPointCache = /* @__PURE__ */ new WeakMap();
  function bezierFraction(t, segments) {
    const count = segments.length / 4;
    const scaled = clamp01(t) * count;
    const index = Math.min(count - 1, Math.floor(scaled));
    const local = scaled - index;
    const base = index * 4;
    const x1 = segments[base], y1 = segments[base + 1];
    const x2 = segments[base + 2], y2 = segments[base + 3];
    let cached = bezierPointCache.get(segments);
    if (cached === void 0) {
      cached = [];
      bezierPointCache.set(segments, cached);
    }
    let points = cached[index];
    if (points === void 0) {
      points = new Float32Array(18);
      cached[index] = points;
      const tmpx = (-2 * x1 + x2) * 0.03, tmpy = (-2 * y1 + y2) * 0.03;
      const dddx = (3 * (x1 - x2) + 1) * 6e-3, dddy = (3 * (y1 - y2) + 1) * 6e-3;
      let ddx = 2 * tmpx + dddx, ddy = 2 * tmpy + dddy;
      let dx = x1 * 0.3 + tmpx + dddx * 0.16666667;
      let dy = y1 * 0.3 + tmpy + dddy * 0.16666667;
      let x = dx, y = dy;
      for (let i = 0; i < 18; i += 2) {
        points[i] = x;
        points[i + 1] = y;
        dx += ddx;
        dy += ddy;
        ddx += dddx;
        ddy += dddy;
        x += dx;
        y += dy;
      }
    }
    let prevX = 0, prevY = 0;
    for (let i = 0; i <= 18; i += 2) {
      const nextX = i === 18 ? 1 : points[i];
      const nextY = i === 18 ? 1 : points[i + 1];
      if (local <= nextX || i === 18) {
        const localY = prevY + (local - prevX) / (nextX - prevX) * (nextY - prevY);
        return count === 1 ? localY : (index + localY) / count;
      }
      prevX = nextX;
      prevY = nextY;
    }
    return 1;
  }
  function easeSineFraction(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const k1 = 0.25;
    const k2 = 0.75;
    const a = k1 / (Math.PI / 2);
    const b = (1 - k2) / (Math.PI / 2);
    const d = a + (k2 - k1) + b;
    let s;
    if (t < k1) {
      s = a * (1 - Math.cos(Math.PI * t / (2 * k1)));
    } else if (t < k2) {
      s = a + (t - k1);
    } else {
      const w = (t - k2) / (1 - k2);
      s = a + (k2 - k1) + b * Math.sin(w * Math.PI / 2);
    }
    return s / d;
  }
  function curveFraction(curve, u, bezier) {
    const t = clamp01(u);
    switch (curve) {
      case void 0:
      case "linear":
        return t;
      case "stepped":
        return t >= 1 ? 1 : 0;
      case "easeSine":
        return easeSineFraction(t);
      default:
        break;
    }
    const segments = curveSegments(curve, bezier);
    if (segments === null) {
      if (wantsBezier(curve)) warnCurve(`\u975E\u6CD5 Bezier \u66F2\u7EBF\uFF0C\u5DF2\u964D\u7EA7\u4E3A linear\uFF1A${String(curve)}`);
      return t;
    }
    return bezierFraction(t, segments);
  }
  function lastKeyIndex(keys, time) {
    if (keys.length === 0) return -1;
    if (time <= keys[0].time) return 0;
    let lo = 0;
    let hi = keys.length - 1;
    while (lo + 1 < hi) {
      const mid = lo + hi >> 1;
      if (keys[mid].time <= time) lo = mid;
      else hi = mid;
    }
    return keys[hi].time <= time ? hi : lo;
  }
  function sampleScalar(keys, time) {
    if (keys.length === 0) return 0;
    const first = keys[0];
    if (keys.length === 1 || time <= first.time) return first.value;
    const last = keys[keys.length - 1];
    if (time >= last.time) return last.value;
    const index = lastKeyIndex(keys, time);
    const k0 = keys[index];
    const k1 = keys[index + 1];
    const span = k1.time - k0.time;
    const u = span <= 0 ? 1 : (time - k0.time) / span;
    const f = curveFraction(k0.curve, u, k0.bezier);
    return k0.value + (k1.value - k0.value) * f;
  }
  function sampleStepped(keys, time) {
    if (keys.length === 0) return 0;
    return keys[lastKeyIndex(keys, time)].value;
  }
  function unwrapRotateKeys(keys) {
    if (keys.length === 0) return [];
    const out = [{ ...keys[0] }];
    let acc = keys[0].value;
    for (let i = 1; i < keys.length; i += 1) {
      const raw = keys[i].value - acc;
      const next = Math.abs(raw) >= TAU2 - 1e-9 ? acc + raw : acc + normalizeAngle(raw);
      out.push({ ...keys[i], value: next });
      acc = next;
    }
    return out;
  }
  var unwrapCache = /* @__PURE__ */ new WeakMap();
  function unwrappedAngles(keys) {
    const cached = unwrapCache.get(keys);
    if (cached !== void 0) return cached;
    const unwrapped = unwrapRotateKeys(keys);
    unwrapCache.set(keys, unwrapped);
    return unwrapped;
  }
  function sampleAngle(keys, time) {
    if (keys.length === 0) return 0;
    return sampleScalar(unwrappedAngles(keys), time);
  }
  var SUFFIXES = {
    x: "x",
    y: "y",
    sx: "sx",
    sy: "sy",
    shx: "shx",
    shy: "shy"
  };
  var CHANNEL_OF = {
    x: CH_X,
    y: CH_Y,
    sx: CH_SX,
    sy: CH_SY,
    shx: CH_SHX,
    shy: CH_SHY
  };
  function targetOf(path) {
    const dot2 = path.lastIndexOf(".");
    if (dot2 > 0) {
      const component = SUFFIXES[path.slice(dot2 + 1).toLowerCase()];
      if (component !== void 0) return { target: path.slice(0, dot2), component };
    }
    return { target: path, component: "all" };
  }
  function axisComponent(kind, axis) {
    if (kind === "translate") return axis;
    if (kind === "scale") return axis === "x" ? "sx" : "sy";
    return axis === "x" ? "shx" : "shy";
  }
  function componentsOf(kind, component) {
    if (component !== "all") return [component];
    if (kind === "translate") return ["x", "y"];
    if (kind === "scale") return ["sx", "sy"];
    return ["shx", "shy"];
  }
  function boneOf(timeline, skeleton) {
    if (timeline.bone !== void 0) return timeline.bone;
    if (timeline.path === void 0) return void 0;
    return skeleton.boneIdByName.get(targetOf(timeline.path).target);
  }
  function slotOf(timeline) {
    if (timeline.slot !== void 0) return timeline.slot;
    const parsed = Number.parseInt(timeline.path ?? "", 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function deformMeshKey(timeline, slot) {
    return `${timeline.skin ?? "default"}:${slot}:${timeline.attachment ?? ""}`;
  }
  function isScalarKey(key) {
    return "value" in key;
  }
  function isDeformKey(key) {
    return "vertices" in key;
  }
  function isDrawOrderKey(key) {
    return "offsets" in key;
  }
  function isAttachmentKey(key) {
    return "name" in key && !("value" in key);
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function mixRGBA(from, to, alpha) {
    return {
      r: lerp(from.r, to.r, alpha),
      g: lerp(from.g, to.g, alpha),
      b: lerp(from.b, to.b, alpha),
      a: lerp(from.a, to.a, alpha)
    };
  }
  var PACKED_MASK = 255;
  function unpackColor(packed) {
    return {
      a: (packed >>> 24 & PACKED_MASK) / 255,
      r: (packed >>> 16 & PACKED_MASK) / 255,
      g: (packed >>> 8 & PACKED_MASK) / 255,
      b: (packed & PACKED_MASK) / 255
    };
  }
  function sampleColorKeys(keys, time, channel) {
    if (keys.length === 0) return { light: ZERO_DARK, dark: ZERO_DARK, legacy: null };
    const first = keys[0];
    if (isScalarKey(first)) {
      const packed = sampleScalar(keys, time);
      return { light: unpackColor(packed), dark: ZERO_DARK, legacy: packed };
    }
    const colorKeys = keys;
    if (colorKeys.length === 1 || time <= colorKeys[0].time) {
      const key = colorKeys[0];
      return { light: key.light, dark: key.dark ?? ZERO_DARK, legacy: null };
    }
    const last = colorKeys[colorKeys.length - 1];
    if (time >= last.time) {
      return { light: last.light, dark: last.dark ?? ZERO_DARK, legacy: null };
    }
    const index = lastKeyIndex(colorKeys, time);
    const k0 = colorKeys[index];
    const k1 = colorKeys[index + 1];
    const span = k1.time - k0.time;
    const u = span <= 0 ? 1 : (time - k0.time) / span;
    const fraction = (index2) => curveFraction(k0.curves === void 0 ? k0.curve : k0.curves[index2], u, void 0);
    const d0 = k0.dark ?? ZERO_DARK;
    const d1 = k1.dark ?? ZERO_DARK;
    const darkOffset = channel === "rgb2" ? 3 : 4;
    return {
      light: {
        r: lerp(k0.light.r, k1.light.r, fraction(0)),
        g: lerp(k0.light.g, k1.light.g, fraction(1)),
        b: lerp(k0.light.b, k1.light.b, fraction(2)),
        a: lerp(k0.light.a, k1.light.a, fraction(channel === "alpha" ? 0 : 3))
      },
      dark: {
        r: lerp(d0.r, d1.r, fraction(darkOffset)),
        g: lerp(d0.g, d1.g, fraction(darkOffset + 1)),
        b: lerp(d0.b, d1.b, fraction(darkOffset + 2)),
        a: lerp(d0.a, d1.a, fraction(7))
      },
      legacy: null
    };
  }
  function applyColorChannels(pending, sampled, channel, alpha) {
    const mode = channel ?? "rgba";
    let light = pending.light;
    let dark = pending.dark;
    if (mode === "rgb" || mode === "rgba" || mode === "rgb2" || mode === "rgba2") {
      light = mixRGBA(light, { ...light, r: sampled.light.r, g: sampled.light.g, b: sampled.light.b }, alpha);
    }
    if (mode === "alpha" || mode === "rgba" || mode === "rgba2") {
      light = mixRGBA(light, { ...light, a: sampled.light.a }, alpha);
    }
    if (mode === "rgb2" || mode === "rgba2") {
      dark = mixRGBA(dark, { ...dark, r: sampled.dark.r, g: sampled.dark.g, b: sampled.dark.b }, alpha);
    }
    if (mode === "alpha2") {
      dark = mixRGBA(dark, { ...dark, a: sampled.dark.a }, alpha);
    }
    return { light, dark };
  }
  function sampleDeformKeys(keys, time, timeline) {
    const first = keys[0];
    if (timeline.unitScale === void 0 && timeline.baseVertices === void 0 && timeline.vertexIndices === void 0) {
      return keys[lastKeyIndex(keys, time)];
    }
    const length = timeline.baseVertices?.length ?? (timeline.vertexIndices?.length ?? 0) * 2;
    const sampled = new Float32Array(length);
    const index = lastKeyIndex(keys, time);
    const from = keys[index];
    const to = keys[Math.min(index + 1, keys.length - 1)];
    const span = to.time - from.time;
    const factor = span > 0 && time > from.time && index + 1 < keys.length ? curveFraction(from.curve, (time - from.time) / span, void 0) : 0;
    const component = (key, sourceIndex, targetIndex) => {
      if (sourceIndex < 0) return 0;
      const raw = key.vertices[sourceIndex - key.offset];
      if (raw === void 0) return 0;
      const scale = (timeline.unitScale ?? 1) * (targetIndex % 2 === 1 && timeline.flipY ? -1 : 1);
      return raw * scale - (timeline.weighted ? 0 : timeline.baseVertices?.[targetIndex] ?? 0);
    };
    for (let i = 0; i < length; i += 1) {
      const influenceSource = timeline.vertexIndices?.[Math.floor(i / 2)] ?? -1;
      const source = timeline.weighted ? influenceSource < 0 ? -1 : influenceSource + i % 2 : i;
      const a = component(from, source, i);
      sampled[i] = a + (component(to, source, i) - a) * factor;
    }
    return { time, offset: 0, vertices: sampled };
  }
  function accumulateDeform(target, key, alpha, meshKey) {
    if (alpha <= 0) return;
    const offset = Math.max(0, Math.floor(key.offset));
    const start2 = offset * 2;
    const needed = start2 + key.vertices.length;
    let acc = target.get(meshKey);
    if (acc === void 0 || acc.length < needed) {
      const grown = new Float32Array(needed);
      if (acc !== void 0) grown.set(acc);
      acc = grown;
      target.set(meshKey, acc);
    }
    for (let i = 0; i < key.vertices.length; i += 1) {
      acc[start2 + i] = acc[start2 + i] + key.vertices[i] * alpha;
    }
  }
  function setupDrawOrder(slotSet) {
    return slotSet.slots.map((_, index) => index).sort((a, b) => slotSet.slots[a].data.order - slotSet.slots[b].data.order || a - b);
  }
  function applyDrawOffsets(base, offsets) {
    const order = base.slice();
    for (const { slot, offset } of offsets) {
      const from = order.indexOf(slot);
      if (from < 0) continue;
      order.splice(from, 1);
      let to = from + offset;
      if (to < 0) to = 0;
      if (to > order.length) to = order.length;
      order.splice(to, 0, slot);
    }
    return order;
  }
  function eventKeysOf(timeline) {
    if (timeline.keys !== void 0) return timeline.keys;
    return timeline.events ?? [];
  }
  function fireEvents(events, from, to, includeFrom, loopTag, track, out, seen) {
    if (to < from) return;
    for (const e of events) {
      if (e.time < from || e.time > to) continue;
      if (!includeFrom && e.time === from) continue;
      const id = `${track}:${loopTag}:${e.time}:${e.name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        name: e.name,
        time: e.time,
        track,
        ...e.int === void 0 ? {} : { int: e.int },
        ...e.float === void 0 ? {} : { float: e.float },
        ...e.string === void 0 ? {} : { string: e.string }
      });
    }
  }
  function blend(cur, setup, sample, alpha, additive, multiplier) {
    const base = cur ?? setup;
    if (additive) return base + sample * alpha;
    const target = multiplier ? setup * sample : setup + sample;
    return base + (target - base) * alpha;
  }
  function applySliderBoneAnimation(clip, pose, time, mix, additive, loop) {
    const at = loop && clip.duration > 0 ? (time % clip.duration + clip.duration) % clip.duration : time;
    for (const timeline of clip.timelines) {
      if (timeline.kind !== "rotate" && timeline.kind !== "translate" && timeline.kind !== "scale" && timeline.kind !== "shear") continue;
      const bone = boneOf(timeline, pose.skeleton);
      if (bone === void 0 || timeline.keys.length === 0 || at < timeline.keys[0].time) continue;
      const component = timeline.path === void 0 ? "" : timeline.path.slice(timeline.path.lastIndexOf(".") + 1);
      const channels = timeline.kind === "rotate" ? [CH_ROT] : timeline.kind === "translate" ? component === "x" ? [CH_X] : component === "y" ? [CH_Y] : [CH_X, CH_Y] : timeline.kind === "scale" ? component === "sx" ? [CH_SX] : component === "sy" ? [CH_SY] : [CH_SX, CH_SY] : component === "shx" ? [CH_SHX] : component === "shy" ? [CH_SHY] : [CH_SHX, CH_SHY];
      const value = sampleScalar(timeline.keys, at);
      for (const channel of channels) {
        const setup = pose.skeleton.setupLocal[bone * POSE_STRIDE + channel];
        const current = pose.local[bone * POSE_STRIDE + channel];
        const target = timeline.kind === "scale" ? setup * value : setup + value;
        const next = additive ? current + (timeline.kind === "scale" ? setup * (value - 1) : value) * mix : current + (target - current) * mix;
        setLocal(pose, bone, channel, next);
      }
    }
  }
  function applySliderSlotAnimation(clip, slotSet, time, loop) {
    const at = loop && clip.duration > 0 ? time % clip.duration : time;
    const positions = /* @__PURE__ */ new Map();
    for (const timeline of clip.timelines) {
      if (timeline.kind === "attachment") {
        const keys = timeline.keys;
        if (keys === void 0 || keys.length === 0 || at < keys[0].time) continue;
        const index = slotOf(timeline);
        if (index < 0 || index >= slotSet.slots.length) continue;
        const key = keys[lastKeyIndex(keys, at)];
        if (isAttachmentKey(key)) setSlotAttachment(slotSet, index, key.name);
      } else if (timeline.kind === "drawOrder") {
        const keys = timeline.keys;
        if (keys === void 0 || keys.length === 0 || at < keys[0].time) continue;
        if (isDrawOrderKey(keys[0])) {
          const key = keys[lastKeyIndex(keys, at)];
          setDrawOrder(slotSet, applyDrawOffsets(setupDrawOrder(slotSet), key.offsets));
        } else {
          const position = /^drawOrder\[(\d+)\]$/.exec(timeline.path ?? "");
          if (position !== null) positions.set(Number(position[1]), sampleStepped(keys, at));
        }
      }
    }
    if (positions.size > 0) {
      const order = setupDrawOrder(slotSet).map((slot, position) => positions.get(position) ?? slot);
      setDrawOrder(slotSet, order);
    }
  }
  function sampleAnimation(tracks, pose, slotSet, dt) {
    const eventData = [];
    const seen = /* @__PURE__ */ new Set();
    const accs = /* @__PURE__ */ new Map();
    let dominant = null;
    const pendingAttachment = /* @__PURE__ */ new Map();
    for (const track of tracks) {
      if (track.mixingOutMix === void 0) continue;
      for (const timeline of track.clip.timelines) {
        if (timeline.kind !== "attachment") continue;
        const index = slotOf(timeline);
        pendingAttachment.set(index, slotSet.slots[index]?.data.attachment ?? null);
      }
    }
    const pendingColor = /* @__PURE__ */ new Map();
    const darkSlots = /* @__PURE__ */ new Set();
    const pendingLegacyColor = /* @__PURE__ */ new Map();
    const pendingDeform = /* @__PURE__ */ new Map();
    const deformOffsets = /* @__PURE__ */ new Map();
    const pendingIk = /* @__PURE__ */ new Map();
    const pendingSequence = /* @__PURE__ */ new Map();
    const constraintMix = /* @__PURE__ */ new Map();
    const constraintMixByName = /* @__PURE__ */ new Map();
    constraintMixByName.channels = /* @__PURE__ */ new Map();
    const constraintIds = /* @__PURE__ */ new Map();
    const constraintNames = [];
    let drawOrderSpec = null;
    const drawOrderPositions = /* @__PURE__ */ new Map();
    const skeleton = pose.skeleton;
    const addConstraint = (name, mix) => {
      const value = clamp01(mix);
      constraintMixByName.set(name, value);
      let id;
      if (/^-?\d+$/.test(name)) {
        id = Number(name);
      } else {
        let assigned = constraintIds.get(name);
        if (assigned === void 0) {
          assigned = -(constraintIds.size + 1);
          constraintIds.set(name, assigned);
          constraintNames[-assigned - 1] = name;
        }
        id = assigned;
      }
      constraintMix.set(id, value);
    };
    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
      const track = tracks[trackIndex];
      if (track.delay > 0) {
        track.delay = Math.max(0, track.delay - dt);
        continue;
      }
      if (track.mixingOutMix === void 0 && track.mixDuration > 0 && track.mixTime < track.mixDuration && dt > 0) {
        track.mixTime = Math.min(track.mixDuration, track.mixTime + dt);
        track.alpha = track.targetAlpha * (track.mixTime / track.mixDuration);
      }
      if (track.alpha <= 0) continue;
      const clip = track.clip;
      const duration = clip.duration;
      const prev = track.lastTime;
      const prevLoops = track.loopCount;
      const isFirst = prev === 0 && prevLoops === 0 && track.time === 0 && dt > 0;
      let curr = track.time;
      if (dt > 0 && track.speed > 0 && (duration > 0 || clip === EMPTY_CLIP)) {
        curr += dt * track.speed;
        if (track.loop && duration > 0) {
          if (curr >= duration) {
            const wraps = Math.floor(curr / duration);
            track.loopCount += wraps;
            curr -= wraps * duration;
          }
        } else if (duration > 0 && curr > duration) {
          curr = duration;
        }
      }
      track.time = curr;
      const loops = track.loopCount - prevLoops;
      if (dt !== 0 && (track.mixingOutMix === void 0 ? track.alpha > 0 : track.mixingOutMix < track.eventThreshold)) {
        const evs = [];
        for (const tl of clip.timelines) {
          if (tl.kind === "event") evs.push(...eventKeysOf(tl));
        }
        if (evs.length > 0) {
          if (track.reverse) {
            const from = duration - prev;
            const to = duration - curr;
            if (from >= to) {
              for (const event of evs) {
                if (event.time >= to && event.time < from)
                  fireEvents([event], event.time, event.time, true, 0, trackIndex, eventData, seen);
              }
            } else {
              for (const event of evs) {
                if (event.time < from)
                  fireEvents([event], event.time, event.time, true, 0, trackIndex, eventData, seen);
              }
              for (const event of evs) {
                if (event.time >= to)
                  fireEvents([event], event.time, event.time, true, 1, trackIndex, eventData, seen);
              }
            }
          } else if (isFirst) {
            for (let k = 0; k < loops; k += 1) fireEvents(evs, 0, duration, true, k, trackIndex, eventData, seen);
            fireEvents(evs, 0, curr, true, loops, trackIndex, eventData, seen);
          } else if (loops > 0) {
            fireEvents(evs, prev, duration, false, 0, trackIndex, eventData, seen);
            for (let k = 1; k < loops; k += 1) fireEvents(evs, 0, duration, true, k, trackIndex, eventData, seen);
            fireEvents(evs, 0, curr, true, loops, trackIndex, eventData, seen);
          } else {
            fireEvents(evs, prev, curr, false, 0, trackIndex, eventData, seen);
          }
        }
      }
      track.lastTime = curr;
      const applyTime = track.reverse ? duration - curr : curr;
      const additive = track.blendMode === "additive";
      let wrote = false;
      for (const [timelineIndex, tl] of clip.timelines.entries()) {
        if (tl.kind === "event") continue;
        const alpha = track.timelineAlphas?.[timelineIndex] ?? track.alpha;
        if (alpha <= 0 && tl.kind !== "attachment" && tl.kind !== "drawOrder") continue;
        if (tl.kind === "rotate") {
          const id = boneOf(tl, skeleton);
          if (id === void 0 || tl.keys.length === 0) continue;
          const acc = accs.get(id) ?? {};
          const setup = skeleton.setupLocal[id * POSE_STRIDE + CH_ROT];
          if (applyTime < tl.keys[0].time) {
            if (acc.rot === void 0) acc.rot = setup;
            accs.set(id, acc);
            continue;
          }
          acc.rot = blend(acc.rot, setup, sampleAngle(tl.keys, applyTime), alpha, additive, false);
          accs.set(id, acc);
          wrote = true;
          continue;
        }
        if (tl.kind === "translate" || tl.kind === "scale" || tl.kind === "shear") {
          const id = boneOf(tl, skeleton);
          if (id === void 0 || tl.keys.length === 0) continue;
          if (tl.kind === "scale" && additive) continue;
          const component = tl.axis !== void 0 ? axisComponent(tl.kind, tl.axis) : targetOf(tl.path ?? "").component;
          const acc = accs.get(id) ?? {};
          const base = id * POSE_STRIDE;
          if (applyTime < tl.keys[0].time) {
            for (const c of componentsOf(tl.kind, component)) {
              if (acc[c] === void 0) acc[c] = skeleton.setupLocal[base + CHANNEL_OF[c]];
            }
            accs.set(id, acc);
            continue;
          }
          const value = sampleScalar(tl.keys, applyTime);
          for (const c of componentsOf(tl.kind, component)) {
            const channel = CHANNEL_OF[c];
            const setup = skeleton.setupLocal[base + channel];
            acc[c] = blend(acc[c], setup, value, alpha, additive, tl.kind === "scale");
          }
          accs.set(id, acc);
          wrote = true;
          continue;
        }
        if (tl.kind === "sequence") {
          const index = slotOf(tl);
          pendingSequence.set(index, Math.round(sampleStepped(tl.keys, applyTime)));
          wrote = true;
          continue;
        }
        if ((tl.kind === "ik" || tl.kind === "transform" || tl.kind === "path" || tl.kind === "physics" || tl.kind === "slider") && "frames" in tl) {
          if (tl.frames.length === 0) continue;
          if (tl.kind === "physics" && tl.channel === "reset") {
            const crossed = tl.frames.some((frame) => (loops > 0 || frame.time > prev || isFirst && frame.time === 0) && frame.time <= curr);
            if (crossed && dt > 0) {
              const name2 = tl.constraint ?? tl.path ?? "-1";
              const existing2 = constraintMixByName.channels.get(name2) ?? [];
              existing2.push({ kind: "physics", values: { reset: true }, alpha, additive: false });
              constraintMixByName.channels.set(name2, existing2);
            }
            continue;
          }
          if (curr < tl.frames[0].time && !(tl.kind === "physics" && (tl.path === "-1" || tl.path === ""))) continue;
          const name = tl.constraint ?? tl.path;
          if (name === void 0) continue;
          const fields = tl.kind === "ik" ? ["mix", "softness"] : tl.kind === "transform" ? ["mixRotate", "mixX", "mixY", "mixScaleX", "mixScaleY", "mixShearY"] : tl.kind === "physics" || tl.kind === "slider" ? [tl.channel ?? "mix"] : tl.channel === "mix" ? ["mixRotate", "mixX", "mixY"] : [tl.channel ?? "position"];
          const values = {};
          for (const [component, field] of fields.entries()) {
            values[field] = tl.kind === "physics" && curr < tl.frames[0].time ? 0 : sampleScalar(tl.frames.map((frame) => ({
              time: frame.time,
              value: frame.values[component],
              ...frame.curves?.[component] === void 0 ? {} : { curve: frame.curves[component] }
            })), curr);
          }
          if (tl.kind === "ik") {
            const frame = tl.frames[lastKeyIndex(tl.frames, curr)];
            values.bendDirection = frame.bendDirection ?? 1;
            values.compress = frame.compress ?? false;
            values.stretch = frame.stretch ?? false;
          }
          const channel = { kind: tl.kind, values, alpha, additive };
          const existing = constraintMixByName.channels.get(name) ?? [];
          existing.push(channel);
          constraintMixByName.channels.set(name, existing);
          wrote = true;
          continue;
        }
        if (tl.kind === "ik" || tl.kind === "transform" || tl.kind === "path" || tl.kind === "physics" || tl.kind === "slider") {
          if (!("keys" in tl)) continue;
          const mix = sampleScalar(tl.keys, applyTime);
          addConstraint(tl.constraint ?? tl.path ?? String(slotOf(tl)), mix);
          if (tl.kind === "ik") pendingIk.set(slotOf(tl), clamp01(mix));
          wrote = true;
          continue;
        }
        if (tl.kind === "attachment") {
          if (additive) continue;
          const keys = tl.keys;
          if (keys === void 0 || keys.length === 0) continue;
          const index = slotOf(tl);
          if (track.mixingOutMix !== void 0 && (track.mixingOutMix >= (track.mixAttachmentThreshold ?? 0) || alpha < (track.alphaAttachmentThreshold ?? 0))) {
            if (!pendingAttachment.has(index)) pendingAttachment.set(index, slotSet.slots[index]?.data.attachment ?? null);
            continue;
          }
          if (track.mixingOutMix === void 0 && alpha < (track.alphaAttachmentThreshold ?? 0)) continue;
          const first = keys[0];
          if (first !== void 0 && isAttachmentKey(first)) {
            const key = keys[lastKeyIndex(keys, applyTime)];
            pendingAttachment.set(index, isAttachmentKey(key) ? key.name : String("value" in key ? key.value : ""));
          } else {
            pendingAttachment.set(index, String(sampleScalar(keys, curr)));
          }
          wrote = true;
          continue;
        }
        if (tl.kind === "color") {
          if (additive) continue;
          const keys = tl.keys;
          if (keys === void 0 || keys.length === 0) continue;
          const index = slotOf(tl);
          const sampled = sampleColorKeys(keys, applyTime, tl.channel);
          if (sampled.legacy !== null) {
            pendingLegacyColor.set(index, sampled.legacy);
          }
          const base = pendingColor.get(index) ?? {
            light: slotSet.slots[index]?.data.color ?? { r: 1, g: 1, b: 1, a: 1 },
            dark: slotSet.slots[index]?.data.dark ?? ZERO_DARK
          };
          pendingColor.set(index, applyColorChannels(base, sampled, tl.channel, alpha));
          if (tl.channel === "rgb2" || tl.channel === "rgba2" || tl.channel === "alpha2") darkSlots.add(index);
          wrote = true;
          continue;
        }
        if (tl.kind === "deform") {
          const keys = tl.keys;
          if (keys === void 0 || keys.length === 0) continue;
          const index = slotOf(tl);
          const first = keys[0];
          if (first !== void 0 && isDeformKey(first)) {
            const key = sampleDeformKeys(keys, applyTime, tl);
            accumulateDeform(deformOffsets, key, alpha, deformMeshKey(tl, index));
          } else {
            pendingDeform.set(index, sampleScalar(keys, curr));
          }
          wrote = true;
          continue;
        }
        if (tl.kind === "drawOrder") {
          if (additive || track.mixingOutMix !== void 0 && track.mixingOutMix >= (track.mixDrawOrderThreshold ?? 0)) continue;
          const keys = tl.keys;
          if (keys === void 0 || keys.length === 0) continue;
          const first = keys[0];
          if (first !== void 0 && isDrawOrderKey(first)) {
            const key = keys[lastKeyIndex(keys, applyTime)];
            drawOrderSpec = { kind: "order", order: applyDrawOffsets(setupDrawOrder(slotSet), key.offsets) };
          } else {
            const position = /^drawOrder\[(\d+)\]$/.exec(tl.path ?? "");
            if (position !== null) {
              drawOrderPositions.set(Number(position[1]), sampleStepped(keys, applyTime));
            } else {
              const shift = sampleScalar(keys, curr);
              drawOrderSpec = { kind: "shift", shift };
            }
          }
          wrote = true;
          continue;
        }
      }
      if (!additive && wrote) dominant = clip.name;
    }
    for (const [id, acc] of accs) {
      if (acc.rot !== void 0) setLocal(pose, id, CH_ROT, acc.rot);
      if (acc.x !== void 0) setLocal(pose, id, CH_X, acc.x);
      if (acc.y !== void 0) setLocal(pose, id, CH_Y, acc.y);
      if (acc.sx !== void 0) setLocal(pose, id, CH_SX, acc.sx);
      if (acc.sy !== void 0) setLocal(pose, id, CH_SY, acc.sy);
      if (acc.shx !== void 0) setLocal(pose, id, CH_SHX, acc.shx);
      if (acc.shy !== void 0) setLocal(pose, id, CH_SHY, acc.shy);
    }
    for (const [slot, attachment] of pendingAttachment) {
      if (slot >= 0 && slot < slotSet.slots.length) setSlotAttachment(slotSet, slot, attachment);
    }
    for (const [slot, packed] of pendingLegacyColor) {
      if (slot >= 0 && slot < slotSet.slots.length) setSlotColor(slotSet, slot, packed >>> 0);
    }
    for (const [slot, color] of pendingColor) {
      const state = slotSet.slots[slot];
      if (state !== void 0) state.color = color.light;
    }
    const baseOrder = setupDrawOrder(slotSet);
    if (drawOrderPositions.size > 0) {
      setDrawOrder(slotSet, baseOrder.map((slot, position) => drawOrderPositions.get(position) ?? slot));
    } else if (drawOrderSpec === null) {
      setDrawOrder(slotSet, baseOrder);
    } else if (drawOrderSpec.kind === "order") {
      setDrawOrder(slotSet, drawOrderSpec.order);
    } else {
      const n = slotSet.slots.length;
      if (n > 0) {
        const shift = (drawOrderSpec.shift % n + n) % n;
        setDrawOrder(slotSet, baseOrder.map((i) => (i + shift) % n));
      }
    }
    const colorDark = /* @__PURE__ */ new Map();
    for (const [slot, color] of pendingColor) {
      if (darkSlots.has(slot) || slotSet.slots[slot]?.data.dark !== void 0) colorDark.set(slot, color.dark);
    }
    return {
      events: eventData.map((event) => event.name),
      eventData,
      dominant,
      deform: pendingDeform,
      ik: pendingIk,
      deformOffsets,
      drawOrder: slotSet.drawOrder.slice(),
      constraintMix,
      constraintMixByName,
      constraintNames,
      sequence: pendingSequence,
      colorDark
    };
  }

  // ../packages/render-engine/src/constraint/constraint.ts
  var EPS_DIR = 1e-8;
  var MAX_STEP = 0.25;
  var ITERATION_CAP = 64;
  var PHYSICS_DT = 1 / 120;
  var PHYSICS_MAX_SUBSTEPS = 4;
  function clamp012(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }
  function lerp2(a, b, t) {
    return a + (b - a) * t;
  }
  function smoothstep01(t) {
    const x = clamp012(t);
    return x * x * (3 - 2 * x);
  }
  function finiteOr(v, fallback) {
    return v !== void 0 && Number.isFinite(v) ? v : fallback;
  }
  function bendDirectionOf(c) {
    const dir = c.bendDirection ?? c.bendSign ?? 1;
    return dir === -1 ? -1 : 1;
  }
  function ikTargetBone(c) {
    const target = c.targetBone ?? c.target;
    if (target === void 0) throw new Error("ik.targetBone");
    return target;
  }
  function transformSourceBone(c) {
    const source = c.sourceBone ?? c.target;
    if (source === void 0) throw new Error("constraint.sourceBone");
    return source;
  }
  function transformBones(c) {
    return c.bones !== void 0 && c.bones.length > 0 ? c.bones : [c.bone];
  }
  function worldChainLength(pose, bones) {
    const last = bones[bones.length - 1];
    let total = 0;
    for (let k = 0; k < bones.length - 1; k += 1) {
      const a = boneOrigin(pose, bones[k]);
      const b = boneOrigin(pose, bones[k + 1]);
      total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const origin = boneOrigin(pose, last);
    const tip = tipPoint(pose, last, pose.skeleton.bones[last].length);
    total += Math.hypot(tip[0] - origin[0], tip[1] - origin[1]);
    return total;
  }
  function scaleChainRoot(pose, root, factor, uniform) {
    if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 1e-9) return;
    const i = root * POSE_STRIDE;
    setLocal(pose, root, CH_SX, pose.local[i + CH_SX] * factor);
    if (uniform) setLocal(pose, root, CH_SY, pose.local[i + CH_SY] * factor);
    updateWorld(pose);
  }
  function cmpId(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function boneOrigin(pose, bone) {
    const o = bone * WORLD_STRIDE;
    return [pose.world[o + 4], pose.world[o + 5]];
  }
  function boneAngle(pose, bone) {
    const o = bone * WORLD_STRIDE;
    return Math.atan2(pose.world[o + 1], pose.world[o]);
  }
  function tipPoint(pose, bone, length) {
    const o = bone * WORLD_STRIDE;
    return [
      pose.world[o + 0] * length + pose.world[o + 4],
      pose.world[o + 1] * length + pose.world[o + 5]
    ];
  }
  function restAngle(skel, bone) {
    return skel.restLocal[bone * POSE_STRIDE + CH_ROT];
  }
  function parentAngleOf(pose, skel, bone) {
    const parent = skel.parent[bone];
    return parent < 0 ? 0 : boneAngle(pose, parent);
  }
  function limitOf(skel, bone) {
    const joint = skel.bones[bone].joint;
    if (!joint || joint.yoke !== null) return null;
    return [joint.min, joint.max];
  }
  function offsetWithin(skel, bone, offset) {
    const limit = limitOf(skel, bone);
    if (!limit) return true;
    const a = normalizeAngle(offset);
    return a >= limit[0] && a <= limit[1];
  }
  function clampOffset(skel, bone, offset) {
    const limit = limitOf(skel, bone);
    if (!limit) return offset;
    const a = normalizeAngle(offset);
    return a < limit[0] ? limit[0] : a > limit[1] ? limit[1] : a;
  }
  function clampChainLimits(pose, bones) {
    const skel = pose.skeleton;
    let changed = false;
    for (const bone of bones) {
      const limit = limitOf(skel, bone);
      if (!limit) continue;
      const current = getRotation(pose, bone);
      const normalized = normalizeAngle(current);
      if (normalized < limit[0]) {
        setLocal(pose, bone, CH_ROT, current + (limit[0] - normalized));
        changed = true;
      } else if (normalized > limit[1]) {
        setLocal(pose, bone, CH_ROT, current + (limit[1] - normalized));
        changed = true;
      }
    }
    if (changed) updateWorld(pose);
    return changed;
  }
  function chainBoneIds(skel, bone, chainLength) {
    if (!Number.isInteger(bone) || bone < 0 || bone >= skel.count) throw new Error("ik.bone");
    if (!Number.isFinite(chainLength)) throw new Error("ik.chainLength");
    const n = Math.floor(chainLength);
    if (n < 2) return null;
    const bones = [bone];
    let cursor = bone;
    for (let i = 1; i < n; i += 1) {
      const parent = skel.parent[cursor];
      if (parent < 0) return null;
      bones.unshift(parent);
      cursor = parent;
    }
    return bones;
  }
  function segmentLengths(skel, bones) {
    const lengths = [];
    for (let k = 0; k < bones.length; k += 1) {
      let length;
      if (k < bones.length - 1) {
        const child = skel.bones[bones[k + 1]];
        length = Math.hypot(child.rest.x, child.rest.y);
      } else {
        length = skel.bones[bones[k]].length;
      }
      if (!(length > 0) || !Number.isFinite(length)) return null;
      lengths.push(length);
    }
    return lengths;
  }
  function targetOf2(pose, targetBone) {
    if (!Number.isInteger(targetBone) || targetBone < 0 || targetBone >= pose.skeleton.count) {
      throw new Error("ik.targetBone");
    }
    const o = targetBone * WORLD_STRIDE;
    const x = pose.world[o + 4];
    const y = pose.world[o + 5];
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("ik.target");
    return [x, y];
  }
  function tipOfChain(pose, bones) {
    const last = bones[bones.length - 1];
    return tipPoint(pose, last, pose.skeleton.bones[last].length);
  }
  function residualOf(pose, target, bones) {
    const tip = tipOfChain(pose, bones);
    const residual = Math.hypot(tip[0] - target[0], tip[1] - target[1]);
    return Number.isFinite(residual) ? residual : Number.MAX_VALUE;
  }
  function aimSegments(pose, bones, angles) {
    updateWorld(pose);
    const before = bones.map((bone) => boneAngle(pose, bone));
    let accumulated = 0;
    for (let k = 0; k < bones.length; k += 1) {
      const delta2 = angleDelta(before[k] + accumulated, angles[k]);
      if (delta2 !== 0) addRotation(pose, bones[k], delta2);
      accumulated += delta2;
    }
    updateWorld(pose);
  }
  function validateIkConstraint(c) {
    if (!c || typeof c !== "object") throw new Error("ik.constraint");
    if (!Number.isFinite(c.tolerance) || c.tolerance <= 0) throw new Error("ik.tolerance");
    if (!Number.isFinite(c.maxIterations) || c.maxIterations < 1) throw new Error("ik.maxIterations");
    if (c.method !== "analytic" && c.method !== "ccd" && c.method !== "fabrik" && c.method !== "dls") throw new Error("ik.method");
    if (c.bendSign !== void 0 && c.bendSign !== 1 && c.bendSign !== -1) throw new Error("ik.bendSign");
    const dir = bendDirectionOf(c);
    if (dir !== 1 && dir !== -1) throw new Error("ik.bendDirection");
    ikTargetBone(c);
    if (c.softness !== void 0 && (!Number.isFinite(c.softness) || c.softness < 0)) throw new Error("ik.softness");
    for (const [name, value] of [
      ["compress", c.compress],
      ["stretch", c.stretch],
      ["mix", c.mix]
    ]) {
      if (value !== void 0 && (!Number.isFinite(value) || value < 0 || value > 1)) {
        throw new Error(`ik.${name}`);
      }
    }
    if (c.uniform !== void 0 && typeof c.uniform !== "boolean") throw new Error("ik.uniform");
  }
  function degenerateResult(pose, target, bone) {
    const origin = boneOrigin(pose, bone);
    const residual = Math.hypot(origin[0] - target[0], origin[1] - target[1]);
    return {
      reached: false,
      residual: Number.isFinite(residual) ? residual : Number.MAX_VALUE,
      iterations: 0,
      reason: "degenerate"
    };
  }
  function straighten(pose, bones, angle) {
    aimSegments(pose, bones, bones.map(() => angle));
  }
  function fold(pose, bones, angle, bendSign) {
    const angles = bones.map((_, k) => k === 0 ? angle : angle + bendSign * Math.PI);
    aimSegments(pose, bones, angles);
  }
  function solveAnalytic(pose, c, bones, lengths, target, distance, targetAngle) {
    if (bones.length !== 2) throw new Error("ik.analytic: chainLength must be 2");
    const skel = pose.skeleton;
    const root = bones[0];
    const mid = bones[1];
    const l1 = lengths[0];
    const l2 = lengths[1];
    const origin = boneOrigin(pose, root);
    const parentAngle = parentAngleOf(pose, skel, root);
    const bindRoot = restAngle(skel, root);
    const bindMid = restAngle(skel, mid);
    const cosine = (l1 * l1 + distance * distance - l2 * l2) / (2 * l1 * distance);
    const alpha = Math.acos(cosine < -1 ? -1 : cosine > 1 ? 1 : cosine);
    const makeCandidate = (sign) => {
      const a1 = targetAngle + sign * alpha;
      const kneeX = origin[0] + l1 * Math.cos(a1);
      const kneeY = origin[1] + l1 * Math.sin(a1);
      const a2 = Math.atan2(target[1] - kneeY, target[0] - kneeX);
      return {
        a1,
        a2,
        offRoot: normalizeAngle(a1 - parentAngle - bindRoot),
        offMid: normalizeAngle(a2 - a1 - bindMid)
      };
    };
    const bend = bendDirectionOf(c);
    const preferred = makeCandidate(bend);
    const opposite = makeCandidate(bend === 1 ? -1 : 1);
    let chosen = preferred;
    let forcedReason = "ok";
    if (!offsetWithin(skel, root, preferred.offRoot) || !offsetWithin(skel, mid, preferred.offMid)) {
      if (offsetWithin(skel, root, opposite.offRoot) && offsetWithin(skel, mid, opposite.offMid)) {
        chosen = opposite;
      } else {
        const a1 = parentAngle + bindRoot + clampOffset(skel, root, preferred.offRoot);
        const a2 = a1 + bindMid + clampOffset(skel, mid, preferred.offMid);
        aimSegments(pose, bones, [a1, a2]);
        forcedReason = "limit";
      }
    }
    if (forcedReason === "ok") aimSegments(pose, bones, [chosen.a1, chosen.a2]);
    const residual = residualOf(pose, target, bones);
    return {
      reached: residual <= c.tolerance,
      residual,
      iterations: 1,
      reason: forcedReason === "limit" ? "limit" : "ok"
    };
  }
  function solveSpineIk(pose, c) {
    const sk = pose.skeleton;
    const child = c.bone;
    const parent = c.chainLength === 2 ? sk.parent[child] : child;
    const grandparent = sk.parent[parent];
    const target = targetOf2(pose, ikTargetBone(c));
    if (parent < 0 || grandparent < 0) return degenerateResult(pose, target, child);
    if (c.chainLength === 2 && (sk.inherit[parent] !== "normal" || sk.inherit[child] !== "normal")) {
      const residual2 = residualOf(pose, target, [parent, child]);
      return { reached: residual2 <= c.tolerance, residual: residual2, iterations: 0, reason: "ok" };
    }
    const mix = clamp012((c.mix ?? 1) * c.weight);
    const pi = parent * POSE_STRIDE, gi = grandparent * WORLD_STRIDE;
    const px = pose.local[pi + CH_X], py = pose.local[pi + CH_Y];
    const psx0 = pose.local[pi + CH_SX], psy0 = pose.local[pi + CH_SY];
    const w = pose.world;
    const a0 = w[gi], b0 = w[gi + 2], c0 = w[gi + 1], d0 = w[gi + 3];
    const det = a0 * d0 - b0 * c0;
    const inverse = Math.abs(det) <= 1e-8 ? 0 : 1 / det;
    const tx0 = target[0] - w[gi + 4], ty0 = target[1] - w[gi + 5];
    let tx = (tx0 * d0 - ty0 * b0) * inverse - px;
    let ty = (ty0 * a0 - tx0 * c0) * inverse - py;
    if (c.chainLength === 1) {
      let delta2 = Math.atan2(ty, tx) - pose.local[pi + CH_SHX] - pose.local[pi + CH_ROT];
      if (psx0 < 0) delta2 += Math.PI;
      addRotation(pose, parent, normalizeAngle(delta2) * mix);
      const length = sk.bones[parent].length * psx0;
      const distance2 = tx * tx + ty * ty;
      if (length > 1e-8 && (c.compress && distance2 < length * length || c.stretch && distance2 > length * length)) {
        const factor = (Math.sqrt(distance2) / length - 1) * mix + 1;
        setLocal(pose, parent, CH_SX, psx0 * factor);
        if (c.uniform) setLocal(pose, parent, CH_SY, psy0 * factor);
      }
      updateWorld(pose);
      const residual2 = residualOf(pose, target, [parent]);
      return { reached: residual2 <= c.tolerance, residual: residual2, iterations: 1, reason: "ok" };
    }
    const ci = child * POSE_STRIDE, wi = parent * WORLD_STRIDE;
    const psx = Math.abs(psx0), psy = Math.abs(psy0), csx = Math.abs(pose.local[ci + CH_SX]);
    const os1 = psx0 < 0 ? Math.PI : 0;
    const os2 = pose.local[ci + CH_SX] < 0 ? Math.PI : 0;
    const s2 = (psx0 < 0 ? -1 : 1) * (psy0 < 0 ? -1 : 1);
    const uniform = Math.abs(psx - psy) <= 1e-8;
    const cx = pose.local[ci + CH_X];
    let cy = pose.local[ci + CH_Y];
    if (!uniform || c.stretch) {
      cy = 0;
      setLocal(pose, child, CH_Y, 0);
    }
    const cwx = w[wi] * cx + w[wi + 2] * cy + w[wi + 4];
    const cwy = w[wi + 1] * cx + w[wi + 3] * cy + w[wi + 5];
    const lx = cwx - w[gi + 4], ly = cwy - w[gi + 5];
    const dx = (lx * d0 - ly * b0) * inverse - px;
    const dy = (ly * a0 - lx * c0) * inverse - py;
    const l1 = Math.hypot(dx, dy);
    let l2 = sk.bones[child].length * csx;
    if (l1 < 1e-8) return degenerateResult(pose, target, child);
    let dd = tx * tx + ty * ty;
    let softness = c.softness ?? 0;
    if (softness !== 0) {
      softness *= psx * (csx + 1) * 0.5;
      const td = Math.sqrt(dd), sd = td - l1 - l2 * psx + softness;
      if (sd > 0 && td > 0) {
        let p = Math.min(1, sd / (softness * 2)) - 1;
        p = (sd - softness * (1 - p * p)) / td;
        tx -= p * tx;
        ty -= p * ty;
        dd = tx * tx + ty * ty;
      }
    }
    const bend = bendDirectionOf(c);
    let a1 = 0, a2 = 0;
    if (uniform) {
      l2 *= psx;
      const cos = Math.max(-1, Math.min(1, (dd - l1 * l1 - l2 * l2) / (2 * l1 * l2)));
      a2 = Math.acos(cos) * bend;
      if (c.stretch && dd > (l1 + l2) ** 2) {
        const factor = (Math.sqrt(dd) / (l1 + l2) - 1) * mix + 1;
        setLocal(pose, parent, CH_SX, psx0 * factor);
        if (c.uniform) setLocal(pose, parent, CH_SY, psy0 * factor);
      }
      const a = l1 + l2 * cos, b = l2 * Math.sin(a2);
      a1 = Math.atan2(ty * a - tx * b, tx * a + ty * b);
    } else {
      const a = psx * l2, b = psy * l2, aa = a * a, bb = b * b, ta = Math.atan2(ty, tx);
      const cc = bb * l1 * l1 + aa * dd - aa * bb;
      const c1 = -2 * bb * l1, c2 = bb - aa, disc = c1 * c1 - 4 * c2 * cc;
      let solved = false;
      if (disc >= 0) {
        let q = Math.sqrt(disc);
        if (c1 < 0) q = -q;
        q = -(c1 + q) * 0.5;
        const r0 = q / c2, r1 = cc / q;
        const r = Math.abs(r0) < Math.abs(r1) ? r0 : r1;
        const other = dd - r * r;
        if (other >= 0) {
          const y = Math.sqrt(other) * bend;
          a1 = ta - Math.atan2(y, r);
          a2 = Math.atan2(y / psy, (r - l1) / psx);
          solved = true;
        }
      }
      if (!solved) {
        let minAngle = Math.PI, minX = l1 - a, minDist = minX * minX, minY = 0;
        let maxAngle = 0, maxX = l1 + a, maxDist = maxX * maxX, maxY = 0;
        let candidate = -a * l1 / (aa - bb);
        if (candidate >= -1 && candidate <= 1) {
          candidate = Math.acos(candidate);
          const x = a * Math.cos(candidate) + l1, y = b * Math.sin(candidate), dist = x * x + y * y;
          if (dist < minDist) {
            minAngle = candidate;
            minDist = dist;
            minX = x;
            minY = y;
          }
          if (dist > maxDist) {
            maxAngle = candidate;
            maxDist = dist;
            maxX = x;
            maxY = y;
          }
        }
        if (dd <= (minDist + maxDist) * 0.5) {
          a1 = ta - Math.atan2(minY * bend, minX);
          a2 = minAngle * bend;
        } else {
          a1 = ta - Math.atan2(maxY * bend, maxX);
          a2 = maxAngle * bend;
        }
      }
    }
    const os = Math.atan2(cy, cx) * s2;
    addRotation(pose, parent, normalizeAngle(a1 - os + os1 - pose.local[pi + CH_ROT]) * mix);
    addRotation(pose, child, normalizeAngle((a2 + os) * s2 + os2 - pose.local[ci + CH_SHX] * s2 - pose.local[ci + CH_ROT]) * mix);
    updateWorld(pose);
    const residual = residualOf(pose, target, [parent, child]);
    return { reached: residual <= c.tolerance, residual, iterations: 1, reason: "ok" };
  }
  function solveCcd(pose, c, bones, target) {
    const last = bones[bones.length - 1];
    const length = pose.skeleton.bones[last].length;
    const cap = Math.min(Math.max(1, Math.floor(c.maxIterations)), ITERATION_CAP);
    let iterations = 0;
    let converged = false;
    for (let it = 0; it < cap; it += 1) {
      iterations = it + 1;
      for (let j = bones.length - 1; j >= 0; j -= 1) {
        updateWorld(pose);
        const joint = boneOrigin(pose, bones[j]);
        const tip = tipPoint(pose, last, length);
        const ax = tip[0] - joint[0];
        const ay = tip[1] - joint[1];
        const bx = target[0] - joint[0];
        const by = target[1] - joint[1];
        const la = Math.hypot(ax, ay);
        const lb = Math.hypot(bx, by);
        if (la < EPS_DIR || lb < EPS_DIR) continue;
        let delta2 = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
        delta2 = delta2 > MAX_STEP ? MAX_STEP : delta2 < -MAX_STEP ? -MAX_STEP : delta2;
        if (delta2 !== 0) addRotation(pose, bones[j], delta2);
        if (residualOf(pose, target, bones) <= c.tolerance) {
          converged = true;
          break;
        }
      }
      if (converged) break;
    }
    const limited = clampChainLimits(pose, bones);
    const residual = residualOf(pose, target, bones);
    return {
      reached: residual <= c.tolerance,
      residual,
      iterations,
      reason: limited ? "limit" : converged ? "ok" : "maxIterations"
    };
  }
  function solveFabrik(pose, c, bones, lengths, target) {
    const n = bones.length;
    const last = bones[n - 1];
    const length = pose.skeleton.bones[last].length;
    updateWorld(pose);
    const points = [];
    for (const bone of bones) points.push(...boneOrigin(pose, bone));
    points.push(...tipPoint(pose, last, length));
    const rootX = points[0];
    const rootY = points[1];
    const cap = Math.min(Math.max(1, Math.floor(c.maxIterations)), ITERATION_CAP);
    let iterations = 0;
    let converged = false;
    for (let it = 0; it < cap; it += 1) {
      iterations = it + 1;
      points[n * 2] = target[0];
      points[n * 2 + 1] = target[1];
      for (let i = n - 1; i >= 0; i -= 1) {
        let dx2 = points[i * 2] - points[(i + 1) * 2];
        let dy2 = points[i * 2 + 1] - points[(i + 1) * 2 + 1];
        let d = Math.hypot(dx2, dy2);
        if (d < EPS_DIR) {
          dx2 = 1;
          dy2 = 0;
          d = 1;
        }
        const scale = lengths[i] / d;
        points[i * 2] = points[(i + 1) * 2] + dx2 * scale;
        points[i * 2 + 1] = points[(i + 1) * 2 + 1] + dy2 * scale;
      }
      points[0] = rootX;
      points[1] = rootY;
      for (let i = 1; i <= n; i += 1) {
        let dx2 = points[i * 2] - points[(i - 1) * 2];
        let dy2 = points[i * 2 + 1] - points[(i - 1) * 2 + 1];
        let d = Math.hypot(dx2, dy2);
        if (d < EPS_DIR) {
          dx2 = 1;
          dy2 = 0;
          d = 1;
        }
        const scale = lengths[i - 1] / d;
        points[i * 2] = points[(i - 1) * 2] + dx2 * scale;
        points[i * 2 + 1] = points[(i - 1) * 2 + 1] + dy2 * scale;
      }
      const dx = points[n * 2] - target[0];
      const dy = points[n * 2 + 1] - target[1];
      if (Math.hypot(dx, dy) <= c.tolerance) {
        converged = true;
        break;
      }
    }
    const angles = [];
    for (let k = 0; k < n; k += 1) {
      angles.push(Math.atan2(
        points[(k + 1) * 2 + 1] - points[k * 2 + 1],
        points[(k + 1) * 2] - points[k * 2]
      ));
    }
    aimSegments(pose, bones, angles);
    const limited = clampChainLimits(pose, bones);
    const residual = residualOf(pose, target, bones);
    return {
      reached: residual <= c.tolerance,
      residual,
      iterations,
      reason: limited ? "limit" : converged ? "ok" : "maxIterations"
    };
  }
  function solveIk(pose, c) {
    validateIkConstraint(c);
    const skel = pose.skeleton;
    updateWorld(pose);
    if (c.spine && (c.chainLength === 1 || c.chainLength === 2)) return solveSpineIk(pose, c);
    let target = targetOf2(pose, ikTargetBone(c));
    const bones = chainBoneIds(skel, c.bone, c.chainLength);
    if (!bones) return degenerateResult(pose, target, c.bone);
    const restLengths = segmentLengths(skel, bones);
    if (!restLengths) return degenerateResult(pose, target, c.bone);
    const mix = clamp012(c.mix ?? 1);
    const beforeRotations = mix < 1 ? bones.map((bone) => getRotation(pose, bone)) : null;
    const rootIndex = bones[0] * POSE_STRIDE;
    const beforeSx = pose.local[rootIndex + CH_SX];
    const beforeSy = pose.local[rootIndex + CH_SY];
    let origin = boneOrigin(pose, bones[0]);
    let dx = target[0] - origin[0];
    let dy = target[1] - origin[1];
    let distance = Math.hypot(dx, dy);
    if (!Number.isFinite(distance) || distance < EPS_DIR) {
      return degenerateResult(pose, target, c.bone);
    }
    const total = restLengths.reduce((sum, v) => sum + v, 0);
    const longest = restLengths.reduce((max, v) => v > max ? v : max, 0);
    const minimum = Math.max(0, 2 * longest - total);
    const stretch = clamp012(c.stretch ?? 0);
    const compress = clamp012(c.compress ?? 0);
    const softness = clamp012(c.softness ?? 0);
    const tolerance = c.tolerance;
    let targetAngle = Math.atan2(dy, dx);
    let currentTotal = worldChainLength(pose, bones);
    let effectiveScale = total > EPS_DIR && currentTotal > EPS_DIR ? currentTotal / total : 1;
    if (distance > total + tolerance) {
      if (stretch <= 0) {
        straighten(pose, bones, targetAngle);
        return { reached: false, residual: residualOf(pose, target, bones), iterations: 0, reason: "unreachable" };
      }
      const desiredTotal = total + (distance - total) * stretch;
      const increment = currentTotal > EPS_DIR ? desiredTotal / currentTotal : 1;
      scaleChainRoot(pose, bones[0], increment, c.uniform === true);
      effectiveScale *= increment;
    } else if (distance < minimum - tolerance) {
      if (compress <= 0 || minimum <= EPS_DIR) {
        fold(pose, bones, targetAngle, bendDirectionOf(c));
        return { reached: false, residual: residualOf(pose, target, bones), iterations: 0, reason: "unreachable" };
      }
      const desiredMin = minimum + (distance - minimum) * compress;
      const desiredTotal = total * (desiredMin / minimum);
      const increment = currentTotal > EPS_DIR ? desiredTotal / currentTotal : 1;
      scaleChainRoot(pose, bones[0], increment, c.uniform === true);
      effectiveScale *= increment;
    }
    if (Math.abs(effectiveScale - 1) > 1e-9) {
      updateWorld(pose);
      target = targetOf2(pose, ikTargetBone(c));
      origin = boneOrigin(pose, bones[0]);
      dx = target[0] - origin[0];
      dy = target[1] - origin[1];
      distance = Math.hypot(dx, dy);
      targetAngle = Math.atan2(dy, dx);
      if (!Number.isFinite(distance) || distance < EPS_DIR) {
        return degenerateResult(pose, target, c.bone);
      }
    }
    const effectiveLengths = restLengths.map((v) => v * effectiveScale);
    const effectiveTotal = total * effectiveScale;
    const effectiveMin = minimum * effectiveScale;
    if (distance > effectiveTotal + tolerance) {
      straighten(pose, bones, targetAngle);
      return { reached: false, residual: residualOf(pose, target, bones), iterations: 0, reason: "unreachable" };
    }
    if (distance < effectiveMin - tolerance) {
      fold(pose, bones, targetAngle, bendDirectionOf(c));
      return { reached: false, residual: residualOf(pose, target, bones), iterations: 0, reason: "unreachable" };
    }
    let aimDistance = distance;
    if (softness > 0 && effectiveTotal > EPS_DIR) {
      const zone = Math.max(effectiveTotal * 0.1, 1e-9);
      const near = clamp012((distance - (effectiveTotal - zone)) / zone);
      aimDistance = distance - softness * zone * smoothstep01(near);
      if (aimDistance < effectiveMin) aimDistance = effectiveMin;
      if (aimDistance > effectiveTotal) aimDistance = effectiveTotal;
    }
    const inv = 1 / distance;
    const aimTarget = [origin[0] + dx * inv * aimDistance, origin[1] + dy * inv * aimDistance];
    let result;
    if (c.method === "analytic") {
      result = solveAnalytic(pose, c, bones, effectiveLengths, aimTarget, aimDistance, targetAngle);
    } else if (c.method === "ccd") {
      result = solveCcd(pose, c, bones, aimTarget);
    } else if (c.method === "dls") {
      result = solveDls(pose, c, bones, aimTarget);
    } else {
      result = solveFabrik(pose, c, bones, effectiveLengths, aimTarget);
    }
    if (mix < 1 && beforeRotations !== null) {
      for (let k = 0; k < bones.length; k += 1) {
        const after = getRotation(pose, bones[k]);
        const before = beforeRotations[k];
        setLocal(pose, bones[k], CH_ROT, before + angleDelta(before, after) * mix);
      }
      const afterSx = pose.local[rootIndex + CH_SX];
      setLocal(pose, bones[0], CH_SX, beforeSx + (afterSx - beforeSx) * mix);
      if (c.uniform === true) {
        const afterSy = pose.local[rootIndex + CH_SY];
        setLocal(pose, bones[0], CH_SY, beforeSy + (afterSy - beforeSy) * mix);
      }
      updateWorld(pose);
    }
    const residual = residualOf(pose, target, bones);
    return { ...result, residual, reached: residual <= tolerance };
  }
  function solveDls(pose, c, bones, target) {
    const n = bones.length;
    const cap = Math.min(Math.max(1, Math.floor(c.maxIterations)), ITERATION_CAP);
    const h = 1e-3;
    const lambda2 = 1e-4;
    let iterations = 0;
    let converged = false;
    for (let it = 0; it < cap; it += 1) {
      iterations = it + 1;
      updateWorld(pose);
      const tip = tipOfChain(pose, bones);
      const ex = target[0] - tip[0];
      const ey = target[1] - tip[1];
      if (Math.hypot(ex, ey) <= c.tolerance) {
        converged = true;
        break;
      }
      const jac = new Float64Array(n * 2);
      for (let j = 0; j < n; j += 1) {
        addRotation(pose, bones[j], h);
        updateWorld(pose);
        const moved = tipOfChain(pose, bones);
        jac[j * 2] = (moved[0] - tip[0]) / h;
        jac[j * 2 + 1] = (moved[1] - tip[1]) / h;
        addRotation(pose, bones[j], -h);
        updateWorld(pose);
      }
      let a = lambda2;
      let b = 0;
      let d = lambda2;
      for (let j = 0; j < n; j += 1) {
        const jx = jac[j * 2];
        const jy = jac[j * 2 + 1];
        a += jx * jx;
        b += jx * jy;
        d += jy * jy;
      }
      const det = a * d - b * b;
      if (!Number.isFinite(det) || Math.abs(det) < 1e-14) {
        for (let j = 0; j < n; j += 1) {
          let delta2 = 0.25 * (jac[j * 2] * ex + jac[j * 2 + 1] * ey);
          delta2 = delta2 > MAX_STEP ? MAX_STEP : delta2 < -MAX_STEP ? -MAX_STEP : delta2;
          if (delta2 !== 0) addRotation(pose, bones[j], delta2);
        }
        continue;
      }
      const yx = (d * ex - b * ey) / det;
      const yy = (-b * ex + a * ey) / det;
      for (let j = 0; j < n; j += 1) {
        let delta2 = jac[j * 2] * yx + jac[j * 2 + 1] * yy;
        delta2 = delta2 > MAX_STEP ? MAX_STEP : delta2 < -MAX_STEP ? -MAX_STEP : delta2;
        if (delta2 !== 0) addRotation(pose, bones[j], delta2);
      }
    }
    const limited = clampChainLimits(pose, bones);
    const residual = residualOf(pose, target, bones);
    return {
      reached: residual <= c.tolerance,
      residual,
      iterations,
      reason: limited ? "limit" : converged ? "ok" : "maxIterations"
    };
  }
  function orderedConstraints(constraints) {
    return constraints.slice().sort((a, b) => a.order - b.order || cmpId(a.id, b.id));
  }
  function detectCycles(graph) {
    const color = /* @__PURE__ */ new Map();
    const visit = (node) => {
      color.set(node, 1);
      for (const next of graph.get(node) ?? []) {
        if (color.get(next) === 1) throw new Error(`constraint.cycle: bone ${node} -> ${next}`);
        if (!color.has(next)) visit(next);
      }
      color.set(node, 2);
    };
    for (const node of graph.keys()) {
      if (!color.has(node)) visit(node);
    }
  }
  function addEdge(graph, from, to) {
    if (from === to) throw new Error(`constraint.cycle: self bone ${from}`);
    let edges = graph.get(from);
    if (!edges) {
      edges = /* @__PURE__ */ new Set();
      graph.set(from, edges);
    }
    edges.add(to);
  }
  function pathBones(c) {
    return c.bones !== void 0 && c.bones.length > 0 ? c.bones : [c.bone];
  }
  function checkCreationCycles(list) {
    const graph = /* @__PURE__ */ new Map();
    for (const c of list) {
      if (!c.enabled || c.weight === 0) continue;
      if (c.kind === "transform") {
        for (const bone of transformBones(c)) addEdge(graph, bone, transformSourceBone(c));
      } else if (c.kind === "ik") {
        const target = ikTargetBone(c);
        if (target === c.bone) throw new Error("constraint.cycle: ik target inside chain");
        addEdge(graph, c.bone, target);
      } else if (c.kind === "path") {
        if (c.targetBone !== void 0) {
          for (const bone of pathBones(c)) addEdge(graph, bone, c.targetBone);
        }
      } else if (c.kind === "physics") {
        if (c.target !== void 0) addEdge(graph, c.bone, c.target);
      }
    }
    detectCycles(graph);
  }
  function checkSolveCycles(list, skel) {
    const graph = /* @__PURE__ */ new Map();
    for (const c of list) {
      if (!c.enabled || c.weight === 0) continue;
      if (c.kind === "transform") {
        for (const bone of transformBones(c)) addEdge(graph, bone, transformSourceBone(c));
      } else if (c.kind === "ik") {
        const bones = chainBoneIds(skel, c.bone, c.chainLength);
        const target = ikTargetBone(c);
        if (bones) {
          if (bones.includes(target)) throw new Error("constraint.cycle: ik target inside chain");
          for (const bone of bones) addEdge(graph, bone, target);
        }
      } else if (c.kind === "path") {
        if (c.targetBone !== void 0) {
          if (pathBones(c).includes(c.targetBone)) throw new Error("constraint.cycle: path target inside bones");
          for (const bone of pathBones(c)) addEdge(graph, bone, c.targetBone);
        }
      } else if (c.kind === "physics") {
        if (c.target !== void 0) addEdge(graph, c.bone, c.target);
      }
    }
    detectCycles(graph);
  }
  function transformTargetValues(pose, c) {
    const skel = pose.skeleton;
    const src = transformSourceBone(c);
    const si = src * POSE_STRIDE;
    if (c.local !== false) {
      return {
        rot: pose.local[si + CH_ROT],
        x: pose.local[si + CH_X],
        y: pose.local[si + CH_Y],
        sx: pose.local[si + CH_SX],
        sy: pose.local[si + CH_SY],
        shy: pose.local[si + CH_SHY]
      };
    }
    updateWorld(pose);
    const parent = skel.parent[c.bone];
    const worldAngle = boneAngle(pose, src);
    const parentAngle = parent < 0 ? 0 : boneAngle(pose, parent);
    let x = pose.world[src * WORLD_STRIDE + 4];
    let y = pose.world[src * WORLD_STRIDE + 5];
    if (parent >= 0) {
      const matrix = createAffine();
      for (let k = 0; k < WORLD_STRIDE; k += 1) matrix[k] = pose.world[parent * WORLD_STRIDE + k];
      const inverse = invertAffine(matrix);
      if (inverse) {
        const wx = x;
        const wy = y;
        x = inverse[0] * wx + inverse[2] * wy + inverse[4];
        y = inverse[1] * wx + inverse[3] * wy + inverse[5];
      }
    }
    const parentSx = parent < 0 ? 1 : Math.hypot(
      pose.world[parent * WORLD_STRIDE],
      pose.world[parent * WORLD_STRIDE + 1]
    );
    const parentSy = parent < 0 ? 1 : Math.hypot(
      pose.world[parent * WORLD_STRIDE + 2],
      pose.world[parent * WORLD_STRIDE + 3]
    );
    const srcSx = Math.hypot(
      pose.world[src * WORLD_STRIDE],
      pose.world[src * WORLD_STRIDE + 1]
    );
    const srcSy = Math.hypot(
      pose.world[src * WORLD_STRIDE + 2],
      pose.world[src * WORLD_STRIDE + 3]
    );
    return {
      rot: worldAngle - parentAngle,
      x,
      y,
      sx: Math.abs(parentSx) > EPS_DIR ? srcSx / parentSx : 1,
      sy: Math.abs(parentSy) > EPS_DIR ? srcSy / parentSy : 1,
      shy: pose.local[si + CH_SHY]
    };
  }
  function writeMappedWorld(pose, bone, world) {
    const parent = pose.skeleton.parent[bone];
    const local = createAffine();
    if (parent < 0) local.set(world);
    else {
      const basis = createAffine();
      for (let k = 0; k < WORLD_STRIDE; k += 1) basis[k] = pose.world[parent * WORLD_STRIDE + k];
      parentBasis(pose.skeleton.inherit[bone], basis, basis);
      const inverse = invertAffine(basis);
      if (!inverse) throw new Error("constraint.worldToLocal: singular parent");
      const a = inverse[0], b = inverse[1], c = inverse[2], d = inverse[3];
      local[0] = a * world[0] + c * world[1];
      local[1] = b * world[0] + d * world[1];
      local[2] = a * world[2] + c * world[3];
      local[3] = b * world[2] + d * world[3];
      local[4] = a * world[4] + c * world[5] + inverse[4];
      local[5] = b * world[4] + d * world[5] + inverse[5];
    }
    const i = bone * POSE_STRIDE;
    const shearX = pose.local[i + CH_SHX];
    const xLength = Math.hypot(local[0], local[1]);
    const yLength = Math.hypot(local[2], local[3]);
    const sxSign = pose.local[i + CH_SX] < 0 ? -1 : 1;
    const sySign = pose.local[i + CH_SY] < 0 ? -1 : 1;
    const sx = xLength * sxSign;
    const rot = xLength > EPS_DIR ? Math.atan2(local[1] * sxSign, local[0] * sxSign) - shearX : yLength > EPS_DIR ? Math.atan2(-local[2] * sySign, local[3] * sySign) - pose.local[i + CH_SHY] : pose.local[i + CH_ROT];
    const sy = yLength * sySign;
    setLocal(pose, bone, CH_X, local[4]);
    setLocal(pose, bone, CH_Y, local[5]);
    setLocal(pose, bone, CH_ROT, rot);
    setLocal(pose, bone, CH_SX, sx);
    setLocal(pose, bone, CH_SY, sy);
    setLocal(pose, bone, CH_SHY, yLength > EPS_DIR ? Math.atan2(-local[2] * sySign, local[3] * sySign) - rot : pose.local[i + CH_SHY]);
  }
  function applyTransform(pose, c) {
    if (c.properties !== void 0) {
      const src2 = transformSourceBone(c);
      if (!Number.isInteger(src2) || src2 < 0 || src2 >= pose.skeleton.count) throw new Error("constraint.sourceBone");
      const channels = {
        rotate: CH_ROT,
        x: CH_X,
        y: CH_Y,
        scaleX: CH_SX,
        scaleY: CH_SY,
        shearY: CH_SHY
      };
      const offsets = c.offsets ?? [0, 0, 0, 0, 0, 0];
      const offsetOf = {
        rotate: 0,
        x: 1,
        y: 2,
        scaleX: 3,
        scaleY: 4,
        shearY: 5
      };
      const mixOf = {
        rotate: finiteOr(c.mixRotate, finiteOr(c.mixRotation, 1)),
        x: finiteOr(c.mixX, finiteOr(c.mixTranslation, 1)),
        y: finiteOr(c.mixY, finiteOr(c.mixTranslation, 1)),
        scaleX: finiteOr(c.mixScaleX, 0),
        scaleY: finiteOr(c.mixScaleY, 0),
        shearY: finiteOr(c.mixShearY, 0)
      };
      const localSource = c.localSource ?? c.local !== false;
      const localTarget = c.localTarget ?? c.local !== false;
      const additive = c.additive ?? c.relative === true;
      for (const bone of transformBones(c)) {
        if (!Number.isInteger(bone) || bone < 0 || bone >= pose.skeleton.count) throw new Error("constraint.bone");
        updateWorld(pose);
        const matrix = createAffine();
        for (let k = 0; k < WORLD_STRIDE; k += 1) matrix[k] = pose.world[bone * WORLD_STRIDE + k];
        let worldChanged = false;
        for (let f = 0; f < c.properties.length; f += 1) {
          const from = c.properties[f];
          const si = src2 * POSE_STRIDE;
          const so = src2 * WORLD_STRIDE;
          const sx = pose.world[so], sy = pose.world[so + 1];
          const bx = pose.world[so + 2], by = pose.world[so + 3];
          const ox = offsets[1] ?? 0, oy = offsets[2] ?? 0;
          let sourceValue;
          if (localSource) sourceValue = pose.local[si + channels[from.kind]] + (offsets[offsetOf[from.kind]] ?? 0);
          else if (from.kind === "rotate") {
            sourceValue = Math.atan2(sy, sx) + (sx * by - bx * sy > 0 ? 1 : -1) * (offsets[0] ?? 0);
            if (sourceValue < 0) sourceValue += Math.PI * 2;
          } else if (from.kind === "x") sourceValue = sx * ox + bx * oy + pose.world[so + 4];
          else if (from.kind === "y") sourceValue = sy * ox + by * oy + pose.world[so + 5];
          else if (from.kind === "scaleX") sourceValue = Math.hypot(sx, sy) + (offsets[3] ?? 0);
          else if (from.kind === "scaleY") sourceValue = Math.hypot(bx, by) + (offsets[4] ?? 0);
          else sourceValue = Math.atan2(by, bx) - Math.atan2(sy, sx) - Math.PI / 2 + (offsets[5] ?? 0);
          const value = sourceValue - from.offset;
          for (let t = 0; t < from.to.length; t += 1) {
            const to = from.to[t];
            const mix = c.weight * mixOf[to.kind];
            if (mix === 0) continue;
            let desired = to.offset + value * to.scale;
            if (c.clamp === true) desired = Math.max(Math.min(to.offset, to.max), Math.min(Math.max(to.offset, to.max), desired));
            if (localTarget) {
              const index = bone * POSE_STRIDE + channels[to.kind];
              const current = pose.local[index];
              if (to.kind === "scaleX" || to.kind === "scaleY") {
                if (additive) desired = current * (1 + (desired - 1) * mix);
                else if (current !== 0) desired = current + (desired - current) * mix;
                else continue;
              } else desired = current + (additive ? desired : desired - current) * mix;
              setLocal(pose, bone, channels[to.kind], desired);
              continue;
            }
            worldChanged = true;
            if (to.kind === "x" || to.kind === "y") {
              const index = to.kind === "x" ? 4 : 5;
              matrix[index] = matrix[index] + (additive ? desired : desired - matrix[index]) * mix;
            } else if (to.kind === "rotate") {
              let angle = additive ? desired : desired - Math.atan2(matrix[1], matrix[0]);
              if (angle > Math.PI) angle -= 2 * Math.PI;
              else if (angle < -Math.PI) angle += 2 * Math.PI;
              angle *= mix;
              const cos = Math.cos(angle), sin = Math.sin(angle);
              const a = matrix[0], b = matrix[2], cc = matrix[1], d = matrix[3];
              matrix[0] = cos * a - sin * cc;
              matrix[2] = cos * b - sin * d;
              matrix[1] = sin * a + cos * cc;
              matrix[3] = sin * b + cos * d;
            } else if (to.kind === "scaleX" || to.kind === "scaleY") {
              const x = to.kind === "scaleX" ? 0 : 2, y = x + 1;
              const length = Math.hypot(matrix[x], matrix[y]);
              if (additive || length !== 0) {
                const factor = additive ? 1 + (desired - 1) * mix : 1 + (desired - length) * mix / length;
                matrix[x] = matrix[x] * factor;
                matrix[y] = matrix[y] * factor;
              }
            } else {
              const angleY = Math.atan2(matrix[3], matrix[2]);
              let angle = additive ? desired : desired + Math.PI / 2 - angleY + Math.atan2(matrix[1], matrix[0]);
              if (!additive) {
                if (angle > Math.PI) angle -= 2 * Math.PI;
                else if (angle < -Math.PI) angle += 2 * Math.PI;
              }
              const result = angleY + angle * mix;
              const length = Math.hypot(matrix[2], matrix[3]);
              matrix[2] = Math.cos(result) * length;
              matrix[3] = Math.sin(result) * length;
            }
          }
        }
        if (worldChanged) writeMappedWorld(pose, bone, matrix);
      }
      return;
    }
    const src = transformSourceBone(c);
    if (!Number.isInteger(src) || src < 0 || src >= pose.skeleton.count) throw new Error("constraint.sourceBone");
    const weight = clamp012(c.weight);
    if (finiteOr(c.mixRotate, finiteOr(c.mixRotation, 1)) === 0 && finiteOr(c.mixX, finiteOr(c.mixTranslation, 1)) === 0 && finiteOr(c.mixY, finiteOr(c.mixTranslation, 1)) === 0 && finiteOr(c.mixScaleX, 0) === 0 && finiteOr(c.mixScaleY, 0) === 0 && finiteOr(c.mixShearY, 0) === 0) return;
    if (c.local === false && c.relative !== true && finiteOr(c.mixRotate, finiteOr(c.mixRotation, 1)) === 0 && finiteOr(c.mixScaleX, 0) === 0 && finiteOr(c.mixScaleY, 0) === 0 && finiteOr(c.mixShearY, 0) === 0) {
      for (const bone of transformBones(c)) {
        updateWorld(pose);
        const targetOffset = src * WORLD_STRIDE;
        const tx = pose.world[targetOffset] * finiteOr(c.offsetX, 0) + pose.world[targetOffset + 2] * finiteOr(c.offsetY, 0) + pose.world[targetOffset + 4];
        const ty = pose.world[targetOffset + 1] * finiteOr(c.offsetX, 0) + pose.world[targetOffset + 3] * finiteOr(c.offsetY, 0) + pose.world[targetOffset + 5];
        const offset = bone * WORLD_STRIDE;
        const matrix = createAffine();
        for (let k = 0; k < WORLD_STRIDE; k += 1) matrix[k] = pose.world[offset + k];
        matrix[4] = matrix[4] + (tx - matrix[4]) * weight * finiteOr(c.mixX, finiteOr(c.mixTranslation, 1));
        matrix[5] = matrix[5] + (ty - matrix[5]) * weight * finiteOr(c.mixY, finiteOr(c.mixTranslation, 1));
        writeMappedWorld(pose, bone, matrix);
      }
      return;
    }
    const target = transformTargetValues(pose, c);
    const mixRotate = finiteOr(c.mixRotate, finiteOr(c.mixRotation, 1));
    const mixX = finiteOr(c.mixX, finiteOr(c.mixTranslation, 1));
    const mixY = finiteOr(c.mixY, finiteOr(c.mixTranslation, 1));
    const mixScaleX = finiteOr(c.mixScaleX, 0);
    const mixScaleY = finiteOr(c.mixScaleY, 0);
    const mixShearY = finiteOr(c.mixShearY, 0);
    const offRot = finiteOr(c.offsetRotation, 0);
    const offX = finiteOr(c.offsetX, 0);
    const offY = finiteOr(c.offsetY, 0);
    const offSx = finiteOr(c.offsetScaleX, 0);
    const offSy = finiteOr(c.offsetScaleY, 0);
    const offShy = finiteOr(c.offsetShearY, 0);
    const relative = c.relative === true;
    const di = c.bone * POSE_STRIDE;
    const curX = pose.local[di + CH_X];
    const curY = pose.local[di + CH_Y];
    const curRot = pose.local[di + CH_ROT];
    const curShy = pose.local[di + CH_SHY];
    const fr = weight * mixRotate;
    if (fr !== 0) {
      const desired = relative ? curRot + target.rot + offRot : target.rot + offRot;
      const delta2 = angleDelta(curRot, desired);
      if (delta2 !== 0) addRotation(pose, c.bone, delta2 * fr);
    }
    const fx = weight * mixX;
    if (fx !== 0) {
      const desired = relative ? curX + target.x + offX : target.x + offX;
      setLocal(pose, c.bone, CH_X, curX + (desired - curX) * fx);
    }
    const fy = weight * mixY;
    if (fy !== 0) {
      const desired = relative ? curY + target.y + offY : target.y + offY;
      setLocal(pose, c.bone, CH_Y, curY + (desired - curY) * fy);
    }
    const fsx = weight * mixScaleX;
    if (fsx !== 0) {
      const desired = target.sx + offSx;
      setLocal(pose, c.bone, CH_SX, pose.local[di + CH_SX] * lerp2(1, desired, fsx));
    }
    const fsy = weight * mixScaleY;
    if (fsy !== 0) {
      const desired = target.sy + offSy;
      setLocal(pose, c.bone, CH_SY, pose.local[di + CH_SY] * lerp2(1, desired, fsy));
    }
    const fshy = weight * mixShearY;
    if (fshy !== 0) {
      const desired = relative ? curShy + target.shy + offShy : target.shy + offShy;
      setLocal(pose, c.bone, CH_SHY, curShy + (desired - curShy) * fshy);
    }
  }
  function samplePath(points, closed, t) {
    const n = points.length / 2;
    if (n < 2) throw new Error("constraint.points");
    const segmentCount = closed ? n : n - 1;
    const lengths = [];
    let total = 0;
    for (let i = 0; i < segmentCount; i += 1) {
      const j = (i + 1) % n;
      const dx = points[j * 2] - points[i * 2];
      const dy = points[j * 2 + 1] - points[i * 2 + 1];
      const len = Math.hypot(dx, dy);
      if (!Number.isFinite(len)) throw new Error("constraint.points");
      lengths.push(len);
      total += len;
    }
    if (!(total > EPS_DIR)) throw new Error("constraint.path: zero length");
    let remaining = clamp012(t) * total;
    for (let i = 0; i < segmentCount; i += 1) {
      const len = lengths[i];
      if (len <= EPS_DIR) continue;
      if (remaining <= len || i === segmentCount - 1) {
        const j = (i + 1) % n;
        const u = len > EPS_DIR ? clamp012(remaining / len) : 0;
        const ax = points[i * 2];
        const ay = points[i * 2 + 1];
        const bx = points[j * 2];
        const by = points[j * 2 + 1];
        const dx = bx - ax;
        const dy = by - ay;
        return { x: ax + dx * u, y: ay + dy * u, tx: dx, ty: dy };
      }
      remaining -= len;
    }
    const last = (n - 1) * 2;
    return {
      x: points[last],
      y: points[last + 1],
      tx: points[last] - points[last - 2],
      ty: points[last + 1] - points[last - 1]
    };
  }
  function toParentLocal(pose, bone, px, py) {
    const parent = pose.skeleton.parent[bone];
    if (parent < 0) return [px, py];
    const matrix = createAffine();
    for (let k = 0; k < WORLD_STRIDE; k += 1) matrix[k] = pose.world[parent * WORLD_STRIDE + k];
    const inverse = invertAffine(matrix);
    if (!inverse) return [px, py];
    return [
      inverse[0] * px + inverse[2] * py + inverse[4],
      inverse[1] * px + inverse[3] * py + inverse[5]
    ];
  }
  function spinePathWorldVertices(pose, path) {
    const world = [];
    for (const influences of path.vertices) {
      let x = 0, y = 0;
      for (const influence of influences) {
        const o = influence.bone * WORLD_STRIDE;
        const m = pose.world;
        const w = influence.weight;
        x += (m[o] * influence.x + m[o + 2] * influence.y + m[o + 4]) * w;
        y += (m[o + 1] * influence.x + m[o + 3] * influence.y + m[o + 5]) * w;
      }
      world.push(x, y);
    }
    return world;
  }
  function spineCurveLengths(world, closed) {
    const count = world.length / 6 - (closed ? 1 : 2) + 1;
    const lengths = Array(count);
    let x1 = world[2], y1 = world[3], total = 0;
    for (let curve = 0; curve < count; curve++) {
      const ids = closed && curve === count - 1 ? [world.length / 2 - 2, world.length / 2 - 1, 0, 1] : [curve * 3 + 1, curve * 3 + 2, curve * 3 + 3, curve * 3 + 4];
      const cx1 = world[ids[1] * 2], cy1 = world[ids[1] * 2 + 1];
      const cx2 = world[ids[2] * 2], cy2 = world[ids[2] * 2 + 1];
      const x2 = world[ids[3] * 2], y2 = world[ids[3] * 2 + 1];
      let tmpx = (x1 - cx1 * 2 + cx2) * 0.1875, tmpy = (y1 - cy1 * 2 + cy2) * 0.1875;
      let dddfx = ((cx1 - cx2) * 3 - x1 + x2) * 0.09375, dddfy = ((cy1 - cy2) * 3 - y1 + y2) * 0.09375;
      let ddfx = tmpx * 2 + dddfx, ddfy = tmpy * 2 + dddfy;
      let dfx = (cx1 - x1) * 0.75 + tmpx + dddfx * 0.16666667;
      let dfy = (cy1 - y1) * 0.75 + tmpy + dddfy * 0.16666667;
      total += Math.hypot(dfx, dfy);
      dfx += ddfx;
      dfy += ddfy;
      ddfx += dddfx;
      ddfy += dddfy;
      total += Math.hypot(dfx, dfy);
      dfx += ddfx;
      dfy += ddfy;
      total += Math.hypot(dfx, dfy);
      dfx += ddfx + dddfx;
      dfy += ddfy + dddfy;
      total += Math.hypot(dfx, dfy);
      lengths[curve] = total;
      x1 = x2;
      y1 = y2;
    }
    return lengths;
  }
  function spineCurveSegment(world, ids, fraction) {
    const [x1, y1, cx1, cy1, cx2, cy2, x2, y2] = ids.flatMap((id) => [world[id * 2], world[id * 2 + 1]]);
    const segments = [];
    let tmpx = (x1 - cx1 * 2 + cx2) * 0.03, tmpy = (y1 - cy1 * 2 + cy2) * 0.03;
    let dddfx = ((cx1 - cx2) * 3 - x1 + x2) * 6e-3, dddfy = ((cy1 - cy2) * 3 - y1 + y2) * 6e-3;
    let ddfx = tmpx * 2 + dddfx, ddfy = tmpy * 2 + dddfy;
    let dfx = (cx1 - x1) * 0.3 + tmpx + dddfx * 0.16666667;
    let dfy = (cy1 - y1) * 0.3 + tmpy + dddfy * 0.16666667;
    let total = Math.hypot(dfx, dfy);
    segments.push(total);
    for (let i = 1; i < 8; i++) {
      dfx += ddfx;
      dfy += ddfy;
      ddfx += dddfx;
      ddfy += dddfy;
      total += Math.hypot(dfx, dfy);
      segments.push(total);
    }
    dfx += ddfx;
    dfy += ddfy;
    total += Math.hypot(dfx, dfy);
    segments.push(total);
    dfx += ddfx + dddfx;
    dfy += ddfy + dddfy;
    total += Math.hypot(dfx, dfy);
    segments.push(total);
    let p = fraction * total, segment = 0;
    while (segment < 9 && p > segments[segment]) segment++;
    const prev = segment === 0 ? 0 : segments[segment - 1];
    return (segment + (p - prev) / (segments[segment] - prev)) * 0.1;
  }
  function sampleSpinePath(world, lengths, closed, distance, constantSpeed) {
    const vertexCount = world.length / 2;
    const curveCount = vertexCount / 3 - (closed ? 1 : 2);
    const pathLength = lengths[curveCount];
    if (!(pathLength > 0)) return [world[2] ?? 0, world[3] ?? 0, 0];
    let p = distance;
    if (closed) p = (p % pathLength + pathLength) % pathLength;
    if (!closed && (p < 0 || p > pathLength)) {
      const index = p < 0 ? 1 : vertexCount - 3;
      const x12 = world[index * 2], y12 = world[index * 2 + 1];
      const x22 = world[(index + 1) * 2], y22 = world[(index + 1) * 2 + 1];
      const angle2 = Math.atan2(y22 - y12, x22 - x12);
      const d = p < 0 ? p : p - pathLength;
      return [
        p < 0 ? x12 + d * Math.cos(angle2) : x22 + d * Math.cos(angle2),
        p < 0 ? y12 + d * Math.sin(angle2) : y22 + d * Math.sin(angle2),
        angle2
      ];
    }
    let curve = 0;
    while (curve < curveCount && p > lengths[curve]) curve++;
    const prev = curve === 0 ? 0 : lengths[curve - 1];
    let t = (p - prev) / (lengths[curve] - prev);
    const first = curve * 3 + 1;
    const ids = closed && curve === curveCount ? [vertexCount - 2, vertexCount - 1, 0, 1] : [first, first + 1, first + 2, first + 3];
    if (constantSpeed) t = spineCurveSegment(world, ids, t);
    const [x1, y1, cx1, cy1, cx2, cy2, x2, y2] = ids.flatMap((id) => [world[id * 2], world[id * 2 + 1]]);
    if (t === 0 || Number.isNaN(t)) return [x1, y1, Math.atan2(cy1 - y1, cx1 - x1)];
    const u = 1 - t, tt = t * t, uu = u * u;
    const x = x1 * uu * u + cx1 * 3 * uu * t + cx2 * 3 * u * tt + x2 * tt * t;
    const y = y1 * uu * u + cy1 * 3 * uu * t + cy2 * 3 * u * tt + y2 * tt * t;
    const angle = t < 1e-3 ? Math.atan2(cy1 - y1, cx1 - x1) : Math.atan2(
      y - (y1 * uu + cy1 * 2 * u * t + cy2 * tt),
      x - (x1 * uu + cx1 * 2 * u * t + cx2 * tt)
    );
    return [x, y, angle];
  }
  function applySpinePath(pose, c) {
    const path = c.spinePath;
    const bones = pathBones(c);
    if (bones.length === 0 || path.vertices.length < 4) return;
    const weight = clamp012(c.weight);
    const mixRotate = clamp012(weight * finiteOr(c.mixRotate, 1));
    const mixX = clamp012(weight * finiteOr(c.mixX, 1));
    const mixY = clamp012(weight * finiteOr(c.mixY, 1));
    if (mixRotate === 0 && mixX === 0 && mixY === 0) return;
    updateWorld(pose);
    const vertices = spinePathWorldVertices(pose, path);
    const lengths = path.constantSpeed ? spineCurveLengths(vertices, path.closed) : path.lengths;
    const curveCount = vertices.length / 6 - (path.closed ? 1 : 2);
    const total = lengths[curveCount];
    if (!(total > 0)) return;
    const tangent = c.rotateMode === "tangent", scale = c.rotateMode === "chainScale";
    const count = tangent ? bones.length : bones.length + 1;
    const spaces = Array(count).fill(0);
    const boneLengths = Array(bones.length).fill(0);
    const spacing = finiteOr(c.spacing, 0);
    for (let i = 0; i < count - 1; i++) {
      const bone = bones[i];
      const o = bone * WORLD_STRIDE;
      const setupLength = pose.skeleton.bones[bone].length;
      const worldLength = Math.hypot(setupLength * pose.world[o], setupLength * pose.world[o + 1]);
      if (scale) boneLengths[i] = worldLength;
      spaces[i + 1] = c.spacingMode === "percent" ? spacing : c.spacingMode === "proportional" ? worldLength : setupLength < 1e-6 ? spacing : (c.spacingMode === "length" ? Math.max(0, setupLength + spacing) : spacing) * worldLength / setupLength;
    }
    if (c.spacingMode === "proportional") {
      const sum = spaces.reduce((a, b) => a + b, 0);
      if (sum > 0) for (let i = 1; i < count; i++) spaces[i] = spaces[i] * count / sum * spacing;
    }
    const multiplier = c.spacingMode === "percent" ? total : c.spacingMode === "proportional" ? total / count : 1;
    let position = finiteOr(c.position, 0) * (c.positionMode === "percent" ? total : 1);
    const positions = [];
    for (let i = 0; i < count; i++) {
      position += spaces[i] * multiplier;
      positions.push(sampleSpinePath(vertices, lengths, path.closed, position, path.constantSpeed));
    }
    let [boneX, boneY] = positions[0];
    const initialMatrices = bones.map((bone) => Array.from(pose.world.subarray(bone * WORLD_STRIDE, (bone + 1) * WORLD_STRIDE)));
    const offsetRotation = finiteOr(c.offsetRotation, 0) * (c.targetBone === void 0 || pose.world[c.targetBone * WORLD_STRIDE] * pose.world[c.targetBone * WORLD_STRIDE + 3] - pose.world[c.targetBone * WORLD_STRIDE + 2] * pose.world[c.targetBone * WORLD_STRIDE + 1] > 0 ? 1 : -1);
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      const m = initialMatrices[i];
      m[4] = m[4] + (boneX - m[4]) * mixX;
      m[5] = m[5] + (boneY - m[5]) * mixY;
      const [x, y, angle] = positions[i + 1] ?? positions[i];
      const dx = x - boneX, dy = y - boneY;
      if (scale && boneLengths[i] !== 0) {
        const s = (Math.hypot(dx, dy) / boneLengths[i] - 1) * mixRotate + 1;
        m[0] = m[0] * s;
        m[1] = m[1] * s;
      }
      boneX = x;
      boneY = y;
      if (mixRotate > 0) {
        let r = (tangent || spaces[i + 1] === 0 ? angle : Math.atan2(dy, dx)) - Math.atan2(m[1], m[0]);
        if (offsetRotation !== 0 || c.rotateMode !== "chain") r += offsetRotation;
        else {
          const cos2 = Math.cos(r), sin2 = Math.sin(r), len = pose.skeleton.bones[bone].length;
          boneX += (len * (cos2 * m[0] - sin2 * m[1]) - dx) * mixRotate;
          boneY += (len * (sin2 * m[0] + cos2 * m[1]) - dy) * mixRotate;
        }
        if (r > Math.PI) r -= 2 * Math.PI;
        else if (r < -Math.PI) r += 2 * Math.PI;
        const cos = Math.cos(r * mixRotate), sin = Math.sin(r * mixRotate);
        const [a, c0, b, d] = m;
        m[0] = cos * a - sin * c0;
        m[1] = sin * a + cos * c0;
        m[2] = cos * b - sin * d;
        m[3] = sin * b + cos * d;
      }
      setWorldOverride(pose, bone, m);
    }
  }
  function applyPath(pose, c) {
    if (c.spinePath) {
      applySpinePath(pose, c);
      return;
    }
    const bones = pathBones(c);
    const weight = clamp012(c.weight);
    const baseMix = finiteOr(c.mix, 1);
    const rotMix = clamp012(weight * finiteOr(c.mixRotate, finiteOr(c.rotateMix, 0)));
    const xMix = clamp012(weight * finiteOr(c.mixX, finiteOr(c.translateMix, baseMix)));
    const yMix = clamp012(weight * finiteOr(c.mixY, finiteOr(c.mixX, finiteOr(c.translateMix, baseMix))));
    if (rotMix === 0 && xMix === 0 && yMix === 0 || c.points.length < 4) return;
    const position = clamp012(finiteOr(c.position, 0));
    const spacing = clamp012(finiteOr(c.spacing, 0));
    const closed = c.closed === true;
    for (let index = 0; index < bones.length; index += 1) {
      const bone = bones[index];
      if (!Number.isInteger(bone) || bone < 0 || bone >= pose.skeleton.count) throw new Error("constraint.bone");
      const t = clamp012(position + index * spacing);
      const sample = samplePath(c.points, closed, t);
      updateWorld(pose);
      const [localX, localY] = toParentLocal(pose, bone, sample.x, sample.y);
      const i = bone * POSE_STRIDE;
      if (xMix > 0) setLocal(pose, bone, CH_X, pose.local[i + CH_X] + (localX - pose.local[i + CH_X]) * xMix);
      if (yMix > 0) setLocal(pose, bone, CH_Y, pose.local[i + CH_Y] + (localY - pose.local[i + CH_Y]) * yMix);
      if (rotMix > 0) {
        const parent = pose.skeleton.parent[bone];
        const parentAngle = parent < 0 ? 0 : boneAngle(pose, parent);
        const desired = Math.atan2(sample.ty, sample.tx) - parentAngle;
        const delta2 = angleDelta(getRotation(pose, bone), desired);
        if (delta2 !== 0) addRotation(pose, bone, delta2 * rotMix);
      }
      updateWorld(pose);
    }
  }
  function applyIk(pose, c, results) {
    if (c.spine) {
      results.set(c.id, solveIk(pose, c));
      return;
    }
    const bones = chainBoneIds(pose.skeleton, c.bone, c.chainLength);
    if (!bones) {
      updateWorld(pose);
      results.set(c.id, degenerateResult(pose, targetOf2(pose, ikTargetBone(c)), c.bone));
      return;
    }
    const weight = clamp012(c.weight);
    const before = bones.map((bone) => getRotation(pose, bone));
    const result = solveIk(pose, c);
    if (weight < 1) {
      const after = bones.map((bone) => getRotation(pose, bone));
      for (let k = 0; k < bones.length; k += 1) {
        setLocal(pose, bones[k], CH_ROT, before[k] + (after[k] - before[k]) * weight);
      }
      updateWorld(pose);
      const target = targetOf2(pose, ikTargetBone(c));
      const residual = residualOf(pose, target, bones);
      results.set(c.id, {
        ...result,
        residual,
        reached: residual <= c.tolerance
      });
    } else {
      results.set(c.id, result);
    }
  }
  function createConstraintSolver(constraints) {
    const ordered = orderedConstraints(constraints);
    checkCreationCycles(ordered);
    const results = /* @__PURE__ */ new Map();
    const physicsStates = /* @__PURE__ */ new Map();
    return {
      results,
      physicsTranslate(x, y) {
        for (const state of physicsStates.values()) {
          const s = state.spine;
          if (s === void 0) continue;
          s.ux -= x;
          s.uy -= y;
          s.cx -= x;
          s.cy -= y;
        }
      },
      reset() {
        results.clear();
        for (const state of physicsStates.values()) {
          delete state.spine;
          state.offsetX = 0;
          state.offsetY = 0;
          state.offsetRot = 0;
          state.velocityX = 0;
          state.velocityY = 0;
          state.velocityRot = 0;
          state.accumulator = 0;
          state.initialized = false;
        }
      },
      solve(pose, dt, weights, slotSet, animationReset = false) {
        checkSolveCycles(ordered, pose.skeleton);
        results.clear();
        updateWorld(pose);
        for (const base of ordered) {
          const override = weights?.get(base.id);
          let c = override === void 0 ? base : { ...base, weight: clamp012(override) };
          const channelMap = weights?.channels;
          const channels = channelMap?.get(base.id) ?? [];
          const globalChannels = base.kind === "physics" ? channelMap?.get("-1") ?? [] : [];
          let timelineReset = false;
          for (let channel of [...channels, ...globalChannels]) {
            if (base.kind === "physics" && globalChannels.includes(channel)) {
              const filtered = Object.fromEntries(Object.entries(channel.values).filter(([field]) => field === "reset" || base[`${field}Global`] === true));
              if (Object.keys(filtered).length === 0) continue;
              channel = { ...channel, values: filtered };
            }
            if (channel.kind !== c.kind) continue;
            const values = { ...c };
            for (const [field, target] of Object.entries(channel.values)) {
              if (field === "reset") {
                if (target) {
                  values.reset = true;
                  timelineReset = animationReset;
                }
                continue;
              }
              if (field === "bendDirection" || field === "compress" || field === "stretch") {
                if (!channel.additive && channel.alpha >= 0.5) {
                  if (field === "bendDirection") values.bendDirection = target;
                  else values[field] = target ? 1 : 0;
                }
                continue;
              }
              const key = c.kind === "ik" && field === "mix" ? "weight" : field;
              if (c.kind === "physics" && field === "mass") {
                const physicsBase = base;
                const setupMass = physicsBase.mass ?? 1 / (physicsBase.massInverse ?? 1);
                const currentMass = 1 / Number(values.massInverse ?? 1 / setupMass);
                const mass = channel.additive ? currentMass + Number(target) * channel.alpha : currentMass + (Number(target) - currentMass) * channel.alpha;
                if (mass > 0) {
                  values.mass = mass;
                  values.massInverse = 1 / mass;
                }
                continue;
              }
              const setup = Number(base[key] ?? (key.startsWith("mix") ? 1 : 0));
              const current = Number(values[key] ?? setup);
              values[key] = channel.additive ? current + Number(target) * channel.alpha : current + (Number(target) - current) * channel.alpha;
            }
            c = values;
          }
          if (!c.enabled || c.weight === 0) continue;
          if (c.kind === "transform") {
            applyTransform(pose, c);
          } else if (c.kind === "path") {
            applyPath(pose, c);
          } else if (c.kind === "slider") {
            if (c.clip !== void 0 && c.mix !== 0) {
              let time = c.time;
              if (c.sourceBone !== void 0 && c.property !== void 0) {
                const i = c.sourceBone * POSE_STRIDE, w = c.sourceBone * WORLD_STRIDE;
                const local = pose.local, world = pose.world;
                const value = c.local ? {
                  rotate: local[i + CH_ROT] * 180 / Math.PI,
                  x: local[i + CH_X],
                  y: local[i + CH_Y],
                  scaleX: local[i + CH_SX],
                  scaleY: local[i + CH_SY],
                  shearY: local[i + CH_SHY] * 180 / Math.PI
                }[c.property] : {
                  rotate: (Math.atan2(world[w + 1], world[w]) * 180 / Math.PI + 360) % 360,
                  x: world[w + 4],
                  y: world[w + 5],
                  scaleX: Math.hypot(world[w], world[w + 1]),
                  scaleY: Math.hypot(world[w + 2], world[w + 3]),
                  shearY: Math.atan2(
                    world[w] * world[w + 2] + world[w + 1] * world[w + 3],
                    world[w] * world[w + 3] - world[w + 1] * world[w + 2]
                  ) * 180 / Math.PI
                }[c.property];
                time = (c.to ?? 0) + (value - (c.from ?? 0)) * (c.scale ?? 1);
                time = c.loop && c.clip.duration > 0 ? c.clip.duration + time % c.clip.duration : Math.max(0, time);
              }
              applySliderBoneAnimation(c.clip, pose, time, c.mix, c.additive, c.loop);
              if (slotSet !== void 0) applySliderSlotAnimation(c.clip, slotSet, time, c.loop);
            }
          } else if (c.kind === "physics") {
            let state = physicsStates.get(c.id);
            if (state === void 0) {
              state = createPhysicsConstraintState();
              physicsStates.set(c.id, state);
            }
            stepPhysicsConstraint(pose, c, state, dt, timelineReset);
          } else {
            applyIk(pose, c, results);
          }
          updateWorld(pose);
        }
      }
    };
  }
  function createPhysicsConstraintState() {
    return {
      offsetX: 0,
      offsetY: 0,
      offsetRot: 0,
      velocityX: 0,
      velocityY: 0,
      velocityRot: 0,
      appliedX: 0,
      appliedY: 0,
      appliedRot: 0,
      writtenX: 0,
      writtenY: 0,
      writtenRot: 0,
      lastX: 0,
      lastY: 0,
      lastRot: 0,
      accumulator: 0,
      initialized: false
    };
  }
  function resetPhysicsConstraintState(state) {
    delete state.spine;
    state.offsetX = 0;
    state.offsetY = 0;
    state.offsetRot = 0;
    state.velocityX = 0;
    state.velocityY = 0;
    state.velocityRot = 0;
    state.appliedX = 0;
    state.appliedY = 0;
    state.appliedRot = 0;
    state.writtenX = 0;
    state.writtenY = 0;
    state.writtenRot = 0;
    state.lastX = 0;
    state.lastY = 0;
    state.lastRot = 0;
    state.accumulator = 0;
    state.initialized = false;
  }
  function stepSpinePhysics(pose, c, state, dt, timelineReset = false) {
    updateWorld(pose);
    const k = c.bone * WORLD_STRIDE;
    const world = createAffine();
    for (let j = 0; j < WORLD_STRIDE; j += 1) world[j] = pose.world[k + j];
    const s = state.spine ?? (state.spine = {
      ux: 0,
      uy: 0,
      cx: 0,
      cy: 0,
      tx: 0,
      ty: 0,
      x: 0,
      y: 0,
      rot: 0,
      scale: 0,
      xv: 0,
      yv: 0,
      rv: 0,
      sv: 0,
      xl: 0,
      yl: 0,
      rl: 0,
      sl: 0,
      remaining: 0,
      reset: true,
      time: 0,
      lastTime: 0
    });
    const mix = finiteOr(c.mix, 1) * c.weight;
    if (mix === 0) return;
    const t = c.step;
    if (!(t > 0)) throw new Error("physics.step");
    if (c.reset) {
      Object.assign(s, {
        x: 0,
        y: 0,
        rot: 0,
        scale: 0,
        xv: 0,
        yv: 0,
        rv: 0,
        sv: 0,
        xl: 0,
        yl: 0,
        rl: 0,
        sl: 0,
        remaining: 0,
        reset: true
      });
    }
    const env = c.environment ?? { referenceScale: 1, windX: 1, windY: 0, gravityX: 0, gravityY: 1 };
    const sx = env.scaleX ?? 1, sy = env.scaleY ?? 1;
    const inertia = finiteOr(c.inertia, 0);
    const strength = finiteOr(c.strength, 0);
    const massInverse = finiteOr(c.massInverse, 1 / finiteOr(c.mass, 1));
    const damping = finiteOr(c.damping, 1) ** (60 * t);
    const wind = finiteOr(c.wind, 0), gravity = finiteOr(c.gravity, 0);
    const length = pose.skeleton.bones[c.bone].length;
    s.time += Math.max(0, dt);
    if (c.reset && !timelineReset) s.lastTime = s.time;
    const elapsed = Math.max(0, s.time - s.lastTime);
    s.lastTime = s.time;
    const qx = finiteOr(c.limit, 0) * elapsed * Math.abs(sx);
    const qy = finiteOr(c.limit, 0) * elapsed * Math.abs(sy);
    const clamp2 = (value, limit) => Math.max(-limit, Math.min(limit, value));
    const oldRemaining = s.remaining;
    s.remaining += elapsed;
    let z = 0;
    if (s.reset) {
      s.reset = false;
      s.ux = world[4];
      s.uy = world[5];
    } else {
      let a = s.remaining;
      const xEnabled = (c.x ?? 0) > 0, yEnabled = (c.y ?? 0) > 0;
      const angular = (c.rotate ?? 0) > 0 || (c.shearX ?? 0) > 0;
      const scaling = (c.scaleX ?? 0) > 0;
      const m = t * massInverse;
      if (xEnabled || yEnabled) {
        if (xEnabled) {
          s.x += clamp2((s.ux - world[4]) * inertia, qx);
          s.ux = world[4];
        }
        if (yEnabled) {
          s.y += clamp2((s.uy - world[5]) * inertia, qy);
          s.uy = world[5];
        }
        if (a >= t) {
          const oldX = s.x, oldY = s.y;
          const ax = env.referenceScale * (wind * env.windX + gravity * env.gravityX) * sx;
          const ay = env.referenceScale * (wind * env.windY + gravity * env.gravityY) * sy;
          do {
            if (xEnabled) {
              s.xv += (ax - s.x * strength) * m;
              s.x += s.xv * t;
              s.xv *= damping;
            }
            if (yEnabled) {
              s.yv -= (ay + s.y * strength) * m;
              s.y += s.yv * t;
              s.yv *= damping;
            }
            a -= t;
          } while (a >= t);
          s.xl = s.x - oldX;
          s.yl = s.y - oldY;
        }
        z = Math.max(0, 1 - a / t);
        if (xEnabled) world[4] = world[4] + (s.x - s.xl * z) * mix * c.x;
        if (yEnabled) world[5] = world[5] + (s.y - s.yl * z) * mix * c.y;
      }
      if (angular || scaling) {
        const ca = Math.atan2(world[1], world[0]);
        let dx = clamp2(s.cx - world[4], qx), dy = clamp2(s.cy - world[5], qy);
        let co = 0, si = 0;
        const mr = ((c.rotate ?? 0) + (c.shearX ?? 0)) * mix;
        if (angular) {
          const lag = s.rl * Math.max(0, 1 - oldRemaining / t);
          const angle2 = Math.atan2(dy + s.ty, dx + s.tx) - ca - (s.rot - lag) * mr;
          s.rot += (angle2 - Math.ceil(angle2 / (Math.PI * 2) - 0.5) * Math.PI * 2) * inertia;
          const direction = (s.rot - lag) * mr + ca;
          co = Math.cos(direction);
          si = Math.sin(direction);
          const r = length * Math.hypot(world[0], world[1]);
          if (scaling && r > 0) s.scale += (dx * co + dy * si) * inertia / r;
        } else {
          co = Math.cos(ca);
          si = Math.sin(ca);
          const r = length * Math.hypot(world[0], world[1]) - s.sl * Math.max(0, 1 - oldRemaining / t);
          if (r > 0) s.scale += (dx * co + dy * si) * inertia / r;
        }
        a = s.remaining;
        if (a >= t) {
          const oldRot = s.rot, oldScale = s.scale;
          const ax = wind * env.windX + gravity * env.gravityX;
          const ay = wind * env.windY + gravity * env.gravityY;
          do {
            a -= t;
            if (scaling) {
              s.sv += (ax * co - ay * si - s.scale * strength) * m;
              s.scale += s.sv * t;
              s.sv *= damping;
            }
            if (angular) {
              s.rv -= ((ax * si + ay * co) * length / env.referenceScale + s.rot * strength) * m;
              s.rot += s.rv * t;
              s.rv *= damping;
              if (a >= t) {
                const direction = s.rot * mr + ca;
                co = Math.cos(direction);
                si = Math.sin(direction);
              }
            }
          } while (a >= t);
          s.rl = s.rot - oldRot;
          s.sl = s.scale - oldScale;
        }
        z = Math.max(0, 1 - a / t);
      }
      s.remaining = a;
    }
    s.cx = world[4];
    s.cy = world[5];
    const angle = (s.rot - s.rl * z) * mix;
    const rotateAxis = (axis, radians) => {
      const co = Math.cos(radians), si = Math.sin(radians);
      const x = world[axis], y = world[axis + 1];
      world[axis] = co * x - si * y;
      world[axis + 1] = si * x + co * y;
    };
    if ((c.shearX ?? 0) > 0) {
      if ((c.rotate ?? 0) > 0) rotateAxis(2, angle * c.rotate);
      rotateAxis(0, angle * ((c.rotate ?? 0) + c.shearX));
    } else if ((c.rotate ?? 0) > 0) {
      rotateAxis(0, angle * c.rotate);
      rotateAxis(2, angle * c.rotate);
    }
    if ((c.scaleX ?? 0) > 0) {
      const scale = 1 + (s.scale - s.sl * z) * mix * c.scaleX;
      world[0] = world[0] * scale;
      world[1] = world[1] * scale;
      let scaleY = 1;
      if (c.scaleYMode === "Uniform") scaleY = scale;
      if (c.scaleYMode === "Volume") {
        const magnitude = Math.abs(scale);
        scaleY = magnitude >= 0.7 ? 1 / magnitude : 4 - 3.67347 * magnitude;
      }
      world[2] = world[2] * scaleY;
      world[3] = world[3] * scaleY;
    }
    s.tx = length * world[0];
    s.ty = length * world[1];
    if ([...world].every(Number.isFinite)) setWorldOverride(pose, c.bone, world);
  }
  function validatePhysicsConstraint(pose, c) {
    if (!Number.isInteger(c.bone) || c.bone < 0 || c.bone >= pose.skeleton.count) throw new Error("physics.bone");
    if (c.target !== void 0 && (!Number.isInteger(c.target) || c.target < 0 || c.target >= pose.skeleton.count)) {
      throw new Error("physics.target");
    }
    if (c.target === c.bone) throw new Error("constraint.cycle: self bone");
    for (const [name, value] of [
      ["inertia", c.inertia],
      ["strength", c.strength],
      ["damping", c.damping],
      ["mass", c.mass],
      ["wind", c.wind],
      ["gravity", c.gravity],
      ["mix", c.mix]
    ]) {
      if (value !== void 0 && !Number.isFinite(value)) throw new Error(`physics.${name}`);
    }
    if (c.mass !== void 0 && !(c.mass > 0)) throw new Error("physics.mass");
    if (c.strength !== void 0 && c.strength < 0) throw new Error("physics.strength");
    if (c.damping !== void 0 && c.damping < 0) throw new Error("physics.damping");
  }
  function applyPhysicsOffset(pose, c, state) {
    const factor = clamp012(c.weight * finiteOr(c.mix, 1));
    const i = c.bone * POSE_STRIDE;
    const curX = pose.local[i + CH_X];
    const curY = pose.local[i + CH_Y];
    const curRot = pose.local[i + CH_ROT];
    const sameX = Math.abs(curX - state.writtenX) <= 1e-5;
    const sameY = Math.abs(curY - state.writtenY) <= 1e-5;
    const sameRot = Math.abs(curRot - state.writtenRot) <= 1e-5;
    const baseX = sameX ? curX - state.appliedX : curX;
    const baseY = sameY ? curY - state.appliedY : curY;
    const baseRot = sameRot ? curRot - state.appliedRot : curRot;
    const desiredX = state.offsetX * factor * (c.x ?? 1);
    const desiredY = state.offsetY * factor * (c.y ?? 1);
    const desiredRot = state.offsetRot * factor * (c.rotate ?? 1);
    const nextX = baseX + desiredX;
    const nextY = baseY + desiredY;
    const nextRot = baseRot + desiredRot;
    if (nextX !== curX) setLocal(pose, c.bone, CH_X, nextX);
    if (nextY !== curY) setLocal(pose, c.bone, CH_Y, nextY);
    if (nextRot !== curRot) setLocal(pose, c.bone, CH_ROT, nextRot);
    state.appliedX = desiredX;
    state.appliedY = desiredY;
    state.appliedRot = desiredRot;
    state.writtenX = nextX;
    state.writtenY = nextY;
    state.writtenRot = nextRot;
  }
  function stepPhysicsConstraint(pose, c, state, dt, timelineReset = false) {
    validatePhysicsConstraint(pose, c);
    if (c.step !== void 0) {
      stepSpinePhysics(pose, c, state, dt, timelineReset);
      return;
    }
    updateWorld(pose);
    const parent = pose.skeleton.parent[c.bone];
    const reference = c.target ?? parent;
    if (c.reset === true) {
      applyPhysicsOffset(pose, c, { ...state, offsetX: 0, offsetY: 0, offsetRot: 0 });
      resetPhysicsConstraintState(state);
      updateWorld(pose);
      if (reference >= 0) {
        state.lastX = boneOrigin(pose, reference)[0];
        state.lastY = boneOrigin(pose, reference)[1];
        state.lastRot = boneAngle(pose, reference);
      }
      state.initialized = true;
      return;
    }
    const refX = reference < 0 ? 0 : boneOrigin(pose, reference)[0];
    const refY = reference < 0 ? 0 : boneOrigin(pose, reference)[1];
    const refRot = reference < 0 ? 0 : boneAngle(pose, reference);
    if (!state.initialized) {
      state.lastX = refX;
      state.lastY = refY;
      state.lastRot = refRot;
      state.initialized = true;
    }
    const frameDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_STEP) : 0;
    if (frameDt === 0) return;
    state.accumulator = Math.min(state.accumulator + frameDt, PHYSICS_MAX_SUBSTEPS * PHYSICS_DT);
    let substeps = Math.floor(state.accumulator / PHYSICS_DT + 1e-12);
    if (substeps > PHYSICS_MAX_SUBSTEPS) substeps = PHYSICS_MAX_SUBSTEPS;
    if (substeps <= 0) return;
    state.accumulator -= substeps * PHYSICS_DT;
    const inertia = Math.max(0, finiteOr(c.inertia, 1));
    const strength = Math.max(0, finiteOr(c.strength, 10));
    const damping = Math.max(0, finiteOr(c.damping, 2));
    const mass = Math.max(EPS_DIR, finiteOr(c.mass, 1));
    const wind = finiteOr(c.wind, 0);
    const gravity = finiteOr(c.gravity, 0);
    const parentDx = refX - state.lastX;
    const parentDy = refY - state.lastY;
    const parentDr = angleDelta(state.lastRot, refRot);
    const spring = strength / mass;
    const targetX = -parentDx * inertia / mass + (strength > EPS_DIR ? wind / strength : wind);
    const targetY = -parentDy * inertia / mass + (strength > EPS_DIR ? gravity / strength : gravity);
    const targetRot = -parentDr * inertia / mass;
    const h = PHYSICS_DT;
    const damp = Math.exp(-damping * h);
    for (let step = 0; step < substeps; step += 1) {
      state.velocityX += (targetX - state.offsetX) * spring * h;
      state.velocityY += (targetY - state.offsetY) * spring * h;
      state.velocityRot += (targetRot - state.offsetRot) * spring * h;
      state.velocityX *= damp;
      state.velocityY *= damp;
      state.velocityRot *= damp;
      state.offsetX += state.velocityX * h;
      state.offsetY += state.velocityY * h;
      state.offsetRot += state.velocityRot * h;
    }
    if (!Number.isFinite(state.offsetX)) {
      state.offsetX = 0;
      state.velocityX = 0;
    }
    if (!Number.isFinite(state.offsetY)) {
      state.offsetY = 0;
      state.velocityY = 0;
    }
    if (!Number.isFinite(state.offsetRot)) {
      state.offsetRot = 0;
      state.velocityRot = 0;
    }
    state.lastX = refX;
    state.lastY = refY;
    state.lastRot = refRot;
    applyPhysicsOffset(pose, c, state);
    updateWorld(pose);
  }

  // ../packages/render-engine/src/physics/physics.ts
  var DEFAULT_FIXED_DT = 1 / 120;

  // ../packages/render-engine/src/render/render.ts
  var EPS2 = 1e-12;
  var clamp013 = (v) => Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  function toByte(v) {
    return Math.min(255, Math.max(0, Math.floor(clamp013(v) * 255 + 0.5)));
  }
  function colorBytes(color, pma) {
    const a = clamp013(color[3]);
    const r = pma ? clamp013(color[0]) : clamp013(color[0]) * a;
    const g = pma ? clamp013(color[1]) : clamp013(color[1]) * a;
    const b = pma ? clamp013(color[2]) : clamp013(color[2]) * a;
    return new Uint8Array([toByte(r), toByte(g), toByte(b), toByte(a)]);
  }
  function fillColors(vertexCount, bytes) {
    const out = new Uint8Array(vertexCount * 4);
    for (let i = 0; i < vertexCount; i += 1) {
      const o = i * 4;
      out[o] = bytes[0];
      out[o + 1] = bytes[1];
      out[o + 2] = bytes[2];
      out[o + 3] = bytes[3];
    }
    return out;
  }
  function spinePmaTint(skeleton, slot, attachment, dark) {
    const a = Math.floor(skeleton.a * slot.a * attachment.a * 255);
    const light = [
      Math.floor(a * skeleton.r * slot.r * attachment.r),
      Math.floor(a * skeleton.g * slot.g * attachment.g),
      Math.floor(a * skeleton.b * slot.b * attachment.b),
      a
    ];
    return dark === void 0 ? { light } : {
      light,
      dark: [Math.floor(dark.r * a), Math.floor(dark.g * a), Math.floor(dark.b * a), 255]
    };
  }
  function atlasRegionUv(rect, page) {
    const inset = 0.5;
    const w = page.width > 0 ? page.width : 1;
    const h = page.height > 0 ? page.height : 1;
    return {
      u0: (rect.x + inset) / w,
      v0: (rect.y + inset) / h,
      u1: (rect.x + rect.width - inset) / w,
      v1: (rect.y + rect.height - inset) / h
    };
  }
  function defaultUvs(vertexCount) {
    if (vertexCount === 4) return new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const out = new Float32Array(vertexCount * 2);
    const denom = Math.max(1, vertexCount - 1);
    for (let i = 0; i < vertexCount; i += 1) out[i * 2] = i / denom;
    return out;
  }
  function mapRegionUvs(uvs, region) {
    const uv = atlasRegionUv(region.rect, region.page);
    const du = uv.u1 - uv.u0;
    const dv = uv.v1 - uv.v0;
    const out = new Float32Array(uvs.length);
    for (let i = 0; i + 1 < uvs.length; i += 2) {
      out[i] = uv.u0 + uvs[i] * du;
      out[i + 1] = uv.v0 + uvs[i + 1] * dv;
    }
    return out;
  }
  function fanIndices(vertexCount) {
    if (vertexCount === 4) return new Uint16Array([0, 1, 2, 0, 2, 3]);
    const count = vertexCount >= 3 ? (vertexCount - 2) * 3 : 0;
    const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
    const out = new IndexArray(count);
    let cursor = 0;
    for (let i = 1; i + 1 < vertexCount; i += 1) {
      out[cursor++] = 0;
      out[cursor++] = i;
      out[cursor++] = i + 1;
    }
    return out;
  }
  function buildRegionPacket(args) {
    const vertexCount = Math.floor(args.positions.length / 2);
    const sourceUvs = args.uvs ?? defaultUvs(vertexCount);
    const uvs = args.region ? mapRegionUvs(sourceUvs, args.region) : new Float32Array(sourceUvs);
    return {
      id: args.id,
      kind: args.kind ?? "region",
      version: 1,
      positions: args.positions,
      uvs,
      colors: fillColors(vertexCount, args.lightBytes === void 0 ? colorBytes(args.color, args.pma === true) : Uint8Array.from(args.lightBytes)),
      ...args.dark === void 0 && args.darkBytes === void 0 ? {} : {
        dark: fillColors(vertexCount, args.darkBytes === void 0 ? colorBytes(args.dark, true) : Uint8Array.from(args.darkBytes)),
        twoColor: args.twoColor ?? true
      },
      depth: null,
      indices: fanIndices(vertexCount),
      materialId: args.materialId,
      ...args.page !== void 0 ? { page: args.page } : {},
      blend: args.blend ?? "normal",
      maskPath: args.maskPath ?? 0,
      order: args.order,
      depthKey: args.depthKey,
      subOrder: args.subOrder ?? 0,
      seq: args.seq ?? 0
    };
  }
  function buildMeshPacket(args) {
    const vertexCount = Math.floor(args.positions.length / 2);
    const sourceUvs = args.uvs ?? defaultUvs(vertexCount);
    const uvs = args.region ? mapRegionUvs(sourceUvs, args.region) : new Float32Array(sourceUvs);
    return {
      id: args.id,
      kind: args.kind ?? "mesh",
      version: 1,
      positions: args.positions,
      uvs,
      colors: fillColors(vertexCount, args.lightBytes === void 0 ? colorBytes(args.color, args.pma === true) : Uint8Array.from(args.lightBytes)),
      ...args.dark === void 0 && args.darkBytes === void 0 ? {} : {
        dark: fillColors(vertexCount, args.darkBytes === void 0 ? colorBytes(args.dark, true) : Uint8Array.from(args.darkBytes)),
        twoColor: args.twoColor ?? true
      },
      depth: args.depth ?? null,
      indices: args.indices,
      materialId: args.materialId,
      ...args.page !== void 0 ? { page: args.page } : {},
      blend: args.blend ?? "normal",
      maskPath: args.maskPath ?? 0,
      order: args.order,
      depthKey: args.depthKey,
      subOrder: args.subOrder ?? 0,
      seq: args.seq ?? 0
    };
  }
  function comparePackets(a, b) {
    return a.order - b.order || a.depthKey - b.depthKey || a.subOrder - b.subOrder || a.seq - b.seq;
  }
  function sortPackets(packets) {
    const decorated = packets.map((packet, index) => ({ packet, index }));
    decorated.sort((a, b) => comparePackets(a.packet, b.packet) || a.index - b.index);
    return decorated.map((entry) => entry.packet);
  }
  function batchPackets(packets) {
    const out = [];
    let current = null;
    let positions = [];
    let uvs = [];
    let colors = [];
    let darks = null;
    let indices = [];
    let depths = [];
    let vertexCount = 0;
    let key = "";
    const flush = () => {
      if (current === null) return;
      out.push({
        ...current,
        positions: Float32Array.from(positions),
        uvs: Float32Array.from(uvs),
        colors: Uint8Array.from(colors),
        ...darks === null ? {} : { dark: Uint8Array.from(darks) },
        indices: current.indices instanceof Uint32Array ? Uint32Array.from(indices) : Uint16Array.from(indices),
        depth: depths === null ? null : Float32Array.from(depths)
      });
      current = null;
      positions = [];
      uvs = [];
      colors = [];
      darks = null;
      indices = [];
      depths = [];
      vertexCount = 0;
      key = "";
    };
    for (const packet of packets) {
      const indexType2 = packet.indices instanceof Uint32Array ? 32 : 16;
      const nextKey = `${batchKey(packet)}|${packet.maskPath}|${packet.depthKey}`;
      const count = Math.floor(packet.positions.length / 2);
      const canMerge = current !== null && nextKey === key && vertexCount + count <= 65535;
      if (!canMerge) {
        flush();
        current = packet;
        key = nextKey;
        vertexCount = count;
        positions = [...packet.positions];
        uvs = [...packet.uvs];
        colors = [...packet.colors];
        darks = packet.dark === void 0 ? null : [...packet.dark];
        indices = [...packet.indices];
        depths = packet.depth === null ? null : [...packet.depth];
        continue;
      }
      const base = vertexCount;
      for (const value of packet.positions) positions.push(value);
      for (const value of packet.uvs) uvs.push(value);
      for (const value of packet.colors) colors.push(value);
      if (darks !== null && packet.dark !== void 0) for (const value of packet.dark) darks.push(value);
      for (const value of packet.indices) indices.push(value + base);
      if (depths === null || packet.depth === null) depths = null;
      else for (const value of packet.depth) depths.push(value);
      vertexCount += count;
      void indexType2;
    }
    flush();
    return out;
  }
  function batchKey(p) {
    const indexType2 = p.indices instanceof Uint32Array ? 32 : 16;
    return `${p.materialId}|${p.page ?? -1}|${p.blend}|${p.maskPath}|${indexType2}|${p.kind}|${p.twoColor === true ? 1 : 0}|${p.dark === void 0 ? 0 : 1}`;
  }
  function triangulatePolygon(points) {
    const n = Math.floor(points.length / 2);
    if (n < 3) return new Uint32Array(0);
    const order = Array.from({ length: n }, (_, i) => i);
    let signed = 0;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      signed += points[i * 2] * points[j * 2 + 1] - points[j * 2] * points[i * 2 + 1];
    }
    if (signed < 0) order.reverse();
    const out = [];
    const cross3 = (a, b, c) => (points[b * 2] - points[a * 2]) * (points[c * 2 + 1] - points[a * 2 + 1]) - (points[b * 2 + 1] - points[a * 2 + 1]) * (points[c * 2] - points[a * 2]);
    const inside = (a, b, c, p) => {
      const d1 = cross3(a, b, p);
      const d2 = cross3(b, c, p);
      const d3 = cross3(c, a, p);
      return d1 >= 0 && d2 >= 0 && d3 >= 0 || d1 <= 0 && d2 <= 0 && d3 <= 0;
    };
    let guard = 0;
    while (order.length > 3 && guard < n * n) {
      guard += 1;
      let clipped = false;
      for (let i = 0; i < order.length; i += 1) {
        const prev = order[(i + order.length - 1) % order.length];
        const curr = order[i];
        const next = order[(i + 1) % order.length];
        if (cross3(prev, curr, next) <= 1e-12) continue;
        let blocked = false;
        for (const other of order) {
          if (other === prev || other === curr || other === next) continue;
          if (inside(prev, curr, next, other)) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
        out.push(prev, curr, next);
        order.splice(i, 1);
        clipped = true;
        break;
      }
      if (!clipped) break;
    }
    if (order.length === 3) out.push(order[0], order[1], order[2]);
    else if (order.length > 3) {
      for (let i = 1; i + 1 < order.length; i += 1) out.push(order[0], order[i], order[i + 1]);
    }
    return Uint32Array.from(out);
  }
  function buildOutlinePacket(source, width, color, id = source.id, seq = source.seq) {
    const edges = outlineEdges(source.indices);
    const boundary = new Set(edges.map(([a, b]) => `${a},${b}`));
    const half = Math.max(0, Number.isFinite(width) ? width : 0) / 2;
    const outward = /* @__PURE__ */ new Map();
    for (let i = 0; i + 2 < source.indices.length; i += 3) {
      const triangle = [source.indices[i], source.indices[i + 1], source.indices[i + 2]];
      for (let side = 0; side < 3; side += 1) {
        const x = triangle[side], y = triangle[(side + 1) % 3], opposite = triangle[(side + 2) % 3];
        const a = Math.min(x, y), b = Math.max(x, y);
        const key = `${a},${b}`;
        if (!boundary.has(key)) continue;
        const ax = source.positions[a * 2], ay = source.positions[a * 2 + 1];
        const dx = source.positions[b * 2] - ax, dy = source.positions[b * 2 + 1] - ay;
        const cross3 = dx * (source.positions[opposite * 2 + 1] - ay) - dy * (source.positions[opposite * 2] - ax);
        const length = Math.hypot(dx, dy);
        if (length > EPS2) outward.set(key, cross3 >= 0 ? [dy / length, -dx / length] : [-dy / length, dx / length]);
      }
    }
    const incident = /* @__PURE__ */ new Map();
    for (const [a, b] of edges) {
      const normal = outward.get(`${a},${b}`);
      if (!normal) continue;
      for (const vertex of [a, b]) {
        const neighbors = incident.get(vertex) ?? [];
        neighbors.push(normal);
        incident.set(vertex, neighbors);
      }
    }
    const join = (vertex, normal) => {
      const neighbors = incident.get(vertex);
      if (neighbors?.length !== 2) return [normal[0] * half, normal[1] * half];
      const dot2 = neighbors[0][0] * neighbors[1][0] + neighbors[0][1] * neighbors[1][1];
      const divisor = Math.max(0.25, 1 + dot2);
      return [
        (neighbors[0][0] + neighbors[1][0]) * half / divisor,
        (neighbors[0][1] + neighbors[1][1]) * half / divisor
      ];
    };
    const positions = new Float32Array(edges.length * 8);
    const uvs = new Float32Array(edges.length * 8);
    const indices = new Uint16Array(edges.length * 6);
    let p = 0;
    let u = 0;
    let k = 0;
    for (const [a, b] of edges) {
      const ax = source.positions[a * 2], ay = source.positions[a * 2 + 1];
      const bx = source.positions[b * 2], by = source.positions[b * 2 + 1];
      const normal = outward.get(`${a},${b}`) ?? [0, 0];
      const [anx, any] = join(a, normal);
      const [bnx, bny] = join(b, normal);
      positions.set([
        ax + anx,
        ay + any,
        ax - anx,
        ay - any,
        bx - bnx,
        by - bny,
        bx + bnx,
        by + bny
      ], p);
      p += 8;
      uvs.set([
        source.uvs[a * 2],
        source.uvs[a * 2 + 1],
        source.uvs[a * 2],
        source.uvs[a * 2 + 1],
        source.uvs[b * 2],
        source.uvs[b * 2 + 1],
        source.uvs[b * 2],
        source.uvs[b * 2 + 1]
      ], u);
      u += 8;
      indices.set([k, k + 1, k + 2, k, k + 2, k + 3], k / 4 * 6);
      k += 4;
    }
    return {
      ...source,
      id,
      kind: "outline",
      positions,
      uvs,
      colors: fillColors(edges.length * 4, colorBytes(color, false)),
      indices,
      depth: null,
      subOrder: source.subOrder + 1,
      seq
    };
  }
  function outlineEdges(indices) {
    const edges = /* @__PURE__ */ new Map();
    const add2 = (x, y) => {
      if (x === y) return;
      const a = Math.min(x, y);
      const b = Math.max(x, y);
      const key = `${a},${b}`;
      const found = edges.get(key);
      if (found !== void 0) found.count += 1;
      else edges.set(key, { a, b, count: 1 });
    };
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const i0 = indices[i];
      const i1 = indices[i + 1];
      const i2 = indices[i + 2];
      add2(i0, i1);
      add2(i1, i2);
      add2(i2, i0);
    }
    const out = [];
    for (const edge2 of edges.values()) {
      if (edge2.count === 1) out.push([edge2.a, edge2.b]);
    }
    out.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    return out;
  }
  var mulU8 = (a, b) => (a * b + 127) / 255 | 0;
  function roundByte(v) {
    return Math.min(255, Math.max(0, Math.floor(v + 0.5)));
  }
  function sampleTexture(page, u, v, filter) {
    const w = Math.max(1, Math.floor(page.width));
    const h = Math.max(1, Math.floor(page.height));
    const data = page.data;
    const premultiply2 = page.pma === false;
    const uWrap = page.uWrap ?? page.wrap ?? "clamp";
    const vWrap = page.vWrap ?? page.wrap ?? "clamp";
    const wrapIndex = (index, size, mode) => mode === "repeat" ? (index % size + size) % size : Math.min(size - 1, Math.max(0, index));
    const read = (x, y) => {
      const cx = wrapIndex(x, w, uWrap);
      const cy = wrapIndex(y, h, vWrap);
      const o = (cy * w + cx) * 4;
      const r = data[o] ?? 0;
      const g = data[o + 1] ?? 0;
      const b = data[o + 2] ?? 0;
      const a = data[o + 3] ?? 0;
      if (!premultiply2) return [r, g, b, a];
      return [mulU8(r, a), mulU8(g, a), mulU8(b, a), a];
    };
    const cu = Number.isFinite(u) ? uWrap === "repeat" ? u - Math.floor(u) : clamp013(u) : 0;
    const cv = Number.isFinite(v) ? vWrap === "repeat" ? v - Math.floor(v) : clamp013(v) : 0;
    if (filter === "nearest") {
      const ix = Math.min(w - 1, Math.floor(cu * w));
      const iy = Math.min(h - 1, Math.floor(cv * h));
      return read(ix, iy);
    }
    const fx = cu * w - 0.5;
    const fy = cv * h - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const c00 = read(x0, y0);
    const c10 = read(x0 + 1, y0);
    const c01 = read(x0, y0 + 1);
    const c11 = read(x0 + 1, y0 + 1);
    const out = [0, 0, 0, 0];
    for (let i = 0; i < 4; i += 1) {
      const top = c00[i] * (1 - tx) + c10[i] * tx;
      const bottom = c01[i] * (1 - tx) + c11[i] * tx;
      out[i] = roundByte(top * (1 - ty) + bottom * ty);
    }
    return out;
  }
  function validateAssets(assets) {
    const errors = [];
    const warnings = [];
    const pages = assets.pages;
    const maxPages = assets.maxTexturePages ?? 4;
    if (pages.length < 1) errors.push("\u7EB9\u7406\u9875\u6570\u91CF\u5FC5\u987B\u81F3\u5C11\u4E3A 1");
    if (pages.length > 4) errors.push("\u7EB9\u7406\u9875\u6570\u91CF\u8D85\u8FC7\u5F15\u64CE\u4E0A\u9650 4");
    if (pages.length > maxPages) errors.push(`\u7EB9\u7406\u9875\u6570\u91CF ${pages.length} \u8D85\u8FC7 maxTexturePages=${maxPages}`);
    pages.forEach((page, index) => {
      if (!Number.isInteger(page.width) || page.width <= 0) {
        errors.push(`\u7EB9\u7406\u9875 ${index} \u5BBD\u5EA6\u5FC5\u987B\u4E3A\u6B63\u6574\u6570`);
      }
      if (!Number.isInteger(page.height) || page.height <= 0) {
        errors.push(`\u7EB9\u7406\u9875 ${index} \u9AD8\u5EA6\u5FC5\u987B\u4E3A\u6B63\u6574\u6570`);
      }
      const need = Math.max(0, Math.floor(page.width)) * Math.max(0, Math.floor(page.height)) * 4;
      if (page.data.length !== need) {
        errors.push(`\u7EB9\u7406\u9875 ${index} \u6570\u636E\u957F\u5EA6 ${page.data.length} \u5E94\u4E3A ${need}\uFF08w*h*4\uFF09`);
      }
      if (page.pma === false) warnings.push(`\u7EB9\u7406\u9875 ${index} \u672A\u9884\u4E58 alpha`);
    });
    const ids = /* @__PURE__ */ new Set();
    for (const material of assets.materials) {
      if (!Number.isInteger(material.id) || material.id < 0) {
        errors.push(`\u6750\u8D28 id ${material.id} \u5FC5\u987B\u4E3A\u975E\u8D1F\u6574\u6570`);
      }
      if (ids.has(material.id)) errors.push(`\u6750\u8D28 id ${material.id} \u91CD\u590D`);
      ids.add(material.id);
      if (material.kind === "sprite") {
        if (!Number.isInteger(material.page) || material.page < 0 || material.page >= pages.length) {
          errors.push(`\u6750\u8D28 ${material.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u7EB9\u7406\u9875 ${material.page}`);
        }
      } else if (material.page !== -1 && (material.page < 0 || material.page >= pages.length)) {
        errors.push(`\u6750\u8D28 ${material.id} \u7684 flat \u9875\u53F7\u5E94\u4E3A -1`);
      }
    }
    if (assets.materials.length === 0) warnings.push("\u6750\u8D28\u5E93\u4E3A\u7A7A");
    return { errors, warnings };
  }
  function maskChain(path, maskPaths) {
    if (path === -1) return { ids: [], error: false };
    if (!Number.isInteger(path) || path < 0 || path >= maskPaths.length) {
      return { ids: [], error: true };
    }
    const ids = [];
    const seen = /* @__PURE__ */ new Set();
    let cursor = path;
    while (cursor !== -1) {
      if (!Number.isInteger(cursor) || cursor < 0 || cursor >= maskPaths.length) {
        return { ids: [], error: true };
      }
      if (seen.has(cursor)) return { ids: [], error: true };
      if (ids.length >= 8) return { ids: [], error: true };
      seen.add(cursor);
      ids.push(maskPaths[cursor].maskId);
      cursor = maskPaths[cursor].parent;
    }
    ids.reverse();
    return { ids, error: false };
  }

  // ../packages/render-engine/src/render/shader-variants.ts
  function variantOf(material, maskMode) {
    return {
      pma: material.pma ?? true,
      twoColor: material.twoColor ?? false,
      tintBlack: material.tintBlack ?? false,
      alphaMask: maskMode === "alpha",
      stencil: maskMode === "stencil"
    };
  }
  var VERTEX = `#version 300 es
in vec2 aPosition; in vec2 aUv; in vec4 aColor; in vec4 aDark;
uniform mat3 viewProjection; uniform vec2 uResolution;
out vec2 vUv; out vec4 vColor; out vec4 vDark; out vec2 vScreen;
void main() {
  vec3 p = viewProjection * vec3(aPosition, 1.0);
  gl_Position = vec4(p.x / uResolution.x * 2.0 - 1.0, 1.0 - p.y / uResolution.y * 2.0, 0.0, 1.0);
  vUv = aUv; vColor = aColor; vDark = aDark; vScreen = p.xy;
}`;
  var FRAGMENT = `#version 300 es
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
}`;

  // ../packages/render-engine/src/asset/image.ts
  var CHANNELS = 4;
  var mulU82 = (a, b) => (a * b + 127) / 255 | 0;
  function premultiply(data) {
    const out = new Uint8Array(data.length);
    for (let i = 0; i + 3 < data.length; i += CHANNELS) {
      const a = data[i + 3];
      out[i] = Math.min(255, mulU82(data[i], a));
      out[i + 1] = Math.min(255, mulU82(data[i + 1], a));
      out[i + 2] = Math.min(255, mulU82(data[i + 2], a));
      out[i + 3] = a;
    }
    return out;
  }

  // ../packages/render-engine/src/backend/backend.ts
  var EPS3 = 1e-12;
  var mulU83 = (a, b) => (a * b + 127) / 255 | 0;
  var clampUnit = (v) => Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  function assetError(code, detail) {
    return Object.assign(new Error(`${code}: ${detail}`), { code });
  }
  function checkAssets(assets) {
    const { errors } = validateAssets(assets);
    if (errors.length > 0) throw assetError("E_ASSET_INVALID", errors.join("; "));
  }
  function spritePage(material, pages) {
    if (material?.kind === "sprite" && pages?.[material.page] === void 0) {
      throw assetError("E_TEXTURE_MISSING", `\u6750\u8D28 ${material.id} \u7684\u56FE\u96C6\u9875 ${material.page} \u7F3A\u5931`);
    }
  }
  function distanceToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 <= EPS3) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }
  function pointInPolygon(poly, px, py) {
    let inside = false;
    const count = Math.floor(poly.length / 2);
    for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
      const xi = poly[i * 2];
      const yi = poly[i * 2 + 1];
      const xj = poly[j * 2];
      const yj = poly[j * 2 + 1];
      const intersects = yi > py !== yj > py && px < (xj - xi) * (py - yi) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }
  function distanceToPolygon(poly, px, py) {
    const count = Math.floor(poly.length / 2);
    let best = Infinity;
    for (let i = 0; i < count; i += 1) {
      const j = (i + 1) % count;
      const d = distanceToSegment(px, py, poly[i * 2], poly[i * 2 + 1], poly[j * 2], poly[j * 2 + 1]);
      if (d < best) best = d;
    }
    return best;
  }
  function blendPixel(dst, di, sr, sg, sb, sa, mode) {
    const dr = dst[di];
    const dg = dst[di + 1];
    const db = dst[di + 2];
    const da = dst[di + 3];
    const inv = 255 - sa;
    switch (mode) {
      case "normal":
        dst[di] = sr + mulU83(dr, inv);
        dst[di + 1] = sg + mulU83(dg, inv);
        dst[di + 2] = sb + mulU83(db, inv);
        dst[di + 3] = sa + mulU83(da, inv);
        break;
      case "add":
        dst[di] = sr + dr;
        dst[di + 1] = sg + dg;
        dst[di + 2] = sb + db;
        dst[di + 3] = sa + da;
        break;
      case "multiply":
        dst[di] = mulU83(sr, dr) + mulU83(dr, inv);
        dst[di + 1] = mulU83(sg, dg) + mulU83(dg, inv);
        dst[di + 2] = mulU83(sb, db) + mulU83(db, inv);
        dst[di + 3] = sa + mulU83(da, inv);
        break;
      case "screen":
        dst[di] = sr + mulU83(dr, 255 - sr);
        dst[di + 1] = sg + mulU83(dg, 255 - sg);
        dst[di + 2] = sb + mulU83(db, 255 - sb);
        dst[di + 3] = sa + mulU83(da, inv);
        break;
    }
  }
  var edge = (a, b, x, y) => (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
  function insideEdge(e, a, b) {
    if (e > 0) return true;
    if (e < 0) return false;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dy === 0 && dx > 0) return true;
    if (dy < 0) return true;
    return false;
  }
  var CpuBackend = class {
    kind = "cpu";
    stats = {
      drawCalls: 0,
      packets: 0,
      batches: 0,
      textureBinds: 0,
      programSwitches: 0,
      uploadedBytes: 0,
      uploadedVertices: 0,
      maskTests: 0,
      textureSamples: 0
    };
    width;
    height;
    ss;
    background;
    color;
    disposed = false;
    /** prepare() 缓存的资产；frame.assets 优先。 */
    assets = null;
    depthBuffer = null;
    depthMode = "none";
    material = null;
    page = null;
    masks = [];
    maskCache = /* @__PURE__ */ new Map();
    constructor(a = {}, b, c) {
      const opts = typeof a === "number" ? { width: a, height: b ?? 1, supersample: c ?? 1 } : a;
      this.width = Math.max(1, Math.floor(opts.width ?? 1));
      this.height = Math.max(1, Math.floor(opts.height ?? 1));
      this.ss = opts.supersample ?? 1;
      this.background = opts.background ?? [0, 0, 0, 255];
      this.color = new Uint8ClampedArray(this.width * this.ss * this.height * this.ss * 4);
      this.clear();
    }
    /** CPU 端资产只是引用；真正采样在 draw 时进行。 */
    prepare(assets) {
      checkAssets(assets);
      this.assets = assets;
    }
    resize(v) {
      const w = Math.max(1, Math.floor(v.width));
      const h = Math.max(1, Math.floor(v.height));
      if (w === this.width && h === this.height) return;
      this.width = w;
      this.height = h;
      this.color = new Uint8ClampedArray(w * this.ss * h * this.ss * 4);
      this.depthBuffer = null;
      this.clear();
    }
    clear() {
      const [r, g, b, a] = this.background;
      this.color[0] = r;
      this.color[1] = g;
      this.color[2] = b;
      this.color[3] = a;
      const packed = new Uint32Array(this.color.buffer);
      packed.fill(packed[0]);
    }
    toScreen(frame, x, y) {
      const m = frame.viewProjection;
      if (m === void 0) return [x, y];
      if (m.length >= 16) {
        const cx = m[0] * x + m[4] * y + m[12];
        const cy = m[1] * x + m[5] * y + m[13];
        const cw = m[3] * x + m[7] * y + m[15];
        const w = Math.abs(cw) < EPS3 ? EPS3 : cw;
        return [(cx / w * 0.5 + 0.5) * frame.width, (0.5 - cy / w * 0.5) * frame.height];
      }
      if (m.length >= 9) {
        const cx = m[0] * x + m[3] * y + m[6];
        const cy = m[1] * x + m[4] * y + m[7];
        const cw = m[2] * x + m[5] * y + m[8];
        const w = Math.abs(cw) < EPS3 ? EPS3 : cw;
        return [cx / w, cy / w];
      }
      return [x, y];
    }
    rasterize(p0, p1, p2, ss, ssW, ssH) {
      let area = edge(p0, p1, p2.x, p2.y);
      if (!Number.isFinite(area) || Math.abs(area) < EPS3) return;
      if (area < 0) {
        const tmp = p1;
        p1 = p2;
        p2 = tmp;
        area = -area;
      }
      const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x) * ss - 0.5));
      const maxX = Math.min(ssW - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x) * ss - 0.5));
      const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y) * ss - 0.5));
      const maxY = Math.min(ssH - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y) * ss - 0.5));
      if (this.currentBlend === "normal" && !this.currentTwoColor && this.page === null && this.masks.length === 0 && this.depthMode === "none" && p0.a === 255 && p1.a === 255 && p2.a === 255 && p0.r === p1.r && p1.r === p2.r && p0.g === p1.g && p1.g === p2.g && p0.b === p1.b && p1.b === p2.b) {
        const rgba = new Uint8ClampedArray([p0.r, p0.g, p0.b, 255]);
        const packed = new Uint32Array(rgba.buffer)[0];
        const pixels = new Uint32Array(this.color.buffer);
        const top0 = p2.y - p1.y < 0 || p2.y === p1.y && p2.x > p1.x;
        const top1 = p0.y - p2.y < 0 || p0.y === p2.y && p0.x > p2.x;
        const top2 = p1.y - p0.y < 0 || p1.y === p0.y && p1.x > p0.x;
        for (let sy = minY; sy <= maxY; sy += 1) {
          const py = (sy + 0.5) / ss;
          let di = sy * ssW + minX;
          for (let sx = minX; sx <= maxX; sx += 1, di += 1) {
            const px = (sx + 0.5) / ss;
            const w0 = edge(p1, p2, px, py);
            if (w0 < 0 || w0 === 0 && !top0) continue;
            const w1 = edge(p2, p0, px, py);
            if (w1 < 0 || w1 === 0 && !top1) continue;
            const w2 = edge(p0, p1, px, py);
            if (w2 < 0 || w2 === 0 && !top2) continue;
            pixels[di] = packed;
          }
        }
        return;
      }
      for (let sy = minY; sy <= maxY; sy += 1) {
        const py = (sy + 0.5) / ss;
        for (let sx = minX; sx <= maxX; sx += 1) {
          const px = (sx + 0.5) / ss;
          const w0 = edge(p1, p2, px, py);
          if (!insideEdge(w0, p1, p2)) continue;
          const w1 = edge(p2, p0, px, py);
          if (!insideEdge(w1, p2, p0)) continue;
          const w2 = edge(p0, p1, px, py);
          if (!insideEdge(w2, p0, p1)) continue;
          const b0 = w0 / area;
          const b1 = w1 / area;
          const b2 = w2 / area;
          let r = Math.round(b0 * p0.r + b1 * p1.r + b2 * p2.r);
          let g = Math.round(b0 * p0.g + b1 * p1.g + b2 * p2.g);
          let b = Math.round(b0 * p0.b + b1 * p1.b + b2 * p2.b);
          const a = Math.round(b0 * p0.a + b1 * p1.a + b2 * p2.a);
          const dr = Math.round(b0 * (p0.dr ?? 0) + b1 * (p1.dr ?? 0) + b2 * (p2.dr ?? 0));
          const dg = Math.round(b0 * (p0.dg ?? 0) + b1 * (p1.dg ?? 0) + b2 * (p2.dg ?? 0));
          const db = Math.round(b0 * (p0.db ?? 0) + b1 * (p1.db ?? 0) + b2 * (p2.db ?? 0));
          const da = Math.round(b0 * (p0.da ?? 0) + b1 * (p1.da ?? 0) + b2 * (p2.da ?? 0));
          const u = b0 * p0.u + b1 * p1.u + b2 * p2.u;
          const v = b0 * p0.v + b1 * p1.v + b2 * p2.v;
          const z = b0 * p0.z + b1 * p1.z + b2 * p2.z;
          this.shadeFragment(sx, sy, px, py, u, v, r, g, b, a, dr, dg, db, da, z);
        }
      }
    }
    /** 片元着色：mask → 深度 → 纹理调制 → 混合；纹理/顶点色都在 PMA 域只乘一次。 */
    shadeFragment(sx, sy, px, py, u, v, r, g, b, a, dr, dg, db, da, z) {
      if (a <= 0) return;
      const ssW = this.width * this.ss;
      let coverage = 1;
      for (const ctx of this.masks) {
        this.stats.maskTests += 1;
        coverage *= this.maskCoverageAt(ctx, px / this.ss, py / this.ss);
        if (coverage <= 0) return;
      }
      if (this.depthMode !== "none" && this.depthBuffer !== null) {
        const di = sy * ssW + sx;
        const current = this.depthBuffer[di] ?? 1;
        if (!Number.isFinite(z) || z >= current) return;
        if (this.depthMode === "write") this.depthBuffer[di] = z;
      }
      let texel = [255, 255, 255, 255];
      if (this.material !== null && this.material.kind === "sprite" && this.page !== null) {
        texel = sampleTexture(this.page, u, v, this.page.magFilter ?? this.page.filter ?? this.material.filter);
        this.stats.textureSamples += 1;
      }
      if (this.currentTwoColor) {
        const tintBlack = this.material?.tintBlack === true;
        const darkFactor = (texel[3] - 255) * (tintBlack ? 255 : da) / 255 + 255;
        r = Math.round((darkFactor - texel[0]) * (tintBlack ? 0 : dr) / 255 + texel[0] * r / 255);
        g = Math.round((darkFactor - texel[1]) * (tintBlack ? 0 : dg) / 255 + texel[1] * g / 255);
        b = Math.round((darkFactor - texel[2]) * (tintBlack ? 0 : db) / 255 + texel[2] * b / 255);
      } else {
        r = mulU83(texel[0], r);
        g = mulU83(texel[1], g);
        b = mulU83(texel[2], b);
      }
      a = mulU83(texel[3], a);
      if (coverage < 1) {
        const c = Math.round(coverage * 255);
        r = mulU83(r, c);
        g = mulU83(g, c);
        b = mulU83(b, c);
        a = mulU83(a, c);
      }
      if (a <= 0) return;
      blendPixel(this.color, (sy * ssW + sx) * 4, r, g, b, a, this.currentBlend);
    }
    /** 把 mask 的 world 几何预转换到屏幕空间；同一帧内按对象缓存。 */
    maskCtxFor(mask, frame, assets) {
      const cached = this.maskCache.get(mask);
      if (cached !== void 0) return cached;
      const corners = [
        this.toScreen(frame, mask.bounds.x, mask.bounds.y),
        this.toScreen(frame, mask.bounds.x + mask.bounds.width, mask.bounds.y),
        this.toScreen(frame, mask.bounds.x + mask.bounds.width, mask.bounds.y + mask.bounds.height),
        this.toScreen(frame, mask.bounds.x, mask.bounds.y + mask.bounds.height)
      ];
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [x, y] of corners) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      let poly = null;
      if (mask.mode === "stencil") {
        poly = [];
        for (let i = 0; i + 1 < mask.positions.length; i += 2) {
          const [sx, sy] = this.toScreen(frame, mask.positions[i], mask.positions[i + 1]);
          poly.push(sx, sy);
        }
      }
      let alphaPage = null;
      if (mask.mode === "alpha" && mask.alpha !== void 0 && assets !== null) {
        alphaPage = assets.pages[mask.alpha.page] ?? null;
      }
      const ctx = { mask, rect: { x0, y0, x1, y1 }, poly, alphaPage };
      this.maskCache.set(mask, ctx);
      return ctx;
    }
    /** 像素点（设备像素）的 mask 覆盖率 0..1；invert 作用于单层。 */
    maskCoverageAt(ctx, px, py) {
      const mask = ctx.mask;
      let coverage = 0;
      if (mask.mode === "scissor") {
        const r = ctx.rect;
        coverage = px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1 ? 1 : 0;
      } else if (mask.mode === "stencil") {
        const poly = ctx.poly ?? [];
        const inside = pointInPolygon(poly, px, py);
        if (mask.feather > 0) {
          const d = distanceToPolygon(poly, px, py);
          coverage = clampUnit(0.5 + (inside ? d : -d) / mask.feather);
        } else {
          coverage = inside ? 1 : 0;
        }
      } else {
        const page = ctx.alphaPage;
        const alpha = mask.alpha;
        if (page === null || alpha === void 0) {
          coverage = 0;
        } else {
          const r = ctx.rect;
          const u = r.x1 > r.x0 ? (px - r.x0) / (r.x1 - r.x0) : 0;
          const v = r.y1 > r.y0 ? (py - r.y0) / (r.y1 - r.y0) : 0;
          const m = alpha.uvMatrix;
          const up = m[0] * u + m[2] * v + m[4];
          const vp = m[1] * u + m[3] * v + m[5];
          const a = sampleTexture(page, up, vp, "linear")[3];
          coverage = mask.feather > 0 ? a / 255 : a >= 128 ? 1 : 0;
        }
      }
      return mask.invert ? 1 - coverage : coverage;
    }
    currentBlend = "normal";
    currentTwoColor = false;
    draw(frame) {
      if (this.disposed) throw new Error("CpuBackend: \u5DF2 dispose\uFF0C\u4E0D\u80FD\u7EE7\u7EED draw");
      if (frame.width !== this.width || frame.height !== this.height) {
        this.resize({ width: frame.width, height: frame.height });
      }
      this.clear();
      this.stats.drawCalls = 0;
      this.stats.packets = 0;
      this.stats.batches = 0;
      this.stats.textureBinds = 0;
      this.stats.programSwitches = 0;
      this.stats.uploadedBytes = 0;
      this.stats.uploadedVertices = 0;
      this.stats.maskTests = 0;
      this.stats.textureSamples = 0;
      const ss = this.ss;
      const ssW = this.width * ss;
      const ssH = this.height * ss;
      if (frame.assets !== void 0 && frame.assets !== this.assets) this.prepare(frame.assets);
      const assets = frame.assets ?? this.assets;
      this.depthMode = frame.depthMode ?? "none";
      if (this.depthMode !== "none") {
        const size = ssW * ssH;
        if (this.depthBuffer === null || this.depthBuffer.length !== size) {
          this.depthBuffer = new Float32Array(size);
        }
        this.depthBuffer.fill(1);
      } else {
        this.depthBuffer = null;
      }
      this.maskCache.clear();
      for (const packet of frame.packets) {
        this.stats.packets += 1;
        this.stats.batches += 1;
        this.stats.drawCalls += 1;
        this.currentBlend = packet.blend;
        this.material = assets?.materials.find((m) => m.id === packet.materialId) ?? null;
        this.currentTwoColor = packet.twoColor === true && packet.dark !== void 0 || this.material?.tintBlack === true;
        spritePage(this.material, assets?.pages);
        this.page = this.material !== null && this.material.kind === "sprite" && assets !== null ? assets.pages[this.material.page] ?? null : null;
        this.masks = [];
        if (frame.maskPaths !== void 0 && frame.masks !== void 0 && packet.maskPath >= 0) {
          const chain = maskChain(packet.maskPath, frame.maskPaths);
          if (!chain.error) {
            for (const id of chain.ids) {
              const mask = frame.masks.masks[id];
              if (mask !== null && mask !== void 0) this.masks.push(this.maskCtxFor(mask, frame, assets));
            }
          }
        }
        const vertexCount = Math.min(Math.floor(packet.uvs.length / 2), Math.floor(packet.positions.length / 2));
        if (vertexCount <= 0) continue;
        this.stats.uploadedVertices += vertexCount;
        const stride = vertexCount > 0 ? packet.positions.length / vertexCount : 0;
        if (!Number.isFinite(stride) || stride < 2) continue;
        const verts = [];
        for (let i = 0; i < vertexCount; i += 1) {
          const [x, y] = this.toScreen(frame, packet.positions[i * stride], packet.positions[i * stride + 1]);
          const o = i * 4;
          const uv = i * 2;
          const dark = packet.dark;
          const z = packet.depth !== null ? clampUnit(packet.depth[i] ?? 1) : clampUnit(0.5 - packet.depthKey * 0.01);
          verts.push({
            x: x * ss,
            y: y * ss,
            u: packet.uvs[uv] ?? 0,
            v: packet.uvs[uv + 1] ?? 0,
            z,
            r: packet.colors[o],
            g: packet.colors[o + 1],
            b: packet.colors[o + 2],
            a: packet.colors[o + 3],
            dr: dark?.[o] ?? 0,
            dg: dark?.[o + 1] ?? 0,
            db: dark?.[o + 2] ?? 0,
            da: dark?.[o + 3] ?? 0
          });
        }
        for (let t = 0; t + 2 < packet.indices.length; t += 3) {
          const i0 = packet.indices[t];
          const i1 = packet.indices[t + 1];
          const i2 = packet.indices[t + 2];
          const v0 = verts[i0];
          const v1 = verts[i1];
          const v2 = verts[i2];
          if (v0 === void 0 || v1 === void 0 || v2 === void 0) continue;
          this.rasterize(v0, v1, v2, 1, ssW, ssH);
        }
      }
    }
    readPixels(out) {
      if (this.disposed) throw new Error("CpuBackend: \u5DF2 dispose");
      const size = this.width * this.height * 4;
      const target = out ?? new Uint8ClampedArray(size);
      if (target.length !== size) throw new RangeError("CpuBackend.readPixels: \u8F93\u51FA\u7F13\u51B2\u5C3A\u5BF8\u4E0D\u5339\u914D");
      if (this.ss === 1) {
        target.set(this.color);
        return target;
      }
      const ssW = this.width * this.ss;
      for (let y = 0; y < this.height; y += 1) {
        for (let x = 0; x < this.width; x += 1) {
          const o = (y * this.width + x) * 4;
          for (let c = 0; c < 4; c += 1) {
            let sum = 0;
            for (let sy = 0; sy < this.ss; sy += 1) {
              for (let sx = 0; sx < this.ss; sx += 1) {
                sum += this.color[((y * this.ss + sy) * ssW + x * this.ss + sx) * 4 + c];
              }
            }
            target[o + c] = Math.round(sum / (this.ss * this.ss));
          }
        }
      }
      return target;
    }
    dispose() {
      this.disposed = true;
      this.color = new Uint8ClampedArray(0);
    }
  };
  var GL_ARRAY_BUFFER = 34962;
  var GL_ELEMENT_ARRAY_BUFFER = 34963;
  var GL_DYNAMIC_DRAW = 35048;
  var GL_FLOAT = 5126;
  var GL_UNSIGNED_BYTE = 5121;
  var GL_UNSIGNED_SHORT = 5123;
  var GL_UNSIGNED_INT = 5125;
  var GL_TRIANGLES = 4;
  var GL_RGBA = 6408;
  var GL_RGBA8 = 32856;
  var GL_TEXTURE_2D = 3553;
  var GL_TEXTURE0 = 33984;
  var GL_TEXTURE1 = 33985;
  var GL_TEXTURE_MIN_FILTER = 10241;
  var GL_TEXTURE_MAG_FILTER = 10240;
  var GL_TEXTURE_WRAP_S = 10242;
  var GL_TEXTURE_WRAP_T = 10243;
  var GL_LINEAR = 9729;
  var GL_NEAREST = 9728;
  var GL_LINEAR_MIPMAP_LINEAR = 9987;
  var GL_NEAREST_MIPMAP_NEAREST = 9984;
  var GL_LINEAR_MIPMAP_NEAREST = 9985;
  var GL_NEAREST_MIPMAP_LINEAR = 9986;
  var GL_CLAMP_TO_EDGE = 33071;
  var GL_REPEAT = 10497;
  var GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL = 37440;
  var GL_SCISSOR_TEST = 3089;
  var GL_BLEND = 3042;
  var GL_ONE = 1;
  var GL_ONE_MINUS_SRC_ALPHA = 771;
  var GL_DST_COLOR = 774;
  var GL_ONE_MINUS_SRC_COLOR = 769;
  var GL_STENCIL_TEST = 2960;
  var GL_DEPTH_TEST = 2929;
  var GL_ALWAYS = 519;
  var GL_EQUAL = 514;
  var GL_NOTEQUAL = 517;
  var GL_LEQUAL = 515;
  var GL_KEEP = 7680;
  var GL_REPLACE = 7681;
  var GL_STENCIL_BUFFER_BIT = 1024;
  var GL_STENCIL_BITS = 3415;
  var GL_DEPTH_BUFFER_BIT = 256;
  function indexType(indices) {
    return indices instanceof Uint16Array ? GL_UNSIGNED_SHORT : GL_UNSIGNED_INT;
  }
  var GL_VERTEX_SHADER = 35633;
  var GL_FRAGMENT_SHADER = 35632;
  var GL_COMPILE_STATUS = 35713;
  var GL_LINK_STATUS = 35714;
  var DEFAULT_VERTEX_SHADER = VERTEX;
  var DEFAULT_FRAGMENT_SHADER = FRAGMENT.replace("#version 300 es", "#version 300 es\n#define ALPHA_MASK 1\n#define TWO_COLOR 1");
  function compileDefaultProgram(gl) {
    if (gl.createShader === void 0 || gl.createProgram === void 0 || gl.shaderSource === void 0 || gl.compileShader === void 0 || gl.attachShader === void 0 || gl.linkProgram === void 0) return null;
    const vs = gl.createShader(GL_VERTEX_SHADER);
    const fs = gl.createShader(GL_FRAGMENT_SHADER);
    gl.shaderSource?.(vs, DEFAULT_VERTEX_SHADER);
    gl.shaderSource?.(fs, DEFAULT_FRAGMENT_SHADER);
    gl.compileShader?.(vs);
    gl.compileShader?.(fs);
    if (gl.getShaderParameter?.(vs, GL_COMPILE_STATUS) === false || gl.getShaderParameter?.(fs, GL_COMPILE_STATUS) === false) {
      gl.deleteShader?.(vs);
      gl.deleteShader?.(fs);
      return null;
    }
    const program = gl.createProgram();
    gl.attachShader?.(program, vs);
    gl.attachShader?.(program, fs);
    gl.linkProgram?.(program);
    gl.deleteShader?.(vs);
    gl.deleteShader?.(fs);
    if (gl.getProgramParameter?.(program, GL_LINK_STATUS) === false) return null;
    return program;
  }
  var WebGL2Backend = class {
    kind = "webgl2";
    stats = {
      drawCalls: 0,
      packets: 0,
      batches: 0,
      textureBinds: 0,
      programSwitches: 0,
      uploadedBytes: 0,
      uploadedVertices: 0,
      maskTests: 0,
      textureSamples: 0
    };
    /** 上下文恢复次数，供测试/诊断。 */
    restoreCount = 0;
    gl;
    buffers = null;
    capacities = /* @__PURE__ */ new Map();
    program;
    programCache;
    width = 1;
    height = 1;
    pixels = new Uint8ClampedArray(4);
    disposed = false;
    assets = null;
    currentBlend = null;
    textures = [];
    whiteTexture = null;
    constructor(gl, program, programCache) {
      if (gl === null || typeof gl !== "object") throw new Error("WebGL2Backend: \u7F3A\u5C11 gl \u4E0A\u4E0B\u6587");
      if (typeof gl.drawElements !== "function") throw new Error("WebGL2Backend: gl.drawElements \u4E0D\u53EF\u7528\uFF0C\u65E0\u6CD5\u63D0\u4EA4\u7ED8\u5236");
      if (gl.getParameter !== void 0 && Number(gl.getParameter(GL_STENCIL_BITS)) < 1) {
        throw new Error("WebGL2Backend: \u7F3A\u5C11 stencil buffer\uFF08\u521B\u5EFA\u4E0A\u4E0B\u6587\u65F6\u9700\u6307\u5B9A stencil: true\uFF09");
      }
      this.gl = gl;
      this.program = program ?? compileDefaultProgram(gl) ?? {};
      this.programCache = programCache ?? null;
      if (typeof gl.createBuffer === "function") {
        this.buffers = {
          positions: gl.createBuffer(),
          uvs: gl.createBuffer(),
          colors: gl.createBuffer(),
          darks: gl.createBuffer(),
          indices: gl.createBuffer()
        };
      }
    }
    /** 上传页纹理与 1x1 白纹理；帧切换资产时同步更新页绑定。 */
    prepare(assets) {
      checkAssets(assets);
      if (this.textures.length > 0) {
        for (const texture of this.textures) this.gl.deleteTexture?.(texture);
        if (this.whiteTexture !== null) this.gl.deleteTexture?.(this.whiteTexture);
      }
      this.assets = assets;
      this.uploadAssets(assets);
    }
    uploadAssets(assets) {
      const gl = this.gl;
      this.textures = [];
      this.whiteTexture = null;
      if (typeof gl.createTexture !== "function") return;
      const filterOf = (index) => {
        const material = assets.materials.find((m) => m.kind === "sprite" && m.page === index);
        return material?.filter ?? "linear";
      };
      for (let i = 0; i < assets.pages.length; i += 1) {
        const page = assets.pages[i];
        const texture = gl.createTexture();
        gl.activeTexture?.(GL_TEXTURE0 + i);
        this.bindTexture(GL_TEXTURE_2D, texture);
        const pixels = page.pma === false ? premultiply(page.data) : page.data;
        gl.pixelStorei?.(GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        gl.texImage2D?.(
          GL_TEXTURE_2D,
          0,
          GL_RGBA8,
          page.width,
          page.height,
          0,
          GL_RGBA,
          GL_UNSIGNED_BYTE,
          pixels
        );
        const nearest = (page.magFilter ?? page.filter ?? filterOf(i)) === "nearest";
        const mipmap = page.mipmap === true || (page.minFilter?.startsWith("mipmap") ?? false);
        const minFilter = (() => {
          switch (page.minFilter) {
            case "nearest":
              return GL_NEAREST;
            case "linear":
              return GL_LINEAR;
            case "mipmapNearestNearest":
              return GL_NEAREST_MIPMAP_NEAREST;
            case "mipmapLinearNearest":
              return GL_LINEAR_MIPMAP_NEAREST;
            case "mipmapNearestLinear":
              return GL_NEAREST_MIPMAP_LINEAR;
            case "mipmap":
            case "mipmapLinearLinear":
              return GL_LINEAR_MIPMAP_LINEAR;
            default:
              return mipmap ? nearest ? GL_NEAREST_MIPMAP_NEAREST : GL_LINEAR_MIPMAP_LINEAR : nearest ? GL_NEAREST : GL_LINEAR;
          }
        })();
        gl.texParameteri?.(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, minFilter);
        gl.texParameteri?.(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, nearest ? GL_NEAREST : GL_LINEAR);
        gl.texParameteri?.(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, (page.uWrap ?? page.wrap) === "repeat" ? GL_REPEAT : GL_CLAMP_TO_EDGE);
        gl.texParameteri?.(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, (page.vWrap ?? page.wrap) === "repeat" ? GL_REPEAT : GL_CLAMP_TO_EDGE);
        if (mipmap) gl.generateMipmap?.(GL_TEXTURE_2D);
        this.textures.push(texture);
      }
      const white = gl.createTexture();
      gl.activeTexture?.(GL_TEXTURE0);
      this.bindTexture(GL_TEXTURE_2D, white);
      gl.texImage2D?.(
        GL_TEXTURE_2D,
        0,
        GL_RGBA8,
        1,
        1,
        0,
        GL_RGBA,
        GL_UNSIGNED_BYTE,
        new Uint8Array([255, 255, 255, 255])
      );
      gl.texParameteri?.(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
      gl.texParameteri?.(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
      gl.texParameteri?.(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
      gl.texParameteri?.(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
      this.whiteTexture = white;
      gl.pixelStorei?.(GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    }
    /** 上下文恢复：重建 buffer/texture/Program 状态，并记录次数。 */
    restore() {
      this.disposed = false;
      const gl = this.gl;
      if (typeof gl.createBuffer === "function") {
        this.buffers = {
          positions: gl.createBuffer(),
          uvs: gl.createBuffer(),
          colors: gl.createBuffer(),
          darks: gl.createBuffer(),
          indices: gl.createBuffer()
        };
      } else {
        this.buffers = null;
      }
      this.capacities.clear();
      this.gl.useProgram?.(this.program);
      if (this.assets !== null) this.uploadAssets(this.assets);
      this.restoreCount += 1;
    }
    resize(v) {
      this.width = Math.max(1, Math.floor(v.width));
      this.height = Math.max(1, Math.floor(v.height));
      this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
    }
    upload(target, buffer, data) {
      const gl = this.gl;
      if (buffer === null || buffer === void 0 || gl.bindBuffer === void 0 || gl.bufferSubData === void 0) return;
      gl.bindBuffer(target, buffer);
      const need = data.byteLength;
      const have = this.capacities.get(buffer) ?? 0;
      if (need > have && gl.bufferData !== void 0) {
        gl.bufferData(target, need, GL_DYNAMIC_DRAW);
        this.capacities.set(buffer, need);
      }
      gl.bufferSubData(target, 0, data);
      this.stats.uploadedBytes += data.byteLength;
    }
    setAttrib(name, size, type, normalized) {
      const gl = this.gl;
      const loc = gl.getAttribLocation?.(this.program, name);
      if (loc === void 0 || loc < 0 || gl.enableVertexAttribArray === void 0 || gl.vertexAttribPointer === void 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, normalized, 0, 0);
    }
    resetDarkAttrib() {
      const gl = this.gl;
      const loc = gl.getAttribLocation?.(this.program, "aDark");
      if (loc === void 0 || loc < 0) return;
      gl.disableVertexAttribArray?.(loc);
      gl.vertexAttrib4f?.(loc, 0, 0, 0, 0);
    }
    setUniform1f(name, value) {
      const gl = this.gl;
      if (gl.getUniformLocation === void 0 || gl.uniform1f === void 0) return;
      const loc = gl.getUniformLocation(this.program, name);
      if (loc !== null && loc !== void 0) gl.uniform1f(loc, value);
    }
    setResolution(width, height) {
      const gl = this.gl;
      if (gl.getUniformLocation === void 0 || gl.uniform2f === void 0) return;
      const loc = gl.getUniformLocation(this.program, "uResolution");
      if (loc !== null && loc !== void 0) gl.uniform2f(loc, width, height);
    }
    setViewProjection(vp) {
      const gl = this.gl;
      if (gl.getUniformLocation === void 0 || gl.uniformMatrix3fv === void 0) return;
      const loc = gl.getUniformLocation(this.program, "viewProjection");
      if (loc === null || loc === void 0) return;
      if (vp !== void 0 && vp.length >= 16) {
        gl.uniformMatrix3fv(loc, false, new Float32Array([
          vp[0] * this.width / 2,
          -vp[1] * this.height / 2,
          0,
          vp[4] * this.width / 2,
          -vp[5] * this.height / 2,
          0,
          (vp[12] + 1) * this.width / 2,
          (1 - vp[13]) * this.height / 2,
          1
        ]));
      } else {
        gl.uniformMatrix3fv(loc, false, vp?.length === 9 ? vp : new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
      }
    }
    setUniform1i(name, value) {
      const gl = this.gl;
      if (gl.getUniformLocation === void 0 || gl.uniform1i === void 0) return;
      const loc = gl.getUniformLocation(this.program, name);
      if (loc === null || loc === void 0) return;
      gl.uniform1i(loc, value);
    }
    maskMode(frame, path) {
      if (path < 0 || frame.maskPaths === void 0 || frame.masks === void 0) return "none";
      const chain = maskChain(path, frame.maskPaths);
      if (chain.error) return "none";
      let mode = "none";
      for (const id of chain.ids) {
        const mask = frame.masks.masks[id];
        if (mask?.mode === "alpha") {
          if (mode === "alpha") throw new Error("WebGL2Backend: \u591A\u7EA7 alpha mask \u5C1A\u4E0D\u652F\u6301");
          mode = "alpha";
        } else if (mask?.mode === "stencil" && mode === "none") {
          mode = "stencil";
        }
      }
      return mode;
    }
    bindTexture(target, texture) {
      if (this.gl.bindTexture === void 0) return;
      this.gl.bindTexture(target, texture);
      this.stats.textureBinds += 1;
    }
    useProgram(program) {
      if (this.gl.useProgram === void 0) return;
      this.gl.useProgram(program);
      this.stats.programSwitches += 1;
    }
    setAlphaMask(mask, frame) {
      const alpha = mask.alpha;
      const texture = alpha === void 0 ? void 0 : this.textures[alpha.page];
      if (texture === void 0) throw assetError("E_TEXTURE_MISSING", `alpha mask ${mask.id} \u7684\u7EB9\u7406\u9875\u7F3A\u5931`);
      const { x, y, width, height } = mask.bounds;
      const corners = [
        this.toScreen(frame, x, y),
        this.toScreen(frame, x + width, y),
        this.toScreen(frame, x, y + height),
        this.toScreen(frame, x + width, y + height)
      ];
      const xs = corners.map((corner) => corner[0]);
      const ys = corners.map((corner) => corner[1]);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const gl = this.gl;
      gl.activeTexture?.(GL_TEXTURE1);
      this.bindTexture(GL_TEXTURE_2D, texture);
      this.setUniform1i("uMask", 1);
      const loc = gl.getUniformLocation?.(this.program, "uMaskBounds");
      if (loc !== null && loc !== void 0) {
        gl.uniform4f?.(loc, minX, minY, Math.max(Math.max(...xs) - minX, EPS3), Math.max(Math.max(...ys) - minY, EPS3));
      }
      const m = alpha.uvMatrix;
      const matrix = new Float32Array([m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1]);
      const matrixLoc = gl.getUniformLocation?.(this.program, "uMaskUvMatrix");
      if (matrixLoc !== null && matrixLoc !== void 0) gl.uniformMatrix3fv?.(matrixLoc, false, matrix);
      this.setUniform1f("uMaskInvert", mask.invert ? 1 : 0);
      this.setUniform1f("uMaskFeather", mask.feather);
      this.setUniform1f("uAlphaMask", 1);
    }
    /** world 包围盒 → 设备像素矩形；无 viewProjection 时按像素坐标直通。 */
    projectBounds(frame, bounds) {
      const corners = [
        this.toScreen(frame, bounds.x, bounds.y),
        this.toScreen(frame, bounds.x + bounds.width, bounds.y),
        this.toScreen(frame, bounds.x + bounds.width, bounds.y + bounds.height),
        this.toScreen(frame, bounds.x, bounds.y + bounds.height)
      ];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x2, y2] of corners) {
        minX = Math.min(minX, x2);
        minY = Math.min(minY, y2);
        maxX = Math.max(maxX, x2);
        maxY = Math.max(maxY, y2);
      }
      const x = Math.floor(minX);
      const y = Math.floor(minY);
      return { x, y, width: Math.max(0, Math.ceil(maxX) - x), height: Math.max(0, Math.ceil(maxY) - y) };
    }
    toScreen(frame, x, y) {
      const m = frame.viewProjection;
      if (m === void 0) return [x, y];
      if (m.length >= 16) {
        const cx = m[0] * x + m[4] * y + m[12];
        const cy = m[1] * x + m[5] * y + m[13];
        const cw = m[3] * x + m[7] * y + m[15];
        const w = Math.abs(cw) < EPS3 ? EPS3 : cw;
        return [(cx / w * 0.5 + 0.5) * frame.width, (0.5 - cy / w * 0.5) * frame.height];
      }
      if (m.length >= 9) {
        const cx = m[0] * x + m[3] * y + m[6];
        const cy = m[1] * x + m[4] * y + m[7];
        const cw = m[2] * x + m[5] * y + m[8];
        const w = Math.abs(cw) < EPS3 ? EPS3 : cw;
        return [cx / w, cy / w];
      }
      return [x, y];
    }
    /** 应用 packet 的 mask 链；返回需要清理的状态。 */
    applyMasks(frame, packetMaskPath, assets) {
      const state = { scissor: false, stencil: false };
      if (frame.maskPaths === void 0 || frame.masks === void 0 || packetMaskPath < 0) return state;
      const chain = maskChain(packetMaskPath, frame.maskPaths);
      if (chain.error) return state;
      let rect = null;
      for (const id of chain.ids) {
        const mask = frame.masks.masks[id];
        if (mask === null || mask === void 0) continue;
        this.stats.maskTests += 1;
        if (mask.mode !== "scissor") continue;
        const r = this.projectBounds(frame, mask.bounds);
        if (rect === null) rect = r;
        else {
          const x0 = Math.max(rect.x, r.x);
          const y0 = Math.max(rect.y, r.y);
          const x1 = Math.min(rect.x + rect.width, r.x + r.width);
          const y1 = Math.min(rect.y + rect.height, r.y + r.height);
          rect = { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
        }
      }
      if (rect !== null) {
        this.gl.enable?.(GL_SCISSOR_TEST);
        this.gl.scissor?.(rect.x, rect.y, rect.width, rect.height);
        state.scissor = true;
      }
      for (const id of chain.ids) {
        const mask = frame.masks.masks[id];
        if (mask === null || mask === void 0) continue;
        if (mask.mode === "stencil") {
          const gl = this.gl;
          gl.enable?.(GL_STENCIL_TEST);
          gl.colorMask?.(false, false, false, false);
          gl.stencilMask?.(255);
          gl.clearStencil?.(0);
          gl.clear?.(GL_STENCIL_BUFFER_BIT);
          gl.stencilFunc?.(GL_ALWAYS, 1, 255);
          gl.stencilOp?.(GL_KEEP, GL_KEEP, GL_REPLACE);
          gl.disable?.(GL_DEPTH_TEST);
          this.upload(GL_ARRAY_BUFFER, this.buffers?.positions, mask.positions);
          this.setAttrib("aPosition", 2, GL_FLOAT, false);
          this.upload(GL_ELEMENT_ARRAY_BUFFER, this.buffers?.indices, mask.indices);
          this.setUniform1f("uUseTexture", 0);
          gl.drawElements?.(GL_TRIANGLES, mask.indices.length, indexType(mask.indices), 0);
          if (frame.depthMode !== void 0 && frame.depthMode !== "none") gl.enable?.(GL_DEPTH_TEST);
          gl.colorMask?.(true, true, true, true);
          gl.stencilMask?.(0);
          gl.stencilFunc?.(mask.invert ? GL_NOTEQUAL : GL_EQUAL, 1, 255);
          gl.stencilOp?.(GL_KEEP, GL_KEEP, GL_KEEP);
          state.stencil = true;
        } else if (mask.mode === "alpha") {
          this.setAlphaMask(mask, frame);
        }
      }
      return state;
    }
    resetMaskState(state) {
      if (state.scissor) this.gl.disable?.(GL_SCISSOR_TEST);
      if (state.stencil) this.gl.disable?.(GL_STENCIL_TEST);
      if (state.stencil) this.gl.stencilMask?.(255);
      this.gl.colorMask?.(true, true, true, true);
      this.gl.activeTexture?.(GL_TEXTURE0);
    }
    /** H1：每个 packet 的混合状态显式设置；连续同模式不重复切换。 */
    applyBlend(mode) {
      if (this.currentBlend === mode) return;
      this.gl.enable?.(GL_BLEND);
      switch (mode) {
        case "normal":
          this.gl.blendFunc?.(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
          break;
        case "add":
          this.gl.blendFunc?.(GL_ONE, GL_ONE);
          break;
        case "multiply":
          this.gl.blendFunc?.(GL_DST_COLOR, GL_ONE_MINUS_SRC_ALPHA);
          break;
        case "screen":
          this.gl.blendFunc?.(GL_ONE, GL_ONE_MINUS_SRC_COLOR);
          break;
      }
      this.currentBlend = mode;
    }
    draw(frame) {
      if (this.disposed) throw new Error("WebGL2Backend: \u5DF2 dispose\uFF0C\u4E0D\u80FD\u7EE7\u7EED draw");
      if (frame.width !== this.width || frame.height !== this.height) {
        this.resize({ width: frame.width, height: frame.height });
      }
      this.stats.drawCalls = 0;
      this.stats.packets = 0;
      this.stats.batches = 0;
      this.stats.textureBinds = 0;
      this.stats.programSwitches = 0;
      this.stats.uploadedBytes = 0;
      this.stats.uploadedVertices = 0;
      this.stats.maskTests = 0;
      this.stats.textureSamples = 0;
      const gl = this.gl;
      this.useProgram(this.program);
      this.setViewProjection(frame.viewProjection);
      this.setResolution(frame.width, frame.height);
      const depthMode = frame.depthMode ?? "none";
      if (depthMode === "none") {
        gl.disable?.(GL_DEPTH_TEST);
      } else {
        gl.enable?.(GL_DEPTH_TEST);
        gl.depthFunc?.(GL_LEQUAL);
        gl.depthMask?.(depthMode === "write");
        gl.clear?.(GL_DEPTH_BUFFER_BIT);
      }
      if (frame.assets !== void 0 && frame.assets !== this.assets) this.prepare(frame.assets);
      const assets = frame.assets ?? this.assets;
      for (const packet of frame.packets) {
        const vertexCount = Math.floor(packet.uvs.length / 2);
        const stride = vertexCount > 0 ? packet.positions.length / vertexCount : 2;
        const material = assets?.materials.find((m) => m.id === packet.materialId) ?? null;
        spritePage(material, assets?.pages);
        const texture = material !== null && material.kind === "sprite" ? this.textures[material.page] : void 0;
        if (material?.kind === "sprite" && texture === void 0) {
          throw assetError("E_TEXTURE_MISSING", `\u6750\u8D28 ${material.id} \u7684\u56FE\u96C6\u9875 ${material.page} \u5C1A\u672A\u4E0A\u4F20`);
        }
        const maskMode = this.maskMode(frame, packet.maskPath);
        if (this.programCache !== null && material !== null) {
          this.program = this.programCache.get(variantOf({
            pma: material.pma ?? true,
            twoColor: packet.twoColor === true || material.tintBlack === true,
            tintBlack: material.tintBlack === true,
            kind: material.kind
          }, maskMode));
          this.useProgram(this.program);
        }
        this.setViewProjection(frame.viewProjection);
        this.setResolution(frame.width, frame.height);
        this.setUniform1f("uAlphaMask", 0);
        if (texture !== void 0) {
          gl.activeTexture?.(GL_TEXTURE0);
          this.bindTexture(GL_TEXTURE_2D, texture);
          this.setUniform1i("uTexture", 0);
          this.setUniform1f("uUseTexture", 1);
        } else {
          if (this.whiteTexture !== null) {
            gl.activeTexture?.(GL_TEXTURE0);
            this.bindTexture(GL_TEXTURE_2D, this.whiteTexture);
          }
          this.setUniform1f("uUseTexture", 0);
        }
        const maskState = this.applyMasks(frame, packet.maskPath, assets);
        this.setUniform1f("uUseTexture", texture === void 0 ? 0 : 1);
        this.applyBlend(packet.blend);
        this.upload(GL_ARRAY_BUFFER, this.buffers?.positions, packet.positions);
        this.setAttrib("aPosition", Number.isFinite(stride) ? stride : 2, GL_FLOAT, false);
        this.upload(GL_ARRAY_BUFFER, this.buffers?.uvs, packet.uvs);
        this.setAttrib("aUv", 2, GL_FLOAT, false);
        this.upload(GL_ARRAY_BUFFER, this.buffers?.colors, packet.colors);
        this.setAttrib("aColor", 4, GL_UNSIGNED_BYTE, true);
        if (packet.dark !== void 0) {
          this.upload(GL_ARRAY_BUFFER, this.buffers?.darks, packet.dark);
          this.setAttrib("aDark", 4, GL_UNSIGNED_BYTE, true);
        } else {
          this.resetDarkAttrib();
        }
        this.setUniform1f("uTwoColor", packet.twoColor === true && packet.dark !== void 0 || material?.tintBlack === true ? 1 : 0);
        this.setUniform1f("uTintBlack", material?.tintBlack === true ? 1 : 0);
        this.upload(GL_ELEMENT_ARRAY_BUFFER, this.buffers?.indices, packet.indices);
        gl.drawElements?.(GL_TRIANGLES, packet.indices.length, indexType(packet.indices), 0);
        this.resetMaskState(maskState);
        this.stats.drawCalls += 1;
        this.stats.packets += 1;
        this.stats.batches += 1;
        this.stats.uploadedVertices += vertexCount;
      }
      if (depthMode !== "none") {
        gl.depthMask?.(false);
        gl.disable?.(GL_DEPTH_TEST);
      }
    }
    readPixels(out) {
      if (this.disposed) throw new Error("WebGL2Backend: \u5DF2 dispose");
      const size = this.width * this.height * 4;
      const target = out ?? new Uint8ClampedArray(size);
      if (target.length !== size) throw new RangeError("WebGL2Backend.readPixels: \u8F93\u51FA\u7F13\u51B2\u5C3A\u5BF8\u4E0D\u5339\u914D");
      const gl = this.gl;
      if (typeof gl.readPixels !== "function") {
        target.fill(0);
        return target;
      }
      const raw = new Uint8Array(size);
      gl.readPixels(0, 0, this.width, this.height, GL_RGBA, GL_UNSIGNED_BYTE, raw);
      const row = this.width * 4;
      for (let y = 0; y < this.height; y += 1) {
        target.set(raw.subarray((this.height - 1 - y) * row, (this.height - y) * row), y * row);
      }
      return target;
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      const gl = this.gl;
      if (typeof gl.deleteBuffer === "function" && this.buffers !== null) {
        gl.deleteBuffer(this.buffers.positions);
        gl.deleteBuffer(this.buffers.uvs);
        gl.deleteBuffer(this.buffers.colors);
        gl.deleteBuffer(this.buffers.indices);
      }
      if (typeof gl.deleteTexture === "function") {
        for (const texture of this.textures) gl.deleteTexture(texture);
        if (this.whiteTexture !== null) gl.deleteTexture(this.whiteTexture);
      }
      this.textures = [];
      this.whiteTexture = null;
      this.buffers = null;
      this.capacities.clear();
    }
  };

  // ../packages/render-engine/src/render/clipping.ts
  var EPS4 = 1e-9;
  function signedArea(points) {
    let area = 0;
    const n = Math.floor(points.length / 2);
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      area += points[i * 2] * points[j * 2 + 1] - points[j * 2] * points[i * 2 + 1];
    }
    return area;
  }
  function cross(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  }
  function clipAgainstConvex(poly, convex) {
    let out = poly.slice();
    for (let i = 0; i < convex.length && out.length > 0; i += 1) {
      const a = convex[i];
      const b = convex[(i + 1) % convex.length];
      const input = out;
      out = [];
      for (let j = 0; j < input.length; j += 1) {
        const p = input[j];
        const q = input[(j + 1) % input.length];
        const cp = cross(a.x, a.y, b.x, b.y, p.x, p.y);
        const cq = cross(a.x, a.y, b.x, b.y, q.x, q.y);
        const insideP = cp >= -EPS4;
        const insideQ = cq >= -EPS4;
        if (insideP) out.push(p);
        if (insideP !== insideQ) {
          const denom = cp - cq;
          const t = Math.abs(denom) < EPS4 ? 0 : cp / denom;
          const k = Math.min(1, Math.max(0, t));
          out.push({
            x: p.x + (q.x - p.x) * k,
            y: p.y + (q.y - p.y) * k,
            u: p.u + (q.u - p.u) * k,
            v: p.v + (q.v - p.v) * k
          });
        }
      }
    }
    return out;
  }
  function clipTriangles(positions, uvs, indices, clipPolygons) {
    const convexParts = [];
    for (const polygon of clipPolygons) {
      if (polygon.length < 6) continue;
      const ccw = signedArea(polygon) >= 0;
      const tri = triangulatePolygon(polygon);
      for (let i = 0; i + 2 < tri.length; i += 3) {
        const ids = [tri[i], tri[i + 1], tri[i + 2]];
        const part = ids.map((id) => {
          const x = polygon[id * 2];
          const y = polygon[id * 2 + 1];
          return { x, y, u: 0, v: 0 };
        });
        if (!ccw) part.reverse();
        convexParts.push(part);
      }
    }
    if (convexParts.length === 0) {
      return { positions: new Float32Array(0), uvs: new Float32Array(0), indices: new Uint16Array(0) };
    }
    const outPositions = [];
    const outUvs = [];
    const outIndices = [];
    const vertexAt = (id) => ({
      x: positions[id * 2] ?? 0,
      y: positions[id * 2 + 1] ?? 0,
      u: uvs[id * 2] ?? 0,
      v: uvs[id * 2 + 1] ?? 0
    });
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = vertexAt(indices[t]);
      const b = vertexAt(indices[t + 1]);
      const c = vertexAt(indices[t + 2]);
      for (const part of convexParts) {
        const poly = clipAgainstConvex([a, b, c], part);
        if (poly.length < 3) continue;
        const base = outPositions.length / 2;
        for (const p of poly) {
          outPositions.push(p.x, p.y);
          outUvs.push(p.u, p.v);
        }
        for (let i = 1; i + 1 < poly.length; i += 1) {
          outIndices.push(base, base + i, base + i + 1);
        }
      }
    }
    return {
      positions: Float32Array.from(outPositions),
      uvs: Float32Array.from(outUvs),
      indices: Uint16Array.from(outIndices)
    };
  }

  // ../packages/render-engine/src/render/camera.ts
  var DEFAULT_CAMERA = {
    kind: "ortho",
    yaw: 0,
    pitch: 0,
    roll: 0,
    target: [0, 0, 0],
    distance: 5,
    orthoHeight: 2,
    zoom: 1,
    near: 0.1,
    far: 1e3,
    viewport: { width: 800, height: 600, dpr: 1 }
  };
  var MAX_PITCH = 75 * Math.PI / 180;
  var EPS5 = 1e-6;
  var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  var finite = (v, fallback) => Number.isFinite(v) ? v : fallback;
  function normalize(v) {
    const len = Math.hypot(v[0], v[1], v[2]);
    if (len < EPS5) return [0, 0, 0];
    return [v[0] / len, v[1] / len, v[2] / len];
  }
  function cross2(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }
  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
  function cameraBasis(camera) {
    const yaw = finite(camera.yaw, 0);
    const pitch = clamp(finite(camera.pitch, 0), -MAX_PITCH, MAX_PITCH);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const forward = normalize([-sy * cp, -sp, -cy * cp]);
    let right = normalize(cross2(forward, [0, 1, 0]));
    if (Math.hypot(right[0], right[1], right[2]) < EPS5) right = [1, 0, 0];
    let up = normalize(cross2(right, forward));
    const roll = finite(camera.roll, 0);
    if (roll !== 0) {
      const c = Math.cos(roll);
      const s = Math.sin(roll);
      const r = [right[0] * c + up[0] * s, right[1] * c + up[1] * s, right[2] * c + up[2] * s];
      const u = [up[0] * c - right[0] * s, up[1] * c - right[1] * s, up[2] * c - right[2] * s];
      right = r;
      up = u;
    }
    const distance = finite(camera.distance, 0);
    const eye = [
      camera.target[0] - forward[0] * distance,
      camera.target[1] - forward[1] * distance,
      camera.target[2] - forward[2] * distance
    ];
    return { forward, right, up, eye };
  }
  function ppmOf(camera) {
    const h = Math.max(1, finite(camera.viewport.height, 1));
    const orthoHeight = Math.max(EPS5, finite(camera.orthoHeight, EPS5));
    return finite(camera.zoom, 1) * h / orthoHeight;
  }
  function viewProjection2D(camera) {
    const basis = cameraBasis(camera);
    const ppm = ppmOf(camera);
    const w = Math.max(1, finite(camera.viewport.width, 1));
    const h = Math.max(1, finite(camera.viewport.height, 1));
    const eyeDotRight = dot(basis.right, basis.eye);
    const eyeDotUp = dot(basis.up, basis.eye);
    return new Float32Array([
      ppm * basis.right[0],
      -ppm * basis.up[0],
      0,
      ppm * basis.right[1],
      -ppm * basis.up[1],
      0,
      w / 2 - ppm * eyeDotRight,
      h / 2 + ppm * eyeDotUp,
      1
    ]);
  }

  // ../packages/render-engine/src/volume/volume.ts
  var TAU3 = Math.PI * 2;
  var DEG_TO_RAD = Math.PI / 180;
  var EPS6 = 1e-9;
  function positiveArc(from, to) {
    const d = normalizeAngle(to - from);
    return d < 0 ? d + TAU3 : d;
  }
  function inAngleRange(value, range, extraRad) {
    if (range === "any") return true;
    if (!Number.isFinite(value)) return false;
    const start2 = normalizeAngle(range[0]);
    const span = positiveArc(start2, normalizeAngle(range[1]));
    if (span <= EPS6) return true;
    return positiveArc(start2, normalizeAngle(value)) <= span + extraRad;
  }
  function cameraSide(camera) {
    const yaw = normalizeAngle(camera.yaw);
    if (!Number.isFinite(yaw) || Math.abs(yaw) < EPS6) return "any";
    return yaw > 0 ? "right" : "left";
  }
  function sideMatches(rule, current) {
    const wanted = rule.side ?? "any";
    if (wanted === "any") return true;
    return current !== "any" && wanted === current;
  }
  function hysteresisRad(rule) {
    const h = rule.hysteresisDeg;
    return Number.isFinite(h) && h > 0 ? h * DEG_TO_RAD : 0;
  }
  function selected(rule, elapsed) {
    let fadeAlpha = 1;
    if (Number.isFinite(rule.fadeSec) && rule.fadeSec > 0) {
      const t = Number.isFinite(elapsed) ? elapsed : 0;
      fadeAlpha = Math.min(1, Math.max(0, t / rule.fadeSec));
    }
    return { attachment: rule.attachment, fadeAlpha, rule };
  }
  function resolveViewRule(rules, camera, slot, prev, elapsed) {
    const entries = rules.map((rule, index) => ({ rule, index })).filter((entry) => entry.rule.slot === slot);
    entries.sort((a, b) => b.rule.priority - a.rule.priority || a.index - b.index);
    const side = cameraSide(camera);
    const fits = (rule, extraRad) => inAngleRange(camera.yaw, rule.yaw, extraRad) && inAngleRange(camera.pitch, rule.pitch, extraRad) && sideMatches(rule, side);
    if (prev !== null) {
      const keep = entries.find((entry) => entry.rule.attachment === prev && fits(entry.rule, hysteresisRad(entry.rule)));
      if (keep !== void 0) return selected(keep.rule, elapsed);
    }
    const best = entries.find((entry) => fits(entry.rule, 0));
    if (best !== void 0) return selected(best.rule, elapsed);
    const fallback = entries.find((entry) => entry.rule.fallback !== void 0);
    if (fallback !== void 0 && fallback.rule.fallback !== void 0) {
      return { attachment: fallback.rule.fallback, fadeAlpha: 1, rule: null };
    }
    return { attachment: null, fadeAlpha: 1, rule: null };
  }

  // ../packages/render-engine/src/asset/importer.ts
  var DEG = Math.PI / 180;
  var DEFAULT_REGION_UVS = new Float32Array([0, 1, 0, 0, 1, 0, 1, 1]);
  function add(ctx, severity, code, path, message, action, sourceValue) {
    const issue = { severity, code, path, message, action };
    if (sourceValue !== void 0) issue.sourceValue = sourceValue;
    ctx.issues.push(issue);
  }
  function num(v, fallback = 0) {
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  }
  function obj(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
  }
  function arr(v) {
    return Array.isArray(v) ? v : [];
  }
  function clamp014(v) {
    if (!Number.isFinite(v)) return 0;
    return v <= 0 ? 0 : v >= 1 ? 1 : v;
  }
  var WHITE = { r: 1, g: 1, b: 1, a: 1 };
  function parseHexColor(v, ctx, path) {
    if (v === void 0 || v === null) return WHITE;
    if (typeof v === "string" && /^[0-9a-fA-F]{8}$/.test(v)) {
      return {
        r: Number.parseInt(v.slice(0, 2), 16) / 255,
        g: Number.parseInt(v.slice(2, 4), 16) / 255,
        b: Number.parseInt(v.slice(4, 6), 16) / 255,
        a: Number.parseInt(v.slice(6, 8), 16) / 255
      };
    }
    add(ctx, "info", "I_COLOR_DEFAULT", path, "\u989C\u8272\u5B57\u6BB5\u975E\u6CD5\uFF0C\u56DE\u9000\u767D\u8272", "fallback", v);
    return WHITE;
  }
  var BLEND_MAP = {
    normal: "normal",
    additive: "add",
    add: "add",
    multiply: "multiply",
    screen: "screen"
  };
  function parseBlend(v, ctx, path) {
    if (v === void 0 || v === null) return "normal";
    if (typeof v !== "string") {
      add(ctx, "error", "E_UNKNOWN_BLEND", path, "blend \u4E0D\u662F\u5B57\u7B26\u4E32\uFF0C\u56DE\u9000 normal", "fallback", v);
      return "normal";
    }
    const mode = BLEND_MAP[v.toLowerCase()];
    if (mode !== void 0) return mode;
    add(ctx, "warning", "W_BLEND_UNKNOWN", path, "\u672A\u77E5 blend\uFF0C\u56DE\u9000 normal", "fallback", v);
    return "normal";
  }
  function dedupe(names, ctx, prefix) {
    const used = /* @__PURE__ */ new Set();
    return names.map((raw, i) => {
      const base = raw.length > 0 ? raw : `${prefix.replace(/\[\]$/, "")}_${i}`;
      if (base.length === 0 || raw.length === 0) {
        add(ctx, "error", "E_SCHEMA", `${prefix}[${i}].name`, "\u540D\u5B57\u4E3A\u7A7A\uFF0C\u5DF2\u751F\u6210\u66FF\u8865\u540D", "fallback", raw);
      }
      let name = base;
      let n = 2;
      while (used.has(name)) {
        name = `${base}_${n}`;
        n += 1;
      }
      if (name !== base) {
        add(ctx, "error", "E_DUPLICATE_NAME", `${prefix}[${i}].name`, "\u540D\u5B57\u91CD\u590D\uFF0C\u5DF2\u52A0\u7A33\u5B9A\u540E\u7F00", "fallback", raw);
      }
      used.add(name);
      return name;
    });
  }
  function collectAtlas(doc, source) {
    if (source === "spine") {
      const raw = doc.atlas;
      if (Array.isArray(raw)) {
        return new Set(raw.filter((x) => typeof x === "string"));
      }
    } else {
      const raw = doc.SubTexture ?? doc.textures;
      if (Array.isArray(raw)) {
        const names = raw.map((x) => typeof x === "string" ? x : obj(x)?.name).filter((x) => typeof x === "string");
        return new Set(names);
      }
    }
    return null;
  }
  function atlasKeyOf(rawPath, fallbackName, ctx, path) {
    const key = typeof rawPath === "string" && rawPath.length > 0 ? rawPath : fallbackName;
    if (ctx.atlasData !== null) {
      if (!ctx.atlasData.regions.has(key)) {
        add(ctx, "warning", "W_ATLAS_MISSING", path, "atlas \u4E2D\u7F3A\u5C11 region\uFF0C\u4FDD\u7559 atlasKey \u5360\u4F4D", "fallback", key);
      }
      return key;
    }
    if (ctx.atlas !== null) {
      if (!ctx.atlas.has(key)) {
        add(ctx, "error", "E_MISSING_ATLAS", path, "region \u65E0\u5BF9\u5E94\u56FE\u96C6\uFF0C\u4F7F\u7528\u5360\u4F4D\u952E", "fallback", rawPath);
      } else if (key === fallbackName && (typeof rawPath !== "string" || rawPath.length === 0)) {
        add(ctx, "error", "E_MISSING_ATLAS", path, "region path \u4E3A\u7A7A\uFF0C\u4F7F\u7528\u9644\u4EF6\u540D", "fallback", rawPath);
      }
      return key;
    }
    if (key === fallbackName && (typeof rawPath !== "string" || rawPath.length === 0)) {
      add(ctx, "error", "E_MISSING_ATLAS", path, "region path \u4E3A\u7A7A\uFF0C\u4F7F\u7528\u9644\u4EF6\u540D", "fallback", rawPath);
    }
    return key;
  }
  function regionRefOf(ctx, atlasKey, uvs) {
    if (uvs === null && ctx.atlasData !== null && ctx.atlasData.regions.has(atlasKey)) {
      return { atlasKey, uvs: DEFAULT_REGION_UVS };
    }
    return { atlasKey, uvs };
  }
  var INHERITS2 = [
    "normal",
    "onlyTranslation",
    "noRotationOrReflection",
    "noScale",
    "noScaleOrReflection"
  ];
  function rawBoneFrom(raw, index, kind, ctx, path) {
    const o = obj(raw);
    if (o === null) {
      add(ctx, "error", "E_SCHEMA", path, "\u9AA8\u9ABC\u4E0D\u662F\u5BF9\u8C61\uFF0C\u5DF2\u8DF3\u8FC7\u5B57\u6BB5", "fallback", raw);
    }
    const d = o ?? {};
    const transform = obj(d.transform) ?? {};
    const inheritRaw = d.inherit;
    const inherit = typeof inheritRaw === "string" && INHERITS2.includes(inheritRaw) ? inheritRaw : "normal";
    const parent = typeof d.parent === "string" && d.parent.length > 0 ? d.parent : null;
    const bone = {
      name: typeof d.name === "string" ? d.name : `bone_${index}`,
      parentName: parent,
      sourceIndex: index,
      length: Math.max(0, num(d.length, 0)),
      x: num(kind === "spine" ? d.x : transform.x),
      y: num(kind === "spine" ? d.y : transform.y),
      rotationDeg: num(d.rotation),
      scaleX: num(kind === "spine" ? d.scaleX : transform.scX, 1),
      scaleY: num(kind === "spine" ? d.scaleY : transform.scY, 1),
      shearXDeg: num(d.shearX),
      shearYDeg: num(d.shearY),
      skXDeg: num(transform.skX),
      skYDeg: num(transform.skY),
      inherit,
      tags: d.skin === true ? ["skinBone"] : [],
      kind
    };
    return bone;
  }
  function flippedMatrix(b, unitScale, sourceYDown) {
    let a;
    let b1;
    let c;
    let d;
    if (b.kind === "spine") {
      const r = b.rotationDeg * DEG;
      const shx = b.shearXDeg * DEG;
      const shy = b.shearYDeg * DEG;
      a = Math.cos(r + shx) * b.scaleX;
      b1 = -Math.sin(r + shy) * b.scaleY;
      c = Math.sin(r + shx) * b.scaleX;
      d = Math.cos(r + shy) * b.scaleY;
    } else {
      const sx = b.skXDeg * DEG;
      const sy = b.skYDeg * DEG;
      a = Math.cos(sy) * b.scaleX;
      b1 = Math.sin(sy) * b.scaleX;
      c = -Math.sin(sx) * b.scaleY;
      d = Math.cos(sx) * b.scaleY;
    }
    const out = new Float64Array(WORLD_STRIDE);
    out[0] = a;
    if (b.kind === "spine" && !sourceYDown) {
      out[1] = c;
      out[2] = b1;
    } else {
      out[1] = -b1;
      out[2] = -c;
    }
    out[3] = d;
    out[4] = b.x * unitScale;
    out[5] = (b.kind === "spine" && !sourceYDown ? b.y : -b.y) * unitScale;
    return out;
  }
  function convertBone(b, ctx, path) {
    if (b.kind === "spine" && !ctx.sourceYDown) {
      return {
        x: b.x * ctx.unitScale,
        y: b.y * ctx.unitScale,
        rotation: b.rotationDeg * DEG,
        scaleX: b.scaleX,
        scaleY: b.scaleY,
        shearX: b.shearXDeg * DEG,
        shearY: b.shearYDeg * DEG
      };
    }
    const m = flippedMatrix(b, ctx.unitScale, ctx.sourceYDown);
    try {
      return decomposeAffine(m);
    } catch {
      add(ctx, "error", "E_TRANSFORM", path, "\u77E9\u9635\u5947\u5F02\uFF0C\u5DF2\u9000\u56DE\u8F74\u5BF9\u9F50\u8FD1\u4F3C", "fallback", Array.from(m));
      return {
        x: m[4],
        y: m[5],
        rotation: normalizeAngle(Math.atan2(m[1], m[0])),
        scaleX: Math.hypot(m[0], m[1]) || 1,
        scaleY: Math.hypot(m[2], m[3]) || 1,
        shearX: 0,
        shearY: 0
      };
    }
  }
  function resolveParents(bones, ctx, prefix) {
    const byName = /* @__PURE__ */ new Map();
    bones.forEach((b, i) => byName.set(b.name, i));
    for (const b of bones) {
      if (b.parentName === null) continue;
      if (!byName.has(b.parentName)) {
        add(ctx, "error", "E_BONE_PARENT", `${prefix}[${b.sourceIndex}].parent`, "\u7236\u9AA8\u4E0D\u5B58\u5728\uFF0C\u6302\u4E3A\u6839", "fallback", b.parentName);
        b.parentName = null;
      }
    }
    const state = new Uint8Array(bones.length);
    const visit = (i) => {
      if (state[i] === 1) return true;
      if (state[i] === 2) return false;
      state[i] = 1;
      const b = bones[i];
      const p = b.parentName === null ? -1 : byName.get(b.parentName) ?? -1;
      if (p >= 0 && visit(p)) {
        add(ctx, "error", "E_BONE_CYCLE", `${prefix}[${b.sourceIndex}].parent`, "\u9AA8\u9ABC\u7236\u5B50\u6210\u73AF\uFF0C\u5DF2\u65AD\u73AF", "fallback", b.parentName);
        b.parentName = null;
      }
      state[i] = 2;
      return false;
    };
    for (let i = 0; i < bones.length; i += 1) visit(i);
  }
  function topoSort(bones) {
    const n = bones.length;
    const byName = /* @__PURE__ */ new Map();
    bones.forEach((b, i) => byName.set(b.name, i));
    const parent = bones.map((b) => b.parentName === null ? -1 : byName.get(b.parentName) ?? -1);
    const indegree = new Uint16Array(n);
    const children = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i += 1) {
      if (parent[i] >= 0) {
        indegree[i] = 1;
        children[parent[i]].push(i);
      }
    }
    const queue = [];
    for (let i = 0; i < n; i += 1) if (indegree[i] === 0) queue.push(i);
    const order = [];
    const srcToId = new Int32Array(n).fill(-1);
    while (queue.length > 0) {
      const cur = queue.shift();
      srcToId[cur] = order.length;
      order.push(cur);
      for (const child of children[cur]) {
        indegree[child] = indegree[child] - 1;
        if (indegree[child] === 0) queue.push(child);
      }
    }
    if (order.length !== n) throw new Error("E_SCHEMA: skeleton.topoSort");
    return { order, srcToId };
  }
  function compileBones(bones, ctx, skeletonName) {
    resolveParents(bones, ctx, ctx.source === "spine" ? "bones" : "armature.bones");
    const { order, srcToId } = topoSort(bones);
    const specs = order.map((src, id) => {
      const b = bones[src];
      const t = convertBone(b, ctx, `bones[${b.sourceIndex}]`);
      const byName = /* @__PURE__ */ new Map();
      bones.forEach((x, i) => byName.set(x.name, i));
      const p = b.parentName === null ? -1 : srcToId[byName.get(b.parentName)];
      return {
        name: b.name,
        parent: p,
        length: b.length * ctx.unitScale,
        rest: t,
        setup: t,
        inherit: b.inherit,
        tags: b.tags
      };
    });
    const skeleton = compileSkeleton({ name: skeletonName, profile: "full2d", bones: specs });
    return { skeleton, srcToId };
  }
  function flatPositions(points, ctx, scale) {
    const ySign = ctx.sourceYDown ? -1 : 1;
    const out = new Float32Array(points.length);
    for (let i = 0; i < points.length; i += 2) {
      out[i] = num(points[i]) * scale;
      out[i + 1] = ySign * num(points[i + 1]) * scale;
    }
    return out;
  }
  function readSpinePath(raw, slotBone, srcToId, ctx, path) {
    const values = arr(raw.vertices).map((value) => num(value));
    const lengths = Float32Array.from(arr(raw.lengths).map((value) => num(value) * ctx.unitScale));
    const closed = raw.closed === true;
    const expected = Number.isInteger(raw.vertexCount) && raw.vertexCount > 0 ? raw.vertexCount : lengths.length > 0 ? (lengths.length + (closed ? 0 : 2)) * 3 : 0;
    const ySign = ctx.sourceYDown ? -1 : 1;
    const rigid = expected === 0 ? values.length % 2 === 0 : values.length === expected * 2;
    const vertices = [];
    if (rigid) {
      for (let i = 0; i + 1 < values.length; i += 2) {
        vertices.push([{ bone: slotBone, x: values[i] * ctx.unitScale, y: values[i + 1] * ctx.unitScale * ySign, weight: 1 }]);
      }
    } else {
      let cursor = 0;
      while (cursor < values.length && (expected === 0 || vertices.length < expected)) {
        const count = values[cursor++];
        if (!Number.isInteger(count) || count < 1 || cursor + count * 4 > values.length) break;
        const influences = [];
        for (let j = 0; j < count; j += 1) {
          const sourceBone = values[cursor++];
          const x = values[cursor++] * ctx.unitScale;
          const y = values[cursor++] * ctx.unitScale * ySign;
          const weight = values[cursor++];
          if (!Number.isInteger(sourceBone) || sourceBone < 0 || sourceBone >= srcToId.length) {
            add(ctx, "error", "E_INDEX_RANGE", `${path}.vertices[${vertices.length}][${j}].bone`, "\u8DEF\u5F84\u6743\u91CD\u9AA8\u7D22\u5F15\u8D8A\u754C\uFF0C\u5DF2\u8DF3\u8FC7", "skip", sourceBone);
            continue;
          }
          influences.push({ bone: srcToId[sourceBone], x, y, weight });
        }
        const sum = influences.reduce((total, influence) => total + influence.weight, 0);
        if (sum <= 0 || !Number.isFinite(sum)) {
          add(ctx, "error", "E_WEIGHT_SUM", `${path}.vertices[${vertices.length}]`, "\u8DEF\u5F84\u9876\u70B9\u6743\u91CD\u65E0\u6548\uFF0C\u56DE\u9000\u5230 slot \u9AA8", "fallback");
          influences.splice(0, influences.length, { bone: slotBone, x: 0, y: 0, weight: 1 });
        } else {
          for (const influence of influences) influence.weight /= sum;
        }
        if (ctx.maxInfluences > 0 && influences.length > ctx.maxInfluences) {
          add(ctx, "warning", "W_WEIGHT_LIMIT", `${path}.vertices[${vertices.length}]`, "\u8DEF\u5F84\u9876\u70B9\u5F71\u54CD\u6570\u8D85\u8FC7\u914D\u7F6E\u4E0A\u9650\uFF0C\u4FDD\u7559\u5168\u90E8\u5F71\u54CD", "keep", influences.length);
        }
        vertices.push(influences);
      }
      if (cursor !== values.length || expected > 0 && vertices.length !== expected) {
        add(ctx, "warning", "W_ATTACHMENT_UNSUPPORTED", path, "\u8DEF\u5F84\u6743\u91CD\u5E03\u5C40\u65E0\u6548\uFF0C\u4FDD\u7559\u65E7\u5750\u6807\u56DE\u9000", "fallback", raw.vertices);
        return {
          polygon: flatPositions(values, ctx, ctx.unitScale),
          pathData: { vertices: [], lengths, closed, constantSpeed: raw.constantSpeed !== false }
        };
      }
    }
    const polygon = Float32Array.from(vertices.flatMap((influences) => [influences[0].x, influences[0].y]));
    return { polygon, pathData: { vertices, lengths, closed, constantSpeed: raw.constantSpeed !== false } };
  }
  function validateIndices(raw, vertexCount, ctx, path) {
    const kept = [];
    const values = arr(raw);
    for (let i = 0; i + 2 < values.length; i += 3) {
      const tri = [num(values[i]), num(values[i + 1]), num(values[i + 2])];
      if (tri.some((v) => !Number.isInteger(v) || v < 0 || v >= vertexCount)) {
        add(ctx, "error", "E_INDEX_RANGE", `${path}.triangles[${i}]`, "\u4E09\u89D2\u5F62\u7D22\u5F15\u8D8A\u754C\uFF0C\u5DF2\u4E22\u5F03", "skip", tri);
        continue;
      }
      kept.push(...tri);
    }
    return Uint16Array.from(kept);
  }
  function readWeightedMesh(raw, name, slotBone, srcToId, ctx, path) {
    const vertices = arr(raw.vertices).map((v2) => num(v2));
    const uvs = arr(raw.uvs).map((v2) => num(v2));
    let perVertex = 4;
    let vertexCount = 0;
    let scan = 0;
    while (scan < vertices.length) {
      const count = Math.floor(vertices[scan] ?? 0);
      if (!Number.isInteger(count) || count < 0 || scan + 1 + count * 4 > vertices.length) break;
      perVertex = Math.max(perVertex, count);
      scan += 1 + count * 4;
      vertexCount += 1;
    }
    if (vertexCount === 0) vertexCount = Math.max(1, Math.floor(vertices.length / 2));
    const positions = new Float32Array(vertexCount * 2);
    const boneIndices = new Uint16Array(vertexCount * perVertex);
    const weights = new Float32Array(vertexCount * perVertex);
    const influencePositions = new Float32Array(vertexCount * perVertex * 2);
    const influenceSourceIndices = new Int32Array(vertexCount * perVertex).fill(-1);
    let sourceComponent = 0;
    let p = 0;
    let v = 0;
    while (p < vertices.length && v < vertexCount) {
      const count = Math.max(0, Math.floor(vertices[p++]));
      const influences = [];
      for (let j = 0; j < count; j += 1) {
        const srcIndex = Math.floor(vertices[p++]);
        const x = vertices[p++] ?? 0;
        const y = vertices[p++] ?? 0;
        const w = vertices[p++] ?? 0;
        if (srcIndex < 0 || srcIndex >= srcToId.length) {
          add(ctx, "error", "E_INDEX_RANGE", `${path}.vertices[${v}][${j}].bone`, "\u6743\u91CD\u9AA8\u7D22\u5F15\u8D8A\u754C\uFF0C\u5DF2\u8DF3\u8FC7", "skip", srcIndex);
          continue;
        }
        influences.push({ bone: srcToId[srcIndex], x, y, w, source: j });
      }
      let sum = influences.reduce((acc, inf) => acc + inf.w, 0);
      if (!Number.isFinite(sum) || sum <= 0) {
        add(ctx, "error", "E_WEIGHT_SUM", `${path}.vertices[${v}]`, "\u6743\u91CD\u548C \u22640 \u6216\u975E\u6709\u9650\uFF0C\u56DE\u9000\u5355\u9AA8\u521A\u6027", "fallback", influences.map((i) => i.w));
        influences.length = 0;
        influences.push({ bone: slotBone, x: 0, y: 0, w: 1, source: -1 });
        sum = 1;
      }
      if (ctx.maxInfluences > 0 && influences.length > ctx.maxInfluences) {
        add(ctx, "warning", "W_WEIGHT_LIMIT", `${path}.vertices[${v}]`, "\u9876\u70B9\u5F71\u54CD\u6570\u8D85\u8FC7\u914D\u7F6E\u4E0A\u9650\uFF0C\u4FDD\u7559\u5168\u90E8\u5F71\u54CD", "keep", influences.length);
      }
      positions[v * 2] = influences[0].x * ctx.unitScale;
      positions[v * 2 + 1] = (ctx.sourceYDown ? -1 : 1) * influences[0].y * ctx.unitScale;
      for (let j = 0; j < perVertex; j += 1) {
        const inf = influences[j];
        boneIndices[v * perVertex + j] = inf?.bone ?? slotBone;
        weights[v * perVertex + j] = inf && sum > 0 ? clamp014(inf.w / sum) : 0;
        if (inf !== void 0) {
          influenceSourceIndices[v * perVertex + j] = inf.source < 0 ? -1 : sourceComponent + inf.source * 2;
          influencePositions[(v * perVertex + j) * 2] = inf.x * ctx.unitScale;
          influencePositions[(v * perVertex + j) * 2 + 1] = (ctx.sourceYDown ? -1 : 1) * inf.y * ctx.unitScale;
        }
      }
      sourceComponent += count * 2;
      v += 1;
    }
    const mesh = {
      id: name,
      positions,
      uvs: uvOf(uvs, vertexCount),
      indices: validateIndices(raw.triangles, vertexCount, ctx, path),
      bone: slotBone,
      vertexSpace: "boneLocal",
      boneIndices,
      weights,
      influencePositions,
      influenceSourceIndices,
      influencesPerVertex: perVertex,
      // 调试/描边扩展字段；不进入核心 MeshData 契约，故用结构附加。
      ...Number.isFinite(num(raw.hull, NaN)) ? { hull: num(raw.hull) } : {},
      ...arr(raw.edges).length > 0 ? { edges: Uint16Array.from(arr(raw.edges).map((v2) => num(v2))) } : {},
      ...Number.isFinite(num(raw.width, NaN)) ? { sourceWidth: num(raw.width) * ctx.unitScale } : {},
      ...Number.isFinite(num(raw.height, NaN)) ? { sourceHeight: num(raw.height) * ctx.unitScale } : {}
    };
    return {
      kind: "weightedMesh",
      id: mesh.id,
      mesh,
      region: regionRefOf(ctx, atlasKeyOf(raw.path, mesh.id, ctx, `${path}.path`), null),
      color: WHITE
    };
  }
  function uvOf(uvs, vertexCount) {
    const out = new Float32Array(vertexCount * 2);
    out.set(uvs.slice(0, out.length));
    return out;
  }
  function buildAttachment(raw, name, kindHint, slotBone, srcToId, ctx, path) {
    const rawObj = obj(raw);
    if (rawObj === null) {
      add(ctx, "warning", "W_ATTACHMENT_UNSUPPORTED", path, "\u9644\u4EF6\u4E0D\u662F\u5BF9\u8C61\uFF0C\u5DF2\u8DF3\u8FC7", "skip", raw);
      return null;
    }
    const type = kindHint === "spine" ? typeof rawObj.type === "string" ? rawObj.type : "region" : typeof rawObj.type === "string" && rawObj.type === "mesh" ? "mesh" : "region";
    const sequence = kindHint === "spine" ? parseSequence(rawObj, name, ctx, path, atlasKeyOf(rawObj.path ?? name, name, ctx, `${path}.path`)) : void 0;
    const atlasKey = atlasKeyOf(rawObj.path ?? name, name, ctx, `${path}.path`);
    const region = { atlasKey, uvs: null };
    if (type === "mesh" || type === "weightedmesh") {
      const vertices = arr(rawObj.vertices);
      const uvCount = arr(rawObj.uvs).length;
      const first = vertices[0];
      const weighted = type === "weightedmesh" || vertices.length > 0 && vertices.length !== uvCount && Number.isInteger(first) && first >= 1 && 1 + first * 4 <= vertices.length;
      if (weighted) return readWeightedMesh(rawObj, name, slotBone, srcToId, ctx, path);
      const positions = flatPositions(vertices.map((x) => num(x)), ctx, ctx.unitScale);
      const vertexCount = positions.length / 2;
      const mesh = {
        id: name,
        positions,
        uvs: uvOf(arr(rawObj.uvs).map((x) => num(x)), vertexCount),
        indices: validateIndices(rawObj.triangles, vertexCount, ctx, path),
        bone: slotBone,
        vertexSpace: "boneLocal",
        ...Number.isFinite(num(rawObj.hull, NaN)) ? { hull: num(rawObj.hull) } : {},
        ...arr(rawObj.edges).length > 0 ? { edges: Uint16Array.from(arr(rawObj.edges).map((x) => num(x))) } : {},
        ...Number.isFinite(num(rawObj.width, NaN)) ? { sourceWidth: num(rawObj.width) * ctx.unitScale } : {},
        ...Number.isFinite(num(rawObj.height, NaN)) ? { sourceHeight: num(rawObj.height) * ctx.unitScale } : {}
      };
      return {
        kind: "mesh",
        id: name,
        mesh,
        region: regionRefOf(ctx, atlasKey, region.uvs),
        color: kindHint === "spine" ? parseHexColor(rawObj.color, ctx, `${path}.color`) : WHITE
      };
    }
    if (type === "point") {
      return { kind: "point", id: name, point: [num(rawObj.x) * ctx.unitScale, (ctx.sourceYDown ? -1 : 1) * num(rawObj.y) * ctx.unitScale] };
    }
    if (type === "path" && kindHint === "spine") {
      return { kind: "path", id: name, ...readSpinePath(rawObj, slotBone, srcToId, ctx, path) };
    }
    if (type === "clipping" || type === "path" || type === "boundingbox") {
      const kind = type === "boundingbox" ? "boundingBox" : type;
      return { kind, id: name, polygon: flatPositions(arr(rawObj.vertices).map((x) => num(x)), ctx, ctx.unitScale) };
    }
    if (type === "linkedmesh") {
      add(ctx, "warning", "W_ATTACHMENT_UNSUPPORTED", path, "linkedmesh \u65E0\u6CD5\u89E3\u6790\u7236\u62D3\u6251\uFF0C\u9000\u5316\u4E3A region", "fallback", rawObj.parent);
      return { kind: "region", id: name, region: regionRefOf(ctx, atlasKey, null), color: WHITE };
    }
    if (type !== "region") {
      add(ctx, "warning", "W_ATTACHMENT_UNSUPPORTED", path, "\u672A\u77E5\u9644\u4EF6\u7C7B\u578B\uFF0C\u9000\u5316\u4E3A region", "fallback", type);
    }
    const customUvs = arr(rawObj.uvs);
    const uvs = customUvs.length === 8 ? Float32Array.from(customUvs.map((x) => num(x))) : null;
    const width = num(rawObj.width, NaN);
    const height = num(rawObj.height, NaN);
    const regionData = {
      ...regionRefOf(ctx, atlasKey, uvs),
      ...Number.isFinite(width) ? { width: width * ctx.unitScale } : {},
      ...Number.isFinite(height) ? { height: height * ctx.unitScale } : {},
      ...rawObj.x !== void 0 ? { x: num(rawObj.x) * ctx.unitScale } : {},
      ...rawObj.y !== void 0 ? { y: (ctx.sourceYDown ? -1 : 1) * num(rawObj.y) * ctx.unitScale } : {},
      ...rawObj.rotation !== void 0 ? { rotation: num(rawObj.rotation) * DEG } : {},
      ...rawObj.scaleX !== void 0 ? { scaleX: num(rawObj.scaleX) } : {},
      ...rawObj.scaleY !== void 0 ? { scaleY: num(rawObj.scaleY) } : {},
      ...sequence === void 0 ? {} : { sequence }
    };
    return {
      kind: "region",
      id: name,
      region: regionData,
      color: kindHint === "spine" ? parseHexColor(rawObj.color, ctx, `${path}.color`) : WHITE
    };
  }
  function buildLinkedMesh(raw, name, parent, slotBone, ctx, path) {
    if (parent === void 0 || parent.kind !== "mesh" && parent.kind !== "weightedMesh") {
      return null;
    }
    const parentMesh = parent.mesh;
    const rawVertices = arr(raw.vertices).map((x) => num(x));
    const positions = rawVertices.length >= 4 ? flatPositions(rawVertices, ctx, ctx.unitScale) : new Float32Array(parentMesh.positions);
    const rawUvs = arr(raw.uvs).map((x) => num(x));
    const uvs = rawUvs.length === positions.length ? Float32Array.from(rawUvs) : new Float32Array(parentMesh.uvs);
    const atlasKey = atlasKeyOf(raw.path, name, ctx, `${path}.path`);
    const color = parseHexColor(raw.color, ctx, `${path}.color`);
    if (parent.kind === "weightedMesh") {
      const mesh2 = {
        id: name,
        positions,
        uvs,
        indices: new Uint16Array(parentMesh.indices),
        bone: parentMesh.bone,
        vertexSpace: parentMesh.vertexSpace,
        boneIndices: new Uint16Array(parent.mesh.boneIndices),
        weights: new Float32Array(parent.mesh.weights),
        ...parent.mesh.influencesPerVertex === void 0 ? {} : { influencesPerVertex: parent.mesh.influencesPerVertex },
        ...parent.mesh.influencePositions === void 0 ? {} : {
          influencePositions: new Float32Array(parent.mesh.influencePositions)
        },
        ...parent.mesh.influenceSourceIndices === void 0 ? {} : {
          influenceSourceIndices: new Int32Array(parent.mesh.influenceSourceIndices)
        }
      };
      return {
        kind: "weightedMesh",
        id: name,
        mesh: mesh2,
        region: regionRefOf(ctx, atlasKey, null),
        color
      };
    }
    const mesh = {
      id: name,
      positions,
      uvs,
      indices: new Uint16Array(parentMesh.indices),
      bone: parentMesh.bone,
      vertexSpace: parentMesh.vertexSpace
    };
    return { kind: "mesh", id: name, mesh, region: regionRefOf(ctx, atlasKey, null), color };
  }
  function parseSequence(raw, name, ctx, path, baseKey) {
    const seq = obj(raw.sequence);
    if (seq === null) {
      if (raw.type === "sequence") add(ctx, "warning", "W_SEQUENCE", path, "sequence \u7F3A\u5E27\u6570\u636E\uFF0C\u6309 region \u964D\u7EA7", "fallback", name);
      return void 0;
    }
    const count = Math.max(0, Math.floor(num(seq.count, 0)));
    if (count <= 0) return void 0;
    const start2 = Math.floor(num(seq.start, 0));
    const digits = Math.max(0, Math.floor(num(seq.digits, 0)));
    const setupIndex = Math.max(0, Math.min(count - 1, Math.floor(num(seq.setupIndex, 0))));
    const frames = [];
    for (let i = 0; i < count; i += 1) {
      const n = start2 + i;
      const suffix = digits > 0 ? String(n).padStart(digits, "0") : String(n);
      frames.push(`${baseKey}_${suffix}`);
    }
    if (ctx.atlasData === null) {
      add(ctx, "warning", "W_SEQUENCE", path, "\u672A\u63D0\u4F9B atlas\uFF0Csequence \u6309 setup region \u964D\u7EA7", "fallback", frames);
      return void 0;
    }
    if (!frames.every((frame) => ctx.atlasData.regions.has(frame))) {
      add(ctx, "warning", "E_SEQUENCE_REGION", path, "sequence \u5E27 region \u4E0D\u5B8C\u6574\uFF0C\u4FDD\u7559 setup \u5E27", "fallback", frames);
      return void 0;
    }
    return { frames, setupIndex };
  }
  function addClippingMask(ctx, slots, slotName, attachmentName, raw, polygon) {
    const id = `${slots.findIndex((slot) => slot.id === slotName)}:${attachmentName}`;
    if (ctx.masks.some((mask2) => mask2.id === id)) return;
    const requestedEnd = typeof raw.end === "string" ? raw.end : "";
    const endSlotId = slots.some((slot) => slot.id === requestedEnd) ? requestedEnd : slotName;
    if (endSlotId !== requestedEnd) {
      add(ctx, "warning", "W_CLIP_END", `attachments.${slotName}.${attachmentName}.end`, "clipping end slot \u4E0D\u5B58\u5728\uFF0C\u56DE\u9000\u5F53\u524D slot", "fallback", requestedEnd);
    }
    const mask = {
      id,
      mode: "clip",
      invert: raw.inverted === true || raw.inverse === true,
      feather: Math.max(0, num(raw.softness, 0)),
      polygon,
      startSlotId: slotName,
      endSlotId
    };
    ctx.masks.push(Object.freeze(mask));
  }
  function pathAttachment(skins, slots, target) {
    const slot = slots.find((item) => item.id === target);
    for (const skin of skins.values()) {
      const attachment = slot?.attachment === null ? void 0 : skin.attachments.get(`${target}\0${slot?.attachment ?? ""}`);
      if (attachment?.kind === "path") return attachment;
    }
    for (const skin of skins.values()) {
      for (const attachment of skin.attachments.values()) {
        if (attachment.kind === "path" && attachment.id === target) return attachment;
      }
    }
    return void 0;
  }
  function spinePhysicsData(o, ctx) {
    const mass = num(o.mass, 1);
    return {
      x: num(o.x),
      y: num(o.y),
      rotate: num(o.rotate),
      scaleX: num(o.scaleX),
      shearX: num(o.shearX),
      limit: num(o.limit, 5e3) * ctx.unitScale,
      step: 1 / num(o.fps, 60),
      scaleYMode: o.scaleY === "Uniform" ? "Uniform" : o.scaleY === "Volume" ? "Volume" : "None",
      inertia: num(o.inertia, 0.5),
      strength: num(o.strength, 100),
      damping: num(o.damping, 0.85),
      massInverse: 1 / mass,
      mass,
      wind: num(o.wind),
      gravity: num(o.gravity),
      mix: num(o.mix, 1),
      inertiaGlobal: o.inertiaGlobal === true,
      strengthGlobal: o.strengthGlobal === true,
      dampingGlobal: o.dampingGlobal === true,
      massGlobal: o.massGlobal === true,
      windGlobal: o.windGlobal === true,
      gravityGlobal: o.gravityGlobal === true,
      mixGlobal: o.mixGlobal === true
    };
  }
  function readSpineConstraints(doc, skeleton, skins, slots, ctx) {
    if (arr(doc.constraints).length > 0) {
      return readSpineConstraintArray(arr(doc.constraints), skeleton, skins, slots, ctx);
    }
    return readLegacySpineConstraints(doc, skeleton, skins, slots, ctx);
  }
  function readSpineConstraintArray(rawConstraints, skeleton, skins, slots, ctx) {
    const out = [];
    const idOf = (v) => {
      if (typeof v !== "string") return void 0;
      return skeleton.boneIdByName.get(v);
    };
    const idsOf = (v) => arr(v).map(idOf).filter((id) => id !== void 0);
    for (const [index, raw] of rawConstraints.entries()) {
      const o = obj(raw);
      if (o === null) continue;
      const type = typeof o.type === "string" ? o.type : "";
      const id = typeof o.name === "string" && o.name.length > 0 ? o.name : `${type || "constraint"}_${index}`;
      const order = Math.floor(num(o.order, index));
      if (type === "transform") {
        const chain = idsOf(o.bones);
        const source = idOf(o.source ?? o.target);
        if (chain.length === 0 || source === void 0) {
          add(ctx, "warning", "W_CONSTRAINT_UNSUPPORTED", `constraints[${index}]`, "transform \u7F3A bones/source\uFF0C\u5DF2\u8DF3\u8FC7", "skip", raw);
          continue;
        }
        const properties = obj(o.properties);
        const enabled = /* @__PURE__ */ new Set();
        if (properties !== null) {
          for (const entry of Object.values(properties)) {
            for (const channel of Object.keys(obj(obj(entry)?.to) ?? {})) enabled.add(channel);
          }
        }
        const channelNames = ["rotate", "x", "y", "scaleX", "scaleY", "shearY"];
        const propertyScale = (kind) => kind === "rotate" || kind === "shearY" ? DEG : kind === "x" || kind === "y" ? ctx.unitScale * (kind === "y" && ctx.sourceYDown ? -1 : 1) : 1;
        const mappings = properties === null ? [] : Object.entries(properties).flatMap(([kind, entry]) => {
          if (!channelNames.includes(kind)) return [];
          const fromKind = kind;
          const from = obj(entry) ?? {};
          const to = Object.entries(obj(from.to) ?? {}).flatMap(([target, rawTo]) => {
            if (!channelNames.includes(target)) return [];
            const toKind = target;
            const raw2 = obj(rawTo) ?? {};
            const toScale = propertyScale(toKind);
            return [{
              kind: toKind,
              offset: num(raw2.offset) * toScale,
              max: num(raw2.max, 1) * toScale,
              scale: num(raw2.scale, 1) * toScale / propertyScale(fromKind)
            }];
          });
          return to.length === 0 ? [] : [{ kind: fromKind, offset: num(from.offset) * propertyScale(fromKind), to }];
        });
        const active = (channel) => properties === null || enabled.has(channel);
        const mixRotate = active("rotate") ? num(o.mixRotate, num(o.rotateMix, 1)) : 0;
        const mixX = active("x") ? num(o.mixX, num(o.translateMix, 1)) : 0;
        const mixY = active("y") ? num(o.mixY, mixX) : 0;
        const mixScaleX = active("scaleX") ? num(o.mixScaleX, 1) : 0;
        const mixScaleY = active("scaleY") ? num(o.mixScaleY, mixScaleX) : 0;
        const mixShearY = active("shearY") ? num(o.mixShearY, 1) : 0;
        out.push({
          kind: "transform",
          id,
          bone: chain[0],
          weight: num(o.mix, 1),
          enabled: true,
          order,
          sourceBone: source,
          bones: chain,
          localSource: o.localSource === true,
          localTarget: o.localTarget === true,
          additive: o.additive === true,
          clamp: o.clamp === true,
          offsets: [
            num(o.rotation) * DEG,
            num(o.x) * ctx.unitScale,
            num(o.y) * ctx.unitScale * (ctx.sourceYDown ? -1 : 1),
            num(o.scaleX),
            num(o.scaleY),
            num(o.shearY) * DEG
          ],
          ...properties === null ? {} : { properties: mappings },
          mixRotation: mixRotate,
          mixTranslation: (mixX + mixY) / 2,
          mixRotate,
          mixX,
          mixY,
          mixScaleX,
          mixScaleY,
          mixShearY,
          ...o.rotation !== void 0 ? { offsetRotation: num(o.rotation) * DEG } : {},
          ...o.x !== void 0 ? { offsetX: num(o.x) * ctx.unitScale } : {},
          ...o.y !== void 0 ? { offsetY: (ctx.sourceYDown ? -1 : 1) * num(o.y) * ctx.unitScale } : {},
          ...o.scaleX !== void 0 ? { offsetScaleX: num(o.scaleX) } : {},
          ...o.scaleY !== void 0 ? { offsetScaleY: num(o.scaleY) } : {},
          ...o.shearY !== void 0 ? { offsetShearY: num(o.shearY) } : {}
        });
        continue;
      }
      if (type === "ik") {
        const chain = idsOf(o.bones);
        const target = idOf(o.target);
        if (chain.length === 0 || target === void 0) {
          add(ctx, "warning", "W_CONSTRAINT_UNSUPPORTED", `constraints[${index}]`, "IK \u7F3A bones/target\uFF0C\u5DF2\u8DF3\u8FC7", "skip", raw);
          continue;
        }
        out.push({
          kind: "ik",
          spine: true,
          id,
          bone: chain[chain.length - 1],
          weight: clamp014(num(o.mix, 1)),
          enabled: true,
          order,
          targetBone: target,
          chainLength: chain.length,
          method: "analytic",
          maxIterations: Math.max(1, Math.floor(num(o.iterations, 8))),
          tolerance: 1e-3,
          bendSign: o.bendPositive === false ? -1 : 1,
          ...o.softness !== void 0 ? { softness: num(o.softness, 0) * ctx.unitScale } : {},
          ...o.compress !== void 0 ? { compress: o.compress === true ? 1 : 0 } : {},
          ...o.stretch !== void 0 ? { stretch: o.stretch === true ? 1 : 0 } : {},
          ...o.uniform !== void 0 ? { uniform: o.uniform === true } : {}
        });
        continue;
      }
      if (type === "path") {
        const chain = idsOf(o.bones);
        const target = typeof o.slot === "string" ? o.slot : typeof o.target === "string" ? o.target : id;
        const attachment = pathAttachment(skins, slots, target);
        const points = attachment?.polygon;
        const usablePath = points !== void 0 && points.length >= 4 && points.length % 2 === 0 && Array.from(points).every((v) => Number.isFinite(v));
        if (chain.length === 0 || !usablePath) {
          add(ctx, "warning", "W_CONSTRAINT_UNSUPPORTED", `constraints[${index}]`, "path \u7EA6\u675F\u7F3A\u53EF\u7528 path \u51E0\u4F55\uFF0C\u5DF2\u8DF3\u8FC7", "skip", raw);
          continue;
        }
        out.push({
          kind: "path",
          id,
          bone: chain[chain.length - 1],
          weight: clamp014(num(o.mix, 1)),
          enabled: true,
          order,
          points,
          mix: clamp014(num(o.mix, 1)),
          bones: chain,
          ...attachment?.pathData !== void 0 && attachment.pathData.lengths.length > 0 && attachment.pathData.vertices.length > 0 ? { spinePath: attachment.pathData } : {},
          ...slots.find((slot) => slot.id === target) !== void 0 ? { targetBone: slots.find((slot) => slot.id === target).bone } : {},
          spacingMode: o.spacingMode === "fixed" || o.spacingMode === "percent" || o.spacingMode === "proportional" ? o.spacingMode : "length",
          positionMode: o.positionMode === "fixed" ? "fixed" : "percent",
          rotateMode: o.rotateMode === "tangent" || o.rotateMode === "chainScale" ? o.rotateMode : "chain",
          offsetRotation: num(o.rotation, num(o.offsetRotation)) * DEG,
          spacing: num(o.spacing) * (o.spacingMode === "fixed" || o.spacingMode === "length" || o.spacingMode === void 0 ? ctx.unitScale : 1),
          position: num(o.position) * (o.positionMode === "fixed" ? ctx.unitScale : 1),
          mixRotate: clamp014(num(o.mixRotate, num(o.rotateMix, 1))),
          mixX: clamp014(num(o.mixX, num(o.translateMix, 1))),
          mixY: clamp014(num(o.mixY, num(o.translateMix, 1))),
          ...attachment?.pathData !== void 0 ? { closed: attachment.pathData.closed } : o.closed !== void 0 ? { closed: o.closed === true } : {}
        });
        continue;
      }
      if (type === "slider") {
        const sourceBone = idOf(o.bone);
        const property = typeof o.property === "string" ? o.property : void 0;
        const validProperties = ["rotate", "x", "y", "scaleX", "scaleY", "shearY"];
        if (o.bone !== void 0 && (sourceBone === void 0 || property === void 0 || !validProperties.includes(property))) {
          add(ctx, "warning", "W_CONSTRAINT_UNSUPPORTED", `constraints[${index}]`, "slider source/property invalid", "skip", raw);
          continue;
        }
        const animation = typeof o.animation === "string" ? o.animation : "";
        const unit = property === "x" || property === "y" ? ctx.unitScale * (property === "y" && ctx.sourceYDown ? -1 : 1) : 1;
        out.push({
          kind: "slider",
          id,
          bone: sourceBone ?? 0,
          weight: 1,
          enabled: true,
          order,
          animation,
          ...sourceBone === void 0 ? {} : { sourceBone, property },
          from: num(o.from) * unit,
          to: num(o.to),
          scale: num(o.scale, 1) / unit,
          time: num(o.time),
          mix: num(o.mix, 1),
          local: o.local === true,
          loop: o.loop === true,
          additive: o.additive === true
        });
        continue;
      }
      if (type === "physics") {
        const bone = idOf(o.bone);
        if (bone === void 0) {
          add(ctx, "warning", "W_PHYSICS_SKIPPED", `constraints[${index}]`, "physics \u7F3A bone\uFF0C\u5DF2\u8DF3\u8FC7", "skip", raw);
          continue;
        }
        out.push({
          kind: "physics",
          id,
          bone,
          weight: 1,
          enabled: true,
          order,
          ...spinePhysicsData(o, ctx),
          ...typeof o.target === "string" && idOf(o.target) !== void 0 ? { target: idOf(o.target) } : {}
        });
        add(
          ctx,
          "warning",
          "W_PHYSICS_APPROX",
          `constraints[${index}]`,
          "physics \u6570\u636E\u548C timeline \u5DF2\u8BFB\u5165\uFF1B\u4E16\u754C\u7A7A\u95F4\u79EF\u5206\u53CA scale/shear \u901A\u9053\u5C1A\u672A\u5BF9\u6807\u5B98\u65B9",
          "keep"
        );
        continue;
      }
      add(ctx, "warning", "W_CONSTRAINT_UNSUPPORTED", `constraints[${index}]`, "\u672A\u77E5\u7EA6\u675F\u7C7B\u578B\uFF0C\u5DF2\u8DF3\u8FC7", "skip", type);
    }
    return out;
  }
  function readLegacySpineConstraints(doc, skeleton, skins, slots, ctx) {
    const out = [];
    const idOf = (v) => {
      if (typeof v !== "string") return void 0;
      return skeleton.boneIdByName.get(v);
    };
    const idsOf = (v) => arr(v).map(idOf).filter((id) => id !== void 0);
    for (const [index, raw] of arr(doc.ik).entries()) {
      const o = obj(raw);
      if (o === null) continue;
      const chain = idsOf(o.bones);
      const target = idOf(o.target);
      if (chain.length === 0 || target === void 0) {
        add(ctx, "warning", "W_CONSTRAINT_UNSUPPORTED", `ik[${index}]`, "IK \u7F3A bones/target\uFF0C\u5DF2\u8DF3\u8FC7", "skip", raw);
        continue;
      }
      if (o.mix === void 0 || o.bendPositive === void 0) {
        add(ctx, "warning", "W_CONSTRAINT_DEFAULT", `ik[${index}]`, "IK \u7F3A mix/bendPositive\uFF0C\u4F7F\u7528\u9ED8\u8BA4\u503C", "fallback", raw);
      }
      out.push({
        kind: "ik",
        spine: true,
        id: typeof o.name === "string" && o.name.length > 0 ? o.name : `ik_${index}`,
        bone: chain[chain.length - 1],
        weight: clamp014(num(o.mix, 1)),
        enabled: true,
        order: Math.floor(num(o.order, index)),
        targetBone: target,
        chainLength: chain.length,
        method: "analytic",
        maxIterations: Math.max(1, Math.floor(num(o.iterations, 8))),
        tolerance: 1e-3,
        bendSign: o.bendPositive === false ? -1 : 1
      });
    }
    for (const [index, raw] of arr(doc.transform).entries()) {
      const o = obj(raw);
      if (o === null) continue;
      const chain = idsOf(o.bones);
      const source = idOf(o.target);
      if (chain.length === 0 || source === void 0) {
        add(ctx, "warning", "W_CONSTRAINT_UNSUPPORTED", `transform[${index}]`, "transform \u7F3A bones/target\uFF0C\u5DF2\u8DF3\u8FC7", "skip", raw);
        continue;
      }
      if (o.mixRotate === void 0 && o.mixX === void 0 && o.mixY === void 0) {
        add(ctx, "warning", "W_CONSTRAINT_DEFAULT", `transform[${index}]`, "transform \u7F3A mix\uFF0C\u4F7F\u7528\u9ED8\u8BA4 1", "fallback", raw);
      }
      const mixRotate = num(o.mixRotate, 1);
      const mixX = num(o.mixX, 1);
      const mixY = num(o.mixY, mixX);
      const mixScaleX = num(o.mixScaleX, 1);
      const mixScaleY = num(o.mixScaleY, mixScaleX);
      const mixShearY = num(o.mixShearY, 1);
      out.push({
        kind: "transform",
        id: typeof o.name === "string" && o.name.length > 0 ? o.name : `transform_${index}`,
        bone: chain[0],
        weight: clamp014(num(o.mix, 1)),
        enabled: true,
        order: Math.floor(num(o.order, index)),
        sourceBone: source,
        bones: chain,
        local: o.local === true,
        relative: o.relative === true,
        mixRotation: mixRotate,
        mixTranslation: (mixX + mixY) / 2,
        mixRotate,
        mixX,
        mixY,
        mixScaleX,
        mixScaleY,
        mixShearY,
        ...o.rotation !== void 0 ? { offsetRotation: num(o.rotation) * DEG } : {},
        ...o.x !== void 0 ? { offsetX: num(o.x) * ctx.unitScale } : {},
        ...o.y !== void 0 ? { offsetY: num(o.y) * ctx.unitScale * (ctx.sourceYDown ? -1 : 1) } : {},
        ...o.scaleX !== void 0 ? { offsetScaleX: num(o.scaleX) } : {},
        ...o.scaleY !== void 0 ? { offsetScaleY: num(o.scaleY) } : {},
        ...o.shearY !== void 0 ? { offsetShearY: num(o.shearY) * DEG } : {}
      });
    }
    for (const [index, raw] of arr(doc.path).entries()) {
      const o = obj(raw);
      if (o === null) continue;
      const chain = idsOf(o.bones);
      const target = typeof o.target === "string" ? o.target : "";
      const attachment = pathAttachment(skins, slots, target);
      const points = attachment?.polygon;
      if (chain.length === 0 || points === void 0) {
        add(ctx, "warning", "W_CONSTRAINT_UNSUPPORTED", `path[${index}]`, "path \u7EA6\u675F\u7F3A bones/path \u9644\u4EF6\uFF0C\u5DF2\u8DF3\u8FC7", "skip", raw);
        continue;
      }
      if (o.mixX === void 0 && o.mixRotate === void 0) {
        add(ctx, "warning", "W_CONSTRAINT_DEFAULT", `path[${index}]`, "path \u7F3A mix\uFF0C\u4F7F\u7528\u9ED8\u8BA4 1", "fallback", raw);
      }
      out.push({
        kind: "path",
        id: typeof o.name === "string" && o.name.length > 0 ? o.name : `path_${index}`,
        bone: chain[chain.length - 1],
        weight: clamp014(num(o.mix, 1)),
        enabled: true,
        order: Math.floor(num(o.order, index)),
        points,
        mix: clamp014(num(o.mixX, num(o.mixRotate, 1))),
        bones: chain,
        ...attachment?.pathData !== void 0 && attachment.pathData.lengths.length > 0 && attachment.pathData.vertices.length > 0 ? { spinePath: attachment.pathData } : {},
        ...slots.find((slot) => slot.id === target) !== void 0 ? { targetBone: slots.find((slot) => slot.id === target).bone } : {},
        spacingMode: o.spacingMode === "fixed" || o.spacingMode === "percent" || o.spacingMode === "proportional" ? o.spacingMode : "length",
        positionMode: o.positionMode === "fixed" ? "fixed" : "percent",
        rotateMode: o.rotateMode === "tangent" || o.rotateMode === "chainScale" ? o.rotateMode : "chain",
        offsetRotation: num(o.rotation, num(o.offsetRotation)) * DEG,
        spacing: num(o.spacing) * (o.spacingMode === "percent" || o.spacingMode === "proportional" ? 1 : ctx.unitScale),
        position: num(o.position) * (o.positionMode === "fixed" ? ctx.unitScale : 1),
        mixRotate: clamp014(num(o.mixRotate, num(o.rotateMix, 1))),
        mixX: clamp014(num(o.mixX, num(o.translateMix, 1))),
        mixY: clamp014(num(o.mixY, num(o.translateMix, 1)))
      });
    }
    for (const [index, raw] of arr(doc.physics).entries()) {
      const o = obj(raw);
      if (o === null) continue;
      const bone = idOf(o.bone);
      if (bone === void 0) {
        add(ctx, "warning", "W_PHYSICS_SKIPPED", `physics[${index}]`, "physics \u7F3A bone\uFF0C\u5DF2\u8DF3\u8FC7", "skip", raw);
        continue;
      }
      const target = idOf(o.target);
      out.push({
        kind: "physics",
        id: typeof o.name === "string" && o.name.length > 0 ? o.name : `physics_${index}`,
        order: Math.floor(num(o.order, index)),
        enabled: false,
        weight: clamp014(num(o.mix, 1)),
        bone,
        ...target === void 0 ? {} : { target },
        ...spinePhysicsData(o, ctx)
      });
      add(ctx, "warning", "W_PHYSICS_SKIPPED", `physics[${index}]`, "\u65E7\u7248 physics \u7EA6\u675F\u4FDD\u7559\u6570\u636E\u4F46\u9ED8\u8BA4\u4E0D\u6C42\u89E3", "keep", raw);
    }
    return out;
  }
  function pickDefaultSkin(skins, requested, ctx) {
    if (requested !== void 0 && skins.has(requested)) return requested;
    if (requested !== void 0 && !skins.has(requested)) {
      add(ctx, "warning", "W_SKIN_MISSING", "skins.defaultSkin", "\u6307\u5B9A\u9ED8\u8BA4\u76AE\u80A4\u4E0D\u5B58\u5728\uFF0C\u56DE\u9000\u7B2C\u4E00\u4E2A", "fallback", requested);
    }
    if (skins.has("default")) return "default";
    const first = skins.keys().next().value;
    if (first === void 0) {
      add(ctx, "warning", "W_SKIN_MISSING", "skins", "\u6CA1\u6709\u76AE\u80A4\uFF0C\u4F7F\u7528\u7A7A\u76AE\u80A4", "fallback", requested);
      return "default";
    }
    if (requested === void 0) {
      add(ctx, "warning", "W_SKIN_MISSING", "skins.defaultSkin", "\u6CA1\u6709\u540D\u4E3A default \u7684\u76AE\u80A4\uFF0C\u56DE\u9000\u7B2C\u4E00\u4E2A", "fallback", first);
    }
    return first;
  }
  function attachmentIndex(skins) {
    const out = /* @__PURE__ */ new Map();
    for (const skin of skins.values()) {
      for (const key of skin.attachments.keys()) {
        if (!out.has(key)) out.set(key, out.size);
      }
    }
    return out;
  }
  function drawOrderTimelines(keys, slotCount) {
    const out = [];
    for (let pos = 0; pos < slotCount; pos += 1) {
      out.push({
        kind: "drawOrder",
        path: `drawOrder[${pos}]`,
        keys: keys.map((k) => ({ time: k.time, value: k.order[pos] ?? pos }))
      });
    }
    return out;
  }
  function fromOffsets(offsets, slotNames, ctx, path) {
    const count = slotNames.length;
    const order = new Array(count).fill(-1);
    const unchanged = [];
    let original = 0;
    for (const raw of arr(offsets)) {
      const o = obj(raw);
      if (o === null) continue;
      const slot = typeof o.slot === "string" ? slotNames.indexOf(o.slot) : num(o.slot, -1);
      const offset = num(o.offset);
      if (slot < original || slot >= count || !Number.isInteger(offset) || slot + offset < 0 || slot + offset >= count || order[slot + offset] !== -1) {
        add(ctx, "warning", "W_DRAWORDER_DUP", path, "drawOrder \u504F\u79FB\u975E\u6CD5\uFF0C\u5DF2\u5FFD\u7565", "skip", raw);
        continue;
      }
      while (original < slot) unchanged.push(original++);
      order[slot + offset] = original++;
    }
    while (original < count) unchanged.push(original++);
    for (let i = count - 1; i >= 0; i -= 1) {
      if (order[i] === -1) order[i] = unchanged.pop();
    }
    return order;
  }
  function spineBoneCurve(key, next, component, value, nextValue, controlScale) {
    if (key.curve === "stepped") return "stepped";
    const curve = key.curve;
    const offset = component * 4;
    if (!Array.isArray(curve) || curve.length < offset + 4 || next === null) return void 0;
    const span = num(next.time) - num(key.time);
    const delta2 = nextValue - value;
    if (span <= 0 || Math.abs(delta2) < 1e-12) return void 0;
    return [
      (num(curve[offset]) - num(key.time)) / span,
      (num(curve[offset + 1]) * controlScale - value) / delta2,
      (num(curve[offset + 2]) - num(key.time)) / span,
      (num(curve[offset + 3]) * controlScale - value) / delta2
    ];
  }
  function packedColor(v, ctx, path) {
    return packRgba(parseHexColor(v, ctx, path));
  }
  function packRgba(c) {
    const byte = (x) => Math.round(clamp014(x) * 255);
    return (byte(c.a) << 24 | byte(c.r) << 16 | byte(c.g) << 8 | byte(c.b)) >>> 0;
  }
  function readSpineAnimations(rawAnimations, sk, slotNames, attIndex, skins, rawSkins, constraints, legacyConstraints, ctx) {
    const animations = /* @__PURE__ */ new Map();
    const events = [];
    for (const [name, rawAnimation] of Object.entries(obj(rawAnimations) ?? {})) {
      const a = obj(rawAnimation);
      if (a === null) continue;
      const timelines = [];
      let duration = 0;
      for (const [boneName, rawChannels] of Object.entries(obj(a.bones) ?? {})) {
        const id = sk.boneIdByName.get(boneName);
        if (id === void 0) {
          add(ctx, "warning", "W_ANIM_TARGET_MISSING", `animations.${name}.bones.${boneName}`, "\u52A8\u753B\u9AA8\u4E0D\u5B58\u5728\uFF0C\u5DF2\u8DF3\u8FC7", "skip", boneName);
          continue;
        }
        const ch = obj(rawChannels);
        if (ch === null) continue;
        const base = id * 7;
        if (arr(ch.rotate).length > 0) {
          const keys = arr(ch.rotate).map((raw, index, sourceKeys) => {
            const k = obj(raw) ?? {};
            const time = num(k.time);
            duration = Math.max(duration, time);
            const absolute = k.angle !== void 0 ? num(k.angle) * DEG : sk.setupLocal[base + 2] + num(k.value) * DEG;
            const value = absolute - sk.setupLocal[base + 2];
            const next = obj(sourceKeys[index + 1]);
            const nextValue = next === null ? value : next.angle !== void 0 ? num(next.angle) * DEG - sk.setupLocal[base + 2] : num(next.value) * DEG;
            const curve = spineBoneCurve(k, next, 0, value, nextValue, DEG);
            return { time, value, ...curve === void 0 ? {} : { curve } };
          });
          timelines.push({ kind: "rotate", path: boneName, keys });
        }
        if (arr(ch.translate).length > 0) {
          for (const axis of ["x", "y"]) {
            const keys = arr(ch.translate).map((raw, index, sourceKeys) => {
              const k = obj(raw) ?? {};
              const time = num(k.time);
              duration = Math.max(duration, time);
              const scale = ctx.unitScale * (axis === "y" && ctx.sourceYDown ? -1 : 1);
              const value = num(k[axis]) * scale;
              const next = obj(sourceKeys[index + 1]);
              const curve = spineBoneCurve(k, next, axis === "x" ? 0 : 1, value, num(next?.[axis]) * scale, scale);
              return { time, value, ...curve === void 0 ? {} : { curve } };
            });
            timelines.push({ kind: "translate", path: `${boneName}.${axis}`, keys });
          }
        }
        if (arr(ch.scale).length > 0) {
          for (const axis of ["sx", "sy"]) {
            const keys = arr(ch.scale).map((raw, index, sourceKeys) => {
              const k = obj(raw) ?? {};
              const time = num(k.time);
              duration = Math.max(duration, time);
              const component = axis === "sx" ? "x" : "y";
              const value = num(k[component], 1);
              const next = obj(sourceKeys[index + 1]);
              const curve = spineBoneCurve(k, next, component === "x" ? 0 : 1, value, num(next?.[component], 1), 1);
              return { time, value, ...curve === void 0 ? {} : { curve } };
            });
            timelines.push({ kind: "scale", path: `${boneName}.${axis}`, keys });
          }
        }
        for (const kind of ["translate", "scale", "shear"]) {
          const combined = kind === "shear" ? ch.shear : void 0;
          for (const axis of ["x", "y"]) {
            const keysRaw = arr(ch[`${kind}${axis}`]).length > 0 ? arr(ch[`${kind}${axis}`]) : arr(combined);
            if (keysRaw.length === 0) continue;
            const suffix = kind === "translate" ? axis : kind === "scale" ? `s${axis}` : `sh${axis}`;
            const keys = keysRaw.map((raw, index) => {
              const k = obj(raw) ?? {};
              const time = num(k.time);
              duration = Math.max(duration, time);
              const paired = kind === "shear" && arr(ch[`${kind}${axis}`]).length === 0;
              const property = paired ? axis : "value";
              const scale = kind === "translate" ? ctx.unitScale * (axis === "y" && ctx.sourceYDown ? -1 : 1) : kind === "shear" ? DEG : 1;
              const defaultValue = kind === "scale" ? 1 : 0;
              const value = num(k[property], defaultValue) * scale;
              const next = obj(keysRaw[index + 1]);
              const nextValue = num(next?.[property], defaultValue) * scale;
              const curve = spineBoneCurve(k, next, paired && axis === "y" ? 1 : 0, value, nextValue, scale);
              return { time, value, ...curve === void 0 ? {} : { curve } };
            });
            timelines.push({ kind, path: `${boneName}.${suffix}`, keys });
          }
        }
      }
      for (const [slotName, rawChannels] of Object.entries(obj(a.slots) ?? {})) {
        const slotIndex = slotNames.indexOf(slotName);
        if (slotIndex < 0) continue;
        const ch = obj(rawChannels);
        if (ch === null) continue;
        if (arr(ch.attachment).length > 0) {
          const keys = arr(ch.attachment).map((raw) => {
            const k = obj(raw) ?? {};
            const time = num(k.time);
            duration = Math.max(duration, time);
            const label = typeof k.name === "string" ? k.name : null;
            return { time, name: label };
          });
          timelines.push({ kind: "attachment", path: String(slotIndex), keys });
        }
        if (arr(ch.color).length > 0) {
          const keys = arr(ch.color).map((raw) => {
            const k = obj(raw) ?? {};
            const time = num(k.time);
            duration = Math.max(duration, time);
            return { time, value: packedColor(k.color, ctx, `animations.${name}.slots.${slotName}.color`) };
          });
          timelines.push({ kind: "color", path: String(slotIndex), keys });
        }
        for (const channel of ["rgba", "rgb", "alpha", "rgba2", "rgb2"]) {
          if (arr(ch[channel]).length === 0) continue;
          const keys = arr(ch[channel]).map((raw, index, sourceKeys) => {
            const k = obj(raw) ?? {};
            const time = num(k.time);
            duration = Math.max(duration, time);
            const parse = (value, field) => {
              const hex = typeof value === "string" && /^[\da-fA-F]{6}$/.test(value) ? `${value}ff` : value;
              return parseHexColor(hex, ctx, `animations.${name}.slots.${slotName}.${channel}.${field}`);
            };
            const readColors = (key) => ({
              light: channel === "alpha" ? { ...WHITE, a: num(key.value) } : parse(channel.endsWith("2") ? key.light : key.color, "light"),
              dark: channel.endsWith("2") ? parse(key.dark, "dark") : WHITE
            });
            const { light, dark } = readColors(k);
            const next = obj(sourceKeys[index + 1]);
            const future = next === null ? null : readColors(next);
            const values = channel === "alpha" ? [light.a] : channel === "rgb" ? [light.r, light.g, light.b] : channel === "rgba" ? [light.r, light.g, light.b, light.a] : channel === "rgb2" ? [light.r, light.g, light.b, dark.r, dark.g, dark.b] : [light.r, light.g, light.b, light.a, dark.r, dark.g, dark.b];
            const nextValues = future === null ? values : channel === "alpha" ? [future.light.a] : channel === "rgb" ? [future.light.r, future.light.g, future.light.b] : channel === "rgba" ? [future.light.r, future.light.g, future.light.b, future.light.a] : channel === "rgb2" ? [future.light.r, future.light.g, future.light.b, future.dark.r, future.dark.g, future.dark.b] : [future.light.r, future.light.g, future.light.b, future.light.a, future.dark.r, future.dark.g, future.dark.b];
            const curves = values.map((value, component) => spineBoneCurve(k, next, component, value, nextValues[component], 1));
            return {
              time,
              light,
              ...channel.endsWith("2") ? { dark } : {},
              ...k.curve === "stepped" ? { curve: "stepped" } : {},
              ...k.curve === void 0 ? {} : { curves }
            };
          });
          timelines.push({ kind: "color", path: String(slotIndex), channel, keys });
        }
      }
      if (arr(a.drawOrder).length > 0) {
        const drawKeys = arr(a.drawOrder).map((raw, i) => {
          const k = obj(raw) ?? {};
          const time = num(k.time);
          duration = Math.max(duration, time);
          return { time, order: fromOffsets(k.offsets, slotNames, ctx, `animations.${name}.drawOrder[${i}]`) };
        });
        timelines.push(...drawOrderTimelines(drawKeys, slotNames.length));
      }
      for (const [rootName, rawRoot] of [["deform", a.deform], ["attachments", a.attachments]]) {
        for (const [skinName, rawSkin] of Object.entries(obj(rawRoot) ?? {})) {
          for (const [slotName, rawSlot] of Object.entries(obj(rawSkin) ?? {})) {
            const slotIndex = slotNames.indexOf(slotName);
            for (const [attName, rawEntry] of Object.entries(obj(rawSlot) ?? {})) {
              const rawKeys = rootName === "attachments" ? obj(rawEntry)?.deform : rawEntry;
              if (arr(rawKeys).length === 0) continue;
              const path = `animations.${name}.${rootName}.${skinName}.${slotName}.${attName}`;
              const attachment = skins.get(skinName)?.attachments.get(`${slotName}\0${attName}`);
              if (slotIndex < 0 || attachment?.kind !== "mesh" && attachment?.kind !== "weightedMesh") {
                add(ctx, "warning", "W_ANIM_TARGET_MISSING", path, "deform mesh \u4E0D\u5B58\u5728\uFF0C\u5DF2\u8DF3\u8FC7", "skip");
                continue;
              }
              const rawSkinData = arr(rawSkins).find((skin) => obj(skin)?.name === skinName);
              const rawAttachment = obj(obj(obj(rawSkinData)?.attachments)?.[slotName])?.[attName];
              const sourceAttachment = obj(rawAttachment)?.type === "linkedmesh" ? obj(obj(obj(rawSkinData)?.attachments)?.[slotName])?.[String(obj(rawAttachment)?.parent)] : rawAttachment;
              const rawVertices = arr(obj(sourceAttachment)?.vertices);
              const weighted = attachment.kind === "weightedMesh";
              const base = attachment.mesh.positions;
              const vertexIndices = weighted && attachment.mesh.influenceSourceIndices !== void 0 ? Array.from(attachment.mesh.influenceSourceIndices) : (() => {
                const indices = [];
                if (!weighted) return indices;
                let cursor = 0;
                let source = 0;
                const stride = attachment.mesh.influencesPerVertex ?? 4;
                for (let vertex = 0; vertex < base.length / 2; vertex += 1) {
                  const count = Math.max(0, Math.floor(num(rawVertices[cursor])));
                  for (let influence = 0; influence < stride; influence += 1) {
                    indices.push(influence < count ? source + influence * 2 : -1);
                  }
                  cursor += 1 + count * 4;
                  source += count * 2;
                }
                return indices;
              })();
              const keys = arr(rawKeys).map((raw) => {
                const k = obj(raw) ?? {};
                const time = num(k.time);
                duration = Math.max(duration, time);
                return {
                  time,
                  offset: num(k.offset),
                  vertices: arr(k.vertices).map((v) => num(v)),
                  ...k.curve === "stepped" ? { curve: "stepped" } : {}
                };
              });
              timelines.push({
                kind: "deform",
                skin: skinName,
                slot: slotIndex,
                attachment: attName,
                keys,
                ...weighted ? { vertexIndices } : { baseVertices: base },
                weighted,
                unitScale: ctx.unitScale,
                flipY: ctx.sourceYDown
              });
            }
          }
        }
      }
      const constraintFrames = (rawKeys, fields, defaults, scales) => arr(rawKeys).map((raw, index, source) => {
        const key = obj(raw) ?? {};
        const next = obj(source[index + 1]);
        const time = num(key.time);
        duration = Math.max(duration, time);
        const fieldValue = (sourceKey, field, component) => {
          const fallback = field === "mixY" ? sourceKey?.mixX : field === "mixScaleY" ? sourceKey?.mixScaleX : void 0;
          return num(sourceKey?.[field], num(fallback, defaults[component])) * scales[component];
        };
        const values = fields.map((field, component) => fieldValue(key, field, component));
        const curves = values.map((value, component) => spineBoneCurve(
          key,
          next,
          component,
          value,
          fieldValue(next, fields[component], component),
          scales[component]
        ));
        return {
          time,
          values,
          curves,
          ...fields[0] === "mix" ? {
            bendDirection: key.bendPositive === false ? -1 : 1,
            compress: key.compress === true,
            stretch: key.stretch === true
          } : {}
        };
      });
      const validConstraint = (kind, constraintName, path) => {
        if (constraints.some((c) => c.id === constraintName && c.kind === kind)) return true;
        add(ctx, "warning", "W_ANIM_TARGET_MISSING", path, "\u7EA6\u675F timeline \u76EE\u6807\u4E0D\u5B58\u5728\uFF0C\u5DF2\u8DF3\u8FC7", "skip", constraintName);
        return false;
      };
      for (const [constraintName, rawKeys] of Object.entries(obj(a.ik) ?? {})) {
        const path = `animations.${name}.ik.${constraintName}`;
        if (!validConstraint("ik", constraintName, path)) continue;
        const frames = constraintFrames(rawKeys, ["mix", "softness"], [1, 0], [1, ctx.unitScale]);
        if (frames.length > 0) {
          if (legacyConstraints) timelines.push({
            kind: "ik",
            path: constraintName,
            keys: frames.map((frame) => ({ time: frame.time, value: frame.values[0] }))
          });
          else timelines.push({ kind: "ik", path: constraintName, frames });
        }
      }
      for (const [constraintName, rawKeys] of Object.entries(obj(a.transform) ?? {})) {
        const path = `animations.${name}.transform.${constraintName}`;
        if (!validConstraint("transform", constraintName, path)) continue;
        const frames = constraintFrames(
          rawKeys,
          ["mixRotate", "mixX", "mixY", "mixScaleX", "mixScaleY", "mixShearY"],
          [1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1]
        );
        if (frames.length > 0) timelines.push({ kind: "transform", path: constraintName, frames });
      }
      for (const [constraintName, rawChannels] of Object.entries(obj(a.path) ?? {})) {
        const path = `animations.${name}.path.${constraintName}`;
        if (!validConstraint("path", constraintName, path)) continue;
        const constraint = constraints.find((c) => c.id === constraintName && c.kind === "path");
        for (const [channel, rawKeys] of Object.entries(obj(rawChannels) ?? {})) {
          if (channel !== "position" && channel !== "spacing" && channel !== "mix") {
            add(ctx, "warning", "W_ANIM_UNSUPPORTED", `${path}.${channel}`, "\u672A\u77E5 path timeline\uFF0C\u5DF2\u8DF3\u8FC7", "skip", rawKeys);
            continue;
          }
          const scale = channel === "position" ? constraint.positionMode === "fixed" ? ctx.unitScale : 1 : channel === "spacing" ? constraint.spacingMode === "length" || constraint.spacingMode === "fixed" ? ctx.unitScale : 1 : 1;
          const fields = channel === "mix" ? ["mixRotate", "mixX", "mixY"] : ["value"];
          const frames = constraintFrames(rawKeys, fields, fields.map(() => channel === "mix" ? 1 : 0), fields.map(() => scale));
          if (frames.length > 0) timelines.push({ kind: "path", path: constraintName, channel, frames });
        }
      }
      for (const [constraintName, rawChannels] of Object.entries(obj(a.slider) ?? {})) {
        const path = `animations.${name}.slider.${constraintName}`;
        if (!validConstraint("slider", constraintName, path)) continue;
        for (const [channel, rawKeys] of Object.entries(obj(rawChannels) ?? {})) {
          if (channel !== "time" && channel !== "mix") {
            add(ctx, "warning", "W_ANIM_UNSUPPORTED", `${path}.${channel}`, "unknown slider timeline", "skip", rawKeys);
            continue;
          }
          const frames = constraintFrames(rawKeys, ["value"], [channel === "mix" ? 1 : 0], [1]);
          if (frames.length > 0) timelines.push({ kind: "slider", path: constraintName, channel, frames });
        }
      }
      for (const [constraintName, rawChannels] of Object.entries(obj(a.physics) ?? {})) {
        const path = `animations.${name}.physics.${constraintName}`;
        if (constraintName !== "" && !validConstraint("physics", constraintName, path)) continue;
        for (const [channel, rawKeys] of Object.entries(obj(rawChannels) ?? {})) {
          if (!["reset", "inertia", "strength", "damping", "mass", "wind", "gravity", "mix"].includes(channel)) {
            add(ctx, "warning", "W_ANIM_UNSUPPORTED", `${path}.${channel}`, "\u672A\u77E5 physics timeline\uFF0C\u5DF2\u8DF3\u8FC7", "skip", rawKeys);
            continue;
          }
          const frames = constraintFrames(rawKeys, ["value"], [channel === "mix" ? 1 : 0], [1]);
          if (frames.length > 0) timelines.push({
            kind: "physics",
            path: constraintName || "-1",
            channel,
            frames
          });
        }
      }
      const eventKeys = arr(a.events).map((raw) => {
        const k = obj(raw) ?? {};
        const time = num(k.time);
        duration = Math.max(duration, time);
        return {
          time,
          name: typeof k.name === "string" ? k.name : "",
          ...k.int !== void 0 ? { int: num(k.int) } : {},
          ...k.float !== void 0 ? { float: num(k.float) } : {},
          ...typeof k.string === "string" ? { string: k.string } : {}
        };
      });
      if (eventKeys.length > 0) {
        timelines.push({ kind: "event", path: name, events: eventKeys });
        for (const e of eventKeys) events.push({ time: e.time, name: e.name });
      }
      animations.set(name, { name, duration, timelines });
    }
    return { animations, events };
  }
  function canonical(v) {
    if (v === null || v === void 0) return "null";
    if (typeof v === "string") return JSON.stringify(v);
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") return JSON.stringify(Number.isFinite(v) ? v === 0 ? 0 : v : null);
    if (ArrayBuffer.isView(v)) return canonical(Array.from(v));
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (v instanceof Map) {
      const entries = Array.from(v.entries()).map(([k, item]) => [canonical(k), canonical(item)]).sort((l, r) => l[0] < r[0] ? -1 : l[0] > r[0] ? 1 : 0);
      return `{${entries.map(([k, item]) => `${k}:${item}`).join(",")}}`;
    }
    if (typeof v === "object") {
      const o = v;
      const keys = Object.keys(o).filter((k) => o[k] !== void 0).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
    }
    return "null";
  }
  var K256 = new Uint32Array([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  function rotr(x, n) {
    return x >>> n | x << 32 - n;
  }
  function utf8(s) {
    const out = [];
    for (let i = 0; i < s.length; i += 1) {
      let cp = s.charCodeAt(i);
      if (cp >= 55296 && cp <= 56319 && i + 1 < s.length) {
        const lo = s.charCodeAt(i + 1);
        if (lo >= 56320 && lo <= 57343) {
          cp = 65536 + (cp - 55296 << 10) + (lo - 56320);
          i += 1;
        }
      }
      if (cp < 128) out.push(cp);
      else if (cp < 2048) out.push(192 | cp >> 6, 128 | cp & 63);
      else if (cp < 65536) out.push(224 | cp >> 12, 128 | cp >> 6 & 63, 128 | cp & 63);
      else out.push(240 | cp >> 18, 128 | cp >> 12 & 63, 128 | cp >> 6 & 63, 128 | cp & 63);
    }
    return Uint8Array.from(out);
  }
  function sha256Hex(msg) {
    const total = Math.ceil((msg.length + 9) / 64) * 64;
    const padded = new Uint8Array(total);
    padded.set(msg);
    padded[msg.length] = 128;
    const view = new DataView(padded.buffer);
    const bits = msg.length * 8;
    view.setUint32(total - 8, Math.floor(bits / 4294967296));
    view.setUint32(total - 4, bits >>> 0);
    const h = new Uint32Array([
      1779033703,
      3144134277,
      1013904242,
      2773480762,
      1359893119,
      2600822924,
      528734635,
      1541459225
    ]);
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4);
      for (let i = 16; i < 64; i += 1) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
        w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3];
      let e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < 64; i += 1) {
        const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = e & f ^ ~e & g;
        const t1 = hh + s1 + ch + K256[i] + w[i] >>> 0;
        const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = a & b ^ a & c ^ b & c;
        const t2 = s0 + maj >>> 0;
        hh = g;
        g = f;
        f = e;
        e = d + t1 >>> 0;
        d = c;
        c = b;
        b = a;
        a = t1 + t2 >>> 0;
      }
      h[0] = h[0] + a >>> 0;
      h[1] = h[1] + b >>> 0;
      h[2] = h[2] + c >>> 0;
      h[3] = h[3] + d >>> 0;
      h[4] = h[4] + e >>> 0;
      h[5] = h[5] + f >>> 0;
      h[6] = h[6] + g >>> 0;
      h[7] = h[7] + hh >>> 0;
    }
    return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
  }
  function canonicalHash(asset) {
    return sha256Hex(utf8(canonical(asset)));
  }
  function unitScaleOf(options, ctx) {
    const given = options?.unitScale;
    if (given !== void 0 && Number.isFinite(given) && given > 0) return given;
    add(ctx, "info", "I_UNIT_ASSUMED", "unitScale", "\u672A\u63D0\u4F9B unitScale\uFF0C\u91C7\u7528 0.01\uFF08100px/m\uFF09", "fallback", given);
    return 0.01;
  }
  function freezeAsset(source, sourceVersion, unitScale, skeleton, slots, skins, animations, events, ctx, atlas, constraints, maskLibrary) {
    slots.forEach((slot) => Object.freeze(slot));
    for (const skin of skins.values()) Object.freeze(skin);
    animations.forEach((clip) => Object.freeze(clip));
    const core = {
      schema: 1,
      source,
      sourceVersion,
      unitScale,
      skeleton,
      slots: Object.freeze(slots),
      skins: Object.freeze(skins),
      animations: Object.freeze(animations),
      events: Object.freeze(events),
      ...atlas !== void 0 ? { atlas } : {},
      ...constraints !== void 0 ? { constraints: Object.freeze(constraints) } : {},
      ...maskLibrary !== void 0 ? { maskLibrary } : {}
    };
    const report = {
      issues: ctx.issues,
      warnings: ctx.issues.filter((i) => i.severity === "warning").length,
      errors: ctx.issues.filter((i) => i.severity === "error").length
    };
    return Object.freeze({ ...core, hash: canonicalHash(core), report });
  }
  function importSpine(json, options) {
    const doc = obj(json);
    if (doc === null) throw new Error("E_SCHEMA: spine JSON \u5FC5\u987B\u662F\u5BF9\u8C61");
    const skeletonMeta = obj(doc.skeleton);
    if (skeletonMeta === null) throw new Error("E_SCHEMA: spine.skeleton \u7F3A\u5931");
    const version = typeof skeletonMeta.spine === "string" ? skeletonMeta.spine : "";
    if (!/^4\./.test(version)) throw new Error(`E_VERSION: ${version || "(missing)"}`);
    const ctx = {
      source: "spine",
      sourceYDown: options?.sourceYDown ?? false,
      unitScale: 0.01,
      maxInfluences: options?.maxInfluences ?? 0,
      issues: [],
      atlas: collectAtlas(doc, "spine"),
      atlasData: options?.atlas ?? null,
      masks: []
    };
    if (!Number.isInteger(ctx.maxInfluences) || ctx.maxInfluences < 0) throw new Error("E_CONFIG: maxInfluences");
    ctx.unitScale = unitScaleOf(options, ctx);
    const rawBones = arr(doc.bones).map((raw, i) => rawBoneFrom(raw, i, "spine", ctx, `bones[${i}]`));
    if (rawBones.length === 0) throw new Error("E_SCHEMA: spine.bones \u4E3A\u7A7A");
    const boneNames = dedupe(rawBones.map((b) => b.name), ctx, "bones");
    rawBones.forEach((b, i) => {
      b.name = boneNames[i];
    });
    const { skeleton, srcToId } = compileBones(rawBones, ctx, typeof doc.name === "string" ? doc.name : "spine");
    const rawSlots = arr(doc.slots);
    const slotNames = dedupe(rawSlots.map((raw) => {
      const o = obj(raw);
      return typeof o?.name === "string" ? o.name : "";
    }), ctx, "slots");
    const slots = rawSlots.map((raw, i) => {
      const o = obj(raw) ?? {};
      const boneName = typeof o.bone === "string" ? o.bone : "";
      let bone = skeleton.boneIdByName.get(boneName);
      if (bone === void 0) {
        add(ctx, "error", "E_BONE_PARENT", `slots[${i}].bone`, "slot \u9AA8\u4E0D\u5B58\u5728\uFF0C\u6302\u5230\u6839\u9AA8", "fallback", boneName);
        bone = skeleton.roots[0] ?? 0;
      }
      const defaultAttachment = typeof o.attachment === "string" && o.attachment.length > 0 ? o.attachment : null;
      const dark = o.dark !== void 0 && o.dark !== null ? parseHexColor(o.dark, ctx, `slots[${i}].dark`) : void 0;
      return {
        id: slotNames[i],
        bone,
        order: i,
        color: parseHexColor(o.color, ctx, `slots[${i}].color`),
        ...dark === void 0 ? {} : { dark },
        blend: parseBlend(o.blend, ctx, `slots[${i}].blend`),
        attachment: defaultAttachment,
        mask: null,
        zOffset: 0
      };
    });
    const builtSlots = slots.map((s) => ({ name: s.id, attachment: s.attachment }));
    const skins = /* @__PURE__ */ new Map();
    for (const [i, rawSkin] of arr(doc.skins).entries()) {
      const s = obj(rawSkin);
      if (s === null) continue;
      const name = s.name === "default" ? "default" : typeof s.name === "string" ? s.name : `skin_${i}`;
      if (skins.has(name)) {
        add(ctx, "error", "E_DUPLICATE_NAME", `skins[${i}].name`, "\u76AE\u80A4\u91CD\u540D\uFF0C\u5DF2\u8DF3\u8FC7", "skip", name);
        continue;
      }
      const attachments = /* @__PURE__ */ new Map();
      const groups = builtSlots.map((slot) => ({
        slot,
        group: obj(obj(s.attachments)?.[slot.name])
      }));
      for (const linkedPass of [false, true]) {
        for (const { slot, group } of groups) {
          if (group === null) continue;
          for (const [attName, rawAtt] of Object.entries(group)) {
            const attObj = obj(rawAtt);
            const isLinked = attObj?.type === "linkedmesh";
            if (isLinked !== linkedPass) continue;
            const attachmentKey = `${slot.name}\0${attName}`;
            if (attachments.has(attachmentKey)) {
              add(ctx, "error", "E_DUPLICATE_NAME", `skins[${i}].attachments.${slot.name}.${attName}`, "\u9644\u4EF6\u91CD\u540D\uFF0C\u5DF2\u8DF3\u8FC7", "skip", attName);
              continue;
            }
            const path = `skins[${i}].attachments.${slot.name}.${attName}`;
            const bone = slotBoneId(slots, slot);
            let built;
            if (isLinked && attObj !== null) {
              built = buildLinkedMesh(attObj, attName, attachments.get(String(attObj.parent ?? "")), bone, ctx, path);
              if (built === null) {
                add(ctx, "warning", "W_ATTACHMENT_UNSUPPORTED", path, "linkedmesh \u7236\u62D3\u6251\u4E0D\u5B58\u5728\uFF0C\u9000\u5316\u4E3A region", "fallback", attObj.parent);
                built = {
                  kind: "region",
                  id: attName,
                  region: regionRefOf(ctx, atlasKeyOf(attObj.path, attName, ctx, `${path}.path`), null),
                  color: WHITE
                };
              }
            } else {
              built = buildAttachment(rawAtt, attName, "spine", bone, srcToId, ctx, path);
            }
            if (built === null) continue;
            if (built.kind === "clipping" && attObj !== null) {
              addClippingMask(ctx, slots, slot.name, attName, attObj, built.polygon);
              const mask = ctx.masks.find((item) => item.id === `${slots.findIndex((s2) => s2.id === slot.name)}:${attName}`);
              if (mask !== void 0) built = { ...built, endSlotId: mask.endSlotId };
            }
            attachments.set(attachmentKey, built);
            if (!attachments.has(attName)) attachments.set(attName, built);
          }
        }
      }
      skins.set(name, { id: name, attachments });
    }
    pickDefaultSkin(skins, options?.defaultSkin, ctx);
    const referenceScale = num(skeletonMeta.referenceScale, 100) * ctx.unitScale;
    let constraints = readSpineConstraints(doc, skeleton, skins, slots, ctx).map((c) => c.kind === "physics" ? { ...c, environment: { referenceScale, windX: 1, windY: 0, gravityX: 0, gravityY: 1 } } : c);
    const maskLibrary = ctx.masks.length > 0 ? Object.freeze({ version: 1, masks: Object.freeze(ctx.masks.slice()) }) : void 0;
    const attIndex = attachmentIndex(skins);
    const { animations, events } = readSpineAnimations(doc.animations, skeleton, slotNames, attIndex, skins, doc.skins, constraints, constraints.length === 0, ctx);
    constraints = constraints.map((c) => {
      if (c.kind !== "slider") return c;
      const clip = animations.get(c.animation);
      if (clip === void 0) {
        add(ctx, "warning", "W_CONSTRAINT_UNSUPPORTED", `constraints.${c.id}`, "slider animation missing", "skip", c.animation);
        return { ...c, enabled: false };
      }
      const unsupported = clip.timelines.some((t) => !["rotate", "translate", "scale", "shear", "attachment", "drawOrder", "event"].includes(t.kind));
      if (unsupported) add(
        ctx,
        "warning",
        "W_CONSTRAINT_UNSUPPORTED",
        `constraints.${c.id}`,
        "slider nested animation has unsupported channels",
        "keep",
        c.animation
      );
      return { ...c, clip };
    });
    return freezeAsset(
      "spine",
      version,
      ctx.unitScale,
      skeleton,
      slots,
      skins,
      animations,
      events,
      ctx,
      ctx.atlasData ?? void 0,
      constraints,
      maskLibrary
    );
  }
  function slotBoneId(slots, slot) {
    return slots.find((s) => s.id === slot.name)?.bone ?? 0;
  }

  // ../packages/render-engine/src/asset/atlas.ts
  var MAX_PAGES = 4;
  var HEADER_KEYS = /* @__PURE__ */ new Set(["size", "format", "filter", "repeat", "pma", "scale"]);
  var REGION_KEYS = /* @__PURE__ */ new Set(["bounds", "xy", "size", "offsets", "orig", "offset", "rotate", "pad", "split", "index"]);
  var FILTERS = /* @__PURE__ */ new Set([
    "Nearest",
    "Linear",
    "MipMap",
    "MipMapNearestNearest",
    "MipMapLinearNearest",
    "MipMapNearestLinear",
    "MipMapLinearLinear"
  ]);
  function parseFilter(value) {
    if (!FILTERS.has(value)) fail("E_ATLAS_FILTER", `\u4E0D\u652F\u6301\u7684 filter\uFF1A${value}`);
    return value;
  }
  function fail(code, message) {
    const error = new Error(`${code}: ${message}`);
    error.code = code;
    throw error;
  }
  function isIndented(line2) {
    return line2.length > 0 && (line2[0] === " " || line2[0] === "	");
  }
  function splitField(line2) {
    const colon = line2.indexOf(":");
    if (colon <= 0) return null;
    return { key: line2.slice(0, colon).trim().toLowerCase(), value: line2.slice(colon + 1).trim() };
  }
  function numberList(value, code, what) {
    const parts = value.split(/[, ]+/).filter((part) => part.length > 0);
    const out = parts.map((part) => Number(part));
    if (out.length === 0 || out.some((n) => !Number.isFinite(n))) fail(code, `${what} \u4E0D\u662F\u5408\u6CD5\u6570\u5B57\u5217\u8868`);
    return out;
  }
  function parseInsets(value, name, key) {
    if (value === void 0) return void 0;
    const values = numberList(value, "E_ATLAS_REGION", `region ${name}.${key}`);
    if (values.length !== 4 || values.some((n) => !Number.isInteger(n))) {
      fail("E_ATLAS_REGION", `region ${name}.${key} \u9700\u8981\u56DB\u4E2A\u6574\u6570 (left,right,top,bottom)`);
    }
    return Object.freeze({ left: values[0], right: values[1], top: values[2], bottom: values[3] });
  }
  function parseRotate(value) {
    if (value === void 0 || value.length === 0 || value === "false") return 0;
    if (value === "true") return 90;
    const n = Number(value);
    if (!Number.isFinite(n)) fail("E_ATLAS_ROTATE", `rotate \u975E\u6CD5\uFF1A${value}`);
    const normalized = (Math.round(n) % 360 + 360) % 360;
    if (normalized !== 0 && normalized !== 90 && normalized !== 180 && normalized !== 270) {
      fail("E_ATLAS_ROTATE", `rotate \u53EA\u652F\u6301 90 \u7684\u6574\u6570\u500D\uFF1A${value}`);
    }
    return normalized;
  }
  function uvMatrixOf(x, y, width, height, rotate, pageWidth, pageHeight, offsetX = 0, offsetY = 0, originalWidth = width, originalHeight = height) {
    const w = Math.max(1, pageWidth);
    const h = Math.max(1, pageHeight);
    const sx = offsetX / w;
    const sy = offsetY / h;
    if (rotate === 90 || rotate === 270) {
      const su2 = Math.max(0, originalWidth) / h;
      const sv2 = Math.max(0, originalHeight) / w;
      const exW2 = (originalWidth - offsetX - width) / h;
      const exH2 = (originalHeight - offsetY - height) / w;
      if (rotate === 90) {
        return new Float32Array([0, -su2, sv2, 0, x / w - exH2, y / h - exW2 + su2]);
      }
      return new Float32Array([0, su2, -sv2, 0, x / w - sy + sv2, y / h - sx]);
    }
    const su = Math.max(0, originalWidth) / w;
    const sv = Math.max(0, originalHeight) / h;
    const exW = (originalWidth - offsetX - width) / w;
    const exH = (originalHeight - offsetY - height) / h;
    if (rotate === 180) {
      return new Float32Array([-su, 0, 0, -sv, x / w - exW + su, y / h - sy + sv]);
    }
    return new Float32Array([su, 0, 0, sv, x / w - sx, y / h - exH]);
  }
  function maxMipOf(width, height, pageWidth, pageHeight) {
    const side = Math.min(width, height, pageWidth, pageHeight);
    if (side < 2) return 0;
    return Math.max(0, Math.floor(Math.log2(side)) - 1);
  }
  function fnv1a(text) {
    let hash = 0xcbf29ce484222325n;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= BigInt(text.charCodeAt(i));
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, "0");
  }
  function importSpineAtlas(text, options) {
    const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const lines = normalized.split("\n");
    const padding = options?.padding ?? 4;
    const bleed = options?.bleed ?? 2;
    if (!Number.isFinite(padding) || padding < 0) fail("E_ATLAS_PARSE", "padding \u5FC5\u987B\u662F\u975E\u8D1F\u6570");
    if (!Number.isFinite(bleed) || bleed < 0) fail("E_ATLAS_PARSE", "bleed \u5FC5\u987B\u662F\u975E\u8D1F\u6570");
    const pages = [];
    const regions = /* @__PURE__ */ new Map();
    const namedPages = /* @__PURE__ */ new Map();
    for (const supplied of options?.pages ?? []) {
      if (supplied.name === void 0) continue;
      if (namedPages.has(supplied.name)) fail("E_ATLAS_PAGE", `\u91CD\u590D\u7684\u56FE\u7247\u9875\u540D\uFF1A${supplied.name}`);
      namedPages.set(supplied.name, supplied);
    }
    let cursor = 0;
    const skipBlank = () => {
      while (cursor < lines.length && lines[cursor].trim() === "") cursor += 1;
    };
    while (cursor < lines.length) {
      skipBlank();
      if (cursor >= lines.length) break;
      const pageIndex = pages.length;
      if (pageIndex >= MAX_PAGES) fail("E_ATLAS_PAGES", `\u56FE\u96C6\u9875\u6570\u8D85\u8FC7 ${MAX_PAGES}`);
      let imageName = null;
      let width = null;
      let height = null;
      let format;
      let minFilter = "Nearest";
      let magFilter = "Nearest";
      let uWrap = "ClampToEdge";
      let vWrap = "ClampToEdge";
      let pagePma = false;
      while (cursor < lines.length) {
        const raw = lines[cursor];
        if (raw.trim() === "") break;
        const field = splitField(raw.trim());
        if (field === null) {
          if (imageName === null) {
            imageName = raw.trim();
            cursor += 1;
            continue;
          }
          break;
        }
        if (!HEADER_KEYS.has(field.key)) break;
        if (field.key === "pma") pagePma = field.value === "true";
        if (field.key === "format") format = field.value;
        if (field.key === "filter") {
          const filters = field.value.split(",").map((value) => value.trim());
          if (filters.length !== 2) fail("E_ATLAS_FILTER", "filter \u9700\u8981 min,mag");
          minFilter = parseFilter(filters[0]);
          magFilter = parseFilter(filters[1]);
        }
        if (field.key === "repeat") {
          const repeat = field.value.toLowerCase();
          if (!["none", "x", "y", "xy"].includes(repeat)) fail("E_ATLAS_REPEAT", `\u4E0D\u652F\u6301\u7684 repeat\uFF1A${field.value}`);
          uWrap = repeat.includes("x") ? "Repeat" : "ClampToEdge";
          vWrap = repeat.includes("y") ? "Repeat" : "ClampToEdge";
        }
        if (field.key === "size") {
          const values = numberList(field.value, "E_ATLAS_SIZE", "size");
          if (values.length < 2) fail("E_ATLAS_SIZE", "size \u9700\u8981 width,height");
          width = values[0];
          height = values[1];
        }
        cursor += 1;
      }
      const provided = (imageName === null ? void 0 : namedPages.get(imageName)) ?? options?.pages?.find((page2) => page2.name === void 0 && page2.index === pageIndex) ?? (options?.pages?.[pageIndex]?.name === void 0 ? options?.pages?.[pageIndex] : void 0);
      if (namedPages.size > 0 && provided === void 0 && imageName !== null) {
        fail("E_TEXTURE_MISSING", `\u56FE\u96C6\u9875 ${pageIndex}\uFF08${imageName}\uFF09\u6CA1\u6709\u5BF9\u5E94\u7684\u547D\u540D\u56FE\u7247\u9875`);
      }
      const pageWidth = width ?? provided?.width;
      const pageHeight = height ?? provided?.height;
      if (pageWidth === void 0 || pageHeight === void 0 || pageWidth <= 0 || pageHeight <= 0) {
        fail("E_ATLAS_SIZE", `\u7B2C ${pageIndex} \u9875\u7F3A\u5C11\u5408\u6CD5 size${imageName === null ? "" : `\uFF08${imageName}\uFF09`}`);
      }
      const page = {
        index: pageIndex,
        name: imageName ?? provided?.name ?? `page-${pageIndex}`,
        width: Math.floor(pageWidth),
        height: Math.floor(pageHeight),
        ...format !== void 0 ? { format } : {},
        minFilter,
        magFilter,
        uWrap,
        vWrap,
        pma: pagePma,
        ...provided?.image !== void 0 ? { image: provided.image } : {}
      };
      pages.push(Object.freeze(page));
      while (cursor < lines.length) {
        if (lines[cursor].trim() === "") break;
        const rawName = lines[cursor];
        if (isIndented(rawName)) {
          cursor += 1;
          continue;
        }
        const name = rawName.trim();
        cursor += 1;
        const fields = /* @__PURE__ */ new Map();
        while (cursor < lines.length) {
          const raw = lines[cursor];
          if (raw.trim() === "") break;
          if (!isIndented(raw)) break;
          const field = splitField(raw.trim());
          if (field !== null) {
            if (!REGION_KEYS.has(field.key)) {
            } else {
              fields.set(field.key, field.value);
            }
          }
          cursor += 1;
        }
        const boundsRaw = fields.get("bounds");
        const xyRaw = fields.get("xy");
        const sizeRaw = fields.get("size");
        if (boundsRaw === void 0 && (xyRaw === void 0 || sizeRaw === void 0)) {
          fail("E_ATLAS_REGION", `region ${name} \u7F3A\u5C11 bounds \u6216 xy/size`);
        }
        const bounds = boundsRaw === void 0 ? [
          ...numberList(xyRaw, "E_ATLAS_REGION", `region ${name}.xy`),
          ...numberList(sizeRaw, "E_ATLAS_REGION", `region ${name}.size`)
        ] : numberList(boundsRaw, "E_ATLAS_REGION", `region ${name}.bounds`);
        if (bounds.length !== 4) fail("E_ATLAS_REGION", `region ${name} \u9700\u8981 x,y,width,height`);
        const x = bounds[0];
        const y = bounds[1];
        const regionWidth = bounds[2];
        const regionHeight = bounds[3];
        if (regionWidth <= 0 || regionHeight <= 0) fail("E_ATLAS_REGION", `region ${name} \u5C3A\u5BF8\u5FC5\u987B\u4E3A\u6B63`);
        let offsetX = 0;
        let offsetY = 0;
        let sourceWidth = regionWidth;
        let sourceHeight = regionHeight;
        const offsetsRaw = fields.get("offsets");
        if (offsetsRaw !== void 0) {
          const offsets = numberList(offsetsRaw, "E_ATLAS_REGION", `region ${name}.offsets`);
          if (offsets.length >= 4) {
            offsetX = offsets[0];
            offsetY = offsets[1];
            sourceWidth = offsets[2];
            sourceHeight = offsets[3];
          }
        }
        const origRaw = fields.get("orig");
        if (origRaw !== void 0) {
          const orig = numberList(origRaw, "E_ATLAS_REGION", `region ${name}.orig`);
          if (orig.length >= 2) {
            sourceWidth = orig[0];
            sourceHeight = orig[1];
          }
        }
        const offsetRaw = fields.get("offset");
        if (offsetRaw !== void 0) {
          const offset = numberList(offsetRaw, "E_ATLAS_REGION", `region ${name}.offset`);
          if (offset.length >= 2) {
            offsetX = offset[0];
            offsetY = offset[1];
          }
        }
        const rotate = parseRotate(fields.get("rotate"));
        const split = parseInsets(fields.get("split"), name, "split");
        const pad = parseInsets(fields.get("pad"), name, "pad");
        if (pad !== void 0 && split === void 0) fail("E_ATLAS_REGION", `region ${name}.pad \u9700\u8981 split`);
        if (regions.has(name)) fail("E_ATLAS_REGION", `region ${name} \u91CD\u540D`);
        const region = {
          id: name,
          page: pageIndex,
          x,
          y,
          width: regionWidth,
          height: regionHeight,
          uvMatrix: uvMatrixOf(x, y, regionWidth, regionHeight, rotate, page.width, page.height, offsetX, offsetY, sourceWidth, sourceHeight),
          trim: Object.freeze({ offsetX, offsetY, sourceWidth, sourceHeight }),
          ...split !== void 0 ? { split } : {},
          ...pad !== void 0 ? { pad } : {},
          maxMip: maxMipOf(regionWidth, regionHeight, page.width, page.height)
        };
        regions.set(name, Object.freeze(region));
      }
    }
    if (pages.length === 0) fail("E_ATLAS_REGION", "\u6CA1\u6709\u89E3\u6790\u5230\u4EFB\u4F55\u56FE\u96C6\u9875");
    if (pages.length > MAX_PAGES) fail("E_ATLAS_PAGES", `\u56FE\u96C6\u9875\u6570\u8D85\u8FC7 ${MAX_PAGES}`);
    const signature = [
      ...pages.map((page) => `p${page.index}:${page.name}:${page.width}x${page.height}:${page.image?.width ?? 0}x${page.image?.height ?? 0}:${page.format ?? ""}:${page.minFilter},${page.magFilter}:${page.uWrap},${page.vWrap}:${page.pma}`),
      ...[...regions.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((r) => `${r.id}@${r.page}:${r.x},${r.y},${r.width},${r.height}:${r.trim.offsetX},${r.trim.offsetY},${r.trim.sourceWidth},${r.trim.sourceHeight}:${Array.from(r.uvMatrix).join(",")}:split=${r.split === void 0 ? "" : Object.values(r.split).join(",")}:pad=${r.pad === void 0 ? "" : Object.values(r.pad).join(",")}`)
    ].join("|");
    const atlas = {
      format: "dsh-2d-atlas",
      version: 1,
      hash: fnv1a(signature),
      pages: Object.freeze(pages),
      regions,
      pma: pages[0].pma ?? false,
      colorSpace: "srgb",
      padding,
      bleed,
      source: "file"
    };
    return Object.freeze(atlas);
  }

  // ../packages/render-engine/src/debug/overlay.ts
  var DEFAULT_DEBUG_FLAGS = Object.freeze({
    bones: false,
    slots: false,
    attachments: false,
    meshes: false,
    clipping: false,
    bounds: false,
    drawOrder: false,
    stats: false
  });
  var DEBUG_COLORS = {
    bone: [1, 0.45, 0.1, 1],
    slot: [0.2, 0.8, 1, 1],
    mesh: [0.2, 1, 0.35, 1],
    clipping: [1, 0.2, 0.9, 1],
    bounds: [1, 0.95, 0.2, 1]
  };
  var ROOT_CROSS_HALF = 4;
  var SLOT_CROSS_HALF = 3;
  function line(x1, y1, x2, y2, color) {
    return { x1, y1, x2, y2, color };
  }
  function pushCross(out, x, y, half, color) {
    out.push(
      line(x - half, y, x + half, y, color),
      line(x, y - half, x, y + half, color)
    );
  }
  function isFinitePoint(x, y) {
    return Number.isFinite(x) && Number.isFinite(y);
  }
  function bonePivot(pose, bone) {
    if (!Number.isInteger(bone) || bone < 0 || bone >= pose.skeleton.count) return null;
    const offset = bone * WORLD_STRIDE;
    const x = pose.world[offset + 4];
    const y = pose.world[offset + 5];
    return isFinitePoint(x, y) ? [x, y] : null;
  }
  function pushBones(out, pose) {
    const color = DEBUG_COLORS.bone;
    for (let bone = 0; bone < pose.skeleton.count; bone += 1) {
      const pivot = bonePivot(pose, bone);
      if (pivot === null) continue;
      const parent = pose.skeleton.parent[bone];
      if (parent < 0) {
        pushCross(out, pivot[0], pivot[1], ROOT_CROSS_HALF, color);
        continue;
      }
      const parentPivot = bonePivot(pose, parent);
      if (parentPivot === null) continue;
      out.push(line(parentPivot[0], parentPivot[1], pivot[0], pivot[1], color));
    }
  }
  function pushSlots(out, pose, slotSet) {
    for (const slot of slotSet.slots) {
      const pivot = bonePivot(pose, slot.data.bone);
      if (pivot === null) continue;
      pushCross(out, pivot[0], pivot[1], SLOT_CROSS_HALF, DEBUG_COLORS.slot);
    }
  }
  function pushPacketWireframe(out, packet) {
    const { positions, indices } = packet;
    const vertexCount = Math.floor(positions.length / 2);
    const seen = /* @__PURE__ */ new Set();
    const addEdge2 = (a, b) => {
      if (a === b || a < 0 || b < 0 || a >= vertexCount || b >= vertexCount) return;
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = `${lo}:${hi}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(line(
        positions[lo * 2],
        positions[lo * 2 + 1],
        positions[hi * 2],
        positions[hi * 2 + 1],
        DEBUG_COLORS.mesh
      ));
    };
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      addEdge2(a, b);
      addEdge2(b, c);
      addEdge2(c, a);
    }
  }
  function pushMeshes(out, packets) {
    for (const packet of packets) pushPacketWireframe(out, packet);
  }
  function pushClipping(out, masks) {
    for (const mask of masks) {
      if (mask === null || mask.mode !== "stencil") continue;
      const { positions } = mask;
      const count = Math.floor(positions.length / 2);
      if (count < 3) continue;
      for (let i = 0; i < count; i += 1) {
        const j = (i + 1) % count;
        out.push(line(
          positions[i * 2],
          positions[i * 2 + 1],
          positions[j * 2],
          positions[j * 2 + 1],
          DEBUG_COLORS.clipping
        ));
      }
    }
  }
  function pushBounds(out, bounds) {
    const { x, y, width, height } = bounds;
    if (![x, y, width, height].every(Number.isFinite)) return;
    const right = x + width;
    const bottom = y + height;
    const color = DEBUG_COLORS.bounds;
    out.push(
      line(x, y, right, y, color),
      line(right, y, right, bottom, color),
      line(right, bottom, x, bottom, color),
      line(x, bottom, x, y, color)
    );
  }
  function buildDebugLines(input) {
    const { pose, slotSet } = input;
    const flags = {
      bones: input.flags?.bones === true,
      slots: input.flags?.slots === true,
      attachments: input.flags?.attachments === true,
      meshes: input.flags?.meshes === true,
      clipping: input.flags?.clipping === true,
      bounds: input.flags?.bounds === true,
      drawOrder: input.flags?.drawOrder === true,
      stats: input.flags?.stats === true
    };
    if (!flags.bones && !flags.slots && !flags.meshes && !flags.clipping && !flags.bounds) {
      return [];
    }
    const out = [];
    if (flags.bones) pushBones(out, pose);
    if (flags.slots) pushSlots(out, pose, slotSet);
    if (flags.meshes && input.packets) pushMeshes(out, input.packets);
    if (flags.clipping && input.masks) pushClipping(out, input.masks);
    if (flags.bounds && input.bounds) pushBounds(out, input.bounds);
    return out;
  }

  // ../packages/render-engine/src/runtime/runtime.ts
  function defaultBackendFactory(kind, options) {
    if (kind === "cpu") {
      const ss = options?.supersample ?? 1;
      if (!Number.isInteger(ss) || ss < 1 || ss > 16) throw new Error("E_CONFIG");
      return new CpuBackend({ width: 1, height: 1, supersample: ss });
    }
    if (typeof document === "undefined") throw new Error("E_BACKEND: WebGL2 \u4E0A\u4E0B\u6587\u4E0D\u53EF\u7528");
    const canvas2 = document.createElement("canvas");
    const gl = canvas2.getContext("webgl2", { stencil: true });
    if (gl === null) throw new Error("E_BACKEND: WebGL2 \u4E0A\u4E0B\u6587\u4E0D\u53EF\u7528");
    return new WebGL2Backend(gl);
  }
  function createBackend(kind, factory) {
    if (kind === "auto") {
      try {
        return factory("webgl2");
      } catch {
        try {
          return factory("cpu");
        } catch {
          throw new Error("E_BACKEND");
        }
      }
    }
    try {
      return factory(kind);
    } catch {
      throw new Error("E_BACKEND");
    }
  }
  function byOrder(a, b) {
    return (a.plugin.order ?? 0) - (b.plugin.order ?? 0) || a.index - b.index;
  }
  function asRenderable(attachment) {
    return attachment !== null && isRenderable(attachment);
  }
  var PluginHost = class {
    registry;
    ctx;
    ready = /* @__PURE__ */ new Set();
    rejected = /* @__PURE__ */ new Set();
    active = [];
    disposedFlag = false;
    constructor(plugins, ctx) {
      this.registry = plugins;
      this.ctx = ctx;
      this.refresh();
    }
    /** 当前生效插件的 id，按执行顺序排列。 */
    get order() {
      return this.active.map((p) => p.id);
    }
    refresh() {
      this.active = this.registry.map((plugin, index) => ({ plugin, index })).sort(byOrder).filter(({ plugin }) => !this.rejected.has(plugin.id)).map(({ plugin }) => plugin);
    }
    record() {
      const stats = this.ctx.stats;
      stats["pluginErrors"] = (stats["pluginErrors"] ?? 0) + 1;
    }
    /** 同步异常立即隔离；异步 rejection 也记录，不让未捕获 Promise 冒出去。 */
    guard(fn) {
      try {
        const result = fn();
        if (result instanceof Promise) {
          result.catch(() => {
            this.record();
          });
        }
      } catch {
        this.record();
      }
    }
    setup() {
      if (this.disposedFlag) return;
      for (const plugin of this.registry) {
        if (this.ready.has(plugin.id) || this.rejected.has(plugin.id)) continue;
        if (plugin.apiVersion !== 1) {
          this.rejected.add(plugin.id);
          this.record();
          continue;
        }
        this.ready.add(plugin.id);
        this.guard(() => plugin.setup?.(this.ctx));
      }
      this.refresh();
    }
    beforeUpdate(dt) {
      if (this.disposedFlag) return;
      for (const plugin of this.active) this.guard(() => plugin.beforeUpdate?.(this.ctx, dt));
    }
    afterUpdate(dt) {
      if (this.disposedFlag) return;
      for (const plugin of this.active) this.guard(() => plugin.afterUpdate?.(this.ctx, dt));
    }
    afterRender(frame) {
      if (this.disposedFlag) return;
      for (const plugin of this.active) this.guard(() => plugin.afterRender?.(this.ctx, frame));
    }
    viewRules() {
      if (this.disposedFlag) return [];
      const out = [];
      for (const plugin of this.active) {
        try {
          const rules = plugin.viewRules?.(this.ctx, this.ctx.engine.pose.skeleton);
          if (rules) out.push(...rules);
        } catch {
          this.record();
        }
      }
      return out;
    }
    dispose() {
      if (this.disposedFlag) return;
      this.disposedFlag = true;
      for (const plugin of [...this.active].reverse()) this.guard(() => plugin.dispose?.());
      this.active.length = 0;
    }
  };
  var pageFilter = (filter) => {
    switch (filter) {
      case "Nearest":
        return "nearest";
      case "MipMap":
        return "mipmap";
      case "MipMapNearestNearest":
        return "mipmapNearestNearest";
      case "MipMapLinearNearest":
        return "mipmapLinearNearest";
      case "MipMapNearestLinear":
        return "mipmapNearestLinear";
      case "MipMapLinearLinear":
        return "mipmapLinearLinear";
      default:
        return "linear";
    }
  };
  function buildRenderAssets(asset) {
    const atlas = asset.atlas;
    if (atlas === void 0) return void 0;
    const pages = atlas.pages.map((page) => {
      const image = page.image;
      const data = image?.data !== void 0 && image.data.length === page.width * page.height * 4 ? image.data : new Uint8Array([255, 255, 255, 255]);
      return {
        width: image?.data !== void 0 ? page.width : 1,
        height: image?.data !== void 0 ? page.height : 1,
        data,
        pma: page.pma ?? atlas.pma,
        minFilter: pageFilter(page.minFilter),
        magFilter: page.magFilter === "Nearest" ? "nearest" : "linear",
        uWrap: page.uWrap === "Repeat" ? "repeat" : "clamp",
        vWrap: page.vWrap === "Repeat" ? "repeat" : "clamp",
        mipmap: page.minFilter?.startsWith("MipMap") ?? false
      };
    });
    const materials = [{ id: 0, kind: "flat", page: -1, filter: "linear" }];
    for (let i = 0; i < pages.length; i += 1) {
      materials.push({ id: i + 1, kind: "sprite", page: i, filter: "linear" });
    }
    return { pages, materials, maxTexturePages: 4 };
  }
  function resolveMaskPaths(slotSet, library = { version: 1, masks: [] }, pose, atlas) {
    const byId = /* @__PURE__ */ new Map();
    library.masks.forEach((mask, index) => byId.set(mask.id, index));
    const paths = new Array(slotSet.slots.length).fill(-1);
    const nodes = [];
    const masks = new Array(library.masks.length).fill(null);
    let open = null;
    for (const slotIndex of slotSet.drawOrder) {
      const slot = slotSet.slots[slotIndex];
      if (slot === void 0) continue;
      const attachment = resolveAttachment(slotSet, slotIndex);
      if (attachment !== null && attachment.kind === "clipping") {
        if (open === null) {
          const canonical2 = `${slotIndex}:${attachment.id}`;
          const cachedIndex = byId.get(canonical2) ?? byId.get(`${slot.data.id}.${attachment.id}`) ?? library.masks.findIndex((mask) => mask.startSlotId === slot.data.id && mask.id === attachment.id);
          const cached = cachedIndex >= 0 ? library.masks[cachedIndex] : void 0;
          const def = {
            id: canonical2,
            mode: cached?.mode ?? "clip",
            invert: cached?.invert ?? false,
            feather: cached?.feather ?? 0,
            polygon: attachment.polygon,
            startSlotId: slot.data.id,
            endSlotId: attachment.endSlotId ?? cached?.endSlotId ?? slot.data.id,
            ...cached?.alphaRegion === void 0 ? {} : { alphaRegion: cached.alphaRegion }
          };
          const id = cached === void 0 ? masks.length : cachedIndex;
          masks[id] = buildRuntimeMask(def, slotSet, pose, atlas);
          nodes.push({ maskId: id, parent: -1 });
          open = { path: nodes.length - 1, endSlotId: def.endSlotId };
        }
        paths[slotIndex] = -1;
        if (open !== null && open.endSlotId === slot.data.id) open = null;
        continue;
      }
      let path = open?.path ?? -1;
      if (slot.data.mask !== null) {
        const explicit = byId.get(slot.data.mask);
        if (explicit !== void 0 && !(library.masks[explicit].mode === "clip" && library.masks[explicit].startSlotId === slot.data.id)) {
          const def = library.masks[explicit];
          nodes.push({ maskId: explicit, parent: path });
          path = nodes.length - 1;
          if (masks[explicit] == null) masks[explicit] = buildRuntimeMask(def, slotSet, pose, atlas);
        }
      }
      paths[slotIndex] = path;
      if (open !== null && open.endSlotId === slot.data.id) open = null;
    }
    return { paths, maskPaths: nodes, masks };
  }
  function buildRuntimeMask(def, slotSet, pose, atlas) {
    const slot = slotSet.slots.find((entry) => entry.data.id === def.startSlotId);
    const bone = slot?.data.bone ?? 0;
    const positions = new Float32Array(def.polygon.length);
    if (pose !== void 0) {
      const m = pose.world;
      const off = bone * WORLD_STRIDE;
      for (let i = 0; i + 1 < def.polygon.length; i += 2) {
        const x = def.polygon[i];
        const y = def.polygon[i + 1];
        positions[i] = m[off] * x + m[off + 2] * y + m[off + 4];
        positions[i + 1] = m[off + 1] * x + m[off + 3] * y + m[off + 5];
      }
    } else {
      positions.set(def.polygon);
    }
    const indices = triangulatePolygon(positions);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i + 1 < positions.length; i += 2) {
      minX = Math.min(minX, positions[i]);
      minY = Math.min(minY, positions[i + 1]);
      maxX = Math.max(maxX, positions[i]);
      maxY = Math.max(maxY, positions[i + 1]);
    }
    const bounds = Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : { x: 0, y: 0, width: 0, height: 0 };
    const alpha = def.mode === "alpha" && def.alphaRegion !== void 0 && atlas !== void 0 ? atlas.regions.get(def.alphaRegion.atlasKey) : void 0;
    return {
      id: 0,
      mode: def.mode === "alpha" ? "alpha" : "stencil",
      invert: def.invert,
      feather: def.feather,
      positions,
      indices,
      bounds,
      ...alpha === void 0 ? {} : { alpha: { page: alpha.page, uvMatrix: alpha.uvMatrix } }
    };
  }
  function atlasUvOf(asset, attachment, keyOverride) {
    const atlas = asset.atlas;
    if (atlas === void 0) return null;
    const key = keyOverride ?? attachment.region.atlasKey;
    const region = atlas.regions.get(key);
    if (region === void 0) return null;
    if (attachment.kind === "region" && attachment.region.uvs === null) {
      const page = atlas.pages[region.page];
      const rotated = region.uvMatrix[1] < 0 && region.uvMatrix[2] > 0;
      const uv2 = region.uvMatrix;
      const { offsetX, offsetY, sourceWidth, sourceHeight } = region.trim;
      const lowU = sourceWidth > 0 ? offsetX / sourceWidth : 0;
      const highU = sourceWidth > 0 ? (offsetX + region.width) / sourceWidth : 1;
      const lowV = sourceHeight > 0 ? (sourceHeight - offsetY - region.height) / sourceHeight : 0;
      const highV = sourceHeight > 0 ? (sourceHeight - offsetY) / sourceHeight : 1;
      const u = region.x / page.width;
      const v = region.y / page.height;
      const u2 = (region.x + region.height) / page.width;
      const v2 = (region.y + region.width) / page.height;
      const points = [lowU, highV, lowU, lowV, highU, lowV, highU, highV];
      const uvs2 = new Float32Array(8);
      for (let i = 0; i < 8; i += 2) {
        uvs2[i] = rotated ? i < 4 ? u2 : u : uv2[0] * points[i] + uv2[2] * points[i + 1] + uv2[4];
        uvs2[i + 1] = rotated ? i === 0 || i === 6 ? v2 : v : uv2[1] * points[i] + uv2[3] * points[i + 1] + uv2[5];
      }
      return {
        uvs: uvs2,
        page: region.page,
        materialId: region.page + 1
      };
    }
    const source = attachment.kind === "region" ? attachment.region.uvs : attachment.mesh.uvs;
    const uv = region.uvMatrix;
    const uvs = new Float32Array(source.length);
    for (let i = 0; i + 1 < source.length; i += 2) {
      const u = source[i];
      const v = source[i + 1];
      uvs[i] = uv[0] * u + uv[2] * v + uv[4];
      uvs[i + 1] = uv[1] * u + uv[3] * v + uv[5];
    }
    return { uvs, page: region.page, materialId: region.page + 1 };
  }
  function viewportOf(pixelRatio) {
    return {
      width: Math.max(1, Math.floor(DEFAULT_CAMERA.viewport.width * pixelRatio)),
      height: Math.max(1, Math.floor(DEFAULT_CAMERA.viewport.height * pixelRatio))
    };
  }
  var facadeBindings = /* @__PURE__ */ new WeakMap();
  function facadePose(skeleton) {
    const bound = facadeBindings.get(skeleton);
    if (bound.engine.pose !== bound.pose) throw new Error("E_STATE: stale skeleton");
    return bound.pose;
  }
  function facadeSlots(skeleton) {
    const bound = facadeBindings.get(skeleton);
    if (bound.engine.slotSet !== bound.slots) throw new Error("E_STATE: stale skeleton");
    return bound.slots;
  }
  var SpineBone = class {
    constructor(owner, index) {
      this.index = index;
      this.#owner = owner;
    }
    index;
    #owner;
    get name() {
      return facadePose(this.#owner).skeleton.bones[this.index].name;
    }
    get length() {
      return facadePose(this.#owner).skeleton.bones[this.index].length;
    }
    get data() {
      const bone = facadePose(this.#owner).skeleton.bones[this.index];
      return Object.freeze({
        name: bone.name,
        length: bone.length,
        parent: bone.parent,
        setup: Object.freeze({ ...bone.setup })
      });
    }
    get parent() {
      const id = facadePose(this.#owner).skeleton.parent[this.index];
      return id < 0 ? null : this.#owner.bones[id];
    }
    value(channel) {
      return facadePose(this.#owner).local[this.index * POSE_STRIDE + channel];
    }
    change(channel, value) {
      setLocal(facadePose(this.#owner), this.index, channel, value);
    }
    get x() {
      return this.value(0);
    }
    set x(value) {
      this.change(0, value);
    }
    get y() {
      return this.value(1);
    }
    set y(value) {
      this.change(1, value);
    }
    get rotation() {
      return this.value(2);
    }
    set rotation(value) {
      this.change(2, value);
    }
    get scaleX() {
      return this.value(3);
    }
    set scaleX(value) {
      this.change(3, value);
    }
    get scaleY() {
      return this.value(4);
    }
    set scaleY(value) {
      this.change(4, value);
    }
    get shearX() {
      return this.value(5);
    }
    set shearX(value) {
      this.change(5, value);
    }
    get shearY() {
      return this.value(6);
    }
    set shearY(value) {
      this.change(6, value);
    }
    get worldX() {
      updateWorld(facadePose(this.#owner));
      return facadePose(this.#owner).world[this.index * WORLD_STRIDE + 4];
    }
    get worldY() {
      updateWorld(facadePose(this.#owner));
      return facadePose(this.#owner).world[this.index * WORLD_STRIDE + 5];
    }
    get worldTransform() {
      updateWorld(facadePose(this.#owner));
      return Object.freeze(Array.from(facadePose(this.#owner).world.slice(this.index * WORLD_STRIDE, (this.index + 1) * WORLD_STRIDE)));
    }
    localToWorld(point) {
      const [x, y] = localToWorld(facadePose(this.#owner), this.index, point.x, point.y);
      return { x, y };
    }
    worldToLocal(point) {
      const [x, y] = worldToLocal(facadePose(this.#owner), this.index, point.x, point.y);
      return { x, y };
    }
    localToWorldRotation(angle) {
      return localToWorldRotation(facadePose(this.#owner), this.index, angle);
    }
    worldToLocalRotation(angle) {
      return worldToLocalRotation(facadePose(this.#owner), this.index, angle);
    }
    /** Spine 4.3 BonePose-compatible rotation, in degrees (including its shearX offset). */
    localToWorldRotationDegrees(degrees) {
      const pose = facadePose(this.#owner);
      updateWorld(pose);
      const i = this.index * WORLD_STRIDE;
      const m = pose.world;
      const offset = this.index * POSE_STRIDE;
      const angle = degrees * Math.PI / 180 - pose.local[offset + 2] - pose.local[offset + 5];
      return Math.atan2(
        Math.cos(angle) * m[i + 1] + Math.sin(angle) * m[i + 3],
        Math.cos(angle) * m[i] + Math.sin(angle) * m[i + 2]
      ) * 180 / Math.PI;
    }
    /** Spine 4.3 BonePose-compatible world-to-local rotation, in degrees. */
    worldToLocalRotationDegrees(degrees) {
      const pose = facadePose(this.#owner);
      updateWorld(pose);
      const i = this.index * WORLD_STRIDE;
      const m = pose.world;
      const a = m[i], b = m[i + 2], c = m[i + 1], d = m[i + 3];
      if (Math.abs(a * d - b * c) < 1e-12) throw new Error("pose.worldToLocal: singular");
      const offset = this.index * POSE_STRIDE;
      const angle = degrees * Math.PI / 180;
      return Math.atan2(
        a * Math.sin(angle) - c * Math.cos(angle),
        d * Math.cos(angle) - b * Math.sin(angle)
      ) * 180 / Math.PI + (pose.local[offset + 2] - pose.local[offset + 5]) * 180 / Math.PI;
    }
  };
  var Skin = class {
    constructor(owner, name) {
      this.name = name;
      this.#owner = owner;
    }
    name;
    #owner;
    get attachmentNames() {
      return Object.freeze([...facadeSlots(this.#owner).skins.get(this.name).attachments.keys()]);
    }
    hasAttachment(name) {
      return facadeSlots(this.#owner).skins.get(this.name).attachments.has(name);
    }
  };
  var Slot = class {
    constructor(owner, index) {
      this.index = index;
      this.#owner = owner;
    }
    index;
    #owner;
    get state() {
      return facadeSlots(this.#owner).slots[this.index];
    }
    get name() {
      return this.state.data.id;
    }
    get data() {
      const slot = this.state.data;
      return Object.freeze({
        name: slot.id,
        bone: slot.bone,
        attachment: slot.attachment,
        color: Object.freeze({ ...slot.color })
      });
    }
    get bone() {
      return this.#owner.bones[this.state.data.bone];
    }
    get attachmentName() {
      return this.state.attachmentId;
    }
    get skin() {
      return this.#owner.findSkin(this.state.skinId);
    }
    get color() {
      return Object.freeze({ ...this.state.color });
    }
    set color(value) {
      if (![value.r, value.g, value.b, value.a].every(Number.isFinite)) throw new Error("slot.color");
      this.state.color = { ...value };
    }
    setAttachment(name) {
      this.#owner.setAttachment(this.name, name);
    }
  };
  var Skeleton = class {
    bones;
    slots;
    skins;
    elapsed = 0;
    #engine;
    constructor(engine, pose, slots) {
      this.#engine = engine;
      facadeBindings.set(this, { engine, pose, slots });
      this.bones = Object.freeze(pose.skeleton.bones.map((_, i) => new SpineBone(this, i)));
      this.slots = Object.freeze(slots.slots.map((_, i) => new Slot(this, i)));
      this.skins = Object.freeze([...slots.skins.keys()].map((name) => new Skin(this, name)));
    }
    get name() {
      return facadePose(this).skeleton.name;
    }
    get color() {
      facadePose(this);
      return Object.freeze({ ...this.#engine.color });
    }
    set color(value) {
      facadePose(this);
      if (![value.r, value.g, value.b, value.a].every(Number.isFinite)) throw new Error("E_CONFIG");
      Object.assign(this.#engine.color, value);
    }
    get windX() {
      facadePose(this);
      return this.#engine.windX;
    }
    set windX(value) {
      facadePose(this);
      this.#engine.windX = value;
    }
    get windY() {
      facadePose(this);
      return this.#engine.windY;
    }
    set windY(value) {
      facadePose(this);
      this.#engine.windY = value;
    }
    get gravityX() {
      facadePose(this);
      return this.#engine.gravityX;
    }
    set gravityX(value) {
      facadePose(this);
      this.#engine.gravityX = value;
    }
    get gravityY() {
      facadePose(this);
      return this.#engine.gravityY;
    }
    set gravityY(value) {
      facadePose(this);
      this.#engine.gravityY = value;
    }
    get x() {
      facadePose(this);
      return this.#engine.x;
    }
    set x(value) {
      facadePose(this);
      this.#engine.x = value;
    }
    get y() {
      facadePose(this);
      return this.#engine.y;
    }
    set y(value) {
      facadePose(this);
      this.#engine.y = value;
    }
    get scaleX() {
      facadePose(this);
      return this.#engine.scaleX;
    }
    set scaleX(value) {
      facadePose(this);
      this.#engine.scaleX = value;
    }
    get scaleY() {
      facadePose(this);
      return this.#engine.scaleY;
    }
    set scaleY(value) {
      facadePose(this);
      this.#engine.scaleY = value;
    }
    get time() {
      facadePose(this);
      return this.elapsed;
    }
    set time(value) {
      facadePose(this);
      if (!Number.isFinite(value) || value < 0) throw new Error("E_CONFIG");
      this.elapsed = value;
    }
    advanceTime(dt) {
      this.elapsed += dt;
    }
    get drawOrder() {
      return Object.freeze(facadeSlots(this).drawOrder.map((index) => this.slots[index]));
    }
    get skin() {
      const id = facadeSlots(this).slots[0]?.skinId;
      return id === void 0 ? null : this.findSkin(id);
    }
    findBone(name) {
      const id = facadePose(this).skeleton.boneIdByName.get(name);
      return id === void 0 ? null : this.bones[id];
    }
    findSlot(name) {
      const index = facadeSlots(this).slots.findIndex((slot) => slot.data.id === name);
      return index < 0 ? null : this.slots[index];
    }
    findSkin(name) {
      facadeSlots(this);
      return this.skins.find((skin) => skin.name === name) ?? null;
    }
    setSkinByName(name) {
      facadeSlots(this);
      this.#engine.setSkinByName(name);
    }
    setAttachment(slotName, name) {
      facadeSlots(this);
      this.#engine.setAttachment(slotName, name);
    }
    getBounds() {
      facadePose(this);
      return this.#engine.getBounds();
    }
    setupPose() {
      facadePose(this);
      this.#engine.setupPose();
    }
    setupPoseBones() {
      facadePose(this);
      this.#engine.setupPoseBones();
    }
    setupPoseSlots() {
      facadeSlots(this);
      this.#engine.setupPoseSlots();
    }
    setToSetupPose() {
      this.setupPose();
    }
    setBonesToSetupPose() {
      this.setupPoseBones();
    }
    setSlotsToSetupPose() {
      this.setupPoseSlots();
    }
    updateWorldTransform() {
      updateWorld(facadePose(this));
    }
  };
  var Engine = class {
    /** Per-instance skeleton tint; mutable channels affect the next rendered frame. */
    color = whiteSkeletonColor();
    _phase = "created";
    backend;
    stats = { pluginErrors: 0 };
    plugins = [];
    host;
    ctx;
    viewport;
    viewProjection;
    asset = null;
    ownedPose = null;
    ownedSlotSet = null;
    ownedSkeleton = null;
    ownedTracks = [];
    inverseBind = null;
    solver = null;
    animationState = null;
    lastAnimation = null;
    lastFrame = null;
    flipX = false;
    flipY = false;
    instanceScaleX = 1;
    instanceScaleY = 1;
    instanceX = 0;
    instanceY = 0;
    physicsEnvironments = [];
    forceWindX = 1;
    forceWindY = 0;
    forceGravityX = 0;
    forceGravityY = 1;
    renderAssets;
    preparedAssets;
    maskLibrary;
    camera = DEFAULT_CAMERA;
    maxBones;
    maxTexturePages;
    maxInfluences;
    fixedDt;
    outline;
    accumulator = 0;
    rootMotionMode;
    rootSampleX = 0;
    rootSampleY = 0;
    rootDisplacementX = 0;
    rootDisplacementY = 0;
    hasUpdatedSinceLoad = false;
    constructor(config = {}, deps) {
      const kind = config.backend ?? "auto";
      if (kind !== "auto" && kind !== "cpu" && kind !== "webgl2") throw new Error("E_CONFIG");
      const pixelRatio = config.pixelRatio ?? 1;
      if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) throw new Error("E_CONFIG");
      if (config.fixedDt !== void 0 && (!Number.isFinite(config.fixedDt) || config.fixedDt <= 0)) {
        throw new Error("E_CONFIG");
      }
      this.maxBones = config.maxBones ?? 512;
      this.maxTexturePages = config.maxTexturePages ?? 4;
      this.maxInfluences = config.maxInfluences ?? 0;
      this.fixedDt = config.fixedDt;
      if (config.rootMotion !== void 0 && config.rootMotion !== "bone" && config.rootMotion !== "entity") throw new Error("E_CONFIG");
      this.rootMotionMode = config.rootMotion ?? "bone";
      this.outline = config.outline;
      if (!Number.isInteger(this.maxBones) || this.maxBones < 1 || !Number.isInteger(this.maxTexturePages) || this.maxTexturePages < 1 || this.maxTexturePages > 4 || !Number.isInteger(this.maxInfluences) || this.maxInfluences < 0) {
        throw new Error("E_CONFIG");
      }
      const rawSupersample = config.supersample ?? 1;
      const supersample = rawSupersample === 2 || rawSupersample === 4 || rawSupersample === 8 || rawSupersample === 16 ? rawSupersample : 1;
      if (rawSupersample !== supersample) throw new Error("E_CONFIG");
      const factory = deps?.backendFactory ?? ((kind2) => defaultBackendFactory(kind2, { supersample }));
      this.backend = createBackend(kind, factory);
      this.viewport = viewportOf(pixelRatio);
      this.viewProjection = viewProjection2D({
        ...DEFAULT_CAMERA,
        viewport: {
          ...DEFAULT_CAMERA.viewport,
          width: this.viewport.width,
          height: this.viewport.height,
          dpr: pixelRatio
        }
      });
      const self = this;
      this.ctx = {
        engine: this,
        // 用 getter 让插件总是读到当前阶段，而不是注册时的快照。
        get phase() {
          return self._phase;
        },
        stats: this.stats
      };
      this.host = new PluginHost(this.plugins, this.ctx);
    }
    get phase() {
      return this._phase;
    }
    get windX() {
      this.assertLive();
      return this.forceWindX;
    }
    set windX(value) {
      this.setPhysicsForce("windX", value);
    }
    get windY() {
      this.assertLive();
      return this.forceWindY;
    }
    set windY(value) {
      this.setPhysicsForce("windY", value);
    }
    get gravityX() {
      this.assertLive();
      return this.forceGravityX;
    }
    set gravityX(value) {
      this.setPhysicsForce("gravityX", value);
    }
    get gravityY() {
      this.assertLive();
      return this.forceGravityY;
    }
    set gravityY(value) {
      this.setPhysicsForce("gravityY", value);
    }
    get x() {
      this.assertLive();
      return this.instanceX;
    }
    set x(value) {
      this.setPosition(value, this.instanceY);
    }
    get y() {
      this.assertLive();
      return this.instanceY;
    }
    set y(value) {
      this.setPosition(this.instanceX, value);
    }
    /** World displacement extracted from the root in the most recent update. */
    get rootMotionDelta() {
      this.assertLive();
      return { x: this.rootDisplacementX, y: this.rootDisplacementY };
    }
    get scaleX() {
      this.assertLive();
      return this.instanceScaleX;
    }
    set scaleX(value) {
      this.setScale(value, this.instanceScaleY);
    }
    get scaleY() {
      this.assertLive();
      return this.instanceScaleY;
    }
    set scaleY(value) {
      this.setScale(this.instanceScaleX, value);
    }
    setPhysicsForce(field, value) {
      this.assertLive();
      if (!Number.isFinite(value)) throw new Error("E_CONFIG");
      if (field === "windX") this.forceWindX = value;
      else if (field === "windY") this.forceWindY = value;
      else if (field === "gravityX") this.forceGravityX = value;
      else this.forceGravityY = value;
      for (const env of this.physicsEnvironments) env[field] = value;
    }
    get pose() {
      this.assertLive();
      if (this.ownedPose === null) throw new Error("E_NO_ASSET");
      return this.ownedPose;
    }
    get slotSet() {
      this.assertLive();
      if (this.ownedSlotSet === null) throw new Error("E_NO_ASSET");
      return this.ownedSlotSet;
    }
    get skeleton() {
      this.assertLive();
      if (this.ownedSkeleton === null) throw new Error("E_NO_ASSET");
      return this.ownedSkeleton;
    }
    get tracks() {
      this.assertLive();
      if (this.asset === null) throw new Error("E_NO_ASSET");
      return this.animationState?.tracks ?? this.ownedTracks;
    }
    assertLive() {
      if (this._phase === "disposed") throw new Error("E_DISPOSED");
    }
    /** created/ready/running 可注册；created 阶段的 setup 延迟到 load 的 loading 期。 */
    usePlugin(plugin) {
      this.assertLive();
      const phase = this._phase;
      if (phase !== "created" && phase !== "ready" && phase !== "running") throw new Error("E_STATE");
      this.plugins.push(plugin);
      if (phase !== "created") this.host.setup();
    }
    /** 从不可变资产建立可变实例：Pose / SlotSet / 逆绑定矩阵，并清空播放轨道。 */
    load(asset) {
      this.assertLive();
      const previous = this._phase;
      this._phase = "loading";
      try {
        if (asset.skeleton.count > this.maxBones) throw new Error("E_CONFIG: maxBones");
        if (asset.atlas !== void 0 && asset.atlas.pages.length > this.maxTexturePages) {
          throw new Error("E_CONFIG: maxTexturePages");
        }
        for (const skin of asset.skins.values()) {
          for (const attachment of skin.attachments.values()) {
            if (attachment.kind === "weightedMesh") {
              let max = 0;
              const stride = attachment.mesh.influencesPerVertex ?? 4;
              for (let i = 0; i < attachment.mesh.weights.length; i += stride) {
                let count = 0;
                for (let j = 0; j < stride; j += 1) if ((attachment.mesh.weights[i + j] ?? 0) > 0) count += 1;
                if (count > max) max = count;
              }
              if (this.maxInfluences > 0 && max > this.maxInfluences) throw new Error("E_CONFIG: maxInfluences");
            }
          }
        }
        const skins = asset.skins.size > 0 ? asset.skins : /* @__PURE__ */ new Map([["default", { id: "default", attachments: /* @__PURE__ */ new Map() }]]);
        const defaultSkinId = skins.has("default") ? "default" : skins.keys().next().value;
        const pose = createPose(asset.skeleton);
        const root = asset.skeleton.roots[0];
        this.rootSampleX = root === void 0 ? 0 : pose.local[root * POSE_STRIDE + CH_X];
        this.rootSampleY = root === void 0 ? 0 : pose.local[root * POSE_STRIDE + CH_Y];
        this.rootDisplacementX = 0;
        this.rootDisplacementY = 0;
        this.hasUpdatedSinceLoad = false;
        setSkeletonTransform(
          pose,
          this.instanceX,
          this.instanceY,
          this.instanceScaleX * (this.flipX ? -1 : 1),
          this.instanceScaleY * (this.flipY ? -1 : 1)
        );
        updateWorld(pose);
        const slotSet = createSlotSet(asset.slots, skins, defaultSkinId);
        this.asset = asset;
        this.ownedPose = pose;
        this.ownedSlotSet = slotSet;
        this.ownedSkeleton = new Skeleton(this, pose, slotSet);
        this.animationState?.dispose();
        this.animationState = new AnimationState(asset.animations, pose, slotSet);
        this.lastAnimation = null;
        this.lastFrame = null;
        this.inverseBind = buildInverseBind(pose);
        this.physicsEnvironments.length = 0;
        const constraints = asset.constraints?.map((c) => {
          if (c.kind !== "physics") return c;
          const environment = {
            referenceScale: c.environment?.referenceScale ?? 1,
            windX: this.forceWindX,
            windY: this.forceWindY,
            gravityX: this.forceGravityX,
            gravityY: this.forceGravityY,
            scaleX: pose.skeletonScaleX,
            scaleY: pose.skeletonScaleY
          };
          this.physicsEnvironments.push(environment);
          return { ...c, environment };
        });
        this.solver = constraints !== void 0 && constraints.length > 0 ? createConstraintSolver(constraints) : null;
        const initialWeights = new Map(constraints?.filter((c) => c.kind === "physics").map((c) => [c.id, 0]));
        this.solver?.solve(pose, 0, initialWeights, slotSet);
        this.maskLibrary = asset.maskLibrary;
        this.renderAssets = buildRenderAssets(asset);
        this.preparedAssets = void 0;
        this.ownedTracks.length = 0;
        this.host.setup();
        this._phase = "ready";
      } catch (error) {
        this._phase = previous;
        throw error;
      }
    }
    get state() {
      this.assertLive();
      if (this.animationState === null) throw new Error("E_NO_ASSET");
      return this.animationState;
    }
    /** 播放指定动画；省略名字时取资产首条动画。空资产只切到 running。 */
    play(name) {
      this.assertLive();
      if (this.asset === null) throw new Error("E_NO_ASSET");
      const animations = this.asset.animations;
      let clip;
      if (name === void 0) {
        const first = animations.keys().next().value;
        clip = first === void 0 ? void 0 : animations.get(first);
      } else {
        clip = animations.get(name);
        if (clip === void 0) throw new Error("E_STATE: \u52A8\u753B\u4E0D\u5B58\u5728");
      }
      this.ownedTracks.length = 0;
      let track = null;
      if (this.animationState !== null) {
        const target = name ?? this.asset.animations.keys().next().value;
        if (target !== void 0) track = this.animationState.play(target);
      } else if (clip !== void 0) {
        track = createTrack(clip);
        this.ownedTracks.push(track);
      }
      this._phase = "running";
      return track;
    }
    pause() {
      this.assertLive();
      if (this._phase !== "running" && this._phase !== "paused") throw new Error("E_STATE");
      this.animationState?.pause();
      this._phase = "paused";
    }
    resume() {
      this.assertLive();
      if (this._phase !== "paused") throw new Error("E_STATE");
      this.animationState?.resume();
      this._phase = "running";
    }
    update(dt) {
      this.assertLive();
      const pose = this.ownedPose;
      const slotSet = this.ownedSlotSet;
      if (pose === null || slotSet === null || this.asset === null) throw new Error("E_NO_ASSET");
      if (this._phase === "paused") return;
      if (this._phase === "contextLost") throw new Error("E_STATE");
      if (this._phase !== "ready" && this._phase !== "running" && this._phase !== "restored") throw new Error("E_STATE");
      if (!Number.isFinite(dt) || dt < 0) throw new Error("E_CONFIG");
      this.host.beforeUpdate(dt);
      this.rootDisplacementX = 0;
      this.rootDisplacementY = 0;
      const step = (h) => {
        if (this.animationState !== null) {
          this.lastAnimation = this.animationState.update(h);
          if (this.lastAnimation.drawOrder !== void 0 && this.lastAnimation.drawOrder.length === slotSet.slots.length) {
            slotSet.drawOrder.length = 0;
            slotSet.drawOrder.push(...this.lastAnimation.drawOrder);
          }
        } else {
          this.lastAnimation = sampleAnimation(this.ownedTracks, pose, slotSet, h);
        }
        if (this.rootMotionMode === "entity") this.consumeRootMotion(pose);
        if (this.solver !== null) this.solver.solve(pose, h, this.lastAnimation?.constraintMixByName, slotSet, true);
        updateWorld(pose);
      };
      if (this.fixedDt === void 0) {
        step(dt);
      } else {
        this.accumulator = Math.min(this.accumulator + dt, this.fixedDt * 4);
        let steps = Math.floor(this.accumulator / this.fixedDt + 1e-9);
        if (steps > 4) steps = 4;
        this.accumulator -= steps * this.fixedDt;
        if (this.accumulator < 0) this.accumulator = 0;
        for (let i = 0; i < steps; i += 1) step(this.fixedDt);
      }
      this.host.afterUpdate(dt);
      this.ownedSkeleton?.advanceTime(dt);
      this.hasUpdatedSinceLoad = true;
    }
    consumeRootMotion(pose) {
      const root = pose.skeleton.roots[0];
      if (root === void 0) return;
      const offset = root * POSE_STRIDE;
      const x = pose.local[offset + CH_X], y = pose.local[offset + CH_Y];
      const dx = x - this.rootSampleX, dy = y - this.rootSampleY;
      this.rootSampleX = x;
      this.rootSampleY = y;
      if (dx !== 0 || dy !== 0) {
        const sx = pose.skeletonScaleX, sy = pose.skeletonScaleY;
        this.setPosition(this.instanceX + dx * sx, this.instanceY + dy * sy);
        this.rootDisplacementX += dx * sx;
        this.rootDisplacementY += dy * sy;
      }
      const setup = pose.skeleton.setupLocal;
      setLocal(pose, root, CH_X, setup[offset + CH_X]);
      setLocal(pose, root, CH_Y, setup[offset + CH_Y]);
    }
    /** 模拟 WebGL 上下文丢失：暂停绘制，保留实例状态。 */
    contextLost() {
      this.assertLive();
      if (this._phase === "created" || this._phase === "loading") throw new Error("E_STATE");
      this._phase = "contextLost";
    }
    /** 上下文恢复：重建后端资源，后续 render 重新可用。 */
    contextRestored() {
      this.assertLive();
      if (this._phase !== "contextLost") throw new Error("E_STATE");
      this.backend.restore?.();
      this.preparedAssets = void 0;
      this._phase = "restored";
    }
    render() {
      this.assertLive();
      const pose = this.ownedPose;
      const slotSet = this.ownedSlotSet;
      if (pose === null || slotSet === null || this.asset === null || this.inverseBind === null) {
        throw new Error("E_NO_ASSET");
      }
      if (this._phase === "contextLost" || this._phase === "created" || this._phase === "loading") {
        throw new Error("E_STATE");
      }
      const rules = this.host.viewRules();
      if (rules.length > 0) {
        for (const slotIndex of slotSet.drawOrder) {
          const slot = slotSet.slots[slotIndex];
          if (slot === void 0) continue;
          const current = slot.attachmentId;
          const picked = resolveViewRule(rules, this.camera, slotIndex, current, 0);
          if (picked.attachment !== null && picked.attachment !== current) {
            setSlotAttachment(slotSet, slotIndex, picked.attachment);
          }
        }
      }
      const resolved = resolveMaskPaths(slotSet, this.maskLibrary, pose, this.asset.atlas);
      const packetMaskPaths = [...resolved.maskPaths];
      const residualPaths = /* @__PURE__ */ new Map();
      const residualMaskPath = (path) => {
        if (path < 0) return -1;
        const cached = residualPaths.get(path);
        if (cached !== void 0) return cached;
        const chain = maskChain(path, resolved.maskPaths);
        if (chain.error) return path;
        let remaining = -1;
        for (const id of chain.ids) {
          const mask = resolved.masks[id];
          if (mask === null || mask === void 0 || mask.mode === "stencil" && !mask.invert) continue;
          packetMaskPaths.push({ maskId: id, parent: remaining });
          remaining = packetMaskPaths.length - 1;
        }
        residualPaths.set(path, remaining);
        return remaining;
      };
      const packets = [];
      const clipStats = { clippedIn: 0, clippedOut: 0 };
      const drawOrder = slotSet.drawOrder;
      for (let seq = 0; seq < drawOrder.length; seq += 1) {
        const slotIndex = drawOrder[seq];
        const slot = slotSet.slots[slotIndex];
        if (slot === void 0) continue;
        const attachment = resolveAttachment(slotSet, slotIndex);
        if (!asRenderable(attachment)) continue;
        const maskPath = resolved?.paths[slotIndex] ?? -1;
        const packet = this.buildPacket(attachment, slotIndex, seq, pose, maskPath, resolved, clipStats);
        if (packet !== null) packets.push({ ...packet, maskPath: residualMaskPath(maskPath) });
      }
      const outlined = this.outline === void 0 ? packets : packets.flatMap((packet) => [
        packet,
        buildOutlinePacket(packet, this.outline.width, this.outline.color, packet.id + 1e5, packet.seq)
      ]);
      const frame = {
        packets: batchPackets(sortPackets(outlined)),
        stats: { inputPackets: outlined.length, ...clipStats },
        width: this.viewport.width,
        height: this.viewport.height,
        viewProjection: this.viewProjection,
        ...this.renderAssets === void 0 ? {} : { assets: this.renderAssets },
        maskPaths: packetMaskPaths,
        masks: { version: 1, masks: resolved.masks },
        depthMode: "none"
      };
      if (this.renderAssets !== void 0 && this.preparedAssets !== this.renderAssets && this.backend.prepare !== void 0) {
        this.backend.prepare(this.renderAssets);
        this.preparedAssets = this.renderAssets;
      }
      this.lastFrame = frame;
      this.backend.draw(frame);
      this.host.afterRender(frame);
      return frame;
    }
    /** 收集当前 packet 的 stencil/clipping 多边形（世界空间）；alpha/scissor 不参与几何裁剪。 */
    clipPolygonsFor(resolved, maskPath) {
      if (resolved === void 0 || maskPath < 0) return [];
      const chain = maskChain(maskPath, resolved.maskPaths);
      if (chain.error) return [];
      const out = [];
      for (const id of chain.ids) {
        const mask = resolved.masks[id];
        if (mask !== null && mask !== void 0 && mask.mode === "stencil" && !mask.invert) out.push(mask.positions);
      }
      return out;
    }
    /** 附件 → packet：region 用骨世界矩阵变换默认四边形；mesh/weightedMesh 走蒙皮。 */
    buildPacket(attachment, slotIndex, seq, pose, maskPath, resolved, clipStats) {
      const slot = this.ownedSlotSet.slots[slotIndex];
      const sequence = attachment.kind === "region" ? attachment.region.sequence : void 0;
      const animatedIndex = this.lastAnimation?.sequence.get(slotIndex);
      const sequenceIndex = sequence !== void 0 ? Math.max(0, Math.min(
        sequence.frames.length - 1,
        animatedIndex === void 0 || animatedIndex === -1 ? sequence.setupIndex : animatedIndex
      )) : 0;
      const sequenceKey = sequence !== void 0 ? sequence.frames[sequenceIndex] : void 0;
      const atlas = atlasUvOf(this.asset, attachment, sequenceKey);
      const dark = this.lastAnimation?.colorDark.get(slotIndex) ?? slot.data.dark ?? attachment.dark;
      const light = attachment.color;
      const alpha = slot.color.a * light.a;
      const tint = spinePmaTint(this.color, slot.color, light, dark);
      const base = {
        id: slotIndex,
        color: [
          slot.color.r * light.r,
          slot.color.g * light.g,
          slot.color.b * light.b,
          alpha
        ],
        lightBytes: tint.light,
        ...dark !== void 0 ? { dark: [dark.r * alpha, dark.g * alpha, dark.b * alpha, 1], darkBytes: tint.dark, twoColor: true } : {},
        materialId: atlas?.materialId ?? 0,
        order: seq,
        depthKey: slot.data.zOffset,
        subOrder: 0,
        seq,
        maskPath,
        ...atlas === null ? {} : { page: atlas.page },
        blend: slot.data.blend
      };
      if (attachment.kind === "region") {
        const off = slot.data.bone * WORLD_STRIDE;
        const m = pose.world;
        const region = attachment.region;
        const atlasRegion = this.asset.atlas?.regions.get(sequenceKey ?? region.atlasKey);
        const unitScale = this.asset.unitScale;
        const width = region.width ?? (atlasRegion !== void 0 && atlasRegion.trim.sourceWidth > 0 ? atlasRegion.trim.sourceWidth * unitScale : 1);
        const height = region.height ?? (atlasRegion !== void 0 && atlasRegion.trim.sourceHeight > 0 ? atlasRegion.trim.sourceHeight * unitScale : 1);
        const sx = region.scaleX ?? 1;
        const sy = region.scaleY ?? 1;
        const scaleX = atlasRegion !== void 0 && atlasRegion.trim.sourceWidth > 0 ? width / atlasRegion.trim.sourceWidth * sx : width * sx;
        const scaleY = atlasRegion !== void 0 && atlasRegion.trim.sourceHeight > 0 ? height / atlasRegion.trim.sourceHeight * sy : height * sy;
        const x0 = -width / 2 * sx + (atlasRegion?.trim.offsetX ?? 0) * scaleX;
        const y0 = -height / 2 * sy + (atlasRegion?.trim.offsetY ?? 0) * scaleY;
        const x1 = x0 + (atlasRegion?.width ?? 1) * scaleX;
        const y1 = y0 + (atlasRegion?.height ?? 1) * scaleY;
        const rot = region.rotation ?? 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const px = region.x ?? 0;
        const py = region.y ?? 0;
        const corners = [x0, y0, x0, y1, x1, y1, x1, y0];
        const positions = new Float32Array(8);
        for (let v = 0; v < 4; v += 1) {
          const lx = corners[v * 2];
          const ly = corners[v * 2 + 1];
          const x = lx * cos - ly * sin + px;
          const y = lx * sin + ly * cos + py;
          positions[v * 2] = m[off] * x + m[off + 2] * y + m[off + 4];
          positions[v * 2 + 1] = m[off + 1] * x + m[off + 3] * y + m[off + 5];
        }
        const uvs = atlas?.uvs ?? attachment.region.uvs ?? new Float32Array([0, 1, 0, 0, 1, 0, 1, 1]);
        const polygons = this.clipPolygonsFor(resolved, maskPath);
        if (polygons.length > 0) {
          const clipped = clipTriangles(positions, uvs, new Uint16Array([0, 1, 2, 0, 2, 3]), polygons);
          if (clipStats !== void 0) {
            clipStats.clippedIn += 2;
            clipStats.clippedOut += clipped.indices.length / 3;
          }
          return buildMeshPacket({
            ...base,
            kind: "region",
            positions: clipped.positions,
            uvs: clipped.uvs,
            indices: clipped.indices,
            depth: null
          });
        }
        return buildRegionPacket({ ...base, positions, uvs, kind: "region" });
      }
      const baseMesh = attachment.mesh;
      const meshKey = `${slot.skinId}:${slotIndex}:${attachment.id}`;
      const offsets = this.lastAnimation?.deformOffsets.get(meshKey);
      let mesh = baseMesh;
      if (offsets !== void 0 && offsets.length > 0 && attachment.kind !== "weightedMesh") {
        const deformed = new Float32Array(baseMesh.positions.length);
        deformed.set(baseMesh.positions);
        const n = Math.min(deformed.length, offsets.length);
        for (let i = 0; i < n; i += 1) deformed[i] = deformed[i] + offsets[i];
        mesh = { ...baseMesh, positions: deformed };
      }
      try {
        const inverseBind = this.inverseBind;
        const positions = skinMesh2D(
          mesh,
          pose,
          inverseBind,
          void 0,
          attachment.kind === "weightedMesh" ? offsets : void 0
        );
        const uvs = atlas?.uvs ?? mesh.uvs;
        const polygons = this.clipPolygonsFor(resolved, maskPath);
        if (polygons.length > 0) {
          const clipped = clipTriangles(positions, uvs, mesh.indices, polygons);
          if (clipStats !== void 0) {
            clipStats.clippedIn += mesh.indices.length / 3;
            clipStats.clippedOut += clipped.indices.length / 3;
          }
          return buildMeshPacket({
            ...base,
            positions: clipped.positions,
            uvs: clipped.uvs,
            indices: clipped.indices,
            depth: null,
            kind: "mesh"
          });
        }
        return buildMeshPacket({
          ...base,
          positions,
          uvs,
          indices: mesh.indices,
          depth: null,
          kind: "mesh"
        });
      } catch {
        return buildMeshPacket({
          ...base,
          positions: new Float32Array(0),
          uvs: new Float32Array(0),
          indices: new Uint16Array(0),
          kind: "mesh"
        });
      }
    }
    /** 设置 2D/2.5D 相机；viewRules 与投影随之更新。 */
    setCamera(camera) {
      this.assertLive();
      this.camera = camera;
      this.viewProjection = viewProjection2D(camera);
    }
    /** Instance reflection participates in skeleton world transforms and physics. */
    setFlip(flipX, flipY) {
      this.assertLive();
      this.flipX = flipX;
      this.flipY = flipY;
      this.syncSkeletonTransform();
    }
    setPosition(x, y) {
      this.assertLive();
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("E_CONFIG");
      if (this.rootMotionMode === "entity") {
        const sx = this.instanceScaleX * (this.flipX ? -1 : 1);
        const sy = this.instanceScaleY * (this.flipY ? -1 : 1);
        this.solver?.physicsTranslate((x - this.instanceX) / sx, (y - this.instanceY) / sy);
      }
      this.instanceX = x;
      this.instanceY = y;
      this.syncSkeletonTransform();
    }
    syncSkeletonTransform() {
      const sx = this.instanceScaleX * (this.flipX ? -1 : 1);
      const sy = this.instanceScaleY * (this.flipY ? -1 : 1);
      if (this.ownedPose !== null) {
        if (!this.hasUpdatedSinceLoad && (sx !== this.ownedPose.skeletonScaleX || sy !== this.ownedPose.skeletonScaleY)) this.solver?.reset();
        setSkeletonTransform(this.ownedPose, this.instanceX, this.instanceY, sx, sy);
      }
      for (const env of this.physicsEnvironments) {
        env.scaleX = sx;
        env.scaleY = sy;
      }
    }
    /** Instance scale is a skeleton transform, never a bone local rewrite. */
    setScale(scaleX, scaleY) {
      this.assertLive();
      if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX === 0 || scaleY === 0) {
        throw new Error("E_CONFIG");
      }
      this.instanceScaleX = scaleX;
      this.instanceScaleY = scaleY;
      this.syncSkeletonTransform();
    }
    /** 换肤：只换附件集合，不改 pose/drawOrder。 */
    setSkinByName(name) {
      this.assertLive();
      if (this.ownedSlotSet === null) throw new Error("E_NO_ASSET");
      setSkin(this.ownedSlotSet, name);
    }
    /** 单槽附件覆盖；名字不存在时清空该槽。 */
    setAttachment(slotName, attachmentName) {
      this.assertLive();
      const set = this.ownedSlotSet;
      if (set === null) throw new Error("E_NO_ASSET");
      const index = set.slots.findIndex((slot) => slot.data.id === slotName);
      if (index < 0) throw new Error("E_ATTACHMENT");
      setSlotAttachment(set, index, attachmentName);
    }
    /** Restores bone locals without updating world transforms or animation state. */
    setupPoseBones() {
      this.assertLive();
      const pose = this.ownedPose;
      if (pose === null) throw new Error("E_NO_ASSET");
      pose.local.set(pose.skeleton.setupLocal);
      const root = pose.skeleton.roots[0];
      if (root !== void 0) {
        this.rootSampleX = pose.local[root * POSE_STRIDE + CH_X];
        this.rootSampleY = pose.local[root * POSE_STRIDE + CH_Y];
      }
      markAllDirty(pose);
    }
    /** Restores setup attachments, colors, and draw order without changing bones. */
    setupPoseSlots() {
      this.assertLive();
      const set = this.ownedSlotSet;
      if (set === null) throw new Error("E_NO_ASSET");
      for (const slot of set.slots) {
        slot.attachmentId = slot.data.attachment;
        slot.color = slot.data.color;
      }
      set.drawOrder.length = 0;
      set.drawOrder.push(...set.slots.map((_, i) => i).sort((a, b) => set.slots[a].data.order - set.slots[b].data.order));
    }
    setBonesToSetupPose() {
      this.setupPoseBones();
    }
    setSlotsToSetupPose() {
      this.setupPoseSlots();
    }
    setupPose(options = {}) {
      this.setupPoseBones();
      this.setupPoseSlots();
      if (options.stopOnSetupPose) this.animationState?.stop();
    }
    /** Legacy alias; stopping playback requires explicit opt-in. */
    setToSetupPose(options = {}) {
      this.setupPose(options);
    }
    /** 当前渲染包围盒（裁剪前、不含描边）；用于取景/调试。 */
    getBounds() {
      this.assertLive();
      const pose = this.ownedPose;
      const set = this.ownedSlotSet;
      if (pose === null || set === null) throw new Error("E_NO_ASSET");
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let seq = 0; seq < set.drawOrder.length; seq += 1) {
        const index = set.drawOrder[seq];
        const attachment = resolveAttachment(set, index);
        if (!asRenderable(attachment)) continue;
        const packet = this.buildPacket(attachment, index, seq, pose, -1, void 0);
        if (packet === null) continue;
        for (let i = 0; i + 1 < packet.positions.length; i += 2) {
          minX = Math.min(minX, packet.positions[i]);
          maxX = Math.max(maxX, packet.positions[i]);
          minY = Math.min(minY, packet.positions[i + 1]);
          maxY = Math.max(maxY, packet.positions[i + 1]);
        }
      }
      if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    /** 调试叠加线：需先 render 一帧；不修改生产 packet/pose。 */
    debugLines(flags) {
      this.assertLive();
      if (this.lastFrame === null || this.ownedPose === null || this.ownedSlotSet === null) return [];
      return buildDebugLines({
        pose: this.ownedPose,
        slotSet: this.ownedSlotSet,
        packets: this.lastFrame.packets,
        ...this.lastFrame.masks === void 0 ? {} : { masks: this.lastFrame.masks.masks },
        bounds: this.getBounds(),
        flags
      });
    }
    readPixels() {
      this.assertLive();
      return this.backend.readPixels();
    }
    /** 幂等：首次释放插件与后端并置 disposed；之后仅 phase 可读。 */
    dispose() {
      if (this._phase === "disposed") return;
      this.host.dispose();
      this.backend.dispose();
      this.animationState?.dispose();
      this.animationState = null;
      this._phase = "disposed";
      this.asset = null;
      this.ownedPose = null;
      this.ownedSlotSet = null;
      this.ownedSkeleton = null;
      this.inverseBind = null;
      this.solver = null;
      this.ownedTracks.length = 0;
    }
  };

  // ../packages/render-engine/src/app/foot.ts
  var DEFAULT_FOOT_LENGTH = 0.15;
  var DEFAULT_ANKLE_HEIGHT = 0.04;
  var HEEL_BACK_RATIO = 0.3;
  function assertFinite(value, code) {
    if (!Number.isFinite(value)) throw new Error(code);
  }
  function createFootGeometry(footLength = DEFAULT_FOOT_LENGTH, ankleHeight = DEFAULT_ANKLE_HEIGHT) {
    assertFinite(footLength, "foot.footLength");
    assertFinite(ankleHeight, "foot.ankleHeight");
    if (footLength <= 0) throw new Error("foot.footLength");
    if (ankleHeight < 0) throw new Error("foot.ankleHeight");
    const heelBack = HEEL_BACK_RATIO * footLength;
    const soleLength = heelBack + footLength;
    const soleRise = 2 * ankleHeight;
    const point = (u) => ({
      x: -heelBack + u * soleLength,
      y: -soleRise * 0.5 + u * soleRise
    });
    return {
      footLength,
      ankleHeight,
      heelBack,
      soleLength,
      soleRise,
      heel: point(0),
      flat: point(0.5),
      toe: point(1)
    };
  }
  var DEFAULT_GEOMETRY = createFootGeometry();

  // ../packages/render-engine/src/app/params.ts
  var DEFAULT_PARAM_TAUS = {
    speed: 0.12,
    turn: 0.16,
    amplitude: 0.2
  };
  function smoothingAlpha(dt, tau) {
    if (!Number.isFinite(dt) || dt <= 0) return 0;
    if (!Number.isFinite(tau) || tau <= 0) throw new Error("params.tau");
    return 1 - Math.exp(-dt / tau);
  }
  function copyParams(p) {
    return { speed: p.speed, turn: p.turn, gait: p.gait, amplitude: p.amplitude };
  }
  var ParamSmoother = class {
    taus;
    constructor(taus) {
      this.taus = {
        speed: taus?.speed ?? DEFAULT_PARAM_TAUS.speed,
        turn: taus?.turn ?? DEFAULT_PARAM_TAUS.turn,
        amplitude: taus?.amplitude ?? DEFAULT_PARAM_TAUS.amplitude
      };
      for (const key of ["speed", "turn", "amplitude"]) {
        if (!Number.isFinite(this.taus[key]) || this.taus[key] <= 0) throw new Error(`params.tau.${key}`);
      }
    }
    /** 推进一次并写回 state.current；非法 dt 不改变状态。 */
    step(state, dt) {
      if (!Number.isFinite(dt) || dt <= 0) return copyParams(state.current);
      const { current, target } = state;
      const next = {
        speed: current.speed + (target.speed - current.speed) * smoothingAlpha(dt, this.taus.speed),
        turn: current.turn + (target.turn - current.turn) * smoothingAlpha(dt, this.taus.turn),
        gait: target.gait,
        amplitude: current.amplitude + (target.amplitude - current.amplitude) * smoothingAlpha(dt, this.taus.amplitude)
      };
      state.current = next;
      return next;
    }
  };

  // ../packages/render-engine/src/app/motion.ts
  var smoother = new ParamSmoother();

  // ../packages/render-engine/src/tools/tools.ts
  var DEFAULT_FIXED_DT2 = 1 / 60;

  // spine-scene.ts
  var SPINE_SAMPLES = {
    spineboy: { label: "Spineboy", json: "spineboy-pro.json", atlas: "spineboy.atlas" },
    raptor: { label: "Raptor", json: "raptor-pro.json", atlas: "raptor.atlas" },
    stretchyman: { label: "Stretchyman", json: "stretchyman-pro.json", atlas: "stretchyman.atlas" }
  };
  function frameOnlyBackend() {
    return {
      kind: "cpu",
      draw: () => {
      },
      readPixels: () => new Uint8ClampedArray(0),
      resize: () => {
      },
      dispose: () => {
      }
    };
  }
  async function fetchOptional(url) {
    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Spine asset ${url.pathname}: HTTP ${response.status}`);
    return response;
  }
  async function pagePixels(url) {
    const response = await fetchOptional(url);
    if (response === null) return null;
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const canvas2 = document.createElement("canvas");
      canvas2.width = bitmap.width;
      canvas2.height = bitmap.height;
      const context2 = canvas2.getContext("2d", { willReadFrequently: true });
      if (context2 === null) throw new Error("Spine atlas image: 2D canvas unavailable");
      context2.drawImage(bitmap, 0, 0);
      const pixels = context2.getImageData(0, 0, bitmap.width, bitmap.height).data;
      return { width: bitmap.width, height: bitmap.height, data: new Uint8Array(pixels) };
    } finally {
      bitmap.close();
    }
  }
  async function loadSpineScene(sample, baseUrl = "/samples/") {
    const files = SPINE_SAMPLES[sample];
    if (files === void 0) throw new Error(`Unknown Spine sample: ${sample}`);
    const directory = new URL(`${sample}/`, new URL(baseUrl, document.baseURI));
    const [jsonResponse, atlasResponse] = await Promise.all([
      fetchOptional(new URL(files.json, directory)),
      fetchOptional(new URL(files.atlas, directory))
    ]);
    if (jsonResponse === null || atlasResponse === null) return null;
    const [json, atlasText] = await Promise.all([jsonResponse.json(), atlasResponse.text()]);
    const parsed = importSpineAtlas(atlasText);
    const pages = await Promise.all(parsed.pages.map(async (page) => {
      if (!page.name || page.name.includes("/") || page.name.includes("\\") || page.name === "..") {
        throw new Error(`Invalid Spine atlas page name: ${page.name ?? "(missing)"}`);
      }
      const image = await pagePixels(new URL(page.name, directory));
      return image === null ? null : { ...page, image };
    }));
    if (pages.some((page) => page === null)) return null;
    const atlas = { ...parsed, pages };
    const asset = importSpine(json, { atlas, unitScale: 0.01, sourceYDown: false });
    if (asset.report.errors > 0) {
      throw new Error(`Spine ${sample}: ${asset.report.errors} import errors: ${asset.report.issues.filter((issue) => issue.severity === "error").slice(0, 3).map((issue) => issue.code).join(", ")}`);
    }
    const animations = [...asset.animations.keys()];
    const meta = json.skeleton ?? {};
    const bounds = [meta.x, meta.y, meta.width, meta.height];
    const hasBounds = bounds.every((value) => typeof value === "number" && Number.isFinite(value)) && (meta.width ?? 0) > 0 && (meta.height ?? 0) > 0;
    const engine = new Engine({ backend: "cpu" }, { backendFactory: frameOnlyBackend });
    engine.load(asset);
    let selected2 = null;
    const boneOffsets = /* @__PURE__ */ new Map();
    let disposed = false;
    function assertLive() {
      if (disposed) throw new Error("Spine scene disposed");
    }
    const scene = {
      sample,
      animations,
      get animation() {
        return selected2;
      },
      boneNames: engine.skeleton.bones.map((bone) => bone.name),
      setBoneRotation(name, degrees) {
        assertLive();
        if (!Number.isFinite(degrees) || !engine.skeleton.findBone(name)) throw new Error(`Invalid bone rotation: ${name}`);
        boneOffsets.set(name, degrees);
      },
      resetBoneRotations() {
        for (const name of boneOffsets.keys()) {
          const bone = engine.skeleton.findBone(name);
          bone.rotation = bone.data.setup.rotation;
        }
        boneOffsets.clear();
        engine.skeleton.updateWorldTransform();
      },
      setAnimation(name) {
        assertLive();
        if (name !== null && !asset.animations.has(name)) throw new Error(`Unknown Spine animation: ${name}`);
        engine.load(asset);
        selected2 = name;
        if (name !== null) engine.play(name);
      },
      reset() {
        scene.setAnimation(selected2);
      },
      frame(width, height, dt = 0) {
        assertLive();
        if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
          throw new Error("Spine frame needs positive integer dimensions");
        }
        if (!Number.isFinite(dt) || dt < 0) throw new Error("Spine frame needs nonnegative dt");
        const aspect = width / height;
        const figureHeight = hasBounds ? meta.height * 0.01 : 4;
        const figureWidth = hasBounds ? meta.width * 0.01 : 3;
        const orthoHeight = Math.max(figureHeight, figureWidth / aspect) * 1.2;
        engine.setCamera({
          ...DEFAULT_CAMERA,
          target: hasBounds ? [(meta.x + meta.width / 2) * 0.01, (meta.y + meta.height / 2) * 0.01, 0] : [0, 0, 0],
          orthoHeight,
          viewport: { width, height, dpr: 1 }
        });
        if (dt > 0 && selected2 !== null) engine.update(Math.min(dt, 0.1));
        if (boneOffsets.size > 0) {
          for (const [name, degrees] of boneOffsets) {
            const bone = engine.skeleton.findBone(name);
            bone.rotation = bone.data.setup.rotation + degrees * Math.PI / 180;
          }
          engine.skeleton.updateWorldTransform();
        }
        return { ...engine.render(), width, height };
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        engine.dispose();
      }
    };
    return scene;
  }

  // pose-main.ts
  var joints = [
    ["head", "\u5934\u90E8", 5],
    ["neck", "\u9888\u90E8", 0],
    ["torso", "\u8EAF\u5E72", -5],
    ["front-shoulder", "\u524D\u80A9", -35],
    ["front-upper-arm", "\u524D\u4E0A\u81C2", 20],
    ["front-bracer", "\u524D\u5C0F\u81C2", 0],
    ["back-shoulder", "\u540E\u80A9", 35],
    ["rear-upper-arm", "\u540E\u4E0A\u81C2", -20],
    ["rear-bracer", "\u540E\u5C0F\u81C2", 0],
    ["front-thigh", "\u524D\u5927\u817F", 15],
    ["front-shin", "\u524D\u5C0F\u817F", 0],
    ["rear-thigh", "\u540E\u5927\u817F", -15],
    ["rear-shin", "\u540E\u5C0F\u817F", 0]
  ];
  var canvas = document.querySelector("#view");
  var controls = document.querySelector("#controls");
  var errorBox = document.querySelector("#error");
  var context = canvas.getContext("2d", { alpha: false });
  var backend = new CpuBackend({ width: 1, height: 1, background: [25, 27, 34, 255] });
  async function start() {
    const scene = await loadSpineScene("spineboy");
    if (!scene) throw new Error("\u7F3A\u5C11 Spineboy \u7D20\u6750\uFF0C\u8BF7\u5148\u8FD0\u884C pnpm fetch:spine-samples");
    window.addEventListener("pagehide", () => {
      scene.dispose();
      backend.dispose();
    }, { once: true });
    const sliders = /* @__PURE__ */ new Map();
    let scheduled = false;
    let prepared;
    function draw() {
      scheduled = false;
      const width = Math.max(1, Math.floor(canvas.clientWidth));
      const height = Math.max(1, Math.floor(canvas.clientHeight));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const frame = scene.frame(width, height);
      if (frame.assets !== void 0 && frame.assets !== prepared) {
        backend.prepare?.(frame.assets);
        prepared = frame.assets;
      }
      backend.draw(frame);
      context.putImageData(new ImageData(new Uint8ClampedArray(backend.readPixels()), width, height), 0, 0);
    }
    function schedule() {
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(() => {
          try {
            draw();
          } catch (error) {
            showError(error);
          }
        });
      }
    }
    for (const [name, label] of joints) {
      if (!scene.boneNames.includes(name)) continue;
      const row = document.createElement("label");
      row.className = "joint";
      const title = document.createElement("span");
      title.textContent = label;
      const output = document.createElement("output");
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "-90";
      slider.max = "90";
      slider.step = "1";
      slider.setAttribute("aria-label", `${label}\u65CB\u8F6C`);
      slider.addEventListener("input", () => {
        const value = Number(slider.value);
        output.textContent = `${value}\xB0`;
        scene.setBoneRotation(name, value);
        schedule();
      });
      row.append(title, output, slider);
      controls.append(row);
      sliders.set(name, slider);
    }
    function preset(approximate) {
      scene.resetBoneRotations();
      for (const [name, , angle] of joints) {
        const slider = sliders.get(name);
        if (!slider) continue;
        slider.value = String(approximate ? angle : 0);
        slider.dispatchEvent(new Event("input"));
      }
      schedule();
    }
    document.querySelector("#approx").addEventListener("click", () => preset(true));
    document.querySelector("#original").addEventListener("click", () => preset(false));
    document.querySelector("#reset").addEventListener("click", () => preset(false));
    new ResizeObserver(schedule).observe(canvas);
    preset(true);
  }
  function showError(error) {
    errorBox.hidden = false;
    errorBox.textContent = error instanceof Error ? error.message : String(error);
    console.error(error);
  }
  start().catch(showError);
})();
