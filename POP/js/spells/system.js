import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { tmp } from "../utils.js";
import { SPELLS } from "./defs.js";
import { AimReticle, CastSpiral, RangeRing } from "./fx-aim.js";
import { updateBursts, disposeProjectile, updateScorchMarks } from "./fx-common.js";
import { launchFireball as doLaunchFireball, updateFireball, updateSmokePuffs, updateFireDebris, pumpShardQueue } from "./fireball.js";
import { launchIceball as doLaunchIceball, updateIceball, updateIceDebris } from "./iceball.js";
import { strikeLightning as doStrikeLightning, updateBolts } from "./lightning.js";
import { spawnTornado as doSpawnTornado, updateTornados, prepareTornadoEffects as doPrepareTornadoEffects, updateTornadoPull, updateTornadoVictims, disposeTornados } from "./tornado.js";
import { spawnVolcano as doSpawnVolcano, updateVolcanos, disposeVolcanos } from "./volcano.js";
import { spawnEarthquake as doSpawnEarthquake, updateEarthquakes, disposeEarthquakes } from "./earthquake.js";
import { spawnComet as doSpawnComet, updateComets, disposeComets } from "./comet.js";
import { updateWaterFx } from "./water-fx.js";
import { applyInvisibility } from "./invisibility.js";
import { applyImmortality } from "./immortality.js";
import { incantationFileForSpell } from "../incantations.js";

export class SpellSystem {
  constructor(planetGroup, terrain, wizard, getWizards = null) {
    this.planetGroup = planetGroup;
    this.terrain = terrain;
    this.wizard = wizard;
    this.getWizards = getWizards || (() => (wizard ? [wizard] : []));
    this.audio = null;
    this.getListenerDir = null;
    this._castOwnerId = wizard?.id ?? null;
    this.rangeRing = new RangeRing(planetGroup, terrain);
    this.aim = new AimReticle(planetGroup, terrain);
    this.spirals = [];
    this.projectiles = [];
    this.bolts = [];
    this.bursts = [];
    this.scorchMarks = [];
    this.smokePuffs = [];
    this.fireDebris = [];
    this.iceDebris = [];
    this.waterRipples = [];
    this.waterSpray = [];
    this.tornados = [];
    this.volcanos = [];
    this.earthquakes = [];
    this.comets = [];
    /** Doplní main.js — kometa z ní počítá přílet do záběru. */
    this.camera = null;
    this.activeSpellId = null;
    this._sfxLoops = new Set();

    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._vel = new THREE.Vector3();
    this._axis = new THREE.Vector3();
  }

  showRange(spellId) {
    const def = SPELLS[spellId];
    if (!def) {
      this.hideAiming();
      return;
    }
    if (def.selfCast) {
      this.hideAiming();
      return;
    }
    this.activeSpellId = spellId;
    this.rangeRing.show((a, _c, e, n) => this.rangeAtBearing(spellId, e, n, a));
    this.rangeRing.setColor(def.color);
    this.aim.setColor(def.color);
    this.aim.setSpell(spellId);
    this.aim.hide();
    this.wizard.footprints?.hide();
  }

  hideRange() {
    this.hideAiming();
  }

  hideAiming() {
    this.activeSpellId = null;
    this.rangeRing.hide();
    this.aim.hide();
    this.aim.setSpell(null);
    if (this.wizard?.hasTarget) {
      this.wizard.footprints?.show(this.wizard.targetDir, this.wizard.dir);
    }
  }

  /** Lokální hráč má aktivní spirálu — terč se neukazuje. */
  #localSpiralActive() {
    const w = this.wizard;
    if (!w || w.remote) return false;
    return this.spirals.some((s) => s.ownerId === w.id);
  }

  /** Posune terč pod kurzor (local hit point). */
  updateAim(localPoint, camera = null) {
    if (!this.activeSpellId || this.wizard?.isBusy || this.#localSpiralActive()) {
      this.aim.hide();
      return;
    }
    this.aim.show();
    this.aim.setSpell(this.activeSpellId);
    const dir = this._tmp.copy(localPoint).normalize();
    this.aim.place(dir, this.inRange(this.activeSpellId, dir), camera);
  }

  /** Spirála v cíli — dokud se nezavolá clearSpiral / clearAllSpirals. */
  startSpiral(targetDir, spellId) {
    const def = SPELLS[spellId];
    const color = def?.color ?? 0xffe08a;
    const spiral = new CastSpiral(this.planetGroup, this.terrain, targetDir, color);
    spiral.ownerId = this._castOwnerId;
    this.spirals.push(spiral);
    return spiral;
  }

  clearSpiral(spiral) {
    const i = this.spirals.indexOf(spiral);
    if (i < 0) return;
    spiral.dispose();
    this.spirals.splice(i, 1);
  }

  clearAllSpirals() {
    for (const s of this.spirals) s.dispose();
    this.spirals.length = 0;
  }

  /** Smaže všechny aktivní efekty kouzel (projektily, spáleniny, kouř…). */
  resetWorld() {
    this.clearAllSpirals();
    this.hideAiming();

    for (const p of this.projectiles) {
      if (p.kind === "fireball") {
        this.planetGroup.remove(p.ball);
        for (const g of p.geos || []) g.dispose();
        for (const m of p.mats || []) m.dispose();
      } else {
        disposeProjectile(this, p);
      }
    }
    this.projectiles.length = 0;

    for (const b of this.bolts) {
      if (!b.group) continue;
      this.planetGroup.remove(b.group);
      for (const mesh of b.tubes || []) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      for (const sp of b.sparks || []) {
        sp.line.geometry.dispose();
        sp.mat.dispose();
      }
      for (const L of b.lights || []) L.light.dispose();
    }
    this.bolts.length = 0;

    for (const b of this.bursts) {
      this.planetGroup.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mat.dispose();
    }
    this.bursts.length = 0;

    for (const mark of this.scorchMarks) {
      this.planetGroup.remove(mark.mesh);
      mark.mesh.geometry.dispose();
      mark.mat?.dispose();
    }
    this.scorchMarks.length = 0;

    for (const s of this.smokePuffs) {
      this.planetGroup.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mat.dispose();
    }
    this.smokePuffs.length = 0;

    for (const d of this.fireDebris) {
      this.planetGroup.remove(d.mesh);
      d.mesh.geometry.dispose();
      d.mat.dispose();
    }
    this.fireDebris.length = 0;

    for (const s of this.iceDebris) {
      this.planetGroup.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mat.dispose();
    }
    this.iceDebris.length = 0;

    for (const r of this.waterRipples) {
      this.planetGroup.remove(r.line);
      r.geo.dispose();
      r.mat.dispose();
    }
    this.waterRipples.length = 0;

    for (const s of this.waterSpray) {
      this.planetGroup.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mat.dispose();
    }
    this.waterSpray.length = 0;
    disposeTornados(this);
    disposeVolcanos(this);
    disposeEarthquakes(this);
    disposeComets(this);
    for (const h of this._sfxLoops) this.audio?.stopSfxLoop(h, 0.05);
    this._sfxLoops.clear();
  }

  #startTrackedLoop(id, dir, opts = {}) {
    const listener = this.getListenerDir?.();
    if (!listener || !this.audio) return null;
    const handle = this.audio.startSfxLoop(id, dir, listener, opts);
    if (handle) this._sfxLoops.add(handle);
    return handle;
  }

  #stopTrackedLoop(handle, fade = 0.25) {
    if (!handle) return;
    this._sfxLoops.delete(handle);
    this.audio?.stopSfxLoop(handle, fade);
  }

  #updateTrackedLoops() {
    const listener = this.getListenerDir?.();
    if (!listener || !this._sfxLoops.size) return;
    for (const h of this._sfxLoops) {
      if (h.alive) this.audio?.updateSfxLoop(h, h.sourceDir, listener);
    }
  }

  /** Výška nad referenční rovinou (m) — bonus k dosahu kouzel. */
  elevationRangeBonus() {
    if (!this.wizard) return 0;
    const h = this.terrain.height(this.wizard.dir);
    const elev = Math.max(0, h - CONFIG.planetR);
    return elev * CONFIG.spellRangePerHeightM;
  }

  /** Sklon mezi kouzelníkem a cílem — kladný = do kopce. */
  #slopeGradeToTarget(targetDir) {
    if (!this.wizard) return 0;
    const from = this.wizard.dir;
    const to = this._tmp.copy(targetDir).normalize();
    const h0 = this.terrain.height(from);
    const h1 = this.terrain.height(to);
    const dot = Math.min(1, Math.max(-1, from.dot(to)));
    const dist = Math.acos(dot) * CONFIG.planetR;
    if (dist < 0.05) return 0;
    return (h1 - h0) / dist;
  }

  /** Násobič dosahu podle sklonu — stejná křivka jako rychlost chůze. */
  #slopeRangeMul(grade) {
    if (grade >= 0) {
      return 1 / (1 + grade * grade * 3.2 + grade * 1.1);
    }
    return Math.min(CONFIG.wizardDownhillBoost, 1 - grade * 0.4);
  }

  /** Směr na hranici dosahu v daném azimutu — stejný výpočet jako inRange. */
  #dirAtBearing(from, east, north, angle, distM, out) {
    const omega = distM / CONFIG.planetR;
    this._axis
      .copy(east)
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(north, Math.sin(angle));
    return out
      .copy(from)
      .multiplyScalar(Math.cos(omega))
      .addScaledVector(this._axis, Math.sin(omega))
      .normalize();
  }

  /** Bod na hranici dosahu v azimutu — přímo z inRange (stejně jako terč). */
  rangeAtBearing(spellId, east, north, angle) {
    const def = SPELLS[spellId];
    if (!def || !this.wizard) return def?.range ?? 0;

    const from = this.wizard.dir;
    const maxM =
      (def.range + this.elevationRangeBonus()) *
      CONFIG.wizardDownhillBoost *
      1.08;
    let lo = 0;
    let hi = maxM;

    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) * 0.5;
      this.#dirAtBearing(from, east, north, angle, mid, this._tmp);
      if (this.inRange(spellId, this._tmp)) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  dirAtBearing(from, east, north, angle, distM, out) {
    return this.#dirAtBearing(from, east, north, angle, distM, out);
  }

  effectiveRange(spellId, targetDir = null) {
    const def = SPELLS[spellId];
    if (!def) return 0;
    let range = def.range + this.elevationRangeBonus();
    if (targetDir) {
      range *= this.#slopeRangeMul(this.#slopeGradeToTarget(targetDir));
    }
    return Math.max(1, range);
  }

  inRange(spellId, targetDir) {
    const def = SPELLS[spellId];
    if (!def) return false;
    const cosMax = Math.cos(this.effectiveRange(spellId, targetDir) / CONFIG.planetR);
    return this.wizard.dir.dot(this._tmp2.copy(targetDir).normalize()) >= cosMax;
  }

  prepareTornadoEffects(dt) {
    doPrepareTornadoEffects(this, dt);
  }

  update(dt) {
    if (this.wizard) {
      if (this.activeSpellId) {
        const spellId = this.activeSpellId;
        this.rangeRing.setBoundaryFn((a, _c, e, n) =>
          this.rangeAtBearing(spellId, e, n, a)
        );
      }
      this.rangeRing.update(this.wizard.dir, (from, e, n, a, d, out) =>
        this.dirAtBearing(from, e, n, a, d, out)
      );
    }
    for (const s of this.spirals) s.update(dt);
    updateTornados(this, dt);
    updateTornadoPull(this, dt);
    updateTornadoVictims(this, dt);
    updateVolcanos(this, dt);
    updateEarthquakes(this, dt);
    updateComets(this, dt);
    this.#updateTrackedLoops();
    updateBolts(this, dt);
    this.#updateProjectiles(dt);
    updateBursts(this, dt);
    updateSmokePuffs(this, dt);
    pumpShardQueue();
    updateFireDebris(this, dt);
    updateIceDebris(this, dt);
    this.terrain.updateIceTrails(dt);
    updateWaterFx(this, dt);
  }

  /** Přilepí spáleniny na terén po změně výšky (elevace / deprese). */
  refreshScorchMarks() {
    updateScorchMarks(this);
  }

  strikeLightning(targetDir) {
    doStrikeLightning(this, targetDir);
  }

  launchFireball(targetDir) {
    doLaunchFireball(this, targetDir);
  }

  launchIceball(targetDir) {
    doLaunchIceball(this, targetDir);
  }

  /** Provede efekt jako daný caster (MP remote). */
  castAs(wizard, spellId, targetDir, onDone = null) {
    if (!wizard || wizard.dead) return;
    const def = SPELLS[spellId];
    if (!def) return;
    const prev = this.wizard;
    const prevOwner = this._castOwnerId;
    this.wizard = wizard;
    this._castOwnerId = wizard.id;
    const target = targetDir.clone().normalize();
    const spiral = wizard.remote ? null : this.startSpiral(target, spellId);
    if (!wizard.remote) this.aim.hide();

    const restore = () => {
      this.wizard = prev;
      this._castOwnerId = prevOwner;
    };

    const finishFx = () => {
      if (spellId === "tornado") doSpawnTornado(this, target);
      if (spellId === "earthquake") doSpawnEarthquake(this, target);
      if (spellId === "comet") doSpawnComet(this, target);
      this.clearSpiral(spiral);
      if (spellId === "lightning") this.strikeLightning(target);
      else if (spellId === "fireball") this.launchFireball(target);
      else if (spellId === "iceball") this.launchIceball(target);
      else if (spellId === "invisibility") applyInvisibility(this, wizard);
      else if (spellId === "immortality") applyImmortality(this, wizard);
      restore();
      onDone?.();
    };

    const beginCast = (duration, onComplete) => {
      if (!wizard.startCast(target, duration, onComplete)) {
        this.clearSpiral(spiral);
        restore();
        return false;
      }
      const listener = this.getListenerDir?.();
      if (listener) {
        this.audio?.startCastIncantation(
          wizard.id,
          incantationFileForSpell(spellId),
          duration,
          wizard.dir,
          listener,
          { remote: wizard.remote }
        );
      }
      return true;
    };

    if (spellId === "elevate" || spellId === "depress") {
      const sign = spellId === "elevate" ? 1 : -1;
      if (!this.terrain.beginMorph(target, sign, def.castTime)) {
        this.clearSpiral(spiral);
        restore();
        return;
      }
      const moveSfx = this.#startTrackedLoop("groundmove", target);
      beginCast(def.castTime, () => {
        this.#stopTrackedLoop(moveSfx);
        this.clearSpiral(spiral);
        restore();
        onDone?.();
      });
      return;
    }

    if (spellId === "volcano") {
      const morphDur = def.morphDuration ?? CONFIG.spellDuration;
      const prepTime = def.castPrepTime ?? 3;

      if (!beginCast(prepTime, () => {
        this.clearSpiral(spiral);
        const growSfx = this.#startTrackedLoop("volcanogrow", target);
        /** Tvar sopky se dočte až v onComplete — morph teprve poroste */
        const shaped = { info: null };
        shaped.info = this.terrain.beginVolcanoMorph(target, {
          coneRadius: def.coneRadius,
          coneHeight: def.coneHeight,
          flankPow: def.flankPow,
          craterRadius: def.craterRadius,
          craterDepth: def.craterDepth,
          craterFloorRadius: def.craterFloorRadius,
          notchDrop: def.notchDrop,
          secondaryNotchDrop: def.secondaryNotchDrop,
          duration: morphDur,
          onComplete: () => {
            this.#stopTrackedLoop(growSfx);
            doSpawnVolcano(this, target, shaped.info);
            restore();
            onDone?.();
          }
        });
        if (!shaped.info) {
          this.#stopTrackedLoop(growSfx);
          restore();
          onDone?.();
        }
      })) {
        return;
      }
      return;
    }

    if (!beginCast(def.castTime, finishFx)) {
      return;
    }
  }

  #castDuration(spellId, def) {
    if (spellId === "volcano") return def.castPrepTime ?? 3;
    return def.castTime ?? CONFIG.spellDuration;
  }

  #updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;

      let keep = true;
      if (p.kind === "fireball") keep = updateFireball(this, p, dt);
      else if (p.kind === "iceball") keep = updateIceball(this, p, dt);

      if (!keep) this.projectiles.splice(i, 1);
    }
  }
}
