import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { surfaceDist } from "./spells/fx-common.js";
import { FOW_MAX_EYES } from "./fow-material.js";
import { ensureWatcherGhost } from "./spells/watcher.js";

const _pos = new THREE.Vector3();

/**
 * Lokální fog of war.
 * - Terén/voda/stromy: explore + paměť (šedá) mimo FOV
 * - Jednotky (zvířata, remote wizard): jen ve FOV, žádní duchové
 * - Spell FX / duše / spawn markery: jen ve FOV
 * - Extra zdroje (Hlídač): addSource / removeSource — jen pro majitele
 * God mode → vypnuto.
 */
export class FogOfWar {
  constructor(game) {
    this.game = game;
    this.enabled = CONFIG.fowEnabledDefault;
    this.radius = CONFIG.fowRadiusM;
    this._eye = new THREE.Vector3(0, 1, 0);
    /** @type {Map<string, { dir: THREE.Vector3, radiusM: number }>} */
    this._sources = new Map();
    /** Scratch list for shader upload + CPU tests */
    this._active = [];
  }

  setEnabled(on) {
    this.enabled = !!on;
    const u = this.game.terrain?.fowUniforms;
    if (u) u.uFowEnabled.value = this.enabled ? 1 : 0;
  }

  reset() {
    this._sources.clear();
    this.game.terrain?.resetFow();
    this.game.water?.resetFow();
    this.game.trees?.resetFow?.();
  }

  /**
   * Extra FOV zdroj (např. Hlídač). Jen lokální majitel by měl registrovat.
   * @param {string} id
   * @param {THREE.Vector3} dir
   * @param {number} radiusM
   */
  addSource(id, dir, radiusM = CONFIG.fowRadiusM) {
    if (!id || !dir) return;
    const existing = this._sources.get(id);
    if (existing) {
      existing.dir.copy(dir).normalize();
      existing.radiusM = radiusM;
      return;
    }
    this._sources.set(String(id), {
      dir: dir.clone().normalize(),
      radiusM
    });
  }

  removeSource(id) {
    this._sources.delete(String(id));
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
      this.game.trees?.applyFow?.(this, false);
      this.#applyWatchers(false);
      return;
    }

    this._eye.copy(eyeDir).normalize();
    this.radius = CONFIG.fowRadiusM;

    const god = !!this.game.wizard?.godMode;
    this.setEnabled(CONFIG.fowEnabledDefault && !god);

    if (!this.enabled) {
      this.#revealAll();
      this.game.trees?.applyFow?.(this, false);
      this.#applySpellFx(false);
      this.#applyWatchers(false);
      this.#applySpawnMarkers(false);
      return;
    }

    this.#rebuildActive();
    this.#uploadUniforms(u);

    for (const s of this._active) {
      this.game.terrain.snapshotFow(s.dir, s.radiusM);
      this.game.water?.snapshotFow(s.dir, s.radiusM);
    }
    this.game.trees?.applyFow?.(this, true);
    this.#applyUnits();
    this.#applySpellFx(true);
    this.#applyWatchers(true);
    this.#applySpawnMarkers(true);
  }

  #rebuildActive() {
    this._active.length = 0;
    this._active.push({ dir: this._eye, radiusM: this.radius });
    for (const s of this._sources.values()) {
      if (this._active.length >= FOW_MAX_EYES) break;
      this._active.push(s);
    }
  }

  #uploadUniforms(u) {
    const eyes = u.uFowEyes.value;
    const radii = u.uFowRadii.value;
    const n = Math.min(FOW_MAX_EYES, this._active.length);
    for (let i = 0; i < n; i++) {
      eyes[i].copy(this._active[i].dir);
      radii[i] = this._active[i].radiusM;
    }
    u.uFowEyeCount.value = n;
    u.uFowEye.value.copy(this._eye);
    u.uFowRadius.value = this.radius;
    u.uFowSoft.value = CONFIG.fowSoftM;
  }

  inFov(dir) {
    if (!this.enabled || !dir) return true;
    if (!this._active.length) {
      return surfaceDist(dir, this._eye) <= this.radius;
    }
    for (const s of this._active) {
      if (surfaceDist(dir, s.dir) <= s.radiusM) return true;
    }
    return false;
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
    this.#applySpellFx(false);
    this.#applyWatchers(false);
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

  #applySpellFx(fowOn) {
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
    /** Watchers mají `#applyWatchers` (šedý ghost když oslepeni). */
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
      const inFov = this.inFov(d);
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

  /**
   * Hlídač: live ve FOV; mimo FOV šedý otisk pokud už viděn a je oslepen
   * (dočasná slepota / démon), stejně jako ghost stromů.
   */
  #applyWatchers(fowOn) {
    const sys = this.game.spells;
    const list = sys?.watchers;
    if (!list?.length) return;

    for (const w of list) {
      const live = w.group || w.mesh;
      if (!live) continue;

      if (!fowOn) {
        live.visible = true;
        if (w.ghostGroup) w.ghostGroup.visible = false;
        continue;
      }

      const inFov = this.inFov(w.dir);
      const blinded = !!(w.corrupted || w.blindT > 0);

      if (inFov) {
        w.fowSeen = true;
        live.visible = true;
        if (w.ghostGroup) {
          /** Zamrzlá pose pro příští odchod z FOV. */
          w.ghostGroup.position.copy(live.position);
          w.ghostGroup.quaternion.copy(live.quaternion);
          w.ghostGroup.scale.copy(live.scale);
          w.ghostGroup.visible = false;
        }
        continue;
      }

      live.visible = false;
      if (w.fowSeen && blinded) {
        ensureWatcherGhost(sys, w);
        if (w.ghostGroup) w.ghostGroup.visible = true;
      } else if (w.ghostGroup) {
        w.ghostGroup.visible = false;
      }
    }
  }

  dispose() {}
}
