import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { Terrain } from "./terrain.js";
import { Water } from "./water.js";
import { Sky, createSun, placeCamera } from "./sky.js";
import { SPAWN_SEEDS, resolveLandSpawns, pickRandomSpawn } from "./maps.js";
import { SpawnMarkers } from "./spawns.js";
import { Wizard } from "./wizard.js";
import { SPELLS, SpellSystem } from "./spells.js";
import { getPlanetViewAxis, configureShadowFrustum, updateSunShadow } from "./visibility.js";
import { tmp } from "./utils.js";

class Game {
  constructor() {
    this.canvas = document.getElementById("c");
    this.keys = Object.create(null);
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._hitLocal = new THREE.Vector3();
    this.selectedSpell = null;
    this._shoreRefreshAt = 0;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x5a8fc8);
    this.scene.fog = new THREE.Fog(0x7aabdb, 55, 195);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.3, 800);

    this.planetGroup = new THREE.Group();
    this.scene.add(this.planetGroup);
    this.scene.add(new THREE.HemisphereLight(0x9ec8f5, 0x6a5030, 0.28));
    this.scene.add(new THREE.AmbientLight(0xffe8c8, 0.09));

    this.sun = createSun(this.planetGroup);
    configureShadowFrustum(this.sun);

    this.terrain = new Terrain(this.planetGroup);
    this.water = new Water(this.planetGroup, this.terrain);
    this.sky = new Sky(this.planetGroup);

    // 4 pevné spawny (tetraedr) — vždy stejné, maximálně od sebe
    this.landSpawns = resolveLandSpawns(this.terrain, SPAWN_SEEDS);
    this.spawnMarkers = new SpawnMarkers(this.planetGroup, this.terrain, this.landSpawns);
    const start = pickRandomSpawn(this.landSpawns);

    this.wizard = new Wizard(this.planetGroup, this.terrain, start);
    this.spells = new SpellSystem(this.planetGroup, this.terrain, this.wizard);

    placeCamera(this.camera, start);

    this.camRight = new THREE.Vector3();
    this.camUp = new THREE.Vector3();

    this.#applyRendererSize();
    this.#bindInput();
    this.#bindSpells();
    window.addEventListener("resize", () => this.#applyRendererSize());
    this.#hideLoader();
    this.#loop();
  }

  #pixelRatio() {
    const base = Math.min(window.devicePixelRatio || 1, CONFIG.pixelRatioMax);
    return Math.max(0.75, base * CONFIG.resolutionScale);
  }

  #applyRendererSize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.#pixelRatio());
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  #hideLoader() {
    const el = document.getElementById("loader");
    if (!el) return;
    el.classList.add("hidden");
    setTimeout(() => el.remove(), 450);
  }

  #bindSpells() {
    const bar = document.getElementById("spells");
    if (!bar) return;
    bar.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-spell]");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.wizard.isBusy) return;
      const id = btn.getAttribute("data-spell");
      if (this.selectedSpell === id) this.#selectSpell(null);
      else this.#selectSpell(id);
    });
  }

  #selectSpell(id) {
    this.selectedSpell = id;
    document.querySelectorAll("#spells .spell").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-spell") === id);
    });
    const hint = document.getElementById("spell-hint");
    const def = id ? SPELLS[id] : null;
    if (hint) {
      hint.textContent = def
        ? def.hint
        : "Vyber kouzlo, nebo klikni na pevninu pro chůzi.";
    }
    if (def) this.spells.showRange(id);
    else this.spells.hideRange();
  }

  #bindInput() {
    const track = (code) =>
      code.startsWith("Arrow") ||
      code === "KeyW" || code === "KeyA" || code === "KeyS" || code === "KeyD" ||
      code === "Escape";

    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape") {
        this.#selectSpell(null);
        e.preventDefault();
        return;
      }
      if (!track(e.code)) return;
      this.keys[e.code] = true;
      e.preventDefault();
    });
    window.addEventListener("keyup", (e) => {
      if (!track(e.code) || e.code === "Escape") return;
      this.keys[e.code] = false;
      e.preventDefault();
    });

    this.canvas.addEventListener("pointerdown", (e) => this.#onPointerDown(e));
    this.canvas.addEventListener("pointermove", (e) => this.#onPointerMove(e));
  }

  #pickTerrain(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.terrain.intersectPick(this.raycaster);
    if (!hits.length) return null;
    this._hitLocal.copy(hits[0].point);
    this.planetGroup.worldToLocal(this._hitLocal);
    return this._hitLocal;
  }

  #onPointerMove(e) {
    if (!this.selectedSpell || this.wizard.isBusy) return;
    const hit = this.#pickTerrain(e);
    if (hit) this.spells.updateAim(hit);
    else this.spells.aim.hide();
  }

  #onPointerDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest?.("#ui")) return;
    if (this.wizard.isBusy) return;

    const hit = this.#pickTerrain(e);
    if (!hit) return;

    if (this.selectedSpell) {
      this.#castSpell(this.selectedSpell, hit);
      return;
    }

    this.wizard.setDestination(hit);
  }

  #castSpell(spellId, localPoint) {
    if (this.wizard.isBusy) return;
    const def = SPELLS[spellId];
    if (!def) return;

    const dir = tmp.dir.copy(localPoint).normalize();
    if (!this.spells.inRange(spellId, dir)) {
      const hint = document.getElementById("spell-hint");
      if (hint) hint.textContent = "Mimo dosah — klikni uvnitř kruhu.";
      return;
    }

    const target = dir.clone();
    const spiral = this.spells.startSpiral(target, spellId);

    if (spellId === "elevate" || spellId === "depress") {
      const sign = spellId === "elevate" ? 1 : -1;
      if (!this.terrain.beginMorph(target, sign)) {
        this.spells.clearSpiral(spiral);
        return;
      }
      this.wizard.startCast(target, def.castTime, () => {
        this.spells.clearSpiral(spiral);
      });
      this.#selectSpell(null);
      return;
    }

    if (spellId === "lightning") {
      this.wizard.startCast(target, def.castTime, () => {
        this.spells.clearSpiral(spiral);
        this.spells.strikeLightning(target);
      });
      this.#selectSpell(null);
      return;
    }

    if (spellId === "fireball") {
      this.wizard.startCast(target, def.castTime, () => {
        this.spells.clearSpiral(spiral);
        this.spells.launchFireball(target);
      });
      this.#selectSpell(null);
      return;
    }

    if (spellId === "iceball") {
      this.wizard.startCast(target, def.castTime, () => {
        this.spells.clearSpiral(spiral);
        this.spells.launchIceball(target);
      });
      this.#selectSpell(null);
    }
  }

  #loop() {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    this.camRight.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    this.camUp.setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
    const rs = CONFIG.rotSpeed * dt;
    const rsSide = rs * 2;
    if (this.keys.ArrowLeft) this.planetGroup.rotateOnWorldAxis(this.camUp, rsSide);
    if (this.keys.ArrowRight) this.planetGroup.rotateOnWorldAxis(this.camUp, -rsSide);
    if (this.keys.ArrowUp) this.planetGroup.rotateOnWorldAxis(this.camRight, rs);
    if (this.keys.ArrowDown) this.planetGroup.rotateOnWorldAxis(this.camRight, -rs);

    const morphing = this.terrain.updateMorphs(dt);
    if (this.terrain.consumeMorphDirty()) {
      this._shoreRefreshAt -= dt;
      if (!morphing || this._shoreRefreshAt <= 0) {
        this.water.refreshShore();
        this._shoreRefreshAt = morphing ? 0.45 : 0;
      }
    }

    this.wizard.update(dt, this.keys, this.camRight);
    this.spells.update(dt);
    this.spawnMarkers.update(dt);
    this.water.update(dt);

    const viewAxis = getPlanetViewAxis(this.camera, this.planetGroup, tmp.v);
    this.terrain.setViewAxis(viewAxis);
    this.water.setViewAxis(viewAxis);

    updateSunShadow(this.sun, this.planetGroup);
    this.sky.setSunDirection(this.sun);
    this.renderer.shadowMap.autoUpdate = true;

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.#loop());
  }
}

new Game();
