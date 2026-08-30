import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { Terrain } from "./terrain.js";
import { Water } from "./water.js";
import { Sky, createSun, placeCamera } from "./sky.js";
import { Effects } from "./effects.js";
import { Wizard } from "./wizard.js";
import { Dragons } from "./dragons.js";
import { Fireballs } from "./fireballs.js";
import { LavaPools } from "./lava.js";
import { castSpell, inSpellRange } from "./spells.js";
import { applyLavaDps, applySpawnRegen, COMBAT } from "./combat.js";
import { UI } from "./ui.js";
import { Pointer } from "./cursor.js";
import { MultiplayerSession, loadProfile } from "./net/session.js";
import { LobbyUI } from "./net/lobby.js";
import { getMap } from "./maps.js";
import { SpawnDecor } from "./spawns.js";
import { QualityManager } from "./quality.js";

class Game {
  constructor() {
    this.canvas = document.getElementById("c");
    this.keys = Object.create(null);
    this.currentSpell = null;
    this.clock = new THREE.Clock();
    this.inputEnabled = true;
    this.wizards = new Map();
    this.mapId = CONFIG.defaultMapId;
    this.camLocked = false;

    this.quality = new QualityManager(this);
    const q = this.quality.current;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: q.antialias,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(this.quality.pixelRatio());
    this.renderer.setClearColor(0x8ebce6, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = q.shadowType === "pcfsoft"
      ? THREE.PCFSoftShadowMap
      : THREE.BasicShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x5a8fc8);
    this.scene.fog = new THREE.Fog(0x7aabdb, 55, 195);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.3, 800);

    this.planetGroup = new THREE.Group();
    this.scene.add(this.planetGroup);
    this.scene.add(new THREE.HemisphereLight(0x9ec8f5, 0x6a5030, 0.28));
    this.scene.add(new THREE.AmbientLight(0xffe8c8, 0.09));
    this.sun = createSun(this.planetGroup, q);

    this.terrain = new Terrain(this.planetGroup, this.mapId);
    this.water = new Water(this.planetGroup, this.terrain);
    this.sky = new Sky(this.planetGroup);
    this.spawnDecor = new SpawnDecor(this);
    this.spawnDecor.rebuild(this.mapId);
    placeCamera(this.camera, getMap(this.mapId).spawnFocus[0]);

    this.effects = new Effects(this.planetGroup, this.terrain);
    this.dragons = new Dragons(this);
    this.fireballs = new Fireballs(this);
    this.lava = new LavaPools(this);
    this.ui = new UI(this);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.camRight = new THREE.Vector3();
    this.camUp = new THREE.Vector3();
    this.pointerUi = new Pointer(this);

    const profile = loadProfile();
    this.#spawnWizards([{ id: "local", name: profile.name, color: profile.color }], "local");

    this.session = new MultiplayerSession(this);
    this.lobby = new LobbyUI(this, this.session);

    this.quality.initUI();
    this.quality.apply();

    this.#bindInput();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  getWizard(id) {
    return this.wizards.get(id) || null;
  }

  onMpRoom(room) {
    this.lobby.render(room);
    this.inputEnabled = !(this.session.isMp && !this.session.playing);
  }

  enterLobby() {
    this.inputEnabled = false;
    this.ui.setSpell(null);
    this.lobby.render(this.session.room);
  }

  enterSolo() {
    this.inputEnabled = true;
    this.lobby.render(null);
    const profile = loadProfile();
    this.#resetWorld(this.mapId ?? CONFIG.defaultMapId);
    this.#spawnWizards([{ id: "local", name: profile.name, color: profile.color }], "local");
    this.ui.toast("Režim 1P");
  }

  beginMatch({ mapId, players, localId }) {
    this.planetGroup.rotation.set(0, 0, 0);
    this.#resetWorld(mapId ?? CONFIG.defaultMapId);
    this.#spawnWizards(players, localId);
    this.inputEnabled = true;
    this.ui.setSpell(null);
    const map = getMap(this.mapId);
    this.ui.toast("Hra začíná · " + map.name + " · " + players.length + " hráčů");
    if (this.session.isHost) {
      requestAnimationFrame(() => this.session.syncAllVitality(true));
    }
  }

  /** Výběr mapy (0–9). Připraveno pro UI. */
  setMap(mapId) {
    this.mapId = getMap(mapId).index;
    if (!this.session.isPlaying) {
      this.#resetWorld(this.mapId);
      const profile = loadProfile();
      const localId = this.wizard?.id || "local";
      const players = this.session.isMp && this.session.room
        ? this.session.room.players
        : [{ id: localId, name: profile.name, color: profile.color }];
      this.#spawnWizards(players, localId);
    }
    return this.mapId;
  }

  #resetWorld(mapId = CONFIG.defaultMapId) {
    this.mapId = getMap(mapId).index;
    this.dragons.clear();
    this.fireballs.clear();
    this.lava.clear();
    this.effects.clear();
    this.pointerUi.clearWalkTarget();
    this.terrain.rebuild(this.mapId);
    this.water.refresh();
    this.spawnDecor.rebuild(this.mapId);
    this.quality?.refreshSceneLights?.();
  }

  #clearWizards() {
    for (const w of this.wizards.values()) w.dispose();
    this.wizards.clear();
    this.wizard = null;
  }

  #spawnWizards(players, localId) {
    this.#clearWizards();
    const map = getMap(this.mapId);
    const focuses = map.spawnFocus;
    const nSlots = focuses.length;
    const list = Array.isArray(players) ? players : [];

    // Náhodné unikátní spawny, pokud je server ještě nepřiřadil.
    const slots = Array.from({ length: nSlots }, (_, i) => i);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = slots[i];
      slots[i] = slots[j];
      slots[j] = t;
    }
    let auto = 0;

    list.forEach((p, i) => {
      const id = String(p.id);
      const slot = Number.isInteger(p.spawn) ? p.spawn % nSlots : slots[auto++ % nSlots];
      const focusArr = focuses[slot];
      const spawnFocus = new THREE.Vector3(focusArr[0], focusArr[1], focusArr[2]).normalize();
      const w = new Wizard(this, {
        id,
        name: p.name,
        color: p.color,
        focus: spawnFocus.clone()
      });
      w.spawnFocus = spawnFocus;
      w.spawnIndex = slot;
      w.hp = COMBAT.maxHp;
      w.lives = COMBAT.maxLives;
      w.state = "alive";
      this.wizards.set(id, w);
    });
    const lid = localId != null ? String(localId) : "";
    this.wizard = this.wizards.get(lid) || null;
    this.ui?.refreshVitality?.();
    if (this.wizard?.spawnFocus) {
      placeCamera(this.camera, this.wizard.spawnFocus);
    } else if (this.wizard) {
      placeCamera(this.camera, this.wizard.dir);
    }
    this.quality?.applyEntityShadows?.();
  }

  start() {
    const loop = () => {
      this.#tick();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  #bindInput() {
    window.addEventListener("keydown", (e) => {
      if (!this.inputEnabled) return;
      if (e.code === "Escape") this.ui.setSpell(null);
      if (e.code.startsWith("Arrow")) {
        this.keys[e.code] = true;
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code.startsWith("Arrow")) {
        this.keys[e.code] = false;
        e.preventDefault();
      }
    });
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.inputEnabled) return;
      if (this.wizard && !this.wizard.canControl) return;
      const hit = this.#hitPlanet(e);
      if (!hit) return;
      if (this.currentSpell) {
        if (!this.wizard || !inSpellRange(this, this.wizard, hit.local, this.currentSpell)) {
          this.ui.toast("Mimo dosah kouzla.");
          return;
        }
        if (this.session.requestCast(this.currentSpell, hit.local)) return;
        castSpell(this, this.currentSpell, hit.local);
      } else {
        if (!this.terrain.isLand(hit.local)) return;
        if (this.session.requestWalk(hit.local)) return;
        if (!this.wizard) return;
        const ok = this.wizard.walkTo(hit.local, () => {});
        if (ok) this.pointerUi.setWalkTarget(hit.local);
      }
    });

    this.canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.inputEnabled || this.camLocked) return;
        const tree = this.spawnDecor.pickTreeAt(e.clientX, e.clientY);
        if (!tree) return;
        e.preventDefault();
        const step = e.deltaY < 0 ? 0.045 : -0.045;
        tree.nudge(step * (e.shiftKey ? 2.2 : 1));
      },
      { passive: false }
    );
  }

  #hitPlanet(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.firstHitOnly = true;
    const hits = this.raycaster.intersectObject(this.terrain.mesh, false);
    this.raycaster.firstHitOnly = false;
    if (!hits.length) return null;
    return {
      world: hits[0].point.clone(),
      local: this.planetGroup.worldToLocal(hits[0].point.clone())
    };
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.quality.pixelRatio());
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  #resize() {
    this.resize();
  }

  #tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;
    if (this.inputEnabled && !this.camLocked) {
      // Screen-right / screen-up (ne camera.up = radiála — ta dělala divný twist)
      this.camRight.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
      this.camUp.setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
      const s = CONFIG.rotSpeed * dt;
      if (this.keys.ArrowLeft) this.planetGroup.rotateOnWorldAxis(this.camUp, s);
      if (this.keys.ArrowRight) this.planetGroup.rotateOnWorldAxis(this.camUp, -s);
      if (this.keys.ArrowUp) this.planetGroup.rotateOnWorldAxis(this.camRight, s);
      if (this.keys.ArrowDown) this.planetGroup.rotateOnWorldAxis(this.camRight, -s);
    }

    if (this.quality.shouldUpdateSky()) this.sky.update(dt);
    this.terrain.update(dt);
    if (this.quality.shouldUpdateWater()) this.water.update(dt);
    for (const w of this.wizards.values()) w.update(dt, elapsed);
    this.dragons.update(dt, elapsed);
    const fxOpts = {
      ...this.quality.effectsOpts(),
      camera: this.camera
    };
    this.fireballs.update(dt, elapsed, fxOpts);
    this.lava.update(dt, fxOpts);
    applyLavaDps(this, dt);
    applySpawnRegen(this, dt);
    this.session.tickVitalitySync(dt);
    this.effects.update(dt, fxOpts);
    this.spawnDecor.update(dt, elapsed);
    this.ui.update(dt);
    this.pointerUi.update(elapsed);
    this.quality.tick(dt);
    const frame = this._frame || 0;
    this.quality.beforeRender(frame);
    this.renderer.render(this.scene, this.camera);
    this._frame = frame + 1;
  }
}

new Game().start();
