import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { Terrain } from "./terrain.js";
import { Water } from "./water.js";
import { Sky, createSun, placeCamera } from "./sky.js";
import { SPAWN_SEEDS, resolveLandSpawns, pickRandomSpawn } from "./maps.js";
import { SpawnMarkers } from "./spawns.js";
import { Trees } from "./trees.js";
import { CritterHerd } from "./critter.js";
import { WaterLife } from "./water-life.js";
import { LongneckHerd } from "./longneck.js";
import { Blockers } from "./blockers.js";
import { Wizard } from "./wizard.js";
import { SPELLS, SpellSystem } from "./spells.js";
import { burstImmortalShell } from "./spells/immortality.js";
import { pumpFireQueue } from "./burn.js";
import { getPlanetViewAxis, configureShadowFrustum, updateSunShadow } from "./visibility.js";
import { tmp } from "./utils.js";
import { assignTreeTrance } from "./animalsAI.js";
import { MultiplayerSession } from "./net/session.js";
import { LobbyUI } from "./net/lobby.js";
import { createIntentRouter, createGameIntentHandlers } from "./net/intents.js";
import { mountGameVersion } from "./game-version.js";
import { GameAudio } from "./audio.js";
import { WIZARD_COLORS, loadProfile, saveProfile, loadMusicEnabled, saveMusicEnabled } from "./net/client.js";

class Game {
  constructor() {
    this.canvas = document.getElementById("c");
    this.keys = Object.create(null);
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._hitLocal = new THREE.Vector3();
    this._listenerDir = new THREE.Vector3();
    this.selectedSpell = null;
    this._pendingCast = null;
    this._shoreRefreshAt = 0;
    this._spawnCamIdx = 0;
    this.wizards = new Map();
    this.inputEnabled = true;
    this._orbitDrag = false;
    this._orbitPointerId = null;
    this._lastOrbitX = 0;
    this._lastOrbitY = 0;
    this._camFocus = CONFIG.focusDir.slice();
    this._camZoom = 1;
    this._camRecenterT = -1;
    this._camRecenterDur = 0.45;
    this._camRecenterFrom = new THREE.Quaternion();
    this._camRecenterTo = new THREE.Quaternion();
    this._camRecenterQ = new THREE.Quaternion();

    mountGameVersion(document.getElementById("game-version"));

    this.audio = new GameAudio();
    this.audio.setMusicEnabled(loadMusicEnabled());
    void this.audio.preload();
    const unlockAudio = () => {
      void this.audio.unlock();
    };
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    this._wizardColorIdx = this.#colorIndexFor(loadProfile().color);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.scene.fog = new THREE.Fog(0x283850, 58, 205);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.3, 800);

    this.planetGroup = new THREE.Group();
    this.scene.add(this.planetGroup);
    this.scene.add(new THREE.HemisphereLight(0x9ec8f5, 0x6a5030, 0.28));
    this.scene.add(new THREE.AmbientLight(0xffe8c8, 0.09));

    this.terrain = new Terrain(this.planetGroup);
    this.water = new Water(this.planetGroup, this.terrain);
    this.sky = new Sky(this.planetGroup);
    this.sun = createSun(this.planetGroup);
    configureShadowFrustum(this.sun);

    this.landSpawns = resolveLandSpawns(this.terrain, SPAWN_SEEDS);
    this.spawnMarkers = new SpawnMarkers(this.planetGroup, this.terrain, this.landSpawns);
    this.trees = new Trees(this.planetGroup, this.terrain);
    this.critters = new CritterHerd(this.planetGroup, this.terrain);
    this.waterLife = new WaterLife(this.planetGroup, this.terrain);
    this.longnecks = new LongneckHerd(this.planetGroup, this.terrain);
    this.longnecks.trees = this.trees;

    this.blockers = new Blockers();
    this.blockers.trees = this.trees;
    this.blockers.critters = this.critters;
    this.blockers.longnecks = this.longnecks;
    this.critters.blockers = this.blockers;
    this.longnecks.blockers = this.blockers;
    /** Po napojení blockerů znovu rozmísti zvířata mimo kmeny. */
    this.critters.spawn();
    this.longnecks.spawn();

    this.wizard = null;
    this.spells = new SpellSystem(
      this.planetGroup,
      this.terrain,
      null,
      () => [...this.wizards.values()]
    );
    this.spells.critters = this.critters;
    this.spells.trees = this.trees;
    this.spells.longnecks = this.longnecks;
    this.critters.fx = this.spells;
    this.longnecks.fx = this.spells;
    this.waterLife.fx = this.spells;
    this.spells.audio = this.audio;
    this.spells.camera = this.camera;
    this.spells.getListenerDir = (out = this._listenerDir) =>
      getPlanetViewAxis(this.camera, this.planetGroup, out);

    this.session = new MultiplayerSession(this);
    this.lobby = new LobbyUI(this, this.session);
    this.#applyRemoteIntent = createIntentRouter(createGameIntentHandlers(this));
    this.critters.onDied = (c) => {
      this.session.sendIntent({
        kind: "beast",
        id: c.id,
        dir: [c.dir.x, c.dir.y, c.dir.z],
        from: c.knockFrom ? [c.knockFrom.x, c.knockFrom.y, c.knockFrom.z] : null
      });
    };

    this.enterSolo();

    this.camRight = new THREE.Vector3();
    this.camUp = new THREE.Vector3();

    this.#applyRendererSize();
    this.#bindInput();
    this.#bindSpells();
    this.#bindGameBar();
    this.#updateColorSwatch();
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
    this.trees?.clearBurns();
    this.trees?.refresh();
    this.critters?.spawn();
    this.waterLife?.spawn();
    this.longnecks?.spawn();
  }

  #wireWizardAudio(w) {
    if (!w) return;
    const listener = () => this.spells.getListenerDir(this._listenerDir);
    w.onBodyFall = () => this.audio?.playAt("bodyfall", w.dir, listener());
    w.onScream = () => this.audio?.playRandomScream(w.dir, listener());
    w.onImmortalPop = (wiz) => burstImmortalShell(this.spells, wiz);
  }

  /** Kroky slyší jen vlastní kouzelník; hlasitost podle vzdálenosti kamery. */
  #wireLocalFootsteps(w) {
    if (!w || w.remote) return;
    const listener = () => this.spells.getListenerDir(this._listenerDir);
    w.onFootstep = ({ inWater, speed, walkBlend }) =>
      this.audio?.playFootstep({
        inWater,
        speed,
        walkBlend,
        sourceDir: w.dir,
        listenerDir: listener()
      });
  }

  #wireWizardNet(w) {
    if (!w || w.remote) return;
    w.onKnockdown = (kd) => {
      this.session.sendIntent({
        kind: "knock",
        amt: kd.amount,
        from: [kd.fromDir.x, kd.fromDir.y, kd.fromDir.z],
        seq: kd.seq,
        hp: w.hp,
        rotations: kd.rotations ?? null,
        rollDistance: kd.rollDist ?? null,
        away: !!kd.away
      });
    };
    w.onCastAudioStop = () => this.audio?.stopCastBackground(w.id);
  }

  enterSolo() {
    this.inputEnabled = true;
    this.#stopCamRecenter();
    this.planetGroup.rotation.set(0, 0, 0);
    this.#clearWizards();
    const start = pickRandomSpawn(this.landSpawns);
    const profile = loadProfile();
    const w = new Wizard(this.planetGroup, this.terrain, start, {
      id: "local",
      name: "Ty",
      color: profile.color,
      blockers: this.blockers
    });
    this.wizards.set(w.id, w);
    this.wizard = w;
    this.spells.wizard = w;
    this.spells._castOwnerId = w.id;
    this.#wireWizardAudio(w);
    this.#wireLocalFootsteps(w);
    this.#wireWizardNet(w);
    this.#setCameraFocus(start, true);
    this.spawnMarkers?.show();
    this.critters?.spawn();
    this.longnecks?.spawn();
    this.#selectSpell(null);
  }

  beginMatch({ players, localId }) {
    this.inputEnabled = true;
    this.#stopCamRecenter();
    this.planetGroup.rotation.set(0, 0, 0);
    this.#resetWorld();
    this.#clearWizards();
    this.spawnMarkers?.show();

    const list = Array.isArray(players) ? players : [];
    const me = String(localId);
    const nSpawns = Math.max(1, this.landSpawns.length);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const raw = Number(p.spawn);
      const slot =
        Number.isInteger(raw) && raw >= 0
          ? raw % nSpawns
          : i % nSpawns;
      const spawn = this.landSpawns[slot];
      const pid = String(p.id);
      const isLocal = pid === me;
      const w = new Wizard(this.planetGroup, this.terrain, spawn, {
        id: pid,
        name: p.name,
        color: p.color,
        remote: !isLocal,
        blockers: this.blockers
      });
      this.wizards.set(pid, w);
      this.#wireWizardAudio(w);
      if (isLocal) {
        this.wizard = w;
        this.spells.wizard = w;
        this.spells._castOwnerId = w.id;
        this.#wireLocalFootsteps(w);
        this.#wireWizardNet(w);
        this.#setCameraFocus(spawn, true);
      }
    }
    if (!this.wizard && list.length) {
      console.warn("[MP] lokální kouzelník nenalezen, localId=", me);
    }
    this.#selectSpell(null);
    this.lobby?.hide();
    document.getElementById("btn-1p")?.classList.add("active");
    document.getElementById("btn-mp")?.classList.remove("active");
  }

  applyRemoteIntent(fromId, intent) {
    this.#applyRemoteIntent(fromId, intent, this);
  }

  #applyRemoteIntent;

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
    const bar = document.getElementById("spell-bar");
    if (!bar) return;
    bar.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-spell]");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (!this.inputEnabled || !this.wizard || this.wizard.isBusy || this.wizard.immortal) return;
      const id = btn.getAttribute("data-spell");
      const def = SPELLS[id];
      if (def?.selfCast) {
        this.#castSelfSpell(id);
        return;
      }
      if (this.selectedSpell === id) this.#selectSpell(null);
      else this.#selectSpell(id);
    });
  }

  /** Kouzlo bez cíle — cast rovnou na sebe. */
  #castSelfSpell(spellId) {
    if (!this.wizard || this.wizard.isBusy || this.wizard.immortal) return;
    const def = SPELLS[spellId];
    if (!def?.selfCast) return;
    const target = this.wizard.dir.clone();
    this.session.sendIntent({
      kind: "cast",
      spell: spellId,
      target: [target.x, target.y, target.z]
    });
    this.spells.castAs(this.wizard, spellId, target);
    this.#selectSpell(null);
  }

  #selectSpell(id) {
    const keepPending = id && this._pendingCast && this._pendingCast.spellId === id;
    if (!keepPending && this._pendingCast) {
      this.wizard?.clearDestination();
      this._pendingCast = null;
    }
    if (!id) this._pendingCast = null;
    this.selectedSpell = id;
    document.querySelectorAll("#spell-bar .spell").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-spell") === id);
    });
    if (id && this.wizard) this.spells.showRange(id);
    else this.spells.hideRange();
  }

  #colorIndexFor(hex) {
    const i = WIZARD_COLORS.findIndex((c) => c.hex === Number(hex));
    return i >= 0 ? i : 0;
  }

  #updateColorSwatch() {
    const dot = document.getElementById("color-swatch");
    if (!dot) return;
    const hex = WIZARD_COLORS[this._wizardColorIdx]?.hex ?? loadProfile().color;
    dot.style.background = "#" + Number(hex).toString(16).padStart(6, "0");
  }

  #cycleWizardColor() {
    this._wizardColorIdx = (this._wizardColorIdx + 1) % WIZARD_COLORS.length;
    const hex = WIZARD_COLORS[this._wizardColorIdx].hex;
    saveProfile({ color: hex });
    this.lobby.selectedColor = hex;
    if (this.wizard && !this.wizard.remote) this.wizard.setRobeColor(hex);
    this.#updateColorSwatch();
  }

  #bindGameBar() {
    const btn1p = document.getElementById("btn-1p");
    const btnMp = document.getElementById("btn-mp");
    const btnMusic = document.getElementById("btn-music");

    btn1p?.addEventListener("click", () => {
      btn1p.classList.add("active");
      btnMp?.classList.remove("active");
      this.lobby.hide();
      if (this.session.isMp) this.session.leave();
      this.enterSolo();
    });

    btnMp?.addEventListener("click", () => {
      btnMp.classList.add("active");
      btn1p?.classList.remove("active");
      this.lobby.show();
      this.lobby.refreshProfile();
    });

    const syncMusicBtn = () => {
      const on = this.audio.isMusicEnabled();
      btnMusic?.classList.toggle("off", !on);
      btnMusic?.setAttribute("aria-pressed", on ? "true" : "false");
    };
    syncMusicBtn();

    btnMusic?.addEventListener("click", () => {
      const on = !this.audio.isMusicEnabled();
      saveMusicEnabled(on);
      this.audio.setMusicEnabled(on);
      syncMusicBtn();
    });

    document.getElementById("btn-color")?.addEventListener("click", () => {
      this.#cycleWizardColor();
    });
  }

  #spawnIndexForDir(dir) {
    let best = 0;
    let bestDot = -Infinity;
    for (let i = 0; i < this.landSpawns.length; i++) {
      const s = this.landSpawns[i];
      const dot = dir.x * s[0] + dir.y * s[1] + dir.z * s[2];
      if (dot > bestDot) {
        bestDot = dot;
        best = i;
      }
    }
    return best;
  }

  #cycleSpawnCamera() {
    if (!this.landSpawns.length) return;
    this._spawnCamIdx = (this._spawnCamIdx + 1) % this.landSpawns.length;
    this.#setCameraFocus(this.landSpawns[this._spawnCamIdx]);
  }

  #bindInput() {
    const track = (code) => code.startsWith("Arrow") || code === "Escape";

    window.addEventListener("keydown", (e) => {
      if (e.target?.closest?.("input, textarea, [contenteditable]")) return;
      if (e.code === "Space" && !e.repeat && this.inputEnabled && this.wizard && !this.wizard.remote) {
        this.#centerCameraOnWizard();
        e.preventDefault();
        return;
      }
      if (e.code === "KeyG" && !e.repeat && this.inputEnabled && this.wizard && !this.wizard.remote) {
        const next = !this.wizard.godMode;
        this.wizard.setGodMode(next);
        if (next) {
          this._spawnCamIdx = this.#spawnIndexForDir(this.wizard.dir);
        }
        e.preventDefault();
        return;
      }
      if (
        e.code === "Tab" &&
        !e.repeat &&
        this.inputEnabled &&
        this.wizard &&
        !this.wizard.remote &&
        this.wizard.godMode
      ) {
        this.#cycleSpawnCamera();
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
    this.canvas.addEventListener("pointerup", (e) => this.#onPointerUp(e));
    this.canvas.addEventListener("pointercancel", (e) => this.#onPointerUp(e));
    this.canvas.addEventListener("pointerleave", () => this.#onPointerLeave());
    this.canvas.addEventListener("wheel", (e) => this.#onWheel(e), { passive: false });
    window.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  #isUiTarget(target) {
    return !!target?.closest?.("#spell-bar, #game-bar, #mp-panel, #health");
  }

  #setCameraFocus(focusArr, resetZoom = false) {
    this.#stopCamRecenter();
    this._camFocus = [focusArr[0], focusArr[1], focusArr[2]];
    if (resetZoom) this._camZoom = 1;
    placeCamera(this.camera, this._camFocus, this._camZoom);
  }

  #stopCamRecenter() {
    this._camRecenterT = -1;
  }

  #centerCameraOnWizard() {
    const dir = this.wizard?.dir;
    if (!dir) return;
    this.planetGroup.updateMatrixWorld(true);
    const from = tmp.dir.copy(dir).transformDirection(this.planetGroup.matrixWorld);
    if (from.lengthSq() < 1e-12) return;
    from.normalize();
    const to = tmp.dir2.fromArray(this._camFocus);
    if (to.lengthSq() < 1e-12) return;
    to.normalize();
    const dot = Math.min(1, Math.max(-1, from.dot(to)));
    const ang = Math.acos(dot);
    if (ang < 1e-4) {
      this.#stopCamRecenter();
      return;
    }
    this._camRecenterFrom.copy(this.planetGroup.quaternion);
    this._camRecenterQ.setFromUnitVectors(from, to);
    this._camRecenterTo.copy(this._camRecenterQ).multiply(this._camRecenterFrom);
    this._camRecenterT = 0;
    const maxDur = Math.max(0.2, CONFIG.camRecenterSec);
    this._camRecenterDur = 0.2 + (maxDur - 0.2) * (ang / Math.PI);
  }

  #tickCamRecenter(dt) {
    if (this._camRecenterT < 0) return;
    if (this._orbitDrag) {
      this.#stopCamRecenter();
      return;
    }
    this._camRecenterT += dt;
    let u = this._camRecenterT / this._camRecenterDur;
    if (u >= 1) {
      this.planetGroup.quaternion.copy(this._camRecenterTo);
      this.#stopCamRecenter();
      return;
    }
    u = u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2;
    this.planetGroup.quaternion.slerpQuaternions(this._camRecenterFrom, this._camRecenterTo, u);
  }

  #onWheel(e) {
    if (this.#isUiTarget(e.target)) return;
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= 400;
    const next = this._camZoom * Math.exp(dy * 0.0018);
    this._camZoom = Math.min(CONFIG.camZoomMax, Math.max(CONFIG.camZoomMin, next));
    if (this._camFocus) placeCamera(this.camera, this._camFocus, this._camZoom);
  }

  #applyOrbitDrag(dx, dy) {
    this.camRight.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    this.camUp.setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
    const sens = CONFIG.rotSpeed * 0.0065;
    const rsSide = sens * 1.3;
    this.planetGroup.rotateOnWorldAxis(this.camUp, dx * rsSide);
    this.planetGroup.rotateOnWorldAxis(this.camRight, dy * sens);
  }

  #startOrbitDrag(e) {
    this.#stopCamRecenter();
    this._orbitDrag = true;
    this._orbitPointerId = e.pointerId;
    this._lastOrbitX = e.clientX;
    this._lastOrbitY = e.clientY;
    this.canvas.style.cursor = "none";
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch (_) {
      /* noop */
    }
    this.wizard?.hideWalkPreview?.();
    this.spells.aim.hide();
  }

  #endOrbitDrag(e) {
    if (!this._orbitDrag) return;
    if (e && e.pointerId !== this._orbitPointerId) return;
    this._orbitDrag = false;
    this._orbitPointerId = null;
    this.canvas.style.cursor = "";
    try {
      if (e) this.canvas.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* noop */
    }
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
    if (this._orbitDrag && e.pointerId === this._orbitPointerId) {
      const dx = e.clientX - this._lastOrbitX;
      const dy = e.clientY - this._lastOrbitY;
      this._lastOrbitX = e.clientX;
      this._lastOrbitY = e.clientY;
      if (dx !== 0 || dy !== 0) this.#applyOrbitDrag(dx, dy);
      e.preventDefault();
      return;
    }

    if (!this.inputEnabled || !this.wizard || this.wizard.isBusy) return;
    const hit = this.#pickTerrain(e);

    if (this._pendingCast) {
      this.spells.aim.show();
      this.spells.aim.place(
        this._pendingCast.targetDir,
        this.spells.inRange(this._pendingCast.spellId, this._pendingCast.targetDir),
        this.camera
      );
      return;
    }

    if (this.selectedSpell) {
      if (hit) this.spells.updateAim(hit, this.camera);
      else this.spells.aim.hide();
      return;
    }

    if (this.wizard.hasTarget) return;
    if (hit) this.wizard.previewWalk(hit);
    else this.wizard.hideWalkPreview();
  }

  #onPointerLeave() {
    if (this._orbitDrag) return;
    if (!this.wizard || this.wizard.hasTarget || this.selectedSpell) return;
    this.wizard.hideWalkPreview();
  }

  #onPointerUp(e) {
    if (e.button === 2) this.#endOrbitDrag(e);
  }

  #onPointerDown(e) {
    if (this.#isUiTarget(e.target)) return;

    if (e.button === 2) {
      if (!this.inputEnabled) return;
      if (this.selectedSpell) this.#selectSpell(null);
      this.#startOrbitDrag(e);
      e.preventDefault();
      return;
    }

    if (!this.inputEnabled || !this.wizard || this.wizard.isBusy) return;
    if (e.button !== 0) return;

    const hit = this.#pickTerrain(e);
    if (!hit) return;

    if (this.selectedSpell) {
      this.#castSpell(this.selectedSpell, hit);
      return;
    }

    if (this.wizard.setDestination(hit)) {
      // Pohyb na remote jde přes pose; walk intent je no-op (kompatibilita protokolu).
      this.session.sendIntent({
        kind: "walk",
        dir: [this.wizard.targetDir.x, this.wizard.targetDir.y, this.wizard.targetDir.z]
      });
    }
  }

  #castSpell(spellId, localPoint) {
    if (!this.wizard || this.wizard.isBusy) return;
    if (this.wizard.immortal) {
      this.wizard.setDestination(localPoint);
      this.#selectSpell(null);
      return;
    }
    const def = SPELLS[spellId];
    if (!def) return;

    const target = tmp.dir.copy(localPoint).normalize().clone();
    if (this.spells.inRange(spellId, target)) {
      this.#beginCast(spellId, target);
      return;
    }

    /** Mimo dosah — dojde, až hranice dosahu sahá na cíl, a teprve pak kouzlí. */
    this._pendingCast = { spellId, targetDir: target };
    this.wizard.setDestination(target, { allowUnwalkable: true });
    this.spells.aim.show();
    this.spells.aim.place(target, false, this.camera);
  }

  #beginCast(spellId, target) {
    this._pendingCast = null;
    this.session.sendIntent({
      kind: "cast",
      spell: spellId,
      target: [target.x, target.y, target.z]
    });
    this.spells.aim.hide();
    this.spells.castAs(this.wizard, spellId, target);
    this.#selectSpell(null);
  }

  #updatePendingCast() {
    const p = this._pendingCast;
    if (!p || !this.wizard) return;
    if (this.wizard.dead || this.wizard.knockdown || this.wizard.tornado || this.wizard.immortal) {
      this._pendingCast = null;
      return;
    }
    if (this.wizard.casting) return;
    if (this.spells.inRange(p.spellId, p.targetDir)) {
      this.#beginCast(p.spellId, p.targetDir);
      return;
    }
    if (!this.wizard.hasTarget) {
      this._pendingCast = null;
      this.#selectSpell(null);
    }
  }

  #loop() {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    this.camRight.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    this.camUp.setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
    if (this.inputEnabled) {
      const spinning =
        this.keys.ArrowLeft || this.keys.ArrowRight || this.keys.ArrowUp || this.keys.ArrowDown;
      if (spinning) this.#stopCamRecenter();
      else this.#tickCamRecenter(dt);
      const rs = CONFIG.rotSpeed * dt;
      const rsSide = rs * 2;
      if (this.keys.ArrowLeft) this.planetGroup.rotateOnWorldAxis(this.camUp, rsSide);
      if (this.keys.ArrowRight) this.planetGroup.rotateOnWorldAxis(this.camUp, -rsSide);
      if (this.keys.ArrowUp) this.planetGroup.rotateOnWorldAxis(this.camRight, rs);
      if (this.keys.ArrowDown) this.planetGroup.rotateOnWorldAxis(this.camRight, -rs);
    } else {
      this.#tickCamRecenter(dt);
    }

    const morphing = this.terrain.updateMorphs(dt);
    if (this.terrain.consumeMorphDirty()) {
      this._shoreRefreshAt -= dt;
      this.spawnMarkers?.refreshNear(this.terrain.morphs);
      this.trees?.refreshNear(this.terrain.morphs);
      this.spells.refreshScorchMarks();
      if (!morphing || this._shoreRefreshAt <= 0) {
        this.water.refreshShoreNear(this.terrain.morphs);
        this._shoreRefreshAt = morphing ? 0.45 : 0;
      }
    }

    this.spells.prepareTornadoEffects(dt);
    for (const w of this.wizards.values()) {
      w.update(dt, this.keys, this.camRight);
      if (this.spawnMarkers?.isInSpawnZone(w.dir)) {
        w.heal(CONFIG.spawnHealPerSec * dt);
      }
    }
    this.#updatePendingCast();
    assignTreeTrance(this.critters?.list, this.longnecks?.list, this.trees, dt);
    this.critters?.update(dt, [...this.wizards.values()]);
    this.longnecks?.update(dt);
    this.waterLife?.update(dt);
    this.trees?.update(dt);
    /** Rozloží start ohně u víc stromů/zvířat naráz (výbuch komety) do pár snímků. */
    pumpFireQueue();
    this.spells.update(dt);
    this.spawnMarkers.update(dt);
    this.water.update(dt);
    this.sky.update(dt);
    this.session.tickPose(dt);

    const viewAxis = getPlanetViewAxis(this.camera, this.planetGroup, tmp.v);
    this.terrain.setViewAxis(viewAxis);
    this.water.setViewAxis(viewAxis);
    this.audio.updateCastSpatial(viewAxis, (id) => this.wizards.get(String(id))?.dir);

    updateSunShadow(this.sun, this.planetGroup);
    this.sky.setSunDirection(this.sun);

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.#loop());
  }
}

new Game();
