"use strict";
(() => {
  // packages/render-engine/src/core/math.ts
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
  function composeAffineFromLocal(local, bone, out = createAffine()) {
    const i = bone * POSE_STRIDE;
    const c = Math.cos(local[i + CH_ROT]);
    const s = Math.sin(local[i + CH_ROT]);
    const sx = local[i + CH_SX];
    const sy = local[i + CH_SY];
    const shx = local[i + CH_SHX];
    const shy = local[i + CH_SHY];
    out[0] = sx * (c - s * shy);
    out[1] = sx * (s + c * shy);
    out[2] = sy * (c * shx - s);
    out[3] = sy * (s * shx + c);
    out[4] = local[i + CH_X];
    out[5] = local[i + CH_Y];
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
  function transformAffineInto(out, offset, m, x, y) {
    out[offset] = m[0] * x + m[2] * y + m[4];
    out[offset + 1] = m[1] * x + m[3] * y + m[5];
  }
  function parentBasis(mode2, p, out = createAffine()) {
    const tx = p[4];
    const ty = p[5];
    if (mode2 === "normal") {
      for (let i = 0; i < WORLD_STRIDE; i += 1) out[i] = p[i];
      return out;
    }
    if (mode2 === "onlyTranslation") {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
    } else if (mode2 === "noRotationOrReflection") {
      out[0] = Math.hypot(p[0], p[1]);
      out[1] = 0;
      out[2] = 0;
      out[3] = Math.hypot(p[2], p[3]);
    } else if (mode2 === "noScale" || mode2 === "noScaleOrReflection") {
      const lx = Math.hypot(p[0], p[1]);
      const ly = Math.hypot(p[2], p[3]);
      const nx = lx <= EPS ? 1 : p[0] / lx;
      const ny = lx <= EPS ? 0 : p[1] / lx;
      let mx = ly <= EPS ? 0 : p[2] / ly;
      let my = ly <= EPS ? 1 : p[3] / ly;
      if (mode2 === "noScaleOrReflection" && nx * my - ny * mx < 0) {
        mx = -mx;
        my = -my;
      }
      out[0] = nx;
      out[1] = ny;
      out[2] = mx;
      out[3] = my;
    } else {
      throw new Error(`inherit.mode: ${String(mode2)}`);
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

  // packages/render-engine/src/core/skeleton.ts
  var PROFILE_BONE_LIMITS = {
    simple2d: 19,
    full2d: 64,
    volume3d: 64
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

  // packages/render-engine/src/core/pose.ts
  function createPose(skeleton) {
    const pose = {
      skeleton,
      local: skeleton.setupLocal.slice(),
      world: new Float32Array(skeleton.count * WORLD_STRIDE),
      dirty: new Uint8Array(skeleton.count),
      dirtyCount: 0,
      worldValid: false,
      scratch: new Float32Array(WORLD_STRIDE * 2),
      version: 0
    };
    markAllDirty(pose);
    return pose;
  }
  function markAllDirty(pose) {
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
    pose.version += 1;
    markDirty(pose, bone);
  }
  function addRotation(pose, bone, delta2) {
    if (!Number.isFinite(delta2)) throw new Error("pose.value");
    if (bone < 0 || bone >= pose.skeleton.count) throw new Error("pose.bone");
    const i = bone * POSE_STRIDE + CH_ROT;
    pose.local[i] = pose.local[i] + delta2;
    pose.version += 1;
    markDirty(pose, bone);
  }
  function resetToSetup(pose) {
    pose.local.set(pose.skeleton.setupLocal);
    pose.scratch.fill(0);
    markAllDirty(pose);
    pose.version += 1;
  }
  var scratchLocal = createAffine();
  var scratchParent = createAffine();
  var scratchBasis = createAffine();
  function updateWorld(pose) {
    if (pose.worldValid && pose.dirtyCount === 0) return;
    const { skeleton, local, world, dirty } = pose;
    for (const id of skeleton.order) {
      if (dirty[id] === 0 && pose.worldValid) continue;
      composeAffineFromLocal(local, id, scratchLocal);
      const parent = skeleton.parent[id];
      if (parent < 0) {
        for (let k = 0; k < WORLD_STRIDE; k += 1) world[id * WORLD_STRIDE + k] = scratchLocal[k];
      } else {
        for (let k = 0; k < WORLD_STRIDE; k += 1) scratchParent[k] = world[parent * WORLD_STRIDE + k];
        parentBasis(skeleton.inherit[id], scratchParent, scratchBasis);
        multiplyAffine(scratchBasis, scratchLocal, scratchLocal);
        for (let k = 0; k < WORLD_STRIDE; k += 1) world[id * WORLD_STRIDE + k] = scratchLocal[k];
      }
      dirty[id] = 0;
    }
    pose.dirtyCount = 0;
    pose.worldValid = true;
  }

  // packages/render-engine/src/slot/slot.ts
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

  // packages/render-engine/src/mesh/mesh.ts
  var delta = createAffine();
  var temp = createAffine();

  // packages/render-engine/src/animation/animation.ts
  var TAU2 = Math.PI * 2;
  var IDENTITY_BEZIER = [1 / 3, 1 / 3, 2 / 3, 2 / 3];
  function createTrack(clip, options) {
    return {
      clip,
      time: options?.time ?? 0,
      alpha: options?.alpha ?? 1,
      speed: options?.speed ?? 1,
      loop: options?.loop ?? true,
      blendMode: options?.blendMode ?? "replace",
      lastTime: options?.time ?? 0,
      loopCount: 0
    };
  }
  function clamp01(v) {
    if (v <= 0) return 0;
    if (v >= 1) return 1;
    return v;
  }
  function bezierAxis(u, c1, c2) {
    const m = 1 - u;
    return 3 * m * m * u * c1 + 3 * m * u * u * c2 + u * u * u;
  }
  function bezierDerivative(u, c1, c2) {
    const m = 1 - u;
    return 3 * m * m * c1 + 6 * m * u * (c2 - c1) + 3 * u * u * (1 - c2);
  }
  function solveBezierU(t, c1x, c2x) {
    let u = t;
    for (let i = 0; i < 8; i += 1) {
      const err = bezierAxis(u, c1x, c2x) - t;
      if (Math.abs(err) < 1e-6) return u;
      const d = bezierDerivative(u, c1x, c2x);
      if (Math.abs(d) < 1e-8) break;
      u = clamp01(u - err / d);
    }
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 32; i += 1) {
      u = (lo + hi) / 2;
      const x = bezierAxis(u, c1x, c2x);
      if (Math.abs(x - t) < 1e-6) return u;
      if (x < t) lo = u;
      else hi = u;
    }
    return (lo + hi) / 2;
  }
  function bezierFraction(t, bezier) {
    const b = bezier ?? IDENTITY_BEZIER;
    const c1x = b[0];
    const c1y = b[1];
    const c2x = b[2];
    const c2y = b[3];
    if (![c1x, c1y, c2x, c2y].every(Number.isFinite)) return t;
    let ax = clamp01(c1x);
    let bx = clamp01(c2x);
    if (ax > bx) {
      const tmp = ax;
      ax = bx;
      bx = tmp;
    }
    return bezierAxis(solveBezierU(t, ax, bx), c1y, c2y);
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
      case "stepped":
        return t >= 1 ? 1 : 0;
      case "bezier":
        return bezierFraction(t, bezier);
      case "easeSine":
        return easeSineFraction(t);
      case "linear":
        return t;
      default:
        return t;
    }
  }
  function sampleScalar(keys2, time) {
    if (keys2.length === 0) return 0;
    const first = keys2[0];
    if (keys2.length === 1 || time <= first.time) return first.value;
    const last = keys2[keys2.length - 1];
    if (time >= last.time) return last.value;
    let lo = 0;
    let hi = keys2.length - 1;
    while (lo + 1 < hi) {
      const mid = lo + hi >> 1;
      if (keys2[mid].time <= time) lo = mid;
      else hi = mid;
    }
    const k0 = keys2[lo];
    const k1 = keys2[lo + 1];
    const span = k1.time - k0.time;
    const u = span <= 0 ? 1 : (time - k0.time) / span;
    const f = curveFraction(k0.curve, u, k0.bezier);
    return k0.value + (k1.value - k0.value) * f;
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
  function componentsOf(kind, component) {
    if (component !== "all") return [component];
    if (kind === "translate") return ["x", "y"];
    if (kind === "scale") return ["sx", "sy"];
    return ["shx", "shy"];
  }
  function blend(cur, setup, sample, alpha, additive, multiplier) {
    const base = cur ?? setup;
    if (additive) return base + sample * alpha;
    const target = multiplier ? setup * sample : setup + sample;
    return base + (target - base) * alpha;
  }
  function fireEvents(events, from, to, includeFrom, loopTag, out, seen) {
    if (to < from) return;
    for (const e of events) {
      if (e.time < from || e.time > to) continue;
      if (!includeFrom && e.time === from) continue;
      const id = `${loopTag}:${e.name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(e.name);
    }
  }
  function sampleAnimation(tracks, pose, slotSet, dt) {
    const events = [];
    const seen = /* @__PURE__ */ new Set();
    const accs = /* @__PURE__ */ new Map();
    let dominant = null;
    const pendingAttachment = /* @__PURE__ */ new Map();
    const pendingColor = /* @__PURE__ */ new Map();
    const pendingDrawOrder = /* @__PURE__ */ new Map();
    const skeleton = pose.skeleton;
    for (const track of tracks) {
      if (track.alpha <= 0) continue;
      const clip = track.clip;
      const duration = clip.duration;
      const prev = track.lastTime;
      const prevLoops = track.loopCount;
      const isFirst = prev === 0 && prevLoops === 0 && track.time === 0 && dt > 0;
      let curr = track.time;
      if (dt > 0 && track.speed > 0 && duration > 0) {
        curr += dt * track.speed;
        if (track.loop) {
          if (curr >= duration) {
            const wraps = Math.floor(curr / duration);
            track.loopCount += wraps;
            curr -= wraps * duration;
          }
        } else if (curr > duration) {
          curr = duration;
        }
      }
      track.time = curr;
      const loops = track.loopCount - prevLoops;
      if (dt !== 0 && track.alpha >= 0.5) {
        const evs = [];
        for (const tl of clip.timelines) {
          if (tl.kind === "event") evs.push(...tl.events);
        }
        if (evs.length > 0) {
          if (isFirst) {
            for (let k = 0; k < loops; k += 1) fireEvents(evs, 0, duration, true, k, events, seen);
            fireEvents(evs, 0, curr, true, loops, events, seen);
          } else if (loops > 0) {
            fireEvents(evs, prev, duration, false, 0, events, seen);
            for (let k = 1; k < loops; k += 1) fireEvents(evs, 0, duration, true, k, events, seen);
            fireEvents(evs, 0, curr, true, loops, events, seen);
          } else {
            fireEvents(evs, prev, curr, false, 0, events, seen);
          }
        }
      }
      track.lastTime = curr;
      const additive = track.blendMode === "additive";
      let wrote = false;
      for (const tl of clip.timelines) {
        if (tl.kind === "event") continue;
        const value = sampleScalar(tl.keys, curr);
        if (tl.kind === "rotate") {
          const { target } = targetOf(tl.path);
          const id = skeleton.boneIdByName.get(target);
          if (id === void 0) continue;
          const acc = accs.get(id) ?? {};
          const setup = skeleton.setupLocal[id * POSE_STRIDE + CH_ROT];
          acc.rot = blend(acc.rot, setup, value, track.alpha, additive, false);
          accs.set(id, acc);
          wrote = true;
          continue;
        }
        if (tl.kind === "translate" || tl.kind === "scale" || tl.kind === "shear") {
          const { target, component } = targetOf(tl.path);
          const id = skeleton.boneIdByName.get(target);
          if (id === void 0) continue;
          if (tl.kind === "scale" && additive) continue;
          const acc = accs.get(id) ?? {};
          const base = id * POSE_STRIDE;
          for (const c of componentsOf(tl.kind, component)) {
            const channel = CHANNEL_OF[c];
            const setup = skeleton.setupLocal[base + channel];
            acc[c] = blend(acc[c], setup, value, track.alpha, additive, tl.kind === "scale");
          }
          accs.set(id, acc);
          wrote = true;
          continue;
        }
        if (additive) continue;
        const slot = Number.parseInt(tl.path, 10);
        const index = Number.isFinite(slot) ? slot : 0;
        if (tl.kind === "attachment") {
          pendingAttachment.set(index, value);
          wrote = true;
        } else if (tl.kind === "color") {
          pendingColor.set(index, value);
          wrote = true;
        } else if (tl.kind === "drawOrder") {
          pendingDrawOrder.set(index, value);
          wrote = true;
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
    for (const [slot, value] of pendingAttachment) setSlotAttachment(slotSet, slot, String(value));
    for (const [slot, value] of pendingColor) setSlotColor(slotSet, slot, value >>> 0);
    for (const [, value] of pendingDrawOrder) {
      const n = slotSet.slots.length;
      const shift = (value % n + n) % n;
      setDrawOrder(slotSet, slotSet.slots.map((_, i) => (i + shift) % n));
    }
    return { events, dominant };
  }

  // packages/render-engine/src/constraint/constraint.ts
  var PHYSICS_DT = 1 / 120;

  // packages/render-engine/src/render/render.ts
  var clamp012 = (v) => Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  function toByte(v) {
    return Math.min(255, Math.max(0, Math.floor(clamp012(v) * 255 + 0.5)));
  }
  function colorBytes(color, pma) {
    const a = clamp012(color[3]);
    const r = pma ? clamp012(color[0]) : clamp012(color[0]) * a;
    const g = pma ? clamp012(color[1]) : clamp012(color[1]) * a;
    const b = pma ? clamp012(color[2]) : clamp012(color[2]) * a;
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
      colors: fillColors(vertexCount, colorBytes(args.color, args.pma === true)),
      depth: null,
      indices: fanIndices(vertexCount),
      materialId: args.materialId,
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

  // packages/render-engine/src/backend/backend.ts
  var EPS2 = 1e-12;
  var mulU8 = (a, b) => (a * b + 127) / 255 | 0;
  function blendPixel(dst, di, sr, sg, sb, sa, mode2) {
    const dr = dst[di];
    const dg = dst[di + 1];
    const db = dst[di + 2];
    const da = dst[di + 3];
    const inv = 255 - sa;
    switch (mode2) {
      case "normal":
        dst[di] = sr + mulU8(dr, inv);
        dst[di + 1] = sg + mulU8(dg, inv);
        dst[di + 2] = sb + mulU8(db, inv);
        dst[di + 3] = sa + mulU8(da, inv);
        break;
      case "add":
        dst[di] = sr + dr;
        dst[di + 1] = sg + dg;
        dst[di + 2] = sb + db;
        dst[di + 3] = sa + da;
        break;
      case "multiply":
        dst[di] = mulU8(sr, dr) + mulU8(dr, inv);
        dst[di + 1] = mulU8(sg, dg) + mulU8(dg, inv);
        dst[di + 2] = mulU8(sb, db) + mulU8(db, inv);
        dst[di + 3] = sa + mulU8(da, inv);
        break;
      case "screen":
        dst[di] = sr + mulU8(dr, 255 - sr);
        dst[di + 1] = sg + mulU8(dg, 255 - sg);
        dst[di + 2] = sb + mulU8(db, 255 - sb);
        dst[di + 3] = sa + mulU8(da, inv);
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
    stats = { drawCalls: 0, packets: 0, uploadedVertices: 0 };
    width;
    height;
    ss;
    background;
    color;
    disposed = false;
    constructor(a = {}, b, c) {
      const opts = typeof a === "number" ? { width: a, height: b ?? 1, supersample: c ?? 1 } : a;
      this.width = Math.max(1, Math.floor(opts.width ?? 1));
      this.height = Math.max(1, Math.floor(opts.height ?? 1));
      this.ss = opts.supersample ?? 1;
      this.background = opts.background ?? [0, 0, 0, 255];
      this.color = new Uint8ClampedArray(this.width * this.ss * this.height * this.ss * 4);
      this.clear();
    }
    resize(v) {
      const w = Math.max(1, Math.floor(v.width));
      const h = Math.max(1, Math.floor(v.height));
      if (w === this.width && h === this.height) return;
      this.width = w;
      this.height = h;
      this.color = new Uint8ClampedArray(w * this.ss * h * this.ss * 4);
      this.clear();
    }
    clear() {
      const [r, g, b, a] = this.background;
      for (let i = 0; i < this.color.length; i += 4) {
        this.color[i] = r;
        this.color[i + 1] = g;
        this.color[i + 2] = b;
        this.color[i + 3] = a;
      }
    }
    toScreen(frame, x, y) {
      const m = frame.viewProjection;
      if (m === void 0) return [x, y];
      if (m.length >= 16) {
        const cx = m[0] * x + m[4] * y + m[12];
        const cy = m[1] * x + m[5] * y + m[13];
        const cw = m[3] * x + m[7] * y + m[15];
        const w = Math.abs(cw) < EPS2 ? EPS2 : cw;
        return [(cx / w * 0.5 + 0.5) * frame.width, (0.5 - cy / w * 0.5) * frame.height];
      }
      if (m.length >= 9) {
        const cx = m[0] * x + m[3] * y + m[6];
        const cy = m[1] * x + m[4] * y + m[7];
        const cw = m[2] * x + m[5] * y + m[8];
        const w = Math.abs(cw) < EPS2 ? EPS2 : cw;
        return [cx / w, cy / w];
      }
      return [x, y];
    }
    rasterize(p0, p1, p2, ss, ssW, ssH) {
      let area = edge(p0, p1, p2.x, p2.y);
      if (!Number.isFinite(area) || Math.abs(area) < EPS2) return;
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
          const r = Math.round(b0 * p0.r + b1 * p1.r + b2 * p2.r);
          const g = Math.round(b0 * p0.g + b1 * p1.g + b2 * p2.g);
          const b = Math.round(b0 * p0.b + b1 * p1.b + b2 * p2.b);
          const a = Math.round(b0 * p0.a + b1 * p1.a + b2 * p2.a);
          if (a <= 0) continue;
          blendPixel(this.color, (sy * ssW + sx) * 4, r, g, b, a, this.currentBlend);
        }
      }
    }
    currentBlend = "normal";
    draw(frame) {
      if (this.disposed) throw new Error("CpuBackend: \u5DF2 dispose\uFF0C\u4E0D\u80FD\u7EE7\u7EED draw");
      if (frame.width !== this.width || frame.height !== this.height) {
        this.resize({ width: frame.width, height: frame.height });
      }
      this.clear();
      this.stats.drawCalls = 0;
      this.stats.packets = 0;
      this.stats.uploadedVertices = 0;
      const ss = this.ss;
      const ssW = this.width * ss;
      const ssH = this.height * ss;
      for (const packet of frame.packets) {
        this.stats.packets += 1;
        this.stats.drawCalls += 1;
        this.currentBlend = packet.blend;
        const vertexCount = Math.min(Math.floor(packet.uvs.length / 2), Math.floor(packet.positions.length / 2));
        if (vertexCount <= 0) continue;
        this.stats.uploadedVertices += vertexCount;
        const stride = vertexCount > 0 ? packet.positions.length / vertexCount : 0;
        if (!Number.isFinite(stride) || stride < 2) continue;
        const verts = [];
        for (let i = 0; i < vertexCount; i += 1) {
          const [x, y] = this.toScreen(frame, packet.positions[i * stride], packet.positions[i * stride + 1]);
          const o = i * 4;
          verts.push({
            x: x * ss,
            y: y * ss,
            r: packet.colors[o],
            g: packet.colors[o + 1],
            b: packet.colors[o + 2],
            a: packet.colors[o + 3]
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
  var GL_UNSIGNED_INT = 5125;
  var GL_TRIANGLES = 4;
  var GL_RGBA = 6408;
  var WebGL2Backend = class {
    kind = "webgl2";
    stats = { drawCalls: 0, packets: 0, uploadedVertices: 0 };
    gl;
    buffers = null;
    capacities = /* @__PURE__ */ new Map();
    program;
    width = 1;
    height = 1;
    pixels = new Uint8ClampedArray(4);
    disposed = false;
    constructor(gl, program = {}) {
      if (gl === null || typeof gl !== "object") throw new Error("WebGL2Backend: \u7F3A\u5C11 gl \u4E0A\u4E0B\u6587");
      if (typeof gl.drawElements !== "function") throw new Error("WebGL2Backend: gl.drawElements \u4E0D\u53EF\u7528\uFF0C\u65E0\u6CD5\u63D0\u4EA4\u7ED8\u5236");
      this.gl = gl;
      this.program = program;
      if (typeof gl.createBuffer === "function") {
        this.buffers = {
          positions: gl.createBuffer(),
          uvs: gl.createBuffer(),
          colors: gl.createBuffer(),
          indices: gl.createBuffer()
        };
      }
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
    }
    setAttrib(name, size, type, normalized) {
      const gl = this.gl;
      const loc = gl.getAttribLocation?.(this.program, name);
      if (loc === void 0 || loc < 0 || gl.enableVertexAttribArray === void 0 || gl.vertexAttribPointer === void 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, normalized, 0, 0);
    }
    setViewProjection(vp) {
      const gl = this.gl;
      if (vp === void 0 || gl.getUniformLocation === void 0) return;
      const loc = gl.getUniformLocation(this.program, "viewProjection");
      if (loc === null || loc === void 0) return;
      if (vp.length >= 16 && gl.uniformMatrix4fv !== void 0) {
        gl.uniformMatrix4fv(loc, false, vp);
      } else if (vp.length >= 9 && gl.uniformMatrix3fv !== void 0) {
        gl.uniformMatrix3fv(loc, false, vp.subarray(0, 9));
      }
    }
    draw(frame) {
      if (this.disposed) throw new Error("WebGL2Backend: \u5DF2 dispose\uFF0C\u4E0D\u80FD\u7EE7\u7EED draw");
      if (frame.width !== this.width || frame.height !== this.height) {
        this.resize({ width: frame.width, height: frame.height });
      }
      this.stats.drawCalls = 0;
      this.stats.packets = 0;
      this.stats.uploadedVertices = 0;
      this.gl.useProgram?.(this.program);
      this.setViewProjection(frame.viewProjection);
      for (const packet of frame.packets) {
        const vertexCount = Math.floor(packet.uvs.length / 2);
        const stride = vertexCount > 0 ? packet.positions.length / vertexCount : 2;
        this.upload(GL_ARRAY_BUFFER, this.buffers?.positions, packet.positions);
        this.setAttrib("aPosition", Number.isFinite(stride) ? stride : 2, GL_FLOAT, false);
        this.upload(GL_ARRAY_BUFFER, this.buffers?.uvs, packet.uvs);
        this.setAttrib("aUv", 2, GL_FLOAT, false);
        this.upload(GL_ARRAY_BUFFER, this.buffers?.colors, packet.colors);
        this.setAttrib("aColor", 4, GL_UNSIGNED_BYTE, true);
        this.upload(GL_ELEMENT_ARRAY_BUFFER, this.buffers?.indices, packet.indices);
        this.gl.drawElements?.(GL_TRIANGLES, packet.indices.length, GL_UNSIGNED_INT, 0);
        this.stats.drawCalls += 1;
        this.stats.packets += 1;
        this.stats.uploadedVertices += vertexCount;
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
      this.buffers = null;
      this.capacities.clear();
    }
  };

  // packages/render-engine/src/render/camera.ts
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
  var EPS3 = 1e-6;
  var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  var finite = (v, fallback) => Number.isFinite(v) ? v : fallback;
  function normalize(v) {
    const len = Math.hypot(v[0], v[1], v[2]);
    if (len < EPS3) return [0, 0, 0];
    return [v[0] / len, v[1] / len, v[2] / len];
  }
  function cross(a, b) {
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
    let right = normalize(cross(forward, [0, 1, 0]));
    if (Math.hypot(right[0], right[1], right[2]) < EPS3) right = [1, 0, 0];
    let up = normalize(cross(right, forward));
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
    const orthoHeight = Math.max(EPS3, finite(camera.orthoHeight, EPS3));
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

  // packages/render-engine/src/volume/volume.ts
  var TAU3 = Math.PI * 2;
  var DEG_TO_RAD = Math.PI / 180;

  // packages/render-engine/src/asset/importer.ts
  var DEG = Math.PI / 180;
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

  // packages/render-engine/src/app/app.ts
  var DEFAULT_HEIGHT = 1.7;
  var P = {
    pelvisHeight: 0.53,
    spine: 0.17,
    chest: 0.2,
    neck: 0.06,
    head: 0.15,
    // 2 × headRadius(0.075)
    shoulderWidth: 0.23,
    hipWidth: 0.11,
    upperArm: 0.19,
    lowerArm: 0.16,
    hand: 0.11,
    thigh: 0.24,
    shin: 0.23,
    ankleHeight: 0.04,
    foot: 0.15,
    clavicle: 0.05
  };
  var FINGERS = [
    { name: "thumb", segments: [0.3, 0.25], spread: 0.1 },
    { name: "index", segments: [0.22, 0.16, 0.12], spread: 0.045 },
    { name: "middle", segments: [0.24, 0.18, 0.13], spread: 0.015 },
    { name: "ring", segments: [0.22, 0.17, 0.12], spread: -0.015 },
    { name: "pinky", segments: [0.18, 0.14, 0.1], spread: -0.045 }
  ];
  var SIDES = [
    { tag: "L", sign: -1 },
    { tag: "R", sign: 1 }
  ];
  function humanoidSpec(profile, opts) {
    const height = opts?.height ?? DEFAULT_HEIGHT;
    if (!Number.isFinite(height) || height <= 0) throw new Error("app.height");
    const handLod = profile === "simple2d" ? "none" : opts?.handLod ?? "none";
    const m = {
      pelvisHeight: height * P.pelvisHeight,
      spine: height * P.spine,
      chest: height * P.chest,
      neck: height * P.neck,
      head: height * P.head,
      shoulderHalf: height * P.shoulderWidth * 0.5,
      hipHalf: height * P.hipWidth * 0.5,
      upperArm: height * P.upperArm,
      lowerArm: height * P.lowerArm,
      hand: height * P.hand,
      thigh: height * P.thigh,
      shin: height * P.shin,
      ankleHeight: height * P.ankleHeight,
      foot: height * P.foot,
      clavicle: height * P.clavicle
    };
    const bones = [];
    const add = (name, parent, length, rest, tags) => {
      bones.push({
        name,
        parent,
        length,
        rest: {
          x: rest?.x ?? 0,
          y: rest?.y ?? 0,
          rotation: rest?.rotation ?? 0,
          scaleX: 1,
          scaleY: 1,
          shearX: 0,
          shearY: 0
        },
        ...tags ? { tags } : {}
      });
      return bones.length - 1;
    };
    const root = add("root", -1, 0);
    const pelvis = add("pelvis", root, 0, { y: m.pelvisHeight });
    const spine = add("spine", pelvis, m.spine);
    const chest = add("chest", spine, m.chest);
    const neckId = add("neck", chest, m.neck);
    add("head", neckId, m.head);
    const handIds = [];
    for (const { tag, sign } of SIDES) {
      let armParent = chest;
      let upperX = sign * m.shoulderHalf;
      if (profile === "full2d") {
        armParent = add(`clavicle${tag}`, chest, m.clavicle, { x: sign * m.shoulderHalf });
        upperX = 0;
      }
      const upper = add(`upperArm${tag}`, armParent, m.upperArm, { x: upperX, rotation: sign * 0.06 });
      const lower = add(`lowerArm${tag}`, upper, m.lowerArm, { rotation: sign * 0.05 });
      handIds.push(add(`hand${tag}`, lower, m.hand));
    }
    for (const { tag, sign } of SIDES) {
      const thigh = add(`thigh${tag}`, pelvis, m.thigh, { x: sign * m.hipHalf });
      const shin = add(`shin${tag}`, thigh, m.shin);
      add(`foot${tag}`, shin, m.foot, { y: -m.ankleHeight, rotation: sign * 0.02 });
    }
    if (profile === "full2d" && handLod !== "none") {
      for (let s = 0; s < SIDES.length; s += 1) {
        const { tag, sign } = SIDES[s];
        if (handLod === "simple") {
          add(`index1${tag}`, handIds[s], m.hand * 0.5, { rotation: sign * 0.03 }, ["finger"]);
          continue;
        }
        let parent = handIds[s];
        for (const finger of FINGERS) {
          for (let seg = 0; seg < finger.segments.length; seg += 1) {
            parent = add(
              `${finger.name}${seg + 1}${tag}`,
              parent,
              m.hand * finger.segments[seg],
              { x: sign * finger.spread * m.hand, rotation: sign * 0.03 },
              ["finger"]
            );
          }
        }
      }
    }
    return {
      name: `humanoid-${profile}-${handLod}`,
      profile,
      bones,
      rootMotion: "entity"
    };
  }
  function createHumanoid(profile, opts) {
    return compileSkeleton(humanoidSpec(profile, opts));
  }
  var HEEL_BACK = 0.045;
  var FOOT_LENGTH = 0.15;
  var SOLE_LENGTH = HEEL_BACK + FOOT_LENGTH;
  var SOLE_MID_X = -HEEL_BACK + 0.5 * SOLE_LENGTH;

  // packages/render-engine/src/tools/tools.ts
  var DEFAULT_FIXED_DT = 1 / 60;

  // preview/core2d.ts
  var SLIDER_BONES = ["upperArmR", "lowerArmR", "upperArmL", "thighR", "thighL"];
  var BONE_LABEL = {
    upperArmR: "\u53F3\u4E0A\u81C2",
    lowerArmR: "\u53F3\u524D\u81C2",
    upperArmL: "\u5DE6\u4E0A\u81C2",
    thighR: "\u53F3\u5927\u817F",
    thighL: "\u5DE6\u5927\u817F"
  };
  function colorFor(name) {
    if (name === "root") return { r: 0.93, g: 0.95, b: 1, a: 1 };
    if (name === "head") return { r: 1, g: 0.82, b: 0.45, a: 1 };
    if (name === "neck") return { r: 0.95, g: 0.72, b: 0.42, a: 1 };
    if (name === "pelvis" || name === "spine" || name === "chest") {
      return { r: 0.3, g: 0.7, b: 0.98, a: 1 };
    }
    if (name.startsWith("hand")) {
      return name.endsWith("L") ? { r: 0.42, g: 0.92, b: 0.66, a: 1 } : { r: 1, g: 0.54, b: 0.56, a: 1 };
    }
    if (name.startsWith("upperArm") || name.startsWith("lowerArm")) {
      return name.endsWith("L") ? { r: 0.34, g: 0.84, b: 0.58, a: 1 } : { r: 0.96, g: 0.4, b: 0.44, a: 1 };
    }
    if (name.startsWith("thigh") || name.startsWith("shin") || name.startsWith("foot")) {
      return name.endsWith("L") ? { r: 0.54, g: 0.6, b: 0.98, a: 1 } : { r: 1, g: 0.64, b: 0.3, a: 1 };
    }
    return { r: 0.8, g: 0.8, b: 0.8, a: 1 };
  }
  function widthForBone(name) {
    if (name === "head") return 0.24;
    if (name === "neck") return 0.07;
    if (name === "pelvis" || name === "spine" || name === "chest") return 0.16;
    if (name.startsWith("thigh") || name.startsWith("shin")) return 0.09;
    if (name.startsWith("foot")) return 0.07;
    if (name.startsWith("hand")) return 0.07;
    return 0.06;
  }
  function keys(points) {
    return points.map(([time, value]) => ({ time, value, curve: "easeSine" }));
  }
  function createWalkClip() {
    return {
      name: "walk",
      duration: 1,
      timelines: [
        { kind: "rotate", path: "thighL", keys: keys([[0, 0.45], [0.5, -0.45], [1, 0.45]]) },
        { kind: "rotate", path: "thighR", keys: keys([[0, -0.45], [0.5, 0.45], [1, -0.45]]) },
        { kind: "rotate", path: "shinL", keys: keys([[0, 0], [0.25, 0.38], [0.5, 0.05], [0.75, 0.12], [1, 0]]) },
        { kind: "rotate", path: "shinR", keys: keys([[0, 0.12], [0.25, 0], [0.5, 0.38], [0.75, 0.05], [1, 0.12]]) },
        { kind: "rotate", path: "upperArmL", keys: keys([[0, 0.32], [0.5, -0.32], [1, 0.32]]) },
        { kind: "rotate", path: "upperArmR", keys: keys([[0, -0.32], [0.5, 0.32], [1, -0.32]]) },
        { kind: "translate", path: "pelvis.y", keys: keys([[0, 0], [0.25, 0.025], [0.5, 0], [0.75, 0.025], [1, 0]]) }
      ]
    };
  }
  function createScene(speed2) {
    const skeleton = createHumanoid("simple2d");
    const pose = createPose(skeleton);
    const slots = [];
    const attachments = /* @__PURE__ */ new Map();
    const baseColors = [];
    for (const bone of skeleton.bones) {
      const color = colorFor(bone.name);
      baseColors.push(color);
      slots.push({
        id: bone.name,
        bone: bone.id,
        order: bone.id,
        color,
        blend: "normal",
        attachment: bone.name,
        mask: null,
        zOffset: 0
      });
      attachments.set(bone.name, {
        kind: "region",
        id: bone.name,
        region: { atlasKey: "flat", uvs: null },
        color
      });
    }
    const skins = /* @__PURE__ */ new Map([["default", { id: "default", attachments }]]);
    const slotSet = createSlotSet(slots, skins, "default");
    return { skeleton, pose, slotSet, baseColors, walkTrack: createTrack(createWalkClip(), { speed: speed2 }) };
  }
  function packColor(c) {
    const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
    return (byte(c.a) << 24 | byte(c.r) << 16 | byte(c.g) << 8 | byte(c.b)) >>> 0;
  }
  function setHighlight(scene, boneName) {
    for (let i = 0; i < scene.slotSet.slots.length; i += 1) {
      const base = scene.baseColors[i];
      const color = boneName === scene.slotSet.slots[i].data.id ? { r: 1, g: 1, b: 1, a: 1 } : base;
      setSlotColor(scene.slotSet, i, packColor(color));
    }
  }
  var BASE_ROTATION = {
    spine: Math.PI / 2,
    upperArmL: Math.PI / 2,
    upperArmR: -Math.PI / 2,
    thighL: -Math.PI / 2,
    thighR: -Math.PI / 2,
    footL: Math.PI / 2,
    footR: Math.PI / 2
  };
  var BASE_TRANSLATION = [
    ["upperArmL", 0, 0.1955],
    ["upperArmR", 0, -0.1955]
  ];
  function applyBasePose(scene) {
    for (const [name, delta2] of Object.entries(BASE_ROTATION)) {
      const id = scene.skeleton.boneIdByName.get(name);
      if (id !== void 0) addRotation(scene.pose, id, delta2);
    }
    for (const [name, x, y] of BASE_TRANSLATION) {
      const id = scene.skeleton.boneIdByName.get(name);
      if (id === void 0) continue;
      setLocal(scene.pose, id, CH_X, x);
      setLocal(scene.pose, id, CH_Y, y);
    }
  }
  function addPresetRotation(scene, name, delta2) {
    const id = scene.skeleton.boneIdByName.get(name);
    if (id !== void 0) addRotation(scene.pose, id, delta2);
  }
  function applyPose(scene, kind, offsets, dt) {
    resetToSetup(scene.pose);
    if (kind === "walk") sampleAnimation([scene.walkTrack], scene.pose, scene.slotSet, dt);
    applyBasePose(scene);
    if (kind === "raise") {
      addPresetRotation(scene, "upperArmR", 1.2);
      addPresetRotation(scene, "lowerArmR", 0.3);
      addPresetRotation(scene, "upperArmL", -0.2);
      addPresetRotation(scene, "chest", 0.05);
    }
    for (const name of SLIDER_BONES) {
      const delta2 = offsets[name] ?? 0;
      if (delta2 === 0) continue;
      const id = scene.skeleton.boneIdByName.get(name);
      if (id !== void 0) addRotation(scene.pose, id, delta2);
    }
  }
  function buildFrame(scene, width, height) {
    const { pose, slotSet } = scene;
    updateWorld(pose);
    const camera = {
      ...DEFAULT_CAMERA,
      target: [0, 0.9, 0],
      viewport: { width, height, dpr: 1 },
      orthoHeight: 3
    };
    const viewProjection = viewProjection2D(camera);
    const packets = [];
    for (let slotIndex = 0; slotIndex < slotSet.slots.length; slotIndex += 1) {
      const slot = slotSet.slots[slotIndex];
      const attachment = resolveAttachment(slotSet, slotIndex);
      if (attachment === null || attachment.kind !== "region") continue;
      const boneId = pose.skeleton.boneIdByName.get(slot.data.id);
      if (boneId === void 0 || slot.data.id === "root") continue;
      const bone = pose.skeleton.bones[boneId];
      const world = pose.world.subarray(boneId * 6, boneId * 6 + 6);
      const length = Math.max(bone.length, 0.05);
      const half = widthForBone(bone.name) / 2;
      const corners = [
        [0, -half],
        [length, -half],
        [length, half],
        [0, half]
      ];
      const positions = new Float32Array(8);
      for (let i = 0; i < corners.length; i += 1) {
        const [lx, ly] = corners[i];
        transformAffineInto(positions, i * 2, world, lx, ly);
      }
      const c = slot.color;
      packets.push(buildRegionPacket({
        id: slotIndex,
        positions,
        color: [c.r, c.g, c.b, c.a],
        materialId: 0,
        order: boneId,
        depthKey: 0,
        seq: slotIndex,
        kind: "region",
        blend: "normal",
        pma: false
      }));
    }
    return { packets: sortPackets(packets), width, height, viewProjection };
  }

  // preview/main.ts
  var BG = [24, 28, 38, 255];
  function required(selector) {
    const element = document.querySelector(selector);
    if (element === null) throw new Error(`index.html \u7F3A\u5C11 ${selector}`);
    return element;
  }
  var view = required("#view");
  var runtimeInfo = required("#runtimeInfo");
  var panel = required("#composerControls");
  var resetBtn = required("#reset");
  var errorBox = document.querySelector("#error");
  function showError(err) {
    const text = err instanceof Error ? `${err.message}
${err.stack ?? ""}` : String(err);
    if (errorBox !== null) {
      errorBox.hidden = false;
      errorBox.textContent = `\u9884\u89C8\u8FD0\u884C\u5931\u8D25\uFF1A
${text}`;
    }
    console.error(err);
  }
  window.addEventListener("error", (event) => showError(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => showError(event.reason));
  var params = new URLSearchParams(location.search);
  var mode = params.get("mode") === "webgl" ? "webgl" : "cpu";
  var poseParam = params.get("pose");
  var poseKind = poseParam === "walk" || poseParam === "raise" ? poseParam : "tpose";
  var speedParam = Number(params.get("speed") ?? "1");
  var speed = Number.isFinite(speedParam) ? speedParam : 1;
  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (shader === null) throw new Error("WebGL2: createShader \u5931\u8D25");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? "";
      gl.deleteShader(shader);
      throw new Error(`WebGL2 shader \u7F16\u8BD1\u5931\u8D25\uFF1A${log}`);
    }
    return shader;
  }
  function createProgram(gl) {
    const vs = `#version 300 es
precision highp float;
in vec2 aPosition;
in vec2 aUv;
in vec4 aColor;
uniform mat3 viewProjection;
uniform vec2 uResolution;
out vec4 vColor;
void main() {
  vec3 pixel = viewProjection * vec3(aPosition, 1.0);
  vec2 ndc = vec2(pixel.x / uResolution.x * 2.0 - 1.0,
                  1.0 - pixel.y / uResolution.y * 2.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
  vColor = aColor;
}`;
    const fs = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vColor; }`;
    const program = gl.createProgram();
    if (program === null) throw new Error("WebGL2: createProgram \u5931\u8D25");
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vs);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fs);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? "";
      gl.deleteProgram(program);
      throw new Error(`WebGL2 program \u94FE\u63A5\u5931\u8D25\uFF1A${log}`);
    }
    return program;
  }
  function resizeCanvas() {
    const w = Math.max(1, Math.floor(view.clientWidth));
    const h = Math.max(1, Math.floor(view.clientHeight));
    if (view.width !== w || view.height !== h) {
      view.width = w;
      view.height = h;
    }
  }
  function webglFrame(frame) {
    return {
      ...frame,
      packets: frame.packets.map((packet) => ({
        ...packet,
        indices: packet.indices instanceof Uint32Array ? packet.indices : new Uint32Array(packet.indices)
      }))
    };
  }
  function boot() {
    const scene = createScene(speed);
    const offsets = {};
    const ranges = [];
    for (const name of SLIDER_BONES) {
      const row = document.createElement("div");
      row.className = "joint";
      const label = document.createElement("label");
      label.textContent = BONE_LABEL[name];
      const value = document.createElement("span");
      value.className = "value";
      value.textContent = "0\xB0";
      const range = document.createElement("input");
      range.type = "range";
      range.min = "-180";
      range.max = "180";
      range.step = "1";
      range.value = "0";
      range.setAttribute("aria-label", BONE_LABEL[name]);
      range.addEventListener("input", () => {
        const degrees = Number(range.value);
        offsets[name] = degrees * Math.PI / 180;
        value.textContent = `${degrees}\xB0`;
        setHighlight(scene, name);
      });
      row.append(label, value, range);
      panel.append(row);
      ranges.push(range);
    }
    resetBtn.addEventListener("click", () => {
      for (const name of SLIDER_BONES) offsets[name] = 0;
      for (const range of ranges) {
        range.value = "0";
        const row = range.parentElement;
        const value = row?.querySelector(".value");
        if (value !== null && value !== void 0) value.textContent = "0\xB0";
      }
      scene.walkTrack.time = 0;
      scene.walkTrack.lastTime = 0;
      scene.walkTrack.loopCount = 0;
      setHighlight(scene, null);
      applyPose(scene, poseKind, offsets, 0);
    });
    const ctx2d = mode === "cpu" ? view.getContext("2d", { alpha: false }) : null;
    if (mode === "cpu" && ctx2d === null) throw new Error("\u65E0\u6CD5\u83B7\u53D6 2D \u4E0A\u4E0B\u6587");
    const gl = mode === "webgl" ? view.getContext("webgl2", { alpha: false, antialias: true }) : null;
    if (mode === "webgl" && gl === null) throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668/\u73AF\u5883\u4E0D\u652F\u6301 WebGL2");
    let program = null;
    let resolutionLocation = null;
    if (mode === "webgl" && gl !== null) {
      program = createProgram(gl);
      resolutionLocation = gl.getUniformLocation(program, "uResolution");
      if (resolutionLocation === null) throw new Error("WebGL2: \u627E\u4E0D\u5230 uResolution");
      const vao = gl.createVertexArray();
      if (vao !== null) gl.bindVertexArray(vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    const backend = mode === "webgl" ? new WebGL2Backend(gl, program) : new CpuBackend({ width: 1, height: 1, background: BG });
    let last = 0;
    const tick = (now) => {
      try {
        const dt = last === 0 ? 0 : Math.min(0.05, (now - last) / 1e3);
        last = now;
        resizeCanvas();
        const width = view.width;
        const height = view.height;
        applyPose(scene, poseKind, offsets, dt);
        const frame = buildFrame(scene, width, height);
        if (mode === "cpu" && ctx2d !== null) {
          backend.draw(frame);
          const pixels = new Uint8ClampedArray(backend.readPixels());
          ctx2d.putImageData(new ImageData(pixels, width, height), 0, 0);
        } else if (mode === "webgl" && gl !== null && program !== null) {
          gl.viewport(0, 0, width, height);
          gl.clearColor(BG[0] / 255, BG[1] / 255, BG[2] / 255, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.useProgram(program);
          gl.uniform2f(resolutionLocation, width, height);
          backend.draw(webglFrame(frame));
        }
        runtimeInfo.textContent = `\u540E\u7AEF ${mode} \xB7 \u59FF\u6001 ${poseKind} \xB7 \u901F\u5EA6 ${speed} \xB7 \u9AA8\u9ABC ${scene.skeleton.count} \xB7 packets ${backend.stats.packets} \xB7 drawCalls ${backend.stats.drawCalls}`;
      } catch (err) {
        showError(err);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  try {
    boot();
  } catch (err) {
    showError(err);
  }
})();
