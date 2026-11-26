import { loadCharacter, CharacterRenderer, fitCamera } from '/chongyue-native.js';
import { POSE_CONTROLS } from '/chongyue-pose.js';

const canvas = document.querySelector('#character');
const status = document.querySelector('#status');
const controls = document.querySelector('#controls');
const resetButton = document.querySelector('#reset');
const fitButton = document.querySelector('#fit');
const exportButton = document.querySelector('#export');
const skeletonToggle = document.querySelector('#show-skeleton');
const characterName = '重岳 · 正面站姿';
let character, renderer, camera;
let drawCount = 0;

function fail(error) {
  console.error(error);
  status.textContent = `${characterName}载入或绘制失败：${error.message}`;
  status.hidden = false;
}

// Only input, resize and camera events redraw; there is no playback loop.
function draw() {
  if (!renderer) return;
  try {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    camera ??= fitCamera(renderer.bounds(), width, height);
    renderer.draw(width, height, camera);
    drawCount++;
    return true;
  } catch (error) { fail(error); return false; }
}

function currentBounds() {
  return renderer.bounds();
}

function fit() {
  camera = fitCamera(currentBounds(), canvas.width, canvas.height);
  draw();
}

let exporter;
function capture(width = 1536, height = 2048) {
  exporter ??= new CharacterRenderer(document.createElement('canvas'), character);
  exporter.pose.angles.set(renderer.pose.angles);
  exporter.pose.update();
  exporter.showSkeleton = renderer.showSkeleton;
  exporter.draw(width, height, fitCamera(currentBounds(), width, height));
  return exporter.canvas.toDataURL('image/png');
}

function createControls() {
  const groups = new Map();
  for (const joint of POSE_CONTROLS) {
    if (!renderer.pose.byName.has(joint.bone)) throw new Error(`人物缺少关节：${joint.label}`);
    let section = groups.get(joint.group);
    if (!section) {
      section = document.createElement('section');
      const heading = document.createElement('h3');
      heading.textContent = joint.group;
      section.append(heading); controls.append(section); groups.set(joint.group, section);
    }
    const row = document.createElement('div'); row.className = 'joint';
    const label = document.createElement('label'); label.htmlFor = joint.id; label.textContent = joint.label;
    const slider = document.createElement('input');
    slider.type = 'range'; slider.id = joint.id;
    const range = joint.range;
    slider.min = -range; slider.max = range; slider.step = '1'; slider.value = '0';
    slider.setAttribute('aria-label', `${joint.label}角度`);
    const output = document.createElement('output'); output.htmlFor = joint.id; output.textContent = '0°';
    slider.addEventListener('input', () => {
      renderer.pose.setAngle(joint.bone, Number(slider.value));
      output.textContent = `${slider.value}°`;
      draw();
    });
    row.append(label, slider, output); section.append(row);
  }
}

resetButton.addEventListener('click', () => {
  renderer.pose.reset();
  for (const slider of controls.querySelectorAll('input')) {
    slider.value = '0'; slider.nextElementSibling.textContent = '0°';
  }
  draw();
});
fitButton.addEventListener('click', fit);
skeletonToggle.addEventListener('change', () => {
  if (!renderer) return;
  renderer.showSkeleton = skeletonToggle.checked;
  draw();
});
exportButton.addEventListener('click', () => {
  try {
    const link = document.createElement('a');
    link.download = 'chongyue-front-pose.png'; link.href = capture(); link.click();
  } catch (error) { fail(error); }
});

let dragging = null;
canvas.addEventListener('pointerdown', event => {
  if (!renderer || event.button !== 0) return;
  dragging = { id: event.pointerId, x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!dragging || dragging.id !== event.pointerId) return;
  const ratio = canvas.width / canvas.getBoundingClientRect().width;
  camera.x -= (event.clientX - dragging.x) * ratio / camera.scale;
  camera.y += (event.clientY - dragging.y) * ratio / camera.scale;
  dragging.x = event.clientX; dragging.y = event.clientY;
  draw();
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(event, () => { dragging = null; });
}
canvas.addEventListener('wheel', event => {
  if (!renderer) return;
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const ratio = canvas.width / rect.width;
  const x = (event.clientX - rect.left) * ratio - canvas.width / 2;
  const y = (event.clientY - rect.top) * ratio - canvas.height / 2;
  const previous = camera.scale;
  const baseScale = fitCamera(renderer.bounds(), canvas.width, canvas.height).scale;
  camera.scale = Math.max(baseScale * .2, Math.min(baseScale * 8, previous * Math.exp(-event.deltaY * .001)));
  camera.x += x / previous - x / camera.scale;
  camera.y -= y / previous - y / camera.scale;
  draw();
}, { passive: false });

async function start() {
  character = await loadCharacter();
  renderer = new CharacterRenderer(canvas, character);
  createControls();
  if (!draw()) return;
  status.hidden = true;
  resetButton.disabled = fitButton.disabled = exportButton.disabled = skeletonToggle.disabled = false;
  new ResizeObserver(draw).observe(canvas);
  window.chongyuePreview = { character, renderer, capture, fit,
    get drawCount() { return drawCount; },
    get bounds() { return currentBounds(); },
  };
}
start().catch(fail);
