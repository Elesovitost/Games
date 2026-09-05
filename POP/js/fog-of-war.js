import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { surfaceDist } from "./spells/fx-common.js";

const _pos = new THREE.Vector3();

/**
 * Lokální fog of war.
 * - Terén/voda/stromy: explore + paměť (šedá) mimo FOV
 * - Jednotky (zvířata, remote wizard): jen ve FOV, žádní duchové
 * - Spell FX / duše / spawn markery: jen ve FOV
 * God mode → vypnuto.
 */
export class FogOfWar {
  constructor(game) {
    this.game = game;
    this.enabled = CONFIG.fowEnabledDefault;
    this.radius = CONFIG.fowRadiusM;
    this._eye = new THREE.Vector3(0, 1, 0);
  }

  setEnabled(on) {
    this.enabled = !!on;
    const u = this.game.terrain?.fowUniforms;
    if (u) u.uFowEnabled.value = this.enabled ? 1 : 0;
  }

  reset() {
    this.game.terrain?.resetFow();
    this.game.water?.resetFow();
    this.game.trees?.resetFow?.();
  }

  /**
   * Po world update: snapshot terénu + viditelnost entit / stromů / FX.
   * @param {THREE.Vector3} eyeDir lokální wizard.dir
   */
  update(eyeDir) {
    const u = this.game.terrain?.fowUniforms;
    if (!u) return;

    if (!eyeDir) {
      this.setEnabled(false);
      this.#revealAll();
      this.game.trees?.applyFow?.(null, false);
      return;
    }

    this._eye.copy(eyeDir).normalize();
    this.radius = CONFIG.fowRadiusM;
    u.uFowEye.value.copy(this._eye);
    u.uFowRadius.value = this.radius;
    u.uFowSoft.value = CONFIG.fowSoftM;

    const god = !!this.game.wizard?.godMode;
    this.setEnabled(CONFIG.fowEnabledDefault && !god);

    if (!this.enabled) {
      this.#revealAll();
      this.game.trees?.applyFow?.(this._eye, false);
      this.#applySpellFx(null, false);
      this.#applySpawnMarkers(false);
      return;
    }

    this.game.terrain.snapshotFow(this._eye, this.radius);
    this.game.water?.snapshotFow(this._eye, this.radius);
    this.game.trees?.applyFow?.(this._eye, true, this.radius);
    this.#applyUnits();
    this.#applySpellFx(this._eye, true);
    this.#applySpawnMarkers(true);
  }

  inFov(dir) {
    if (!this.enabled || !dir) return true;
    return surfaceDist(dir, this._eye) <= this.radius;
  }

  #unitLists() {
    const g = this.game;
    return [
      g.critters?.list || [],
      g.longnecks?.list || [],
      g.worms?.list || [],
      g.waterLife?.list || []
    ];
  }

  #revealAll() {
    for (const list of this.#unitLists()) {
      for (const e of list) this.#showUnit(e, true);
    }
    for (const w of this.game.wizards?.values?.() || []) {
      if (w === this.game.wizard) continue;
      this.#showUnit(w, true);
    }
    this.#applySpellFx(null, false);
    this.#applySpawnMarkers(false);
  }

  #applyUnits() {
    for (const list of this.#unitLists()) {
      for (const e of list) {
        if (e.dead || e.gone) {
          this.#hideSoul(e);
          continue;
        }
        this.#showUnit(e, this.inFov(e.dir));
      }
    }
    for (const w of this.game.wizards?.values?.() || []) {
      if (w === this.game.wizard) {
        // Lokální wizard i mrtvé tělo vždy vidět (duše je navíc).
        if (w.mesh) w.mesh.visible = true;
        if (w._soul?.mesh) w._soul.mesh.visible = true;
        continue;
      }
      if (w.dead) {
        const inFov = this.inFov(w.dir);
        if (w.mesh) w.mesh.visible = inFov;
        if (w._soul?.mesh) w._soul.mesh.visible = inFov;
        continue;
      }
      this.#showUnit(w, this.inFov(w.dir));
    }
  }

  #isWaterLife(e) {
    return e?.herd === this.game.waterLife;
  }

  /** @param {boolean} inFov */
  #showUnit(e, inFov) {
    const mesh = e.mesh;
    if (!mesh) return;

    if (inFov) {
      if (mesh.userData._fowHidden) delete mesh.userData._fowHidden;
      if (e.dead || e.gone) return;
      if (this.#isWaterLife(e)) {
        // visible už nastavil water-life update podle hloubky
      } else if (e.invis && e.remote && (e.invis.remoteOpacity ?? 0) < 0.02) {
        mesh.visible = false;
      } else {
        mesh.visible = true;
      }
      if (e._soul?.mesh) e._soul.mesh.visible = true;
      return;
    }

    mesh.userData._fowHidden = true;
    mesh.visible = false;
    this.#hideSoul(e);
  }

  #hideSoul(e) {
    if (e._soul?.mesh) e._soul.mesh.visible = false;
  }

  #applySpawnMarkers(fowOn) {
    const markers = this.game.spawnMarkers;
    if (!markers?.entries?.length) return;
    for (const entry of markers.entries) {
      const mush = entry.mush;
      if (!mush) continue;
      if (!fowOn) {
        if (mush.userData._fowHidden) {
          mush.visible = mush.userData._fowWasVisible !== false;
          delete mush.userData._fowHidden;
        }
        continue;
      }
      const dir = entry.ringDir;
      const inFov = dir && this.inFov(dir);
      if (!inFov) {
        if (!mush.userData._fowHidden) {
          mush.userData._fowWasVisible = mush.visible;
          mush.userData._fowHidden = true;
        }
        mush.visible = false;
      } else if (mush.userData._fowHidden) {
        mush.visible = mush.userData._fowWasVisible !== false;
        delete mush.userData._fowHidden;
      }
    }
  }

  #applySpellFx(eye, fowOn) {
    const sys = this.game.spells;
    if (!sys) return;

    const items = [];
    const push = (obj, dir) => {
      if (!obj) return;
      const mesh = obj.mesh || obj.group || obj.ball || obj.sprite || obj;
      if (!mesh?.isObject3D) return;
      const d = dir || obj.dir || obj.center || obj.targetDir || null;
      items.push({ mesh, dir: d });
    };

    for (const p of sys.projectiles || []) push(p, p.dir);
    for (const b of sys.bolts || []) push(b, b.dir || b.target);
    for (const t of sys.tornados || []) push(t, t.dir);
    for (const v of sys.volcanos || []) push(v, v.dir);
    for (const q of sys.earthquakes || []) push(q, q.dir);
    for (const c of sys.comets || []) push(c, c.dir || c.impactDir);
    for (const h of sys.hypnoses || []) push(h, h.dir);
    for (const d of sys.demons || []) push(d, d.dir);
    for (const s of sys.spirals || []) push(s, s.dir);
    for (const m of sys.magicTrees || []) push(m, m.dir);
    for (const b of sys.bursts || []) push(b, b.dir);
    for (const p of sys.smokePuffs || []) push(p, p.dir);
    for (const d of sys.fireDebris || []) push(d, d.dir);
    for (const d of sys.iceDebris || []) push(d, d.dir);
    for (const r of sys.waterRipples || []) push(r, r.dir);
    for (const s of sys.waterSpray || []) push(s, s.dir);
    for (const m of sys.scorchMarks || []) push(m, m.dir);

    for (const { mesh, dir } of items) {
      if (!fowOn) {
        if (mesh.userData._fowFxHidden) {
          mesh.visible = mesh.userData._fowFxWasVisible !== false;
          delete mesh.userData._fowFxHidden;
        }
        continue;
      }
      let d = dir;
      if (!d || typeof d.dot !== "function") {
        if (mesh.position.lengthSq() > 1e-6) {
          _pos.copy(mesh.position).normalize();
          d = _pos;
        } else continue;
      }
      const inFov = surfaceDist(d, eye) <= this.radius;
      if (!inFov) {
        if (!mesh.userData._fowFxHidden) {
          mesh.userData._fowFxWasVisible = mesh.visible;
          mesh.userData._fowFxHidden = true;
        }
        mesh.visible = false;
      } else if (mesh.userData._fowFxHidden) {
        mesh.visible = mesh.userData._fowFxWasVisible !== false;
        delete mesh.userData._fowFxHidden;
      }
    }
  }

  dispose() {}
}
