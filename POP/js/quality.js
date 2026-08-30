import * as THREE from "./three.js";
import { applySunQuality } from "./sky.js";

const LS_QUALITY = "populous.quality";

export const QUALITY_PRESETS = {
  low: {
    id: "low",
    label: "Nízká",
    hint: "Pro slabší počítače — méně detailů, bez stínů.",
    icoSubdiv: 5,
    waterSubdiv: 4,
    pixelRatioMax: 1,
    antialias: false,
    shadows: false,
    shadowMapSize: 1024,
    shadowType: "basic",
    shadowRadius: 2,
    cloudCount: 10,
    cloudCastShadow: false,
    terrainTreeShadows: false,
    characterShadows: false,
    decorShadows: false,
    skyDome: [24, 12],
    atmSphere: [24, 14],
    cloudShell: [24, 12],
    proceduralCloudShell: false,
    mistPuffs: 6,
    decorPointLights: false,
    treeOmniLight: false,
    runeRingSegs: 32
  },
  medium: {
    id: "medium",
    label: "Střední",
    hint: "Vyvážená kvalita — doporučeno pro většinu notebooků.",
    icoSubdiv: 6,
    waterSubdiv: 5,
    pixelRatioMax: 1.25,
    antialias: false,
    shadows: true,
    shadowMapSize: 2048,
    shadowType: "basic",
    shadowRadius: 3,
    cloudCount: 22,
    cloudCastShadow: false,
    terrainTreeShadows: false,
    characterShadows: true,
    decorShadows: false,
    skyDome: [32, 18],
    atmSphere: [32, 20],
    cloudShell: [32, 18],
    proceduralCloudShell: true,
    mistPuffs: 10,
    decorPointLights: true,
    treeOmniLight: true,
    runeRingSegs: 48
  },
  high: {
    id: "high",
    label: "Vysoká",
    hint: "Plná kvalita — pro výkonné PC.",
    icoSubdiv: 7,
    waterSubdiv: 6,
    pixelRatioMax: 2,
    antialias: true,
    shadows: true,
    shadowMapSize: 4096,
    shadowType: "pcfsoft",
    shadowRadius: 6,
    cloudCount: 42,
    cloudCastShadow: true,
    terrainTreeShadows: true,
    characterShadows: true,
    decorShadows: true,
    skyDome: [40, 24],
    atmSphere: [48, 32],
    cloudShell: [48, 28],
    proceduralCloudShell: true,
    mistPuffs: 18,
    decorPointLights: true,
    treeOmniLight: true,
    runeRingSegs: 64
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

export class QualityManager {
  constructor(game) {
    this.game = game;
    this.id = loadQualityId();
    this.current = QUALITY_PRESETS[this.id];
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
    this.#syncUI();
  }

  set(id) {
    if (!QUALITY_PRESETS[id] || id === this.id) return;
    this.id = id;
    this.current = QUALITY_PRESETS[id];
    saveQualityId(id);
    this.apply({ rebuildWorld: true });
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

  terrainOpts() {
    const q = this.current;
    return {
      icoSubdiv: q.icoSubdiv,
      treeShadows: q.shadows && q.terrainTreeShadows
    };
  }

  waterOpts() {
    return { waterSubdiv: this.current.waterSubdiv };
  }

  skyOpts() {
    const q = this.current;
    return {
      cloudCount: q.cloudCount,
      cloudCastShadow: q.shadows && q.cloudCastShadow,
      skyDome: q.skyDome,
      atmSphere: q.atmSphere,
      cloudShell: q.cloudShell,
      proceduralCloudShell: q.proceduralCloudShell
    };
  }

  treeOpts() {
    const q = this.current;
    return {
      mistPuffs: q.mistPuffs,
      treeOmniLight: q.treeOmniLight
    };
  }

  decorOpts() {
    const q = this.current;
    return {
      decorPointLights: q.decorPointLights,
      decorShadows: q.shadows && q.decorShadows,
      runeRingSegs: q.runeRingSegs
    };
  }

  pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.current.pixelRatioMax);
  }

  applyEntityShadows() {
    this.#applySceneShadows();
  }

  apply({ rebuildWorld = false } = {}) {
    this.#applyRenderer();
    this.#applySun();
    if (rebuildWorld) this.#rebuildWorld();
    else this.#applySceneShadows();
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

  #rebuildWorld() {
    const game = this.game;
    const mapId = game.mapId;
    game.terrain.rebuild(mapId, this.terrainOpts());
    game.water.rebuild(game.terrain);
    game.sky.rebuild(this.skyOpts());
    game.spawnDecor.rebuild(mapId);
    for (const w of game.wizards.values()) w.place();
    this.#applySceneShadows();
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
        ch.castShadow = q.shadows && q.characterShadows;
        ch.receiveShadow = q.shadows;
      });
    }

    for (const d of dragons.list) {
      d.mesh.traverse((ch) => {
        if (!ch.isMesh) return;
        ch.castShadow = q.shadows && q.characterShadows;
        ch.receiveShadow = q.shadows;
      });
    }
  }
}
