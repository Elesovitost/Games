import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tangentFrame, surfaceOffsetDir, capWithMargin, dirNearCaps } from "./utils.js";
import { surfaceDist } from "./spells/fx-common.js";
import { BURN_DURATION, CHAR_COLOR, attachFireQueued, setBurnGlow } from "./burn.js";

const TREE_COUNT = 100;
const VARIANTS = 6;
const CLUSTER_COUNT = 18;

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSphereDir(rng) {
  const u = rng();
  const v = rng();
  const theta = Math.PI * 2 * u;
  const z = 2 * v - 1;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new THREE.Vector3(r * Math.cos(theta), z, r * Math.sin(theta));
}

/** Přidá válec mezi dvěma body do akumulátoru (Y-up lokální prostor). */
function pushCylinder(verts, idx, a, b, r0, r1, seg = 5) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 1e-4) return;
  dir.normalize();
  const up = Math.abs(dir.y) < 0.92 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const rx = new THREE.Vector3().crossVectors(up, dir).normalize();
  const ry = new THREE.Vector3().crossVectors(dir, rx);
  const base = verts.length / 3;
  for (let ring = 0; ring <= 1; ring++) {
    const t = ring;
    const r = r0 + (r1 - r0) * t;
    const c = ring === 0 ? a : b;
    for (let i = 0; i < seg; i++) {
      const ang = (i / seg) * Math.PI * 2;
      const co = Math.cos(ang);
      const si = Math.sin(ang);
      verts.push(
        c.x + (rx.x * co + ry.x * si) * r,
        c.y + (rx.y * co + ry.y * si) * r,
        c.z + (rx.z * co + ry.z * si) * r
      );
    }
  }
  for (let i = 0; i < seg; i++) {
    const i0 = base + i;
    const i1 = base + ((i + 1) % seg);
    const i2 = base + seg + i;
    const i3 = base + seg + ((i + 1) % seg);
    idx.push(i0, i1, i2, i1, i3, i2);
  }
}

function pushLeafCluster(verts, idx, center, size, rng) {
  const n = 4 + ((rng() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const off = new THREE.Vector3(
      (rng() - 0.5) * size * 1.6,
      (rng() - 0.2) * size * 1.2,
      (rng() - 0.5) * size * 1.6
    );
    const c = center.clone().add(off);
    const r = size * (0.35 + rng() * 0.35);
    const seg = 5;
    const base = verts.length / 3;
    for (let j = 0; j <= seg; j++) {
      const lat = (j / seg) * Math.PI;
      const sinLat = Math.sin(lat);
      const cosLat = Math.cos(lat);
      for (let k = 0; k <= seg; k++) {
        const lon = (k / seg) * Math.PI * 2;
        verts.push(
          c.x + r * sinLat * Math.cos(lon),
          c.y + r * cosLat,
          c.z + r * sinLat * Math.sin(lon)
        );
      }
    }
    for (let j = 0; j < seg; j++) {
      for (let k = 0; k < seg; k++) {
        const a = base + j * (seg + 1) + k;
        const b = a + seg + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
}

function buildBranch(
  start,
  dir,
  length,
  radius,
  order,
  rng,
  woodV,
  woodI,
  leafV,
  leafI
) {
  const end = start.clone().addScaledVector(dir, length);
  pushCylinder(woodV, woodI, start, end, radius, radius * 0.72, 4);

  if (order >= 3) {
    pushLeafCluster(leafV, leafI, end, radius * 3.2, rng);
    return;
  }

  const count = order === 1 ? 3 + ((rng() * 3) | 0) : 2 + ((rng() * 2) | 0);
  for (let i = 0; i < count; i++) {
    const tilt = 0.35 + rng() * 0.55;
    const spin = rng() * Math.PI * 2;
    const bx = Math.cos(spin);
    const bz = Math.sin(spin);
    const bDir = new THREE.Vector3(bx, tilt, bz).normalize();
    const childLen = length * (0.45 + rng() * 0.25);
    const childR = radius * (0.55 + rng() * 0.15);
    buildBranch(end, bDir, childLen, childR, order + 1, rng, woodV, woodI, leafV, leafI);
  }

  if (order === 2 && rng() > 0.35) {
    pushLeafCluster(leafV, leafI, end, radius * 2.8, rng);
  }
}

function buildTreeVariant(rng, protoHeight = 4) {
  const woodV = [];
  const woodI = [];
  const leafV = [];
  const leafI = [];

  const trunkH = protoHeight * (0.48 + rng() * 0.08);
  const trunkR = 0.12 + rng() * 0.04;
  pushCylinder(
    woodV,
    woodI,
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, trunkH, 0),
    trunkR,
    trunkR * 0.75,
    6
  );

  const mainCount = 4 + ((rng() * 3) | 0);
  for (let i = 0; i < mainCount; i++) {
    const spin = (i / mainCount) * Math.PI * 2 + rng() * 0.8;
    const startY = trunkH * (0.55 + rng() * 0.25);
    const start = new THREE.Vector3(0, startY, 0);
    const tilt = 0.4 + rng() * 0.45;
    const dir = new THREE.Vector3(Math.cos(spin) * Math.sin(tilt), Math.cos(tilt), Math.sin(spin) * Math.sin(tilt)).normalize();
    const len = protoHeight * (0.22 + rng() * 0.18);
    buildBranch(start, dir, len, trunkR * 0.55, 1, rng, woodV, woodI, leafV, leafI);
  }

  pushLeafCluster(leafV, leafI, new THREE.Vector3(0, trunkH * 1.02, 0), trunkR * 4.5, rng);

  const toGeo = (v, i) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    geo.setIndex(i);
    geo.computeVertexNormals();
    return geo;
  };

  return {
    wood: toGeo(woodV, woodI),
    leaf: toGeo(leafV, leafI)
  };
}

function canPlant(terrain, dir, east, north) {
  const h = terrain.height(dir);
  if (h < CONFIG.waterLevel + 0.3) return false;
  if (h < CONFIG.wizardMinTerrainR + 0.05) return false;

  const eps = 0.05;
  const tmp = new THREE.Vector3();
  tmp.copy(dir).addScaledVector(east, eps).normalize();
  const hE = terrain.height(tmp);
  tmp.copy(dir).addScaledVector(north, eps).normalize();
  const hN = terrain.height(tmp);
  const grade = Math.max(Math.abs(hE - h), Math.abs(hN - h)) / eps;
  return grade < 1.1;
}

export class Trees {
  constructor(planetGroup, terrain, seed = CONFIG.defaultMapSeed) {
    this.planetGroup = planetGroup;
    this.terrain = terrain;
    /** @type {{ dir: THREE.Vector3, variant: number, height: number, spin: number }[]} */
    this.placements = [];
    this.meshes = [];
    /** @type {{ p: object, group: THREE.Group, leaf: THREE.Mesh, woodMat: THREE.Material, leafMat: THREE.Material, fire: ReturnType<typeof attachFire> | null, t: number, charred: boolean }[]} */
    this.burns = [];

    this._east = new THREE.Vector3();
    this._north = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._yUp = new THREE.Vector3(0, 1, 0);
    this._mat4 = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
    this._spinQ = new THREE.Quaternion();
    this._scale = new THREE.Vector3();

    this.variants = [];
    const vr = mulberry32(seed ^ 0x7e4a1);
    for (let i = 0; i < VARIANTS; i++) this.variants.push(buildTreeVariant(vr));

    this.woodMat = new THREE.MeshStandardMaterial({
      color: 0x5a3d22,
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide
    });
    this.leafMat = new THREE.MeshStandardMaterial({
      color: 0x3d8a32,
      roughness: 0.82,
      metalness: 0,
      flatShading: true,
      side: THREE.DoubleSide
    });

    this.#scatter(seed);
    this.#createInstances();
    this.refresh();
  }

  #scatter(seed) {
    const rng = mulberry32(seed ^ 0x9e3779b9);
    const dirs = [];

    for (let c = 0; c < CLUSTER_COUNT; c++) {
      let center = null;
      for (let tryN = 0; tryN < 40; tryN++) {
        const d = randomSphereDir(rng);
        tangentFrame(d, this._east, this._north);
        if (canPlant(this.terrain, d, this._east, this._north)) {
          center = d.clone();
          break;
        }
      }
      if (!center) continue;

      tangentFrame(center, this._east, this._north);
      const count = 3 + ((rng() * 6) | 0);
      for (let i = 0; i < count && dirs.length < TREE_COUNT; i++) {
        const dist = i === 0 ? 0 : 0.6 + rng() * 4.2;
        const ang = rng() * Math.PI * 2;
        const dir = dist < 0.01
          ? center.clone()
          : surfaceOffsetDir(center, this._east, this._north, ang, dist, new THREE.Vector3());
        tangentFrame(dir, this._east, this._north);
        if (!canPlant(this.terrain, dir, this._east, this._north)) continue;
        dirs.push({
          dir,
          variant: (rng() * VARIANTS) | 0,
          height: 3 + rng() * 2,
          spin: rng() * Math.PI * 2
        });
      }
    }

    while (dirs.length < TREE_COUNT) {
      const d = randomSphereDir(rng);
      tangentFrame(d, this._east, this._north);
      if (!canPlant(this.terrain, d, this._east, this._north)) continue;
      dirs.push({
        dir: d.clone(),
        variant: (rng() * VARIANTS) | 0,
        height: 3 + rng() * 2,
        spin: rng() * Math.PI * 2
      });
    }

    this.placements = dirs.slice(0, TREE_COUNT);
  }

  #createInstances() {
    const buckets = Array.from({ length: VARIANTS }, () => []);
    for (const p of this.placements) buckets[p.variant].push(p);

    for (let v = 0; v < VARIANTS; v++) {
      const list = buckets[v];
      if (!list.length) continue;
      const proto = this.variants[v];

      for (const [geo, mat, shadow] of [
        [proto.wood, this.woodMat, true],
        [proto.leaf, this.leafMat, false]
      ]) {
        const mesh = new THREE.InstancedMesh(geo, mat, list.length);
        mesh.castShadow = shadow;
        mesh.receiveShadow = false;
        mesh.frustumCulled = false;
        mesh.userData.treePart = true;
        this.planetGroup.add(mesh);
        this.meshes.push({ mesh, list });
      }
    }
  }

  #matrixForPlacement(p, out) {
    if (p.burning || p.gone) {
      this._scale.set(0, 0, 0);
      this._pos.set(0, 0, 0);
      this._quat.set(0, 0, 0, 1);
      return out.compose(this._pos, this._quat, this._scale);
    }
    const dir = p.dir;
    const h = this.terrain.height(dir);
    this._pos.copy(dir).multiplyScalar(h);
    this._quat.setFromUnitVectors(this._yUp, dir);
    this._spinQ.setFromAxisAngle(this._yUp, p.spin);
    this._quat.multiply(this._spinQ);

    const s = p.height / 4;
    this._scale.set(s, s, s);
    return out.compose(this._pos, this._quat, this._scale);
  }

  #poseBurnGroup(entry) {
    const p = entry.p;
    const h = this.terrain.height(p.dir);
    this._pos.copy(p.dir).multiplyScalar(h);
    this._quat.setFromUnitVectors(this._yUp, p.dir);
    this._spinQ.setFromAxisAngle(this._yUp, p.spin);
    this._quat.multiply(this._spinQ);
    const s = p.height / 4;
    entry.group.position.copy(this._pos);
    entry.group.quaternion.copy(this._quat);
    entry.group.scale.set(s, s, s);
  }

  /** Je v okruhu živý (neodstraněný) strom? Nic neničí, jen test kolize
   * pro projektily jako valící se ledová koule. */
  hasNear(centerDir, radiusM) {
    if (!centerDir || radiusM <= 0) return false;
    for (const p of this.placements) {
      if (p.gone) continue;
      if (surfaceDist(p.dir, centerDir) <= radiusM) return true;
    }
    return false;
  }

  /** Zapálí stromy v radiu (přímý zásah blesku / fireballu). */
  igniteNear(centerDir, radiusM) {
    if (!centerDir || radiusM <= 0) return;
    for (const p of this.placements) {
      if (p.burning || p.gone) continue;
      if (surfaceDist(p.dir, centerDir) <= radiusM) this.#ignitePlacement(p);
    }
  }

  /** Odpaří stromy v radiu (kráter komety) — zmizí i s hořícími. */
  vaporizeNear(centerDir, radiusM) {
    if (!centerDir || radiusM <= 0) return;
    for (let i = this.burns.length - 1; i >= 0; i--) {
      const entry = this.burns[i];
      if (surfaceDist(entry.p.dir, centerDir) > radiusM) continue;
      if (entry.fire) entry.fire.dispose();
      this.planetGroup.remove(entry.group);
      entry.woodMat.dispose();
      entry.leafMat.dispose();
      entry.p.burning = false;
      this.burns.splice(i, 1);
    }
    for (const p of this.placements) {
      if (p.gone) continue;
      if (surfaceDist(p.dir, centerDir) > radiusM) continue;
      p.gone = true;
      this.#hideInstance(p);
    }
  }

  /** Zapálí stromy, kde predikát (láva) vrátí true. */
  igniteWhere(pred) {
    if (!pred) return;
    for (const p of this.placements) {
      if (p.burning || p.gone) continue;
      if (pred(p.dir)) this.#ignitePlacement(p);
    }
  }

  #ignitePlacement(p) {
    if (p.burning) return;
    p.burning = true;
    const proto = this.variants[p.variant];
    const woodMat = this.woodMat.clone();
    const leafMat = this.leafMat.clone();
    leafMat.transparent = true;
    const wood = new THREE.Mesh(proto.wood, woodMat);
    const leaf = new THREE.Mesh(proto.leaf, leafMat);
    wood.castShadow = true;
    wood.receiveShadow = false;
    leaf.castShadow = false;
    const group = new THREE.Group();
    group.frustumCulled = false;
    group.add(wood, leaf);
    /**
     * Nižší pad než dřív — `fireSizeOf` bere celou výšku stromu (~4 m i s
     * korunou), takže pad 1.22 dělal plameny vyšší než strom samotný.
     */
    const fire = attachFireQueued(group, { pad: 0.4 });
    this.planetGroup.add(group);

    const entry = { p, group, leaf, woodMat, leafMat, fire, t: 0, charred: false };
    this.burns.push(entry);
    this.#poseBurnGroup(entry);
    this.#hideInstance(p);
  }

  #hideInstance(p) {
    this.#matrixForPlacement(p, this._mat4);
    for (const { mesh, list } of this.meshes) {
      const i = list.indexOf(p);
      if (i < 0) continue;
      mesh.setMatrixAt(i, this._mat4);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  #charTree(entry) {
    if (entry.charred) return;
    entry.charred = true;
    entry.leaf.visible = false;
    entry.woodMat.color.setHex(CHAR_COLOR);
    entry.woodMat.roughness = 0.97;
    entry.woodMat.emissive.setHex(0x000000);
    entry.woodMat.emissiveIntensity = 0;
    entry.woodMat.needsUpdate = true;
    if (entry.fire) {
      if (entry.fire.group) entry.group.remove(entry.fire.group);
      entry.fire.dispose();
      entry.fire = null;
    }
  }

  update(dt) {
    for (const entry of this.burns) {
      if (entry.charred) continue;
      entry.t += dt;
      const left = BURN_DURATION - entry.t;
      if (entry.fire) {
        entry.fire.setStrength(left < 1.2 ? Math.max(0, left / 1.2) : 1);
        entry.fire.update(dt);
      }
      setBurnGlow([entry.woodMat, entry.leafMat], left < 1.2 ? Math.max(0, left / 1.2) : 1);
      if (left < 1.4) {
        entry.leafMat.opacity = Math.max(0, left / 1.4);
        entry.leafMat.needsUpdate = true;
      }
      if (entry.t >= BURN_DURATION) this.#charTree(entry);
    }
  }

  clearBurns() {
    for (const p of this.placements) p.gone = false;
    for (const entry of this.burns) {
      if (entry.fire) entry.fire.dispose();
      this.planetGroup.remove(entry.group);
      entry.woodMat.dispose();
      entry.leafMat.dispose();
      entry.p.burning = false;
    }
    this.burns.length = 0;
    this.refresh();
  }

  refresh() {
    for (const { mesh, list } of this.meshes) {
      for (let i = 0; i < list.length; i++) {
        this.#matrixForPlacement(list[i], this._mat4);
        mesh.setMatrixAt(i, this._mat4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const entry of this.burns) this.#poseBurnGroup(entry);
  }

  /**
   * Přepočítá jen stromy poblíž aktivních morphů terénu (`terrain.morphs`),
   * ne všech 100 instancí každý frame. Bez morphů = plný refresh (dosednutí).
   */
  refreshNear(morphs, margin = 2.2) {
    if (!morphs?.length) {
      this.refresh();
      return;
    }
    const caps = morphs.map((m) => capWithMargin(m.cap, margin));
    for (const { mesh, list } of this.meshes) {
      let changed = false;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (!dirNearCaps(p.dir, caps)) continue;
        this.#matrixForPlacement(p, this._mat4);
        mesh.setMatrixAt(i, this._mat4);
        changed = true;
      }
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.burns.length) {
      for (const entry of this.burns) {
        if (dirNearCaps(entry.p.dir, caps)) this.#poseBurnGroup(entry);
      }
    }
  }

  dispose() {
    this.clearBurns();
    for (const { mesh } of this.meshes) {
      this.planetGroup.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.length = 0;
    for (const v of this.variants) {
      v.wood.dispose();
      v.leaf.dispose();
    }
    this.woodMat.dispose();
    this.leafMat.dispose();
  }
}
