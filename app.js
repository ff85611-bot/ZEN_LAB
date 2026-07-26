import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const canvas = document.getElementById('bg-canvas');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- 場景 / 環境貼圖 ----------
const scene = new THREE.Scene();
const envMap = new THREE.TextureLoader().load('images/Virtual_Models.png');
envMap.mapping = THREE.EquirectangularReflectionMapping;
scene.background = envMap;
scene.environment = envMap;

// ---------- 攝影機 ----------
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 1, 10000);
camera.position.set(0, 0, 10);

// ---------- 變數初始化（液壓與電磁雜訊） ----------
let mouseX = 0, mouseY = 0;
let targetCamX = 0, targetCamY = 0;
let curCamX = 0, curCamY = 0;
let orbitAngle = 0;

let targetGlitch = 0.0;
let currentGlitch = 0.0;

// 監聽滑鼠移動（液壓鏡頭微調）
window.addEventListener('mousemove', (e) => {
  mouseX = (e.clientX / window.innerWidth) * 2 - 1;       
  mouseY = -(e.clientY / window.innerHeight) * 2 + 1;      
}, { passive: true }); // 優化：加上 passive 減少事件監聽開銷

// 監聽專案鋼板 Hover（瞬間激發並維持電磁撕裂）
const bindGlitchEvents = () => {
  const projectRows = document.querySelectorAll('.matrix-row');
  projectRows.forEach(row => {
    // 改用 pointer 事件，效能更佳
    row.addEventListener('pointerenter', () => {
      targetGlitch = 0.8;  // 修正：設置目標值，讓 hover 時能持續維持電磁雜訊
      currentGlitch = 0.8; // 瞬間激發
    });
    row.addEventListener('pointerleave', () => {
      targetGlitch = 0.0;  // 移開後緩慢衰減到 0
    });
  });
};
// app.js 作為 module 載入時 DOM 已就緒，無需 setTimeout 延遲
bindGlitchEvents(); 

// ---------- 渲染器初始化 ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
} catch (err) {
  console.warn('WebGL 初始化失敗。', err);
}

if (renderer) {
  // 優化：DPR 最大限制在 1.5（對後製濾鏡來說，1.5 與 2.0 肉眼幾乎無異，但能省下高達 40% 的渲染像素）
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

        // 【優化】無分支水平電磁撕裂：利用 step 函數代替 if 判斷
        float glitchTime = floor(uTime * 20.0);
        float sliceY = rand(vec2(glitchTime, 82.3));
        float sliceHeight = 0.05 * uGlitchIntensity;
        
        float isInsideSlice = step(abs(uv.y - sliceY), sliceHeight) * step(0.0001, uGlitchIntensity);
        uv.x += (rand(vec2(uv.y, uTime)) - 0.5) * 0.05 * uGlitchIntensity * isInsideSlice;

        vec4 color = texture2D(tDiffuse, uv);

        // 【優化】無分支雪花雜訊與紅色微光
        float noise = (rand(uv + uTime) - 0.5) * 0.12 * uGlitchIntensity;
        color.rgb += vec3(noise);
        color.r += 0.02 * uGlitchIntensity; 

        // 呼吸光暈效果
        float pulse = (sin(uTime * 1.5) + 1.0) * 0.03;
        color.rgb += pulse;

        // 【超巨大優化】將 CSS 的 filter (saturate(0.4) brightness(0.7)) 直接在 GPU 處理！
        float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        color.rgb = mix(vec3(luma), color.rgb, 0.4); // 飽和度降至 0.4
        color.rgb *= 0.7;                            // 亮度調至 0.7

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

    // 1. 自動極慢環繞
    if (!prefersReducedMotion) {
      orbitAngle += 0.0008;
    }
    const radius = 9;
    const baseCamX = Math.cos(orbitAngle) * radius;
    const baseCamZ = Math.sin(orbitAngle) * radius;

    // 2. 滑鼠重力慣性 (Lerp 0.02)
    const parallaxX = mouseX * 1.5;
    const parallaxY = mouseY * 1.5;

    targetCamX = baseCamX + parallaxX;
    targetCamY = parallaxY;

    curCamX += (targetCamX - curCamX) * 0.02;
    curCamY += (targetCamY - curCamY) * 0.02;

    camera.position.set(curCamX, curCamY, baseCamZ);
    camera.lookAt(0, 0, 0); 

    // 3. 雜訊衰減
    currentGlitch += (targetGlitch - currentGlitch) * 0.1;
    pulsePass.uniforms.uGlitchIntensity.value = prefersReducedMotion ? 0 : currentGlitch;

    pulsePass.uniforms.uTime.value = prefersReducedMotion ? 0 : time;
    composer.render();
  }
  
  animate();
}