import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { tangentFrame, tmp } from "../utils.js";

/** Terén pod hladinou (pod vodou nebo na dně). */
export function isWaterAt(sys, dir) {
  return sys.terrain.height(dir) < CONFIG.waterLevel + 0.06;
}

function makeRippleRing(n, radius, delay, maxScale, life) {
  const segments = 36;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const wobble = 1 + Math.sin(a * 5 + radius * 3) * 0.04;
    pts.push(
      new THREE.Vector3(Math.cos(a) * radius * wobble, Math.sin(a) * radius * wobble, 0)
    );
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({
    color: 0xeaf6ff,
    transparent: true,
    opacity: 0.55,
    depthWrite: false
  });
  const line = new THREE.LineLoop(geo, mat);
  line.position.copy(n).multiplyScalar(CONFIG.waterLevel + 0.02);
  line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  line.renderOrder = 3;
  return { line, mat, geo, t: -delay, life, maxScale, baseR: radius };
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

export function updateWaterFx(sys, dt) {
  if (sys.waterRipples?.length) {
    for (let i = sys.waterRipples.length - 1; i >= 0; i--) {
      const r = sys.waterRipples[i];
      r.t += dt;
      if (r.t < 0) continue;
      const u = r.t / r.life;
      const scale = 1 + u * r.maxScale;
      r.line.scale.set(scale, scale, 1);
      r.mat.opacity = Math.max(0, 0.55 * (1 - u) * (1 - u * 0.5));
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
