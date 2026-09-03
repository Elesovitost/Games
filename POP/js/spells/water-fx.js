import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { tangentFrame, tmp } from "../utils.js";

const _yUp = new THREE.Vector3(0, 1, 0);
const _zUp = new THREE.Vector3(0, 0, 1);
const _basisX = new THREE.Vector3();
const _basisY = new THREE.Vector3();
const _basisZ = new THREE.Vector3();
const _mat = new THREE.Matrix4();

let _rippleMap = null;
let _wakeMap = null;

/** Terén pod hladinou (pod vodou nebo na dně). */
export function isWaterAt(sys, dir) {
  return sys.terrain.height(dir) < CONFIG.waterLevel + 0.06;
}

function makeSoftRingMap(res = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = res;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(res, res);
  const data = img.data;
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const nx = (x + 0.5) / res * 2 - 1;
      const ny = (y + 0.5) / res * 2 - 1;
      const d = Math.hypot(nx, ny);
      const a = Math.atan2(ny, nx);
      const wobble = 1 + Math.sin(a * 5.0 + 0.6) * 0.045 + Math.sin(a * 9.0 - 1.1) * 0.025;
      const ring = Math.exp(-((d - 0.67 * wobble) ** 2) / 0.0028);
      const inner = Math.exp(-((d - 0.45 * wobble) ** 2) / 0.006);
      const foam = Math.max(0, ring + inner * 0.35) * (1 - Math.max(0, d - 0.75) / 0.25);
      const i = (y * res + x) * 4;
      data[i] = 235;
      data[i + 1] = 248;
      data[i + 2] = 255;
      data[i + 3] = Math.max(0, Math.min(255, foam * 210));
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function makeWakeMap(res = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = res;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(res, res);
  const data = img.data;
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const nx = (x + 0.5) / res * 2 - 1;
      const ny = (y + 0.5) / res * 2 - 1;
      const back = Math.max(0, -ny);
      const spread = 0.12 + back * 0.62;
      const sideFoam = Math.exp(-((Math.abs(nx) - spread) ** 2) / 0.012) * back;
      const centerTrail = Math.exp(-(nx * nx) / 0.05) * back * 0.35;
      const fade = Math.max(0, 1 - Math.hypot(nx * 0.85, ny * 0.65));
      const foam = (sideFoam + centerTrail) * fade;
      const i = (y * res + x) * 4;
      data[i] = 225;
      data[i + 1] = 246;
      data[i + 2] = 255;
      data[i + 3] = Math.max(0, Math.min(255, foam * 185));
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function rippleMap() {
  if (!_rippleMap) _rippleMap = makeSoftRingMap();
  return _rippleMap;
}

function wakeMap() {
  if (!_wakeMap) _wakeMap = makeWakeMap();
  return _wakeMap;
}

function makeRippleRing(n, radius, delay, maxScale, life) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    map: rippleMap(),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const line = new THREE.Mesh(geo, mat);
  line.position.copy(n).multiplyScalar(CONFIG.waterLevel + 0.02);
  line.quaternion.setFromUnitVectors(_zUp, n);
  line.scale.setScalar(radius * 2);
  line.renderOrder = 3;
  return { line, mat, geo, t: -delay, life, maxScale, baseScale: radius * 2, kind: "ring" };
}

/** Tenké kruhy na hladině + tříšť — náraz do vody. */
export function spawnWaterSplash(sys, dir, radiusM = 1.4) {
  const n = dir.clone().normalize();
  tangentFrame(n, tmp.east, tmp.north);

  if (!sys.waterRipples) sys.waterRipples = [];
  if (!sys.waterSpray) sys.waterSpray = [];

  const ringCount = 4;
  for (let i = 0; i < ringCount; i++) {
    const r = 0.06 + i * 0.04;
    const ripple = makeRippleRing(n, r, i * 0.06, (radiusM * 2.4) / r, 0.75 + i * 0.18);
    sys.planetGroup.add(ripple.line);
    sys.waterRipples.push(ripple);
  }

  // Krátký centrální „korunka“
  const crownMat = new THREE.MeshBasicMaterial({
    color: 0xf0f8ff,
    transparent: true,
    opacity: 0.65,
    depthWrite: false
  });
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), crownMat);
  crown.position.copy(n).multiplyScalar(CONFIG.waterLevel + 0.06);
  crown.scale.set(1.2, 0.35, 1.2);
  crown.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  sys.planetGroup.add(crown);
  sys.waterSpray.push({
    mesh: crown,
    mat: crownMat,
    vel: n.clone().multiplyScalar(0.5),
    t: 0,
    life: 0.18,
    gravity: n.clone().multiplyScalar(-8),
    drag: 0.7,
    crown: true
  });

  const base = n.clone().multiplyScalar(CONFIG.waterLevel);
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 3.8;
    const vel = tmp.east
      .clone()
      .multiplyScalar(Math.cos(a) * speed)
      .addScaledVector(tmp.north, Math.sin(a) * speed)
      .addScaledVector(n, 2.2 + Math.random() * 4.5);
    const mat = new THREE.MeshBasicMaterial({
      color: Math.random() > 0.45 ? 0xd0e8f8 : 0xf4fbff,
      transparent: true,
      opacity: 0.75,
      depthWrite: false
    });
    const r = 0.025 + Math.random() * 0.04;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 4, 3), mat);
    mesh.position.copy(base).addScaledVector(n, 0.03 + Math.random() * 0.06);
    sys.planetGroup.add(mesh);
    sys.waterSpray.push({
      mesh,
      mat,
      vel,
      t: 0,
      life: 0.22 + Math.random() * 0.28,
      gravity: n.clone().multiplyScalar(-18),
      drag: 0.84
    });
  }
}

export function spawnWaterWake(sys, dir, facing, opts = {}) {
  if (!sys?.planetGroup || !dir) return;
  if (!sys.waterRipples) sys.waterRipples = [];
  if (sys.waterRipples.length > 80) return;

  const n = dir.clone().normalize();
  _basisY.copy(facing || _yUp).addScaledVector(n, -n.dot(facing || _yUp));
  if (_basisY.lengthSq() < 1e-8) {
    tangentFrame(n, tmp.east, _basisY);
  } else {
    _basisY.normalize();
  }
  _basisX.crossVectors(_basisY, n).normalize();
  _basisZ.copy(n);
  _mat.makeBasis(_basisX, _basisY, _basisZ);

  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    map: wakeMap(),
    transparent: true,
    opacity: opts.opacity ?? 0.48,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geo, mat);
  const back = opts.back ?? opts.size ?? 0.45;
  mesh.position.copy(n).multiplyScalar(CONFIG.waterLevel + 0.028).addScaledVector(_basisY, -back);
  mesh.quaternion.setFromRotationMatrix(_mat);
  const size = opts.size ?? 0.65;
  mesh.scale.set(size * 1.15, size * 1.75, 1);
  mesh.renderOrder = 3;
  sys.planetGroup.add(mesh);
  sys.waterRipples.push({
    line: mesh,
    mat,
    geo,
    t: 0,
    life: opts.life ?? 0.7,
    baseX: size * 1.15,
    baseY: size * 1.75,
    opacity: opts.opacity ?? 0.48,
    kind: "wake"
  });
}

export function updateWaterFx(sys, dt) {
  if (sys.waterRipples?.length) {
    for (let i = sys.waterRipples.length - 1; i >= 0; i--) {
      const r = sys.waterRipples[i];
      r.t += dt;
      if (r.t < 0) continue;
      const u = r.t / r.life;
      if (r.kind === "wake") {
        r.line.scale.set(r.baseX * (1 + u * 0.55), r.baseY * (1 + u * 0.85), 1);
        r.mat.opacity = Math.max(0, r.opacity * (1 - u) * (1 - u));
      } else {
        const scale = r.baseScale * (1 + u * r.maxScale);
        r.line.scale.set(scale, scale, 1);
        r.mat.opacity = Math.max(0, 0.58 * (1 - u) * (1 - u * 0.5));
      }
      if (u >= 1) {
        sys.planetGroup.remove(r.line);
        r.geo.dispose();
        r.mat.dispose();
        sys.waterRipples.splice(i, 1);
      }
    }
  }

  if (sys.waterSpray?.length) {
    for (let i = sys.waterSpray.length - 1; i >= 0; i--) {
      const s = sys.waterSpray[i];
      s.t += dt;
      const u = s.t / s.life;
      s.vel.addScaledVector(s.gravity, dt);
      s.vel.multiplyScalar(s.drag);
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mat.opacity = Math.max(0, s.crown ? 0.65 * (1 - u * u) : 0.75 * (1 - u));
      if (!s.crown) s.mesh.scale.setScalar(1 - u * 0.5);
      if (u >= 1) {
        sys.planetGroup.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mat.dispose();
        sys.waterSpray.splice(i, 1);
      }
    }
  }
}
