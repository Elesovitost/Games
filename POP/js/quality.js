import * as THREE from "./three.js";
import { applySunQuality } from "./sky.js";
import { configureShadowFrustum, updateSunShadow, PLANET_SHADOW_HALF } from "./visibility.js";

const LS_QUALITY = "populous.quality";
const LS_SHOW_FPS = "populous.showFps";

/**
 * Presety nemění vzhled světa — jen strategii výkonu:
 * rozlišení renderu, stínovou mapu nad viditelnou oblastí, méně práce mimo obrazovku.
 */
export const QUALITY_PRESETS = {
  low: {
    id: "low",
    label: "Plynulá",
    hint: "Nižší rozlišení renderu, méně práce mimo obrazovku, stabilní stíny.",
    pixelRatioMax: 1.15,
    resolutionScale: 0.68,
    antialias: false,
    shadows: true,
    shadowMapSize: 1024,
    shadowType: "basic",
    shadowRadius: 2,
    shadowFrustumHalf: PLANET_SHADOW_HALF,
    renderIcoSubdiv: 5,
    terrainChunked: true,
    visibleCapDot: 0.5,
    waterSubdiv: 5,
    decorSnapInterval: 3,
    shadowUpdateInterval: 1,
    skyUpdateInterval: 2,
    waterUpdateInterval: 2,
    adaptiveResolution: true,
    dynamicPointLights: false
  },
  medium: {
    id: "medium",
    label: "Vyvážená",
    hint: "Doporučeno pro MacBook — stejný svět, chytřejší render mimo záběr.",
    pixelRatioMax: 1.0,
    resolutionScale: 0.75,
    antialias: false,
    shadows: true,
    shadowMapSize: 1024,
    shadowType: "basic",
    shadowRadius: 2,
    shadowFrustumHalf: PLANET_SHADOW_HALF,
    renderIcoSubdiv: 6,
    terrainChunked: true,
    visibleCapDot: 0.5,
    waterSubdiv: 5,
    decorSnapInterval: 2,
    shadowUpdateInterval: 1,
    skyUpdateInterval: 1,
    waterUpdateInterval: 1,
    adaptiveResolution: true,
    dynamicPointLights: false
  },
  high: {
    id: "high",
    label: "Krásná",
    hint: "Plné rozlišení a jemnější stíny — pro výkonné PC.",
    pixelRatioMax: 2,
    resolutionScale: 1,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    shadowType: "pcfsoft",
    shadowRadius: 3,
    shadowFrustumHalf: PLANET_SHADOW_HALF,
    renderIcoSubdiv: 7,
    terrainChunked: false,
    visibleCapDot: null,
    waterSubdiv: 6,
    decorSnapInterval: 1,
    shadowUpdateInterval: 1,
    skyUpdateInterval: 1,
    waterUpdateInterval: 1,
    adaptiveResolution: false,
    dynamicPointLights: true
  }
};

const SHADOW_TYPES = {
  basic: THREE.BasicShadowMap,
  pcf: THREE.PCFShadowMap,
  pcfsoft: THREE.PCFSoftShadowMap
};

export function detectDefaultQualityId() {
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  const dpr = window.devicePixelRatio || 1;
  if (mem <= 4 || (cores <= 4 && dpr >= 2)) return "low";
  if (mem <= 8 || cores <= 8) return "medium";
  return "high";
}

export function loadQualityId() {
  const saved = localStorage.getItem(LS_QUALITY);
  if (saved && QUALITY_PRESETS[saved]) return saved;
  return detectDefaultQualityId();
}

export function saveQualityId(id) {
  localStorage.setItem(LS_QUALITY, id);
}

export function loadShowFps() {
  return localStorage.getItem(LS_SHOW_FPS) === "1";
}

export function saveShowFps(on) {
  localStorage.setItem(LS_SHOW_FPS, on ? "1" : "0");
}

export class QualityManager {
  constructor(game) {
    this.game = game;
    this.id = loadQualityId();
    this.current = QUALITY_PRESETS[this.id];
    this.dynamicScale = 1;
    this.fpsAccum = 0;
    this.fpsFrames = 0;
    this.avgFps = 60;
    this.displayFps = 0;
    this.showFps = loadShowFps();
    this._fpsText = "";
  }

  get currentId() {
    return this.id;
  }

  initUI() {
    document.querySelectorAll("[data-quality]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.quality;
        if (id && QUALITY_PRESETS[id]) this.set(id);
      });
    });
    this.fpsToggleBtn = document.getElementById("fps-toggle");
    this.fpsValueEl = document.getElementById("fps-value");
    if (this.fpsToggleBtn) {
      this.fpsToggleBtn.addEventListener("click", () => {
        this.showFps = !this.showFps;
        saveShowFps(this.showFps);
        this.#syncFpsUI();
      });
    }
    this.#syncUI();
    this.#syncFpsUI();
  }

  set(id) {
    if (!QUALITY_PRESETS[id] || id === this.id) return;
    this.id = id;
    this.current = QUALITY_PRESETS[id];
    this.dynamicScale = 1;
    saveQualityId(id);
    this.apply();
    this.#syncUI();
    this.game.ui?.toast?.("Grafika: " + this.current.label);
  }

  #syncUI() {
    document.querySelectorAll("[data-quality]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.quality === this.id);
    });
    const hint = document.getElementById("quality-hint");
    if (hint) hint.textContent = this.current.hint || "";
  }

  #syncFpsUI() {
    if (this.fpsToggleBtn) {
      this.fpsToggleBtn.classList.toggle("active", this.showFps);
      this.fpsToggleBtn.setAttribute("aria-pressed", this.showFps ? "true" : "false");
    }
    if (!this.fpsValueEl) return;
    this.fpsValueEl.classList.toggle("hidden", !this.showFps);
    this.fpsValueEl.setAttribute("aria-hidden", this.showFps ? "false" : "true");
    if (!this.showFps) {
      this._fpsText = "";
      return;
    }
    const text = this.displayFps > 0 ? Math.round(this.displayFps) + " FPS" : "—";
    this.fpsValueEl.textContent = text;
    this._fpsText = text;
  }

  pixelRatio() {
    const q = this.current;
    const base = Math.min(window.devicePixelRatio || 1, q.pixelRatioMax);
    const scale = (q.resolutionScale ?? 1) * (q.adaptiveResolution ? this.dynamicScale : 1);
    return Math.max(0.55, base * scale);
  }

  shouldSnapDecor() {
    const n = this.current.decorSnapInterval || 1;
    const f = this.game._frame || 0;
    const morphing = this.game.terrain?.jobs?.length > 0;
    if (morphing) return f % Math.max(n, 4) === 0;
    return f % n === 0;
  }

  shouldUpdateSky() {
    const n = this.current.skyUpdateInterval || 1;
    return (this.game._frame || 0) % n === 0;
  }

  shouldUpdateWater() {
    const n = this.current.waterUpdateInterval || 1;
    return (this.game._frame || 0) % n === 0;
  }

  effectsOpts() {
    return { skipOffscreen: false };
  }

  beforeRender() {
    const { renderer, sun, planetGroup, sky } = this.game;
    if (!sun) return;
    sun.visible = true;
    updateSunShadow(sun, planetGroup);
    sky?.setSunDirection?.(sun);
    if (!this.current.shadows) return;
    renderer.shadowMap.autoUpdate = true;
    renderer.shadowMap.needsUpdate = true;
    sun.shadow.needsUpdate = true;
  }

  applyEntityShadows() {
    this.#applySceneShadows();
  }

  refreshSceneLights() {
    this.#applyDynamicLights();
    this.#applySceneShadows();
  }

  apply() {
    this.#applyRenderer();
    this.#applySun();
    this.game.terrain?.applyQuality?.(this.current);
    this.game.water?.applyQuality?.(this.current);
    this.#applySceneShadows();
    this.#applyDynamicLights();
  }

  tick(dt) {
    this.#trackFps(dt);
    this.#sampleFps(dt);
    this.#updateFpsDisplay();
  }

  #trackFps(dt) {
    if (dt <= 0) return;
    const instant = 1 / dt;
    this.displayFps = this.displayFps > 0 ? this.displayFps * 0.88 + instant * 0.12 : instant;
  }

  #updateFpsDisplay() {
    if (!this.showFps || !this.fpsValueEl) return;
    const text = Math.round(this.displayFps) + " FPS";
    if (text === this._fpsText) return;
    this._fpsText = text;
    this.fpsValueEl.textContent = text;
  }

  #sampleFps(dt) {
    if (!this.current.adaptiveResolution) return;
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum < 1.2) return;
    this.avgFps = this.fpsFrames / this.fpsAccum;
    this.fpsAccum = 0;
    this.fpsFrames = 0;

    let next = this.dynamicScale;
    if (this.avgFps < 24) next = Math.max(0.68, this.dynamicScale - 0.06);
    else if (this.avgFps < 32) next = Math.max(0.78, this.dynamicScale - 0.03);
    else if (this.avgFps > 52) next = Math.min(1, this.dynamicScale + 0.04);

    if (Math.abs(next - this.dynamicScale) > 0.01) {
      this.dynamicScale = next;
      this.#applyRenderer();
    }
  }

  #applySun() {
    if (!this.game.sun) return;
    applySunQuality(this.game.sun, this.current);
    configureShadowFrustum(this.game.sun, this.current.shadowFrustumHalf);
  }

  #applyRenderer() {
    const { renderer } = this.game;
    const q = this.current;
    renderer.setPixelRatio(this.pixelRatio());
    renderer.shadowMap.enabled = q.shadows;
    renderer.shadowMap.type = SHADOW_TYPES[q.shadowType] || THREE.BasicShadowMap;
    if (q.shadows) renderer.shadowMap.needsUpdate = true;
    if (typeof this.game.resize === "function") this.game.resize();
  }

  #applyDynamicLights() {
    const on = this.current.dynamicPointLights !== false;
    this.game.spawnDecor?.applyDynamicLights?.(on);
  }

  #applySceneShadows() {
    const q = this.current;
    const { terrain, wizards, dragons, water } = this.game;

    if (terrain?.renderChunks) {
      for (const c of terrain.renderChunks) {
        c.mesh.castShadow = q.shadows;
        c.mesh.receiveShadow = q.shadows;
        c.mesh.frustumCulled = false;
      }
    } else if (terrain?.mesh) {
      terrain.mesh.castShadow = q.shadows;
      terrain.mesh.receiveShadow = q.shadows;
    }
    if (water?.mesh) {
      water.mesh.castShadow = false;
      water.mesh.receiveShadow = q.shadows;
    }

    for (const w of wizards.values()) {
      w.mesh.traverse((ch) => {
        if (!ch.isMesh) return;
        ch.castShadow = q.shadows;
        ch.receiveShadow = q.shadows;
      });
    }

    for (const d of dragons.list) {
      d.mesh.traverse((ch) => {
        if (!ch.isMesh) return;
        ch.castShadow = q.shadows;
        ch.receiveShadow = q.shadows;
      });
    }
  }
}
