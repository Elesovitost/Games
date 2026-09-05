import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { surfaceDist } from "./spells/fx-common.js";

const _pos = new THREE.Vector3();

/**
 * Lokální fog of war: explore snapshot terénu/vody + duchové entit.
 * God mode → enabled=false (živý svět).
 */
export class FogOfWar {
  constructor(game) {
    this.game = game;
    this.enabled = CONFIG.fowEnabledDefault;
    this.radius = CONFIG.fowRadiusM;
    this.ghostMat = new THREE.MeshStandardMaterial({
      color: 0x6a6a6a,
      roughness: 0.95,
      metalness: 0,
      flatShading: true
    });
    this._eye = new THREE.Vector3(0, 1, 0);
    this._entityState = new WeakMap();
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
    this._entityState = new WeakMap();
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
      this.#revealAllEntities();
      this.game.trees?.applyFow?.(null, false);
      return;
    }

    this._eye.copy(eyeDir).normalize();
    u.uFowEye.value.copy(this._eye);
    u.uFowRadius.value = this.radius;
    u.uFowSoft.value = CONFIG.fowSoftM;

    const god = !!this.game.wizard?.godMode;
    this.setEnabled(CONFIG.fowEnabledDefault && !god);

    if (!this.enabled) {
      this.#revealAllEntities();
      this.game.trees?.applyFow?.(this._eye, false);
      this.#applySpellFx(null, false);
      return;
    }

    this.game.terrain.snapshotFow(this._eye, this.radius);
    this.game.water?.snapshotFow(this._eye, this.radius);
    this.game.trees?.applyFow?.(this._eye, true, this.radius);
    this.#applyEntities();
    this.#applySpellFx(this._eye, true);
  }

  inFov(dir) {
    if (!this.enabled || !dir) return true;
    return surfaceDist(dir, this._eye) <= this.radius;
  }

  #revealAllEntities() {
    for (const list of this.#entityLists()) {
      for (const e of list) this.#applyOne(e, true, true, false);
    }
    for (const w of this.game.wizards?.values?.() || []) {
      if (w === this.game.wizard) continue;
      this.#applyOne(w, true, true, true);
    }
  }

  #entityLists() {
    const g = this.game;
    return [
      g.critters?.list || [],
      g.longnecks?.list || [],
      g.worms?.list || [],
      g.waterLife?.list || []
    ];
  }

  #applyEntities() {
    for (const list of this.#entityLists()) {
      for (const e of list) {
        if (e.dead || e.gone) {
          this.#clearGhostLook(e);
          continue;
        }
        const inFov = this.inFov(e.dir);
        // Zvířata mimo FOV úplně schovat — žádní duchové.
        this.#applyOne(e, inFov, false, false);
      }
    }
    for (const w of this.game.wizards?.values?.() || []) {
      if (w === this.game.wizard) {
        if (w.mesh) w.mesh.visible = !w.dead;
        continue;
      }
      if (w.dead) continue;
      const inFov = this.inFov(w.dir);
      this.#applyOne(w, inFov, false, true);
    }
  }

  #getState(e) {
    let st = this._entityState.get(e);
    if (!st) {
      st = {
        seen: false,
        ghosting: false,
        pos: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        scale: new THREE.Vector3(1, 1, 1),
        links: null
      };
      this._entityState.set(e, st);
    }
    return st;
  }

  #isWaterLife(e) {
    return e?.herd === this.game.waterLife;
  }

  /**
   * @param {boolean} allowGhost mimo FOV šedý duch (wizard); false = jen schovat (zvířata)
   */
  #applyOne(e, inFov, forceLive, allowGhost) {
    const mesh = e.mesh;
    if (!mesh) return;
    const st = this.#getState(e);

    if (forceLive) {
      if (st.ghosting) {
        this.#restoreMats(mesh);
        st.ghosting = false;
      }
      if (mesh.userData._fowHidden) {
        delete mesh.userData._fowHidden;
        if (!e.dead && !e.gone) mesh.visible = true;
      }
      return;
    }

    if (inFov) {
      if (st.ghosting) {
        this.#restoreMats(mesh);
        st.ghosting = false;
      }
      st.seen = true;
      if (allowGhost) this.#capturePose(e, st);
      if (mesh.userData._fowHidden) delete mesh.userData._fowHidden;
      // Zvířata (kromě water-life, které si visible řeší samo) znovu ukaž.
      if (!allowGhost && !this.#isWaterLife(e) && !e.dead && !e.gone) {
        mesh.visible = true;
      }
      return;
    }

    // Mimo FOV
    if (st.ghosting) {
      this.#restoreMats(mesh);
      st.ghosting = false;
    }
    if (!allowGhost || !st.seen) {
      mesh.userData._fowHidden = true;
      mesh.visible = false;
      return;
    }

    // Wizard — zamrzlý šedý duch
    if (!st.ghosting) {
      this.#capturePose(e, st);
      this.#applyGhostMats(mesh);
      st.ghosting = true;
    }
    this.#restorePose(e, st);
    mesh.visible = true;
  }

  #capturePose(e, st) {
    const mesh = e.mesh;
    st.pos.copy(mesh.position);
    st.quat.copy(mesh.quaternion);
    st.scale.copy(mesh.scale);
    const links = e.parts?.links;
    if (links?.length) {
      if (!st.links || st.links.length !== links.length) {
        st.links = links.map(() => ({
          pos: new THREE.Vector3(),
          quat: new THREE.Quaternion(),
          fleshVis: true,
          ridgeVis: false,
          headVis: false
        }));
      }
      for (let i = 0; i < links.length; i++) {
        const L = links[i];
        const s = st.links[i];
        s.pos.copy(L.g.position);
        s.quat.copy(L.g.quaternion);
        s.fleshVis = L.flesh.visible;
        s.ridgeVis = L.ridge.visible;
        if (L.head) s.headVis = L.head.visible;
      }
    } else {
      st.links = null;
    }
  }

  #restorePose(e, st) {
    const mesh = e.mesh;
    mesh.position.copy(st.pos);
    mesh.quaternion.copy(st.quat);
    mesh.scale.copy(st.scale);
    const links = e.parts?.links;
    if (links && st.links) {
      for (let i = 0; i < links.length && i < st.links.length; i++) {
        const L = links[i];
        const s = st.links[i];
        L.g.position.copy(s.pos);
        L.g.quaternion.copy(s.quat);
        L.flesh.visible = s.fleshVis;
        L.ridge.visible = s.ridgeVis;
        if (L.head) L.head.visible = s.headVis;
      }
    }
  }

  #applyGhostMats(root) {
    root.traverse((ch) => {
      if (!ch.isMesh || !ch.material) return;
      if (ch.userData._fowMat) return;
      ch.userData._fowMat = ch.material;
      ch.material = this.ghostMat;
    });
  }

  #restoreMats(root) {
    root.traverse((ch) => {
      if (!ch.isMesh) return;
      if (ch.userData._fowMat) {
        ch.material = ch.userData._fowMat;
        delete ch.userData._fowMat;
      }
    });
  }

  #clearGhostLook(e) {
    const st = this._entityState.get(e);
    if (st?.ghosting && e.mesh) {
      this.#restoreMats(e.mesh);
      st.ghosting = false;
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

  dispose() {
    this.ghostMat.dispose();
  }
}
