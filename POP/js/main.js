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
import { MultiplayerSession } from "./net/session.js";
import { LobbyUI } from "./net/lobby.js";
import { mountGameVersion } from "./game-version.js";

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
    this._shadowDirty = true;
    this._shadowAcc = 0;
    this.wizards = new Map();
    this.inputEnabled = true;

    mountGameVersion(document.getElementById("game-version"));

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.scene.fog = new THREE.Fog(0x283850, 58, 205);
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

    this.landSpawns = resolveLandSpawns(this.terrain, SPAWN_SEEDS);
    this.spawnMarkers = new SpawnMarkers(this.planetGroup, this.terrain, this.landSpawns);

    this.wizard = null;
    this.spells = new SpellSystem(
      this.planetGroup,
      this.terrain,
      null,
      () => [...this.wizards.values()]
    );

    this.session = new MultiplayerSession(this);
    this.lobby = new LobbyUI(this, this.session);

    this.enterSolo();

    this.camRight = new THREE.Vector3();
    this.camUp = new THREE.Vector3();

    this.#applyRendererSize();
    this.#bindInput();
    this.#bindSpells();
    window.addEventListener("resize", () => this.#applyRendererSize());
    this.#hideLoader();
    this.#loop();
  }

  #clearWizards() {
    for (const w of this.wizards.values()) w.dispose();
    this.wizards.clear();
    this.wizard = null;
    this.spells.wizard = null;
  }

  #resetWorld() {
    this.terrain.reset();
    this.spells.resetWorld();
    this.water.refreshShore();
    this._shoreRefreshAt = 0;
    this.spawnMarkers?.refresh();
    this.#markShadowDirty();
  }

  enterSolo() {
    this.inputEnabled = true;
    this.planetGroup.rotation.set(0, 0, 0);
    this.#clearWizards();
    const start = pickRandomSpawn(this.landSpawns);
    const w = new Wizard(this.planetGroup, this.terrain, start, {
      id: "local",
      name: "Ty",
      color: 0x4a2d7a
    });
    this.wizards.set(w.id, w);
    this.wizard = w;
    this.spells.wizard = w;
    this.spells._castOwnerId = w.id;
    placeCamera(this.camera, start);
    this.spawnMarkers?.show();
    this.#markShadowDirty();
    this.#selectSpell(null);
  }

  #markShadowDirty() {
    this._shadowDirty = true;
  }

  beginMatch({ players, localId }) {
    this.inputEnabled = true;
    this.planetGroup.rotation.set(0, 0, 0);
    this.#resetWorld();
    this.#clearWizards();
    this.spawnMarkers?.show();

    const list = Array.isArray(players) ? players : [];
    const me = String(localId);
    for (const p of list) {
      const slot = Number.isInteger(p.spawn) ? p.spawn % this.landSpawns.length : 0;
      const spawn = this.landSpawns[slot];
      const pid = String(p.id);
      const isLocal = pid === me;
      const w = new Wizard(this.planetGroup, this.terrain, spawn, {
        id: pid,
        name: p.name,
        color: p.color,
        remote: !isLocal
      });
      this.wizards.set(pid, w);
      if (isLocal) {
        this.wizard = w;
        this.spells.wizard = w;
        this.spells._castOwnerId = w.id;
        placeCamera(this.camera, spawn);
      }
    }
    if (!this.wizard && list.length) {
      console.warn("[MP] lokální kouzelník nenalezen, localId=", me);
    }
    this.#selectSpell(null);
    this.lobby?.hide();
    this.#markShadowDirty();
  }

  applyRemoteIntent(fromId, intent) {
    if (!intent || !intent.kind) return;
    const w = this.wizards.get(String(fromId));
    if (!w) return;

    if (intent.kind === "pose") {
      w.applyNetPose(intent.dir, intent.facing, intent);
      return;
    }
    if (intent.kind === "walk") {
      const dir = new THREE.Vector3(intent.dir[0], intent.dir[1], intent.dir[2]);
      w.setDestination(dir);
      return;
    }
    if (intent.kind === "cast") {
      const target = new THREE.Vector3(
        intent.target[0],
        intent.target[1],
        intent.target[2]
      );
      this.spells.castAs(w, intent.spell, target);
    }
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
      if (!this.inputEnabled || !this.wizard || this.wizard.isBusy) return;
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
    if (def && this.wizard) this.spells.showRange(id);
    else this.spells.hideRange();
  }

  #bindInput() {
    const track = (code) => code.startsWith("Arrow") || code === "Escape";

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyG" && !e.repeat && this.inputEnabled && this.wizard && !this.wizard.remote) {
        this.wizard.setGodMode(!this.wizard.godMode);
        e.preventDefault();
        return;
      }
      if (e.code === "Escape") {
        this.#selectSpell(null);
        e.preventDefault();
        return;
      }
      if (!this.inputEnabled || !track(e.code)) return;
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
    if (!this.inputEnabled || !this.selectedSpell || !this.wizard || this.wizard.isBusy) return;
    const hit = this.#pickTerrain(e);
    if (hit) this.spells.updateAim(hit);
    else this.spells.aim.hide();
  }

  #onPointerDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest?.("#ui") || e.target.closest?.("#mp-panel")) return;
    if (!this.inputEnabled || !this.wizard || this.wizard.isBusy) return;

    const hit = this.#pickTerrain(e);
    if (!hit) return;

    if (this.selectedSpell) {
      this.#castSpell(this.selectedSpell, hit);
      return;
    }

    if (this.wizard.setDestination(hit)) {
      this.session.sendIntent({
        kind: "walk",
        dir: [this.wizard.targetDir.x, this.wizard.targetDir.y, this.wizard.targetDir.z]
      });
    }
  }

  #castSpell(spellId, localPoint) {
    if (!this.wizard || this.wizard.isBusy) return;
    const def = SPELLS[spellId];
    if (!def) return;

    const dir = tmp.dir.copy(localPoint).normalize();
    if (!this.spells.inRange(spellId, dir)) {
      const hint = document.getElementById("spell-hint");
      if (hint) hint.textContent = "Mimo dosah — klikni uvnitř kruhu.";
      return;
    }

    const target = dir.clone();
    this.session.sendIntent({
      kind: "cast",
      spell: spellId,
      target: [target.x, target.y, target.z]
    });
    this.spells.castAs(this.wizard, spellId, target);
    this.#selectSpell(null);
  }

  #loop() {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    this.camRight.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    this.camUp.setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
    if (this.inputEnabled) {
      const rs = CONFIG.rotSpeed * dt;
      const rsSide = rs * 2;
      if (this.keys.ArrowLeft) {
        this.planetGroup.rotateOnWorldAxis(this.camUp, rsSide);
        this.#markShadowDirty();
      }
      if (this.keys.ArrowRight) {
        this.planetGroup.rotateOnWorldAxis(this.camUp, -rsSide);
        this.#markShadowDirty();
      }
      if (this.keys.ArrowUp) {
        this.planetGroup.rotateOnWorldAxis(this.camRight, rs);
        this.#markShadowDirty();
      }
      if (this.keys.ArrowDown) {
        this.planetGroup.rotateOnWorldAxis(this.camRight, -rs);
        this.#markShadowDirty();
      }
    }

    const morphing = this.terrain.updateMorphs(dt);
    if (this.terrain.consumeMorphDirty()) {
      this._shoreRefreshAt -= dt;
      this.spawnMarkers?.refresh();
      this.#markShadowDirty();
      if (!morphing || this._shoreRefreshAt <= 0) {
        this.water.refreshShore();
        this._shoreRefreshAt = morphing ? 0.45 : 0;
      }
    }

    let anyMoving = false;
    for (const w of this.wizards.values()) {
      w.update(dt, this.keys, this.camRight);
      if (w.moving) anyMoving = true;
    }
    if (anyMoving) this._shadowAcc += dt;
    this.spells.update(dt);
    this.spawnMarkers.update(dt);
    this.water.update(dt);
    this.session.tickPose(dt);

    const viewAxis = getPlanetViewAxis(this.camera, this.planetGroup, tmp.v);
    this.terrain.setViewAxis(viewAxis);
    this.water.setViewAxis(viewAxis);

    updateSunShadow(this.sun, this.planetGroup);
    this.sky.setSunDirection(this.sun);

    const shadowInterval = 0.4;
    if (this._shadowDirty || this._shadowAcc >= shadowInterval) {
      this.sun.shadow.needsUpdate = true;
      this._shadowDirty = false;
      this._shadowAcc = 0;
    } else {
      this.sun.shadow.needsUpdate = false;
    }

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.#loop());
  }
}

new Game();
