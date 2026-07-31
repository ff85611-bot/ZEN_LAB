import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const canvas = document.getElementById('bg-canvas');

// 【修改點】強制關閉系統減弱動態的限制，確保 iOS 就算開了「減少動態效果」，3D 動畫與自轉依然能順利執行
const prefersReducedMotion = false;

// ---------- 場景 / 環境貼圖 ----------
const scene = new THREE.Scene();
const envMap = new THREE.TextureLoader().load('images/Virtual_Models.png');
envMap.mapping = THREE.EquirectangularReflectionMapping;
scene.background = envMap;
scene.environment = envMap;

// ---------- 攝影機 ----------
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 1, 10000);
camera.position.set(0, 0, 10);

// ---------- 變數初始化（液壓與電磁雜訊、360度視角） ----------
let mouseX = 0, mouseY = 0;
let targetCamX = 0, targetCamY = 0;
let curCamX = 0, curCamY = 0;
let orbitAngle = 0;

let targetGlitch = 0.0;
let currentGlitch = 0.0;

// ---------- 跨平台（手機觸控 + 電腦滑鼠）360度拖曳控制 ----------
let isDragging = false;
let previousPointerX = 0;
let previousPointerY = 0;
let cameraPitch = 0; // 上下俯仰角度

// 按下螢幕 / 滑鼠點擊時記錄起始點
window.addEventListener('pointerdown', (e) => {
  // 如果點擊的是按鈕或連結，不觸發 3D 旋轉，確保網頁功能正常
  if (e.target.closest('a') || e.target.closest('button')) return;
  isDragging = true;
  previousPointerX = e.clientX;
  previousPointerY = e.clientY;
});

// 移動時：更新座標 ＋ 計算 360 度旋轉偏移量
window.addEventListener('pointermove', (e) => {
  // 1. 標準化座標（維持原本的視差與雜訊效果計算所需）
  mouseX = (e.clientX / window.innerWidth) * 2 - 1;       
  mouseY = -(e.clientY / window.innerHeight) * 2 + 1;

  // 2. 拖曳進行 360 度旋轉
  if (isDragging) {
    const deltaX = e.clientX - previousPointerX;
    const deltaY = e.clientY - previousPointerY;

    // 水平拖曳改變 360 度角度
    orbitAngle -= deltaX * 0.005; 
    // 上下拖曳改變俯仰角
    cameraPitch += deltaY * 0.003; 

    // 限制上下俯仰角度，避免鏡頭整個翻過去倒立
    cameraPitch = Math.max(-0.8, Math.min(0.8, cameraPitch));

    previousPointerX = e.clientX;
    previousPointerY = e.clientY;
  }
}, { passive: true });

// 放開手指 / 滑鼠時停止拖曳
window.addEventListener('pointerup', () => { isDragging = false; });
window.addEventListener('pointercancel', () => { isDragging = false; });

// ---------- 監聽專案鋼板 Hover（電磁撕裂效果） ----------
const bindGlitchEvents = () => {
  const projectRows = document.querySelectorAll('.matrix-row');
  projectRows.forEach(row => {
    row.addEventListener('pointerenter', () => {
      targetGlitch = 0.8;  
      currentGlitch = 0.8; // 瞬間激發
    });
    row.addEventListener('pointerleave', () => {
      targetGlitch = 0.0;  // 移開後緩慢衰減到 0
    });
  });
};
bindGlitchEvents(); 

// ---------- 渲染器初始化 ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
} catch (err) {
  console.warn('WebGL 初始化失敗。', err);
}

if (renderer) {
  // 優化：DPR 最大限制在 1.5
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  // ---------- 後製：呼吸光暈 ＋ 電磁撕裂 Shader ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const pulsePass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uGlitchIntensity: { value: 0.0 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform float uGlitchIntensity;
      varying vec2 vUv;

      float rand(vec2 co) {
        return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
      }

      void main() {
        vec2 uv = vUv;

        // 水平電磁撕裂
        float glitchTime = floor(uTime * 20.0);
        float sliceY = rand(vec2(glitchTime, 82.3));
        float sliceHeight = 0.05 * uGlitchIntensity;
        
        float isInsideSlice = step(abs(uv.y - sliceY), sliceHeight) * step(0.0001, uGlitchIntensity);
        uv.x += (rand(vec2(uv.y, uTime)) - 0.5) * 0.05 * uGlitchIntensity * isInsideSlice;

        vec4 color = texture2D(tDiffuse, uv);

        // 雪花雜訊與紅色微光
        float noise = (rand(uv + uTime) - 0.5) * 0.12 * uGlitchIntensity;
        color.rgb += vec3(noise);
        color.r += 0.02 * uGlitchIntensity; 

        // 呼吸光暈效果
        float pulse = (sin(uTime * 1.5) + 1.0) * 0.03;
        color.rgb += pulse;

        // 色彩過濾 (Saturate & Brightness)
        float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        color.rgb = mix(vec3(luma), color.rgb, 0.4); // 飽和度 0.4
        color.rgb *= 0.7;                            // 亮度 0.7

        gl_FragColor = vec4(color.rgb, 1.0);
      }
    `
  });
  composer.addPass(pulsePass);

  // 尺寸調整
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------- 智慧睡眠與渲染迴圈 ----------
  let isRunning = true;

  // 當使用者切換分頁時，徹底停用渲染，省電又省效能
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      isRunning = false;
    } else {
      if (!isRunning) {
        isRunning = true;
        animate();
      }
    }
  });

  function animate() {
    if (!isRunning) return;
    requestAnimationFrame(animate);

    const time = performance.now() * 0.001;

    // 1. 自動極慢環繞（沒有在手動拖曳時，繼續保持緩慢自轉）
    if (!prefersReducedMotion && !isDragging) {
      orbitAngle += 0.0005;
    }

    // 2. 結合 360 度水平角 (orbitAngle) 與上下俯仰角 (cameraPitch) 計算 3D 空間位置
    const radius = 9;
    const baseCamX = Math.cos(orbitAngle) * Math.cos(cameraPitch) * radius;
    const baseCamY = Math.sin(cameraPitch) * radius;
    const baseCamZ = Math.sin(orbitAngle) * Math.cos(cameraPitch) * radius;

    // 3. 手指/滑鼠的位置視差微調
    const parallaxX = mouseX * 0.8;
    const parallaxY = mouseY * 0.8;

    targetCamX = baseCamX + parallaxX;
    targetCamY = baseCamY + parallaxY;

    // 使用 Lerp 讓移動有滑順慣性
    curCamX += (targetCamX - curCamX) * 0.05;
    curCamY += (targetCamY - curCamY) * 0.05;

    camera.position.set(curCamX, curCamY, baseCamZ);
    camera.lookAt(0, 0, 0); 

    // 4. 雜訊衰減
    currentGlitch += (targetGlitch - currentGlitch) * 0.1;
    pulsePass.uniforms.uGlitchIntensity.value = prefersReducedMotion ? 0 : currentGlitch;

    pulsePass.uniforms.uTime.value = prefersReducedMotion ? 0 : time;
    composer.render();
  }
  
  animate();
}
