import { Engine } from '/engine/runtime/runtime.js';
import { WebGL2Backend } from '/engine/backend/backend.js';
import { setLocal, updateWorld, CH_ROT, POSE_STRIDE } from '/engine/core/pose.js';
import { loadCharacter } from '/character.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#character'), overlay = $('#overlay'), stage = $('#stage');
const ctx = overlay.getContext('2d');
const skinSelect = $('#skin'), animationSelect = $('#animation'), controls = $('#controls');
const toggles = { bones: $('#show-skeleton'), skin: $('#show-skin'), meshes: $('#show-mesh') };
const camera = { x: 0, y: 0, scale: 1 };
let engine, asset, source, backend, frame, selected = -1, playing = false, raf = 0;
let basePose, offsets, jointRows = [], drawCount = 0, activeBones = new Set();

function fail(error) {
  stop(); console.error(error);
  $('#status').textContent = `载入或绘制失败：${error.message}`; $('#status').hidden = false;
}
function matrix() {
  const s = camera.scale;
  return new Float32Array([s, 0, 0, 0, -s, 0,
    canvas.width / 2 - camera.x * s, canvas.height / 2 + camera.y * s, 1]);
}
function project(x, y) {
  return [canvas.width / 2 + (x - camera.x) * camera.scale,
    canvas.height / 2 - (y - camera.y) * camera.scale];
}
function size() {
  const rect = stage.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = overlay.width = width; canvas.height = overlay.height = height;
  }
}
function fit() {
  size();
  const b = engine.getBounds();
  camera.x = b.x + b.width / 2; camera.y = b.y + b.height / 2;
  camera.scale = Math.min(canvas.width / Math.max(1, b.width), canvas.height / Math.max(1, b.height)) * .76;
  draw();
}
function drawBones() {
  const world = engine.pose.world, ratio = canvas.width / stage.clientWidth;
  for (const bone of asset.skeleton.bones) {
    if (!activeBones.has(bone.id)) continue;
    const i = bone.id * 6, [x, y] = project(world[i + 4], world[i + 5]);
    const [endX, endY] = project(world[i + 4] + world[i] * bone.length,
      world[i + 5] + world[i + 1] * bone.length);
    const dx = endX - x, dy = endY - y, length = Math.hypot(dx, dy);
    ctx.strokeStyle = bone.id === selected ? '#586fef' : '#e58b3e';
    ctx.fillStyle = bone.id === selected ? '#7185f14d' : '#f6b66c33';
    ctx.lineWidth = (bone.id === selected ? 2 : 1.2) * ratio;
    if (length > 1) {
      const width = Math.min(5 * ratio, length * .14), nx = -dy / length * width, ny = dx / length * width;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx * .22 + nx, y + dy * .22 + ny);
      ctx.lineTo(endX, endY); ctx.lineTo(x + dx * .22 - nx, y + dy * .22 - ny); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(x, y, (bone.id === selected ? 4 : 2.5) * ratio, 0, Math.PI * 2);
    ctx.fillStyle = bone.id === selected ? '#586fef' : '#fff4dc'; ctx.fill(); ctx.stroke();
  }
}
function draw() {
  if (!engine) return;
  size();
  frame = engine.render();
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (toggles.meshes.checked) {
    ctx.strokeStyle = '#1ba98a99'; ctx.lineWidth = canvas.width / stage.clientWidth * .7;
    ctx.beginPath();
    for (const line of engine.debugLines({ meshes: true })) {
      ctx.moveTo(...project(line.x1, line.y1)); ctx.lineTo(...project(line.x2, line.y2));
    }
    ctx.stroke();
  }
  if (toggles.bones.checked) drawBones();
  const triangles = frame.packets.reduce((count, packet) => count + packet.indices.length / 3, 0);
  $('#stats').textContent = `${activeBones.size} 骨骼 / ${triangles} 三角形`;
  drawCount++;
}
function stop() {
  playing = false; cancelAnimationFrame(raf); $('#play').textContent = '播放动作';
}
function captureBase() {
  basePose = engine.pose.local.slice(); offsets.fill(0); syncRows();
}
function applyOffsets() {
  for (const bone of asset.skeleton.bones) {
    setLocal(engine.pose, bone.id, CH_ROT, basePose[bone.id * POSE_STRIDE + CH_ROT] + offsets[bone.id] * Math.PI / 180);
  }
  updateWorld(engine.pose);
}
function syncRows() {
  for (const row of jointRows) {
    row.slider.value = row.number.value = String(offsets[row.bone.id]);
  }
}
function selectBone(id, scroll = false) {
  selected = id;
  for (const row of jointRows) {
    row.element.classList.toggle('selected', row.bone.id === id);
    if (scroll && row.bone.id === id) {
      if (row.element.hidden) { $('#search').value = ''; filterRows(); }
      row.element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}
function filterRows() {
  const query = $('#search').value.trim().toLowerCase();
  let count = 0;
  for (const row of jointRows) {
    row.element.hidden = !row.element.textContent.toLowerCase().includes(query);
    if (!row.element.hidden) count++;
  }
  $('#empty').hidden = count !== 0;
}
const labels = { root: '整体', hip: '髋部', hips: '髋部', head: '头部', body: '身体', torso: '躯干', neck: '颈部' };
function createControls() {
  // Skin-specific bones are disabled unless listed by the selected official skin.
  // Include every active bone: zero-length bones can still rotate their children.
  const selectedSkin = source.skins.find(skin => skin.name === skinSelect.value);
  const permitted = new Set(selectedSkin?.bones ?? []);
  activeBones = new Set(asset.skeleton.bones.filter(bone => {
    const raw = source.bones.find(entry => entry.name === bone.name);
    return !raw?.skin || permitted.has(bone.name);
  }).map(bone => bone.id));
  controls.replaceChildren(); jointRows = [];
  for (const bone of asset.skeleton.bones) {
    if (!activeBones.has(bone.id)) continue;
    const element = document.createElement('div'); element.className = 'joint';
    element.dataset.bone = bone.name;
    const top = document.createElement('div'); top.className = 'joint-top';
    const label = document.createElement('label'); label.htmlFor = `joint-${bone.id}`;
    label.textContent = labels[bone.name] ? `${labels[bone.name]} · ${bone.name}` : bone.name;
    const angle = document.createElement('div'); angle.className = 'angle-input';
    const number = document.createElement('input'); number.type = 'number';
    number.min = '-180'; number.max = '180'; number.step = '1'; number.value = '0';
    number.setAttribute('aria-label', `${bone.name}角度数值`); angle.append(number, '°');
    const slider = document.createElement('input'); slider.type = 'range'; slider.id = `joint-${bone.id}`;
    slider.min = '-180'; slider.max = '180'; slider.step = '1'; slider.value = '0';
    slider.setAttribute('aria-label', `${bone.name}角度`);
    const update = input => {
      if (input.value === '' || !Number.isFinite(input.valueAsNumber)) return;
      stop();
      const value = Math.max(-180, Math.min(180, input.valueAsNumber));
      offsets[bone.id] = value; slider.value = number.value = String(value);
      selectBone(bone.id); applyOffsets(); draw();
    };
    slider.addEventListener('input', () => update(slider)); number.addEventListener('input', () => update(number));
    top.append(label, angle); element.append(top, slider);
    const parent = asset.skeleton.bones[bone.parent];
    if (parent) { const hint = document.createElement('small'); hint.textContent = `↳ ${parent.name}`; element.append(hint); }
    element.addEventListener('pointerdown', () => { selectBone(bone.id); draw(); });
    controls.append(element); jointRows.push({ bone, element, slider, number });
  }
  $('#joint-count').textContent = `${jointRows.length} JOINTS`;
  syncRows(); filterRows();
}
function setReference() {
  stop(); engine.load(asset); engine.setSkinByName(skinSelect.value); engine.setupPoseSlots();
  if (animationSelect.value) { engine.play(animationSelect.value); engine.update(0); }
  else updateWorld(engine.pose);
  captureBase(); selected = -1; createControls();
  $('#character-name').textContent = skinSelect.value.toUpperCase(); fit();
  $('#status').hidden = true;
}
function play() {
  if (playing) { stop(); return; }
  if (!animationSelect.value) {
    const first = [...animationSelect.options].find(option => option.value);
    if (!first) return; animationSelect.value = first.value;
  }
  // Start from a clean reference so manual offsets never accumulate into animation.
  setReference(); playing = true; $('#play').textContent = '暂停动作';
  // Use RAF's clock for both timestamps: the first callback can be stamped
  // earlier than performance.now() in the click handler that scheduled it.
  let previous;
  const tick = now => {
    if (!playing) return;
    try {
      const dt = previous === undefined ? 0 : Math.max(0, Math.min((now - previous) / 1000, .05));
      previous = now;
      engine.update(dt);
      captureBase(); draw(); raf = requestAnimationFrame(tick);
    } catch (error) { fail(error); }
  };
  raf = requestAnimationFrame(tick);
}

$('#fit').addEventListener('click', () => { if (engine) fit(); });
$('#reset').addEventListener('click', () => { if (engine) setReference(); });
$('#play').addEventListener('click', play);
$('#search').addEventListener('input', filterRows);
skinSelect.addEventListener('change', setReference); animationSelect.addEventListener('change', setReference);
for (const toggle of Object.values(toggles)) toggle.addEventListener('change', () => { if (engine) draw(); });
let drag;
overlay.addEventListener('pointerdown', event => {
  if (!engine || event.button !== 0) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  overlay.setPointerCapture(event.pointerId);
});
overlay.addEventListener('pointermove', event => {
  if (!drag || drag.id !== event.pointerId) return;
  const ratio = canvas.width / stage.clientWidth;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
  camera.x -= dx * ratio / camera.scale; camera.y += dy * ratio / camera.scale;
  drag.x = event.clientX; drag.y = event.clientY; draw();
});
overlay.addEventListener('pointerup', event => {
  if (!drag || drag.id !== event.pointerId) return;
  if (!drag.moved && toggles.bones.checked) {
    const rect = overlay.getBoundingClientRect(), ratio = canvas.width / rect.width;
    const x = (event.clientX - rect.left) * ratio, y = (event.clientY - rect.top) * ratio;
    let nearest = -1, distance = 16 * ratio;
    for (const bone of asset.skeleton.bones) {
      if (!activeBones.has(bone.id)) continue;
      const i = bone.id * 6, world = engine.pose.world;
      const [bx, by] = project(world[i + 4], world[i + 5]);
      const [ex, ey] = project(world[i + 4] + world[i] * bone.length, world[i + 5] + world[i + 1] * bone.length);
      const dx = ex - bx, dy = ey - by;
      const t = Math.max(0, Math.min(1, ((x - bx) * dx + (y - by) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(x - bx - t * dx, y - by - t * dy);
      if (d < distance) { nearest = bone.id; distance = d; }
    }
    if (nearest >= 0) { selectBone(nearest, true); draw(); }
  }
  drag = null;
});
for (const name of ['pointercancel', 'lostpointercapture']) overlay.addEventListener(name, () => { drag = null; });
overlay.addEventListener('wheel', event => {
  if (!engine) return;
  event.preventDefault();
  const rect = overlay.getBoundingClientRect(), ratio = canvas.width / rect.width;
  const x = (event.clientX - rect.left) * ratio - canvas.width / 2;
  const y = (event.clientY - rect.top) * ratio - canvas.height / 2;
  const before = camera.scale;
  camera.scale = Math.max(.05, Math.min(30, before * Math.exp(-event.deltaY * .001)));
  camera.x += x / before - x / camera.scale; camera.y -= y / before - y / camera.scale; draw();
}, { passive: false });

async function start() {
  ({ asset, source } = await loadCharacter());
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true,
    stencil: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error('浏览器不支持 WebGL2');
  backend = new WebGL2Backend(gl);
  // The adapter supplies a responsive viewport and controls the skin layer only.
  // Geometry and clipping are always evaluated by Engine, including mesh-only mode.
  const adapter = {
    kind: 'webgl2',
    resize: viewport => backend.resize(viewport),
    prepare: assets => backend.prepare(assets),
    draw: input => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      backend.draw({ ...input, width: canvas.width, height: canvas.height, viewProjection: matrix(),
        packets: toggles.skin.checked ? input.packets : [] });
    },
    readPixels: () => backend.readPixels(), dispose: () => backend.dispose(),
  };
  engine = new Engine({ backend: 'webgl2' }, { backendFactory: () => adapter });
  offsets = new Float32Array(asset.skeleton.count);
  for (const name of asset.skins.keys()) {
    if (name === 'default' && asset.skins.size > 1) continue;
    skinSelect.add(new Option(name, name));
  }
  skinSelect.value = 'spineboy';
  animationSelect.add(new Option('初始姿态 / Setup pose', ''));
  for (const name of asset.animations.keys()) animationSelect.add(new Option(name, name));
  setReference();
  for (const element of [skinSelect, animationSelect, $('#play'), $('#reset'), $('#fit')]) element.disabled = false;
  $('#status').hidden = true;
  new ResizeObserver(() => { if (engine) draw(); }).observe(stage);
  window.chibiPreview = { engine, asset, source, camera, toggles,
    get frame() { return frame; }, get playing() { return playing; },
    get offsets() { return offsets; }, get drawCount() { return drawCount; }, draw, fit };
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fail(new Error('WebGL 上下文已丢失，请刷新页面恢复')); });
}
window.addEventListener('pagehide', () => { stop(); engine?.dispose(); });
start().catch(fail);
