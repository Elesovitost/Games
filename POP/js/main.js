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
import { castSpell } from "./spells.js";
import { UI } from "./ui.js";
import { Pointer } from "./cursor.js";
import { MultiplayerSession, loadProfile } from "./net/session.js";
import { LobbyUI } from "./net/lobby.js";

class Game {
  constructor() {
    this.canvas = document.getElementById("c");
    this.keys = Object.create(null);
    this.currentSpell = null;
    this.clock = new THREE.Clock();
    this.inputEnabled = true;
    this.wizards = new Map();

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x8ebce6, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x5a8fc8);
    this.scene.fog = new THREE.Fog(0x7aabdb, 55, 195);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.3, 800);

    this.planetGroup = new THREE.Group();
    this.scene.add(this.planetGroup);
    this.scene.add(new THREE.HemisphereLight(0x9ec8f5, 0x6a5030, 0.28));
    this.scene.add(new THREE.AmbientLight(0xffe8c8, 0.09));
    createSun(this.planetGroup);

    this.terrain = new Terrain(this.planetGroup, CONFIG.defaultTerrainSeed);
    this.water = new Water(this.planetGroup, this.terrain);
    this.sky = new Sky(this.planetGroup);
    placeCamera(this.camera);

    this.effects = new Effects(this.planetGroup, this.terrain);
    this.dragons = new Dragons(this);
    this.fireballs = new Fireballs(this);
    this.lava = new LavaPools(this);
    this.ui = new UI(this);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.worldY = new THREE.Vector3(0, 1, 0);
    this.worldX = new THREE.Vector3(1, 0, 0);
    this.pointerUi = new Pointer(this);

    const profile = loadProfile();
    this.#spawnWizards([{ id: "local", name: profile.name, color: profile.color }], "local");

    this.session = new MultiplayerSession(this);
    this.lobby = new LobbyUI(this, this.session);

    this.#bindInput();
    this.#resize();
    window.addEventListener("resize", () => this.#resize());
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
    this.#resetWorld(CONFIG.defaultTerrainSeed);
    this.#spawnWizards([{ id: "local", name: profile.name, color: profile.color }], "local");
    this.ui.toast("Režim 1P");
  }

  beginMatch({ seed, players, localId }) {
    this.#resetWorld(seed);
    this.#spawnWizards(players, localId);
    this.inputEnabled = true;
    this.planetGroup.rotation.set(0, 0, 0);
    this.ui.setSpell(null);
    this.ui.toast("Hra začíná · " + players.length + " hráčů");
  }

  #resetWorld(seed) {
    this.dragons.clear();
    this.fireballs.clear();
    this.lava.clear();
    this.effects.clear();
    this.pointerUi.clearWalkTarget();
    this.terrain.rebuild(seed);
    this.water.refresh();
  }

  #clearWizards() {
    for (const w of this.wizards.values()) w.dispose();
    this.wizards.clear();
    this.wizard = null;
  }

  #spawnWizards(players, localId) {
    this.#clearWizards();
    players.forEach((p, i) => {
      const focusArr = CONFIG.spawnFocus[i % CONFIG.spawnFocus.length];
      const w = new Wizard(this, {
        id: p.id,
        name: p.name,
        color: p.color,
        focus: new THREE.Vector3(...focusArr)
      });
      this.wizards.set(p.id, w);
    });
    this.wizard = this.wizards.get(localId) || this.wizards.values().next().value;
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
      const hit = this.#hitPlanet(e);
      if (!hit) return;
      if (this.currentSpell) {
        if (this.session.requestCast(this.currentSpell, hit.local)) return;
        castSpell(this, this.currentSpell, hit.local);
      } else {
        if (this.session.requestWalk(hit.local)) return;
        const ok = this.wizard.walkTo(hit.local, () => this.ui.toast("Čaroděj umí chodit jen po pevnině."));
        if (ok) this.pointerUi.setWalkTarget(hit.local);
      }
    });
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

  #resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  #tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;
    if (this.inputEnabled) {
      if (this.keys.ArrowLeft) this.planetGroup.rotateOnWorldAxis(this.worldY, CONFIG.rotSpeed * dt);
      if (this.keys.ArrowRight) this.planetGroup.rotateOnWorldAxis(this.worldY, -CONFIG.rotSpeed * dt);
      if (this.keys.ArrowUp) this.planetGroup.rotateOnWorldAxis(this.worldX, CONFIG.rotSpeed * dt);
      if (this.keys.ArrowDown) this.planetGroup.rotateOnWorldAxis(this.worldX, -CONFIG.rotSpeed * dt);
    }

    this.sky.update(dt);
    this.terrain.update(dt);
    this.water.update(dt);
    for (const w of this.wizards.values()) w.update(dt, elapsed);
    this.dragons.update(dt, elapsed);
    this.fireballs.update(dt, elapsed);
    this.lava.update(dt);
    this.effects.update(dt);
    this.ui.update(dt);
    this.pointerUi.update(elapsed);
    this.renderer.render(this.scene, this.camera);
  }
}

new Game().start();
