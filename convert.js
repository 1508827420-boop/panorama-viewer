import * as THREE from 'three';

const faces = ['r', 'l', 'u', 'd', 'f', 'b'];
const faceMap = Object.fromEntries(faces.map(f => [f, null])); // { r: Image, l: Image, ... }
const faceEls = Object.fromEntries(faces.map(f => [f, document.querySelector(`.drop-zone[data-face="${f}"]`)]));

let loadedCount = 0;

const statusEl = document.getElementById('status');
const convertBtn = document.getElementById('convert-btn');
const downloadBtn = document.getElementById('download-btn');
const previewImg = document.getElementById('preview-img');
const outCanvas = document.getElementById('out-canvas');

function status(msg) {
  statusEl.textContent = msg;
}

// ── Drag & drop per face ────────────────────────────────────
Object.entries(faceEls).forEach(([face, el]) => {
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadFace(face, file);
  });
  el.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => { if (input.files[0]) loadFace(face, input.files[0]); };
    input.click();
  });
});

function loadFace(face, file) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      faceMap[face] = img;
      loadedCount++;
      const el = faceEls[face];
      el.classList.add('loaded');
      const preview = el.querySelector('img') || document.createElement('img');
      preview.src = img.src;
      if (!el.contains(preview)) el.appendChild(preview);
      updateButtons();
      status(`已加载 ${loadedCount}/6: ${face}.jpg`);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Auto-load from folder ───────────────────────────────────
document.getElementById('auto-load-btn').addEventListener('click', () => {
  document.getElementById('auto-input').click();
});

document.getElementById('auto-input').addEventListener('change', e => {
  const files = [...e.target.files];
  for (const file of files) {
    // Match filename like "r.jpg", "l.jpg", "u.jpg", "d.jpg", "f.jpg", "b.jpg"
    const name = file.name.toLowerCase().replace(/\.(jpg|jpeg|png|webp)$/, '');
    const match = faces.find(f => name === f || name.endsWith(`_${f}`) || name.startsWith(`${f}_`));
    if (match && !faceMap[match]) {
      loadFace(match, file);
    }
  }
  if (loadedCount === 0) {
    status('未识别到对应文件，请确认文件名含 r/l/u/d/f/b');
  }
});

// ── Enable buttons ──────────────────────────────────────────
function updateButtons() {
  convertBtn.disabled = loadedCount !== 6;
}

// ── Conversion: WebGL cubemap → equirectangular ─────────────
convertBtn.addEventListener('click', () => {
  if (loadedCount !== 6) return;
  status('转换中...');

  const outWidth = parseInt(document.getElementById('out-width').value) || 4096;
  const outHeight = Math.floor(outWidth / 2);

  // Offscreen Three.js renderer
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(outWidth, outHeight);
  renderer.setPixelRatio(1);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // Build the shader that converts equirectangular UV → direction → cube face sample
  const uniforms = {};
  for (const face of faces) {
    const img = faceMap[face];
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    uniforms[`u${face.toUpperCase()}`] = { value: tex };
  }

  const vertexShader = /* glsl */ `
    varying vec2 vUv;
    void main() {
      gl_Position = vec4(position.xy, 0.0, 1.0);
      vUv = uv;
    }
  `;

  // Cubemap face sampling: direction → face + UV
  // Standard coordinate system: +X right, -X left, +Y up, -Y down, +Z front, -Z back
  const fragmentShader = /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D uR, uL, uU, uD, uF, uB;
    const float PI = 3.14159265359;

    void main() {
      // UV → spherical coords
      float theta = vUv.x * 2.0 * PI;
      float phi = vUv.y * PI;

      // Spherical → direction vector
      vec3 dir = vec3(
        sin(phi) * cos(theta),  // X
        cos(phi),               // Y
        sin(phi) * sin(theta)   // Z
      );

      vec3 a = abs(dir);
      vec2 uv;
      vec4 color;

      // Determine major axis → face
      if (a.x >= a.y && a.x >= a.z) {
        if (dir.x > 0.0) {
          // +X (right / r)
          uv = vec2(-dir.z, -dir.y) / a.x;
          color = texture2D(uR, uv * 0.5 + 0.5);
        } else {
          // -X (left / l)
          uv = vec2(dir.z, -dir.y) / a.x;
          color = texture2D(uL, uv * 0.5 + 0.5);
        }
      } else if (a.y >= a.x && a.y >= a.z) {
        if (dir.y > 0.0) {
          // +Y — looking up → use d.jpg (ceiling, flip Z for left-right)
          uv = vec2(dir.x, dir.z) / a.y;
          color = texture2D(uD, uv * 0.5 + 0.5);
        } else {
          // -Y — looking down → use u.jpg (floor, flip Z for left-right)
          uv = vec2(dir.x, -dir.z) / a.y;
          color = texture2D(uU, uv * 0.5 + 0.5);
        }
      } else {
        if (dir.z > 0.0) {
          // +Z (front / f) — camera looks toward +Z in OpenGL
          uv = vec2(dir.x, -dir.y) / a.z;
          color = texture2D(uF, uv * 0.5 + 0.5);
        } else {
          // -Z (back / b)
          uv = vec2(-dir.x, -dir.y) / a.z;
          color = texture2D(uB, uv * 0.5 + 0.5);
        }
      }

      gl_FragColor = color;
    }
  `;

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
  });

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(plane);

  // Render to render target
  const renderTarget = new THREE.WebGLRenderTarget(outWidth, outHeight, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });
  renderer.setRenderTarget(renderTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);

  // Read pixels to canvas
  const pixelData = new Uint8Array(outWidth * outHeight * 4);
  renderer.readRenderTargetPixels(renderTarget, 0, 0, outWidth, outHeight, pixelData);

  outCanvas.width = outWidth;
  outCanvas.height = outHeight;
  const ctx = outCanvas.getContext('2d');
  const imageData = ctx.createImageData(outWidth, outHeight);
  imageData.data.set(pixelData);
  // WebGL pixels are bottom-to-top → flip via temp canvas
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = outWidth;
  tempCanvas.height = outHeight;
  tempCanvas.getContext('2d').putImageData(imageData, 0, 0);
  ctx.setTransform(1, 0, 0, -1, 0, outHeight);
  ctx.drawImage(tempCanvas, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Show preview
  previewImg.src = outCanvas.toDataURL('image/png');
  previewImg.classList.add('show');
  downloadBtn.disabled = false;
  renderer.dispose();
  status(`转换完成 — ${outWidth}×${outHeight}px`);
});

// ── Download ────────────────────────────────────────────────
downloadBtn.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'panorama_equirectangular.png';
  link.href = outCanvas.toDataURL('image/png');
  link.click();
  status('下载中...');
});
