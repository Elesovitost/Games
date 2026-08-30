import * as THREE from "./three.js";
import { applySunQuality } from "./sky.js";
import { focusShadowOnView } from "./visibility.js";

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
    hint: "Nižší rozlišení renderu, stíny jen nad hráčem, méně práce mimo obrazovku.",
    pixelRatioMax: 1.25,
    resolutionScale: 0.72,
    antialias: false,
    shadows: true,
    shadowMapSize: 1536,
    shadowType: "basic",
    shadowRadius: 2,
    shadowFrustumHalf: 46,
    shadowFollowView: true,
    decorSnapInterval: 3,
    adaptiveResolution: true,
    cloudCastShadow: false,
    terrainTreeShadows: true
  },
  medium: {
    id: "medium",
    label: "Vyvážená",
    hint: "Doporučeno pro notebooky — stejná grafika, chytřejší stíny a render.",
    pixelRatioMax: 1.5,
    resolutionScale: 0.88,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    shadowType: "basic",
    shadowRadius: 3,
    shadowFrustumHalf: 58,
    shadowFollowView: true,
    decorSnapInterval: 2,
    adaptiveResolution: true,
    cloudCastShadow: false,
    terrainTreeShadows: true
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
    shadowRadius: 4,
    shadowFrustumHalf: 72,
    shadowFollowView: true,
    decorSnapInterval: 1,
    adaptiveResolution: false,
    cloudCastShadow: false,
    terrainTreeShadows: true
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
    if (n <= 1) return true;
    const f = this.game._frame || 0;
    return f % n === 0 || (this.game.terrain?.jobs?.length > 0);
  }

  applyEntityShadows() {
    this.#applySceneShadows();
  }

  apply() {
    this.#applyRenderer();
    this.#applySun();
    this.#applySceneShadows();
    this.#updateShadowFocus();
  }

  tick(dt) {
    this.#trackFps(dt);
    this.#sampleFps(dt);
    this.#updateFpsDisplay();
    this.#updateShadowFocus();
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

  #updateShadowFocus() {
    const q = this.current;
    if (!q.shadowFollowView || !this.game.sun) return;
    focusShadowOnView(this.game, this.game.sun, q.shadowFrustumHalf);
  }

  #applyRenderer() {
    const { renderer } = this.game;
    const q = this.current;
    renderer.setPixelRatio(this.pixelRatio());
    renderer.shadowMap.enabled = q.shadows;
    renderer.shadowMap.type = SHADOW_TYPES[q.shadowType] || THREE.BasicShadowMap;
    if (typeof this.game.resize === "function") this.game.resize();
  }

  #applySun() {
    if (this.game.sun) applySunQuality(this.game.sun, this.current);
  }

  #applySceneShadows() {
    const q = this.current;
    const { terrain, wizards, dragons } = this.game;

    if (terrain?.mesh) {
      terrain.mesh.castShadow = q.shadows;
      terrain.mesh.receiveShadow = q.shadows;
    }
    if (terrain?.trees) {
      terrain.trees.castShadow = q.shadows && q.terrainTreeShadows;
      terrain.trees.receiveShadow = q.shadows;
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
