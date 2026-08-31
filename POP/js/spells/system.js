import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { tmp } from "../utils.js";
import { SPELLS } from "./defs.js";
import { AimReticle, CastSpiral, RangeRing } from "./fx-aim.js";
import { updateBursts } from "./fx-common.js";
import { launchFireball as doLaunchFireball, updateFireball, updateSmokePuffs, updateFireDebris } from "./fireball.js";
import { launchIceball as doLaunchIceball, updateIceball } from "./iceball.js";
import { strikeLightning as doStrikeLightning, updateBolts } from "./lightning.js";
import { updateWaterFx } from "./water-fx.js";

export class SpellSystem {
  constructor(planetGroup, terrain, wizard, getWizards = null) {
    this.planetGroup = planetGroup;
    this.terrain = terrain;
    this.wizard = wizard;
    this.getWizards = getWizards || (() => (wizard ? [wizard] : []));
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
    this.waterRipples = [];
    this.waterSpray = [];
    this.activeSpellId = null;

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
    this.activeSpellId = spellId;
    this.rangeRing.show(def.range);
    this.rangeRing.setColor(def.color);
    this.aim.setColor(def.color);
    this.aim.hide();
  }

  hideRange() {
    this.hideAiming();
  }

  hideAiming() {
    this.activeSpellId = null;
    this.rangeRing.hide();
    this.aim.hide();
  }

  /** Posune terč pod kurzor (local hit point). */
  updateAim(localPoint) {
    if (!this.activeSpellId || this.wizard.isBusy) {
      this.aim.hide();
      return;
    }
    this.aim.show();
    const dir = this._tmp.copy(localPoint).normalize();
    this.aim.place(dir, this.inRange(this.activeSpellId, dir));
  }

  /** Spirála v cíli — dokud se nezavolá clearSpiral / clearAllSpirals. */
  startSpiral(targetDir, spellId) {
    const def = SPELLS[spellId];
    const color = def?.color ?? 0xffe08a;
    const spiral = new CastSpiral(this.planetGroup, this.terrain, targetDir, color);
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

  inRange(spellId, targetDir) {
    const def = SPELLS[spellId];
    if (!def) return false;
    const cosMax = Math.cos(def.range / CONFIG.planetR);
    return this.wizard.dir.dot(tmp.dir.copy(targetDir).normalize()) >= cosMax;
  }

  update(dt) {
    if (this.wizard) this.rangeRing.update(this.wizard.dir);
    for (const s of this.spirals) s.update(dt);
    updateBolts(this, dt);
    this.#updateProjectiles(dt);
    updateBursts(this, dt);
    updateSmokePuffs(this, dt);
    updateFireDebris(this, dt);
    updateWaterFx(this, dt);
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
    const spiral = this.startSpiral(target, spellId);

    const restore = () => {
      this.wizard = prev;
      this._castOwnerId = prevOwner;
    };

    const finishFx = () => {
      this.clearSpiral(spiral);
      if (spellId === "lightning") this.strikeLightning(target);
      else if (spellId === "fireball") this.launchFireball(target);
      else if (spellId === "iceball") this.launchIceball(target);
      restore();
      onDone?.();
    };

    if (spellId === "elevate" || spellId === "depress") {
      const sign = spellId === "elevate" ? 1 : -1;
      if (!this.terrain.beginMorph(target, sign)) {
        this.clearSpiral(spiral);
        restore();
        return;
      }
      if (!wizard.startCast(target, def.castTime, () => {
        this.clearSpiral(spiral);
        restore();
        onDone?.();
      })) {
        this.clearSpiral(spiral);
        restore();
      }
      return;
    }

    if (!wizard.startCast(target, def.castTime, finishFx)) {
      this.clearSpiral(spiral);
      restore();
    }
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
