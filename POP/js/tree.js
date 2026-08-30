import * as THREE from "./three.js";
import { CONFIG } from "./config.js";

/** Start ≈ 2× kouzelník, max ≈ 4×. */
export const TREE_MIN_HEIGHT = CONFIG.wizardHeight * 2;
export const TREE_MAX_HEIGHT = CONFIG.wizardHeight * 4;

/** Referenční výška modelu (local Y kmene). */
const MODEL_FULL_HEIGHT = 1.52;
const Y_UP = new THREE.Vector3(0, 1, 0);
/** Sdílená geometrie listu (scale per-instance). */
const LEAF_GEO = new THREE.ConeGeometry(1, 1.7, 4);

function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth01(t) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

function makeBark() {
  return new THREE.MeshStandardMaterial({
    color: 0x4a3018,
    roughness: 0.92,
    metalness: 0.05,
    flatShading: true
  });
}

function makeGoldBark() {
  return new THREE.MeshStandardMaterial({
    color: 0x8a6028,
    emissive: 0x3a2810,
    emissiveIntensity: 0.2,
    roughness: 0.75,
    metalness: 0.15,
    flatShading: true
  });
}

function makeGoldLeaf(intensity = 0.55) {
  return new THREE.MeshStandardMaterial({
    color: 0xf0d060,
    emissive: 0xb88820,
    emissiveIntensity: intensity,
    roughness: 0.42,
    metalness: 0.28,
    flatShading: true,
    side: THREE.DoubleSide
  });
}

/**
 * Zlatý strom ve stylu lípy — široká košatá koruna, husté olistění na všech větvích.
 * Local +Y = radiála od středu planety.
 */
export class GoldenTree {
  constructor(seed = 0, opts = {}) {
    this.seed = seed;
    this.maxMistPuffs = opts.mistPuffs ?? 18;
    this.useOmniLight = opts.treeOmniLight !== false;
    this.growth = 0;
    this.displayGrowth = 0;
    this.root = new THREE.Group();
    this.hitMeshes = [];
    this.segments = [];
    this.leaves = [];
    this.attachments = [];
    this.radialUp = null;
    this._settled = false;
    this._quat = new THREE.Quaternion();

    this.bark = makeBark();
    this.goldBark = makeGoldBark();
    this.leafMat = makeGoldLeaf();

    this.hitProxy = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.4, MODEL_FULL_HEIGHT, 8),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false
      })
    );
    this.hitProxy.geometry.translate(0, MODEL_FULL_HEIGHT * 0.5, 0);
    this.hitProxy.userData.noOutline = true;
    this.root.add(this.hitProxy);

    const rnd = mulberry32(0x9e3779b9 ^ (seed * 0x85ebca6b));
    this.#build(rnd);
    this.mistPuffs = [];
    this.mistRoot = new THREE.Group();
    this.root.add(this.mistRoot);
    this.#buildMist(rnd);

    // Omni světlo u paty kmene — osvětlí zem a okolí do všech stran
    this.omniLight = new THREE.PointLight(0xffe4b8, 0.35, 6, 2);
    this.omniLight.position.set(0, 0.08, 0);
    this.root.add(this.omniLight);
    if (!this.useOmniLight) this.omniLight.intensity = 0;

    this.root.traverse((ch) => {
      if (!ch.isMesh) return;
      if (ch.userData.isMist) return;
      ch.receiveShadow = true;
      ch.castShadow = false;
    });
    for (const seg of this.segments) {
      if (seg.gen <= 1) seg.mesh.castShadow = true;
    }
    this.hitProxy.castShadow = false;
    this.hitProxy.receiveShadow = false;

    this.#applyGrowth(true);
    this._settled = true;
  }

  placeRadial(position, upDir) {
    const up = (upDir || position).clone().normalize();
    this.radialUp = up;
    this.root.position.copy(up).multiplyScalar(position.length());
    this._quat.setFromUnitVectors(Y_UP, up);
    this.root.quaternion.copy(this._quat);
  }

  /** Přilepí patku na aktuální výšku terénu. */
  snapToGround(terrain) {
    if (!this.radialUp || !terrain) return;
    const h = terrain.height(this.radialUp);
    this.root.position.copy(this.radialUp).multiplyScalar(h);
    this._quat.setFromUnitVectors(Y_UP, this.radialUp);
    this.root.quaternion.copy(this._quat);
  }

  nudge(delta) {
    this.growth = THREE.MathUtils.clamp(this.growth + delta, 0, 1);
    this._settled = false;
  }

  setGrowth(g) {
    this.growth = THREE.MathUtils.clamp(g, 0, 1);
    this._settled = false;
  }

  update(dt, elapsed = 0) {
    if (!this._settled) {
      const diff = this.growth - this.displayGrowth;
      if (Math.abs(diff) < 0.00035) {
        this.displayGrowth = this.growth;
        this.#applyGrowth(false);
        this._settled = true;
      } else {
        this.displayGrowth += diff * Math.min(1, dt * 7);
        this.#applyGrowth(false);
      }
    }
    this.#updateMist(elapsed);
    this.#updateLighting(elapsed);
  }

  /** Jemné dýchání omni světla u kmene. */
  #updateLighting(elapsed) {
    if (!this.useOmniLight) {
      this.omniLight.intensity = 0;
      return;
    }
    const g = this.displayGrowth;
    const t = elapsed * 0.28 + this.seed * 0.2;
    const pulse = 0.92 + Math.sin(t) * 0.06 + Math.sin(t * 0.4) * 0.03;
    const power = 0.28 + g * 1.55;

    this.omniLight.intensity = power * pulse;
    this.omniLight.distance = 3.5 + g * 14;
    this.omniLight.position.y = 0.06 + g * 0.05;
  }

  /** Nehomogenní mlha — drobné puffy, ne jedna koule. */
  #buildMist(rnd) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const count = Math.min(this.maxMistPuffs, 16 + (this.seed % 5));
    for (let i = 0; i < count; i++) {
      const warm = rnd() > 0.55 ? 0xf6f2ea : 0xeeeae4;
      const mat = new THREE.MeshBasicMaterial({
        color: warm,
        transparent: true,
        opacity: 0.018 + rnd() * 0.022,
        depthWrite: false,
        fog: true,
        side: THREE.DoubleSide
      });
      const puff = new THREE.Mesh(geo, mat);
      puff.userData.isMist = true;
      puff.raycast = () => {};
      puff.castShadow = false;
      puff.receiveShadow = false;
      puff.renderOrder = 3;

      const y = 0.08 + rnd() * 0.82;
      const ang = rnd() * Math.PI * 2;
      const rad = 0.08 + rnd() * 0.38;
      const sx = 0.1 + rnd() * 0.2;
      const sy = 0.04 + rnd() * 0.1;
      const sz = 0.09 + rnd() * 0.18;
      puff.position.set(Math.cos(ang) * rad, y, Math.sin(ang) * rad);
      puff.scale.set(sx, sy, sz);
      puff.rotation.set(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI);

      puff.userData.baseX = puff.position.x;
      puff.userData.baseY = y;
      puff.userData.baseZ = puff.position.z;
      puff.userData.sx = sx;
      puff.userData.sy = sy;
      puff.userData.sz = sz;
      puff.userData.baseOpacity = mat.opacity;
      puff.userData.phase = rnd() * Math.PI * 2;
      puff.userData.drift = 0.012 + rnd() * 0.018;

      this.mistPuffs.push(puff);
      this.mistRoot.add(puff);
    }
  }

  #updateMist(elapsed) {
    const g = this.displayGrowth;
    const grow = 0.9 + g * 0.85;
    const density = 0.35 + g * 0.65;
    const t = elapsed * 0.22 + this.seed * 0.17;

    for (const puff of this.mistPuffs) {
      const u = puff.userData;
      const breathe =
        0.78 +
        Math.sin(t * 0.9 + u.phase) * 0.14 +
        Math.sin(t * 0.35 + u.phase * 1.7) * 0.08;
      puff.material.opacity = u.baseOpacity * density * breathe;
      puff.position.x = u.baseX * grow + Math.sin(t * 0.55 + u.phase) * u.drift;
      puff.position.z = u.baseZ * grow + Math.cos(t * 0.48 + u.phase * 1.3) * u.drift;
      puff.position.y = u.baseY * grow + Math.sin(t * 0.25 + u.phase) * 0.012;
      puff.scale.set(u.sx * grow, u.sy * grow, u.sz * grow);
    }
  }

  #build(rnd) {
    // Kratší kmen → koruna začíná níž (lípa)
    const trunkLens = [0.28, 0.34, 0.36, 0.32];
    const trunkThick = [0.058, 0.048, 0.038, 0.028];
    const trunkNodes = [];
    let parent = this.root;

    for (let i = 0; i < trunkLens.length; i++) {
      const seg = this.#addSegment(parent, {
        gen: 0,
        len: trunkLens[i],
        thickBase: trunkThick[i],
        thickTip: trunkThick[Math.min(i + 1, trunkLens.length - 1)] * 0.92,
        unlock: -1,
        growSpan: 0.001,
        radialSegs: 6,
        material: this.bark
      });
      trunkNodes.push(seg);
      parent = seg.tip;
    }

    // Široké primární větve do stran (nízká elevace = vodorovněji)
    const primaries = [];
    let pIdx = 0;
    for (let ti = 1; ti < trunkNodes.length; ti++) {
      const host = trunkNodes[ti];
      // Více větví na horních segmentech — kulatá koruna
      const count = ti === 1 ? 5 : ti === 2 ? 6 : 7;
      for (let b = 0; b < count; b++) {
        const early = pIdx < 6;
        // elev ~0.15–0.55: vějíř do stran, horní vrstva mírně nahoru
        const layerLift = (ti - 1) * 0.12;
        primaries.push({
          host,
          along: 0.15 + (b / count) * 0.75,
          az: (b / count) * Math.PI * 2 + ti * 0.35 + this.seed * 0.4,
          elev: 0.18 + layerLift + rnd() * 0.28,
          unlock: early ? -0.05 : 0.12 + (pIdx - 6) * 0.055,
          growSpan: early ? 0.1 : 0.14,
          // Delší větve = košatost do stran
          len: 0.42 + rnd() * 0.18 + (ti === 2 ? 0.08 : 0),
          thick: 0.016 + rnd() * 0.005 + (3 - ti) * 0.003,
          early
        });
        pIdx++;
      }
    }

    for (const spec of primaries) {
      const primary = this.#attachBranch(spec.host, spec.along, {
        gen: 1,
        len: spec.len,
        thick: spec.thick,
        unlock: spec.unlock,
        growSpan: spec.growSpan,
        az: spec.az,
        elev: spec.elev,
        rnd
      });
      this.#growChildren(primary, 2, rnd, Math.max(0.08, spec.unlock + 0.12));
    }

    // Husté olistění na KAŽDÉ větvi (gen ≥ 1)
    this.#foliateAll(rnd);
  }

  #growChildren(parentSeg, gen, rnd, baseUnlock) {
    if (gen > 4) return;

    // Více bočních výhonů — široká koruna
    const n = gen === 2 ? 3 + (rnd() > 0.4 ? 1 : 0) : gen === 3 ? 3 : 2;
    const lenMul = { 2: 0.62, 3: 0.5, 4: 0.4 }[gen];
    const thickMul = { 2: 0.55, 3: 0.5, 4: 0.45 }[gen];
    const growSpan = { 2: 0.13, 3: 0.11, 4: 0.1 }[gen];
    const genUnlockBias = { 2: 0, 3: 0.1, 4: 0.22 }[gen];

    for (let i = 0; i < n; i++) {
      const along = 0.28 + (i / Math.max(1, n - 1)) * 0.58 + rnd() * 0.05;
      const unlock = baseUnlock + genUnlockBias + i * 0.03;
      // Boční větvění — rozprostření do stran (nižší elev)
      const elev = gen === 2
        ? 0.05 + rnd() * 0.4
        : 0.1 + rnd() * 0.45;
      const child = this.#attachBranch(parentSeg, along, {
        gen,
        len: parentSeg.fullLen * lenMul * (0.88 + rnd() * 0.28),
        thick: parentSeg.fullThick * thickMul,
        unlock,
        growSpan,
        az: (i / n) * Math.PI * 2 + rnd() * 0.7 + gen,
        elev,
        rnd
      });
      this.#growChildren(child, gen + 1, rnd, unlock + 0.07);
    }
  }

  /** Každá větev dostane listy — hustota podle řádu a unlock větve. */
  #foliateAll(rnd) {
    const branchSegs = this.segments.filter((s) => s.gen >= 1);
    for (const seg of branchSegs) {
      // Hustota: delší / vyšší řád = víc listů
      const base = seg.gen === 1 ? 8 : seg.gen === 2 ? 10 : seg.gen === 3 ? 12 : 14;
      const dens = base + ((seg.fullLen * 18) | 0);
      // Listy startují s větví (ne až pozdě) → rovnoměrné olistění
      const unlock = seg.unlock + 0.02;
      this.#addLeavesAlong(seg, dens, unlock, rnd, 0.1);
    }
  }

  #attachBranch(parentSeg, along, opts) {
    const { gen, len, thick, unlock, growSpan, az, elev, rnd } = opts;

    const pivot = new THREE.Group();
    pivot.rotation.order = "YXZ";
    pivot.rotation.y = az;
    pivot.rotation.x = Math.PI * 0.5 - elev;
    pivot.rotation.z = 0;
    parentSeg.group.add(pivot);

    this.attachments.push({
      pivot,
      parentSeg,
      along: THREE.MathUtils.clamp(along, 0.05, 1)
    });

    const mat = gen >= 3 ? this.goldBark : this.bark;
    return this.#addSegment(pivot, {
      gen,
      len,
      thickBase: thick,
      thickTip: thick * 0.55,
      unlock,
      growSpan,
      radialSegs: gen <= 1 ? 5 : 4,
      material: mat
    });
  }

  #addSegment(parent, opts) {
    const {
      gen,
      len,
      thickBase,
      thickTip,
      unlock,
      growSpan,
      radialSegs,
      material
    } = opts;

    const group = new THREE.Group();
    parent.add(group);

    const geo = new THREE.CylinderGeometry(thickTip, thickBase, 1, radialSegs);
    geo.translate(0, 0.5, 0);
    const mesh = new THREE.Mesh(geo, material);
    mesh.scale.set(1, len, 1);
    group.add(mesh);
    this.hitMeshes.push(mesh);

    const tip = new THREE.Group();
    tip.position.set(0, len, 0);
    group.add(tip);

    const seg = {
      group,
      mesh,
      tip,
      gen,
      fullLen: len,
      fullThick: thickBase,
      unlock,
      growSpan,
      lengthScale: 1
    };
    this.segments.push(seg);
    return seg;
  }

  #addLeavesAlong(seg, count, unlockBase, rnd, span = 0.1) {
    for (let i = 0; i < count; i++) {
      const t = count <= 1 ? 0.5 : i / (count - 1);
      const along = 0.12 + t * 0.82 + (rnd() - 0.5) * 0.06;
      // Větší lístky
      const size = 0.022 + rnd() * 0.016;
      const leaf = this.#makeLeaf(size, rnd);
      // Víc do stran od větve = plnější objem koruny
      const spread = Math.max(seg.fullThick * 5.5, 0.04) * (0.7 + seg.gen * 0.25);
      const ang = rnd() * Math.PI * 2;
      const rad = rnd() * spread;
      leaf.baseX = Math.cos(ang) * rad;
      leaf.baseZ = Math.sin(ang) * rad;
      leaf.along = THREE.MathUtils.clamp(along, 0.05, 0.98);
      leaf.unlock = unlockBase + t * 0.06;
      leaf.growSpan = span;
      leaf.seg = seg;
      leaf.group.rotation.set(
        (rnd() - 0.5) * 1.4,
        rnd() * Math.PI * 2,
        (rnd() - 0.5) * 1.2
      );
      leaf.group.position.set(leaf.baseX, leaf.along * seg.fullLen, leaf.baseZ);
      seg.group.add(leaf.group);
      this.leaves.push(leaf);
      leaf.group.traverse((ch) => {
        if (ch.isMesh) this.hitMeshes.push(ch);
      });
    }
  }

  #makeLeaf(size, rnd) {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(LEAF_GEO, this.leafMat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.scale.set(
      size * (1.35 + rnd() * 0.35),
      size * (0.4 + rnd() * 0.2),
      size * 1.05
    );
    g.add(mesh);
    g.scale.setScalar(0.001);
    g.visible = false;
    return {
      group: g,
      unlock: 0,
      growSpan: 0.1,
      seg: null,
      along: 0,
      baseX: 0,
      baseZ: 0
    };
  }

  #applyGrowth(instant) {
    const g = instant ? this.growth : this.displayGrowth;

    const t = smooth01(g);
    const worldH = THREE.MathUtils.lerp(TREE_MIN_HEIGHT, TREE_MAX_HEIGHT, t);
    this.root.scale.setScalar(worldH / MODEL_FULL_HEIGHT);

    const trunkThick = 1 + t * 0.35;

    for (const seg of this.segments) {
      const span = Math.max(seg.growSpan, 0.001);
      const local = smooth01((g - seg.unlock) / span);
      const alive = seg.gen === 0 || local > 0.01;
      seg.group.visible = alive;
      if (!alive) {
        seg.mesh.scale.set(0.001, 0.001, 0.001);
        seg.tip.position.set(0, 0, 0);
        seg.lengthScale = 0;
        continue;
      }

      let lenS;
      let thickS;
      if (seg.gen === 0) {
        lenS = 1;
        thickS = trunkThick;
      } else {
        lenS = 0.08 + local * 0.92;
        thickS = (0.3 + local * 0.7) * (0.9 + g * 0.2);
      }

      seg.lengthScale = lenS;
      const len = seg.fullLen * lenS;
      seg.mesh.scale.set(thickS, len, thickS);
      seg.tip.position.set(0, len, 0);
    }

    for (const a of this.attachments) {
      const pl = a.parentSeg.fullLen * a.parentSeg.lengthScale;
      a.pivot.position.set(0, pl * a.along, 0);
      a.pivot.visible = a.parentSeg.lengthScale > 0.05;
    }

    for (const leaf of this.leaves) {
      const parentReady = leaf.seg.lengthScale > 0.2;
      if (!parentReady) {
        leaf.group.visible = false;
        leaf.group.scale.setScalar(0.001);
        continue;
      }
      const local = smooth01((g - leaf.unlock) / Math.max(leaf.growSpan, 0.001));
      const alive = local > 0.02;
      leaf.group.visible = alive;
      leaf.group.scale.setScalar(Math.max(0.001, local * (0.85 + g * 0.3)));
      leaf.group.position.set(
        leaf.baseX,
        leaf.along * leaf.seg.fullLen * leaf.seg.lengthScale,
        leaf.baseZ
      );
    }

    if (this.hitProxy) {
      const r = 1.4 + g * 3.2;
      this.hitProxy.scale.set(r, 1, r);
      this.hitProxy.castShadow = false;
    }

    this.leafMat.emissiveIntensity = 0.4 + g * 0.8;
    this.goldBark.emissiveIntensity = 0.1 + g * 0.45;
  }
}
