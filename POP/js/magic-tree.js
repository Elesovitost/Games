import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { mulberry32 } from "./animalsAI.js";
import { makeTreeBlockR } from "./blockers.js";
import {
  TREE_GROW_TIME,
  TREE_MAX_HEIGHT,
  treeSizeAt,
  treeThickAt,
  growthFront,
  pathAppear,
  leafAppearAlong
} from "./tree-grow.js";

const _dummy = new THREE.Object3D();
const _yUp = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _end = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _spinQ = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _nx = new THREE.Vector3();
const _ny = new THREE.Vector3();
const _col = new THREE.Color();
const _wiz = new THREE.Color();
const _glow = new THREE.Color();
const TREE_YELLOW = new THREE.Color(0xffe566);

let _woodGeo = null;
let _leafGeo = null;
let _flyGeo = null;

const FIREFLY_N = 20;

function woodGeo() {
  if (!_woodGeo) _woodGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1);
  return _woodGeo;
}

function flyGeo() {
  if (!_flyGeo) _flyGeo = new THREE.IcosahedronGeometry(1, 0);
  return _flyGeo;
}

/** Jeden blob = mrak lístků na větvi (20 trojúhelníků). */
function leafGeo() {
  if (!_leafGeo) {
    _leafGeo = new THREE.IcosahedronGeometry(1, 0);
    const pos = _leafGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, pos.getY(i) * 0.72);
    }
    pos.needsUpdate = true;
    _leafGeo.computeVertexNormals();
  }
  return _leafGeo;
}

function v(x, y, z) {
  return new THREE.Vector3(x, y, z);
}

function hashDir(dir) {
  const x = Math.abs(dir.x * 1e6) | 0;
  const y = Math.abs(dir.y * 1e5) | 0;
  const z = Math.abs(dir.z * 1e4) | 0;
  return (x ^ (y * 374761393) ^ (z * 668265263)) >>> 0;
}

/**
 * Lípa: krátký kmen, větve do koule (výška ≈ šířka).
 * Listy jen na dřevě — žádné volně visící obláčky.
 */
function buildSkeleton(rng) {
  const woods = [];
  const leaves = [];
  const S = 1.5;
  const trunkH = 2.15 * S;
  const crownC = v(0, 5.05 * S, 0);
  const crownR = 4.7 * S;

  const segs = [0.42, 0.33, 0.25];
  const rads = [0.42 * S, 0.3 * S, 0.18 * S];
  let y = 0;
  for (let i = 0; i < 3; i++) {
    const h = trunkH * segs[i];
    woods.push({
      start: v(0, y, 0),
      end: v(0, y + h, 0),
      r: rads[i],
      order: 0,
      pathStart: y,
      pathEnd: y + h
    });
    y += h;
  }

  function addLeafOnWood(start, end, along, radial, size, pathStart, pathEnd) {
    leaves.push({
      start: start.clone(),
      end: end.clone(),
      along,
      radial,
      radAng: rng() * Math.PI * 2,
      size,
      pathStart,
      pathEnd
    });
  }

  function addBranch(start, dir, len, r, order, pathStart) {
    const end = start.clone().addScaledVector(dir, len);
    const pathEnd = pathStart + len;
    woods.push({ start: start.clone(), end, r, order, pathStart, pathEnd });

    if (order >= 4) {
      addLeafOnWood(start, end, 0.55, r * 0.4, Math.max(0.26 * S, r * 4.2), pathStart, pathEnd);
      addLeafOnWood(start, end, 0.78, r * 0.45, Math.max(0.3 * S, r * 4.8), pathStart, pathEnd);
      addLeafOnWood(start, end, 0.98, r * 0.25, Math.max(0.28 * S, r * 4.4), pathStart, pathEnd);
      return;
    }

    const n = order === 1 ? 3 : order === 2 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const spin = (i / n) * Math.PI * 2 + rng() * 0.4;
      const towardCrown = crownC.clone().sub(end);
      if (towardCrown.lengthSq() < 1e-6) towardCrown.set(dir.x, 0.4, dir.z);
      towardCrown.normalize();
      const side = new THREE.Vector3(Math.cos(spin), 0.15, Math.sin(spin)).normalize();
      const childDir = new THREE.Vector3()
        .addScaledVector(dir, 0.42 + rng() * 0.18)
        .addScaledVector(towardCrown, 0.38 + rng() * 0.18)
        .addScaledVector(side, 0.22 + rng() * 0.16);
      childDir.normalize();
      const remain = Math.max(0.55 * S, crownR - end.distanceTo(crownC));
      const childLen = Math.min(len * (0.48 + rng() * 0.18), remain * (0.42 + rng() * 0.18));
      const childR = r * (0.55 + rng() * 0.12);
      addBranch(end, childDir, childLen, childR, order + 1, pathEnd);
    }

    if (order >= 2) {
      addLeafOnWood(start, end, 0.7, r * 0.28, Math.max(0.22 * S, r * 3.6), pathStart, pathEnd);
    }
    if (order === 1) {
      addLeafOnWood(start, end, 0.52, r * 0.22, Math.max(0.2 * S, r * 3.0), pathStart, pathEnd);
    }
  }

  const mainN = 20;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < mainN; i++) {
    const gy = 0.92 - (i / Math.max(1, mainN - 1)) * 1.35;
    const gr = Math.sqrt(Math.max(0, 1 - gy * gy));
    const th = golden * i + rng() * 0.2;
    const aim = v(
      crownC.x + Math.cos(th) * gr * crownR,
      crownC.y + gy * crownR * 0.92,
      crownC.z + Math.sin(th) * gr * crownR
    );
    const low = i >= mainN - 6;
    const startY = low ? trunkH * (0.18 + rng() * 0.28) : trunkH * (0.72 + rng() * 0.22);
    const start = v(0, startY, 0);
    const dir = aim.clone().sub(start).normalize();
    const len = start.distanceTo(aim) * (0.38 + rng() * 0.1);
    addBranch(start, dir, len, (0.13 + rng() * 0.03) * S, 1, startY);
  }

  addLeafOnWood(woods[1].start, woods[1].end, 0.7, 0.06 * S, 0.18 * S, woods[1].pathStart, woods[1].pathEnd);
  addLeafOnWood(woods[2].start, woods[2].end, 0.85, 0.05 * S, 0.16 * S, woods[2].pathStart, woods[2].pathEnd);

  let maxPath = 0;
  for (let i = 0; i < woods.length; i++) {
    if (woods[i].pathEnd > maxPath) maxPath = woods[i].pathEnd;
  }
  return { woods, leaves, maxPath };
}

function poseWood(seg, size, thick, appear) {
  if (appear < 0.004) {
    _dummy.scale.set(0, 0, 0);
    _dummy.position.set(0, 0, 0);
    _dummy.quaternion.set(0, 0, 0, 1);
    _dummy.updateMatrix();
    return _dummy.matrix;
  }
  _end.copy(seg.end).multiplyScalar(size);
  _pos.copy(seg.start).multiplyScalar(size);
  _end.lerpVectors(_pos, _end, appear);
  _dir.subVectors(_end, _pos);
  const len = _dir.length();
  if (len < 1e-5) {
    _dummy.scale.set(0, 0, 0);
    _dummy.updateMatrix();
    return _dummy.matrix;
  }
  _dir.multiplyScalar(1 / len);
  _mid.copy(_pos).addScaledVector(_dir, len * 0.5);
  _quat.setFromUnitVectors(_yUp, _dir);
  const rad = seg.r * size * thick * (0.55 + 0.45 * appear);
  _dummy.position.copy(_mid);
  _dummy.quaternion.copy(_quat);
  _dummy.scale.set(rad, len, rad);
  _dummy.updateMatrix();
  return _dummy.matrix;
}

/** List sedí na větvi a objeví se, až dřevo doroste k jeho místu. */
function poseLeaf(leaf, size, woodAppear, leafAppear) {
  if (leafAppear < 0.004 || woodAppear < leaf.along * 0.82) {
    _dummy.scale.set(0, 0, 0);
    _dummy.position.set(0, 0, 0);
    _dummy.quaternion.set(0, 0, 0, 1);
    _dummy.updateMatrix();
    return _dummy.matrix;
  }
  const along = leaf.along * woodAppear;
  _pos.copy(leaf.start).multiplyScalar(size);
  _end.copy(leaf.end).multiplyScalar(size);
  _dir.subVectors(_end, _pos);
  const len = _dir.length();
  if (len < 1e-5) {
    _dummy.scale.set(0, 0, 0);
    _dummy.updateMatrix();
    return _dummy.matrix;
  }
  _dir.multiplyScalar(1 / len);
  _pos.addScaledVector(_dir, len * along);
  if (leaf.radial > 1e-4) {
    if (Math.abs(_dir.y) < 0.92) _nx.set(0, 1, 0);
    else _nx.set(1, 0, 0);
    _nx.cross(_dir).normalize();
    _ny.copy(_dir).cross(_nx);
    _pos.addScaledVector(_nx, Math.cos(leaf.radAng) * leaf.radial * size * woodAppear);
    _pos.addScaledVector(_ny, Math.sin(leaf.radAng) * leaf.radial * size * woodAppear);
  }
  const s = leaf.size * size * leafAppear;
  _quat.setFromAxisAngle(_yUp, leaf.radAng);
  _dummy.position.copy(_pos);
  _dummy.quaternion.copy(_quat);
  _dummy.scale.set(s, s * 0.78, s);
  _dummy.updateMatrix();
  return _dummy.matrix;
}

function makeFireflies(rng) {
  const flies = [];
  for (let i = 0; i < FIREFLY_N; i++) {
    flies.push({
      kind: i % 3,
      phase: rng() * Math.PI * 2,
      speed: (0.28 + rng() * 0.72) * (rng() < 0.5 ? 1 : -1),
      r0: 3.4 + rng() * 4.8,
      rAmp: 0.35 + rng() * 1.7,
      rFreq: 0.12 + rng() * 0.4,
      y0: 3.2 + rng() * 7.8,
      yAmp: 0.5 + rng() * 2.4,
      yFreq: 0.16 + rng() * 0.48,
      climb: 0.22 + rng() * 0.55,
      tilt: (rng() - 0.5) * 0.7,
      tiltAz: rng() * Math.PI * 2,
      blinkPh: rng() * Math.PI * 2,
      blinkSp: 0.7 + rng() * 1.4,
      size: 0.09 + rng() * 0.07
    });
  }
  return flies;
}

function poseFirefly(f, t, g) {
  if (g < 0.04) {
    _dummy.scale.set(0, 0, 0);
    _dummy.position.set(0, 0, 0);
    _dummy.quaternion.set(0, 0, 0, 1);
    _dummy.updateMatrix();
    return _dummy.matrix;
  }
  const s = 0.18 + 0.82 * g;
  let theta = f.phase + t * f.speed;
  let r;
  let y;
  if (f.kind === 0) {
    r = (f.r0 + f.rAmp * Math.sin(t * f.rFreq + f.phase)) * s;
    y = (f.y0 + f.yAmp * Math.sin(t * f.yFreq + f.phase * 1.3)) * s;
  } else if (f.kind === 1) {
    const u = t * f.climb + f.phase;
    r = (f.r0 * 0.82 + f.rAmp * Math.sin(theta * 0.4 + f.phase)) * s;
    y = (2.4 + (0.5 + 0.5 * Math.sin(u)) * 9.2) * s;
  } else {
    r = (f.r0 + f.rAmp * Math.sin(theta * 0.55) * Math.cos(t * f.rFreq)) * s;
    y = (f.y0 + f.yAmp * Math.sin(theta * 1.65 + f.phase)) * s;
    theta += 0.35 * Math.sin(t * f.yFreq + f.phase);
  }
  let x = r * Math.cos(theta);
  let z = r * Math.sin(theta);
  const ct = Math.cos(f.tilt);
  const st = Math.sin(f.tilt);
  const y2 = y * ct - z * st;
  const z2 = y * st + z * ct;
  const ca = Math.cos(f.tiltAz);
  const sa = Math.sin(f.tiltAz);
  _pos.set(x * ca - z2 * sa, y2, x * sa + z2 * ca);
  const blink = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * f.blinkSp + f.blinkPh)) ** 2;
  const sz = f.size * (0.35 + 0.65 * g) * blink;
  _dummy.position.copy(_pos);
  _dummy.quaternion.set(0, 0, 0, 1);
  _dummy.scale.set(sz, sz * 0.82, sz);
  _dummy.updateMatrix();
  return _dummy.matrix;
}

/**
 * Magický strom — dřevo, listy a světlušky. Růst `setGrowth(0..1)`.
 */
export class MagicTree {
  constructor(planetGroup, terrain, dir, colorHex, opts = {}) {
    this.planetGroup = planetGroup;
    this.terrain = terrain;
    this.dir = dir.clone().normalize();
    this.color = Number(colorHex) || 0xe8c44a;
    this.ownerId = opts.ownerId ?? null;
    this._colorApplied = false;
    this.spin = opts.spin ?? 0;
    this.age = 0;
    this.glowT = 0;
    this.growth = 0;
    this.grown = false;
    this.disposed = false;

    const rng = mulberry32(opts.seed ?? hashDir(this.dir) ^ 0x51ed);
    const skel = buildSkeleton(rng);
    this.woods = skel.woods;
    this.leaves = skel.leaves;
    this.maxPath = skel.maxPath;
    this.glowPhase = rng() * Math.PI * 2;
    this.fireflies = makeFireflies(rng);

    this.group = new THREE.Group();
    this.group.frustumCulled = false;

    this.woodMat = new THREE.MeshStandardMaterial({
      color: 0x6b4428,
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide
    });
    _col.setHex(this.color);
    this.leafMat = new THREE.MeshStandardMaterial({
      color: _col,
      roughness: 0.74,
      metalness: 0,
      emissive: 0x000000,
      emissiveIntensity: 0,
      flatShading: true,
      side: THREE.DoubleSide
    });

    this.woodMesh = new THREE.InstancedMesh(woodGeo(), this.woodMat, this.woods.length);
    this.woodMesh.castShadow = true;
    this.woodMesh.receiveShadow = false;
    this.woodMesh.frustumCulled = false;

    this.leafMesh = new THREE.InstancedMesh(leafGeo(), this.leafMat, this.leaves.length);
    this.leafMesh.castShadow = false;
    this.leafMesh.receiveShadow = false;
    this.leafMesh.frustumCulled = false;

    this.light = new THREE.PointLight(0xffe566, 0, 8, 1.5);
    this.light.castShadow = false;
    this.light.position.set(0, 0.4, 0);

    this.flyMat = new THREE.MeshBasicMaterial({
      color: 0xffe566,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.flyMesh = new THREE.InstancedMesh(flyGeo(), this.flyMat, FIREFLY_N);
    this.flyMesh.castShadow = false;
    this.flyMesh.receiveShadow = false;
    this.flyMesh.frustumCulled = false;
    this.flyMesh.renderOrder = 3;

    this.group.add(this.woodMesh, this.leafMesh, this.light, this.flyMesh);
    this.planetGroup.add(this.group);

    this.placement = {
      dir: this.dir,
      height: 0.4,
      spin: this.spin,
      blockR: makeTreeBlockR(0.6),
      magic: true,
      gone: false,
      magicTree: this
    };

    this.setGrowth(0);
    this.setColor(this.color);
    this.pose();
  }

  setColor(hex) {
    const c = Number(hex) || this.color;
    if (this._colorApplied && c === this.color) return;
    this.color = c;
    this._colorApplied = true;
    _col.setHex(c);
    this.leafMat.color.copy(_col);
    this.leafMat.needsUpdate = true;
    this.applyGlow();
  }

  /** Listy = hábit. Světlušky + PointLight: žlutá smíchaná s barvou kouzelníka. */
  applyGlow() {
    const g = this.growth;
    const wave = 0.5 + 0.5 * Math.sin(this.glowT * 1.75 + this.glowPhase);
    const pulse = 0.78 + 0.22 * wave;
    const mix = 0.32 + 0.18 * wave;
    _glow.copy(TREE_YELLOW).lerp(_wiz.setHex(this.color), mix);

    this.light.color.copy(_glow);
    this.light.intensity = g * 9 * pulse;
    this.light.distance = 10 + g * 22;
    this.flyMat.color.copy(_glow);

    for (let i = 0; i < this.fireflies.length; i++) {
      this.flyMesh.setMatrixAt(i, poseFirefly(this.fireflies[i], this.glowT, g));
    }
    this.flyMesh.instanceMatrix.needsUpdate = true;
  }

  setGrowth(g) {
    if (this.disposed) return;
    this.growth = Math.min(1, Math.max(0, g));
    const worldSize = treeSizeAt(this.growth);
    const thick = treeThickAt(this.growth);
    const front = growthFront(this.growth, this.maxPath);

    for (let i = 0; i < this.woods.length; i++) {
      const seg = this.woods[i];
      this.woodMesh.setMatrixAt(i, poseWood(seg, worldSize, thick, pathAppear(front, seg.pathStart, seg.pathEnd)));
    }
    this.woodMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.leaves.length; i++) {
      const leaf = this.leaves[i];
      const woodA = pathAppear(front, leaf.pathStart, leaf.pathEnd);
      const leafA = leafAppearAlong(woodA, leaf.along);
      this.leafMesh.setMatrixAt(i, poseLeaf(leaf, worldSize, woodA, leafA));
    }
    this.leafMesh.instanceMatrix.needsUpdate = true;

    const h = TREE_MAX_HEIGHT * worldSize * Math.max(0.08, this.growth);
    this.light.position.set(0, 1.6 + h * 0.22, 0);
    this.applyGlow();

    this.placement.height = TREE_MAX_HEIGHT * this.growth;
    this.placement.blockR = 0.18 + this.growth * 0.67 * thick;
    this.grown = this.growth >= 0.999;
  }

  pose() {
    if (this.disposed) return;
    const h = this.terrain.height(this.dir);
    _pos.copy(this.dir).multiplyScalar(h);
    _quat.setFromUnitVectors(_yUp, this.dir);
    _spinQ.setFromAxisAngle(_yUp, this.spin);
    _quat.multiply(_spinQ);
    this.group.position.copy(_pos);
    this.group.quaternion.copy(_quat);
  }

  update(dt) {
    if (this.disposed) return;
    this.glowT += dt;
    if (!this.grown) {
      this.age += dt;
      this.setGrowth(this.age / TREE_GROW_TIME);
    } else {
      this.applyGlow();
    }
    this.pose();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.placement.gone = true;
    this.planetGroup.remove(this.group);
    this.woodMat.dispose();
    this.leafMat.dispose();
    this.flyMat.dispose();
    this.light.dispose();
  }
}

/** Sázej všude kromě vody — hráč mířil na konkrétní místo. */
export function canPlantMagicTree(terrain, dir) {
  const h = terrain.height(dir);
  return h >= CONFIG.waterLevel - 0.02;
}
