import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const statusEl = document.getElementById('status-msg');

function status(msg) {
  console.log('[panorama]', msg);
  if (statusEl) statusEl.textContent = msg;
}

// Detect WebGL support
const isWebGLAvailable = (() => {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
})();

if (!isWebGLAvailable) {
  status('当前浏览器不支持 WebGL，请换用 Chrome/Safari 打开');
}

// ── Renderer ────────────────────────────────────────────────
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (e) {
  renderer = new THREE.WebGLRenderer({ antialias: false });
}
status('');

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.style.position = 'fixed';
renderer.domElement.style.top = '0';
renderer.domElement.style.left = '0';
document.body.appendChild(renderer.domElement);

// ── Scene & Camera ──────────────────────────────────────────
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 0, 0);

// ── Sphere with equirectangular mapping ─────────────────────
const sphereGeom = new THREE.SphereGeometry(500, 64, 64);
const sphereMat = new THREE.MeshBasicMaterial({
  side: THREE.BackSide,
  color: 0x1a1a2e,
});
const sphere = new THREE.Mesh(sphereGeom, sphereMat);
scene.add(sphere);

// ── OrbitControls ───────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.minDistance = 1.0;
controls.maxDistance = 3.0;
controls.rotateSpeed = 0.5;
controls.target.set(0, 0, -1);

// ── Animation ───────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
status('');

// ── Resize ──────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Selector-driven panorama loading ───────────────────────
const styleSelect = document.getElementById('style-select');
const roomSelect = document.getElementById('room-select');
const textureLoader = new THREE.TextureLoader();

function loadPanoramaPath(style, room) {
  const url = `panos/${style}/${room}.png`;
  status('加载中: ' + style + ' / ' + room);
  textureLoader.load(
    url,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      sphere.material.map = texture;
      sphere.material.color.set(0xffffff);
      sphere.material.needsUpdate = true;
      status('');
    },
    undefined,
    () => {
      sphere.material.map = null;
      sphere.material.color.set(0x1a1a2e);
      sphere.material.needsUpdate = true;
      status('图片加载失败: ' + style + ' / ' + room);
    }
  );
}

function updatePanorama() {
  const style = styleSelect.value;
  const room = roomSelect.value;
  if (style && room) {
    loadPanoramaPath(style, room);
  }
}

styleSelect.addEventListener('change', updatePanorama);
roomSelect.addEventListener('change', updatePanorama);
