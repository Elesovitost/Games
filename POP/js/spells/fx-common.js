import * as THREE from "../three.js";
import { CONFIG } from "../config.js";

/** Vzdálenost po povrchu (m). */
export function surfaceDist(a, b) {
  const d = Math.min(1, Math.max(-1, a.dot(b)));
  return Math.acos(d) * CONFIG.planetR;
}

export function applyAoeDamage(sys, centerDir, radiusM, dmgCenter, dmgEdge) {
  if (!sys.wizard || sys.wizard.dead) return;
  const dist = surfaceDist(centerDir, sys.wizard.dir);
  if (dist >= radiusM) return;
  const t = dist / radiusM;
  const dmg = dmgCenter + (dmgEdge - dmgCenter) * t;
  sys.wizard.takeDamage(dmg);
}

export function spawnBurst(sys, pos, up, color, life = 0.45) {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), mat);
  mesh.position.copy(pos).addScaledVector(up, 0.3);
  sys.planetGroup.add(mesh);
  sys.bursts.push({ mesh, mat, t: 0, life, up: up.clone() });
}

/** Nepravidelná spálenina na povrchu (viditelná i při hrubém meshi). */
export function spawnScorchMark(sys, dir, radiusM) {
  const h = sys.terrain.height(dir);
  const n = 28;
  const shape = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wobble =
      0.55 +
      0.28 * Math.sin(i * 2.3 + 1.7) +
      0.22 * Math.sin(i * 5.1 + 0.4) +
      Math.random() * 0.12;
    const r = radiusM * wobble;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x3a2e28,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(dir).multiplyScalar(h + 0.08);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  mesh.renderOrder = 2;
  sys.planetGroup.add(mesh);
  sys.scorchMarks.push(mesh);
}

export function disposeProjectile(sys, p) {
  sys.planetGroup.remove(p.ball);
  p.mat.dispose();
  if (p.glowMat) p.glowMat.dispose();
}

export function updateBursts(sys, dt) {
  for (let i = sys.bursts.length - 1; i >= 0; i--) {
    const b = sys.bursts[i];
    b.t += dt;
    const u = b.t / b.life;
    b.mesh.scale.setScalar(1 + u * 4);
    b.mat.opacity = Math.max(0, 0.85 * (1 - u));
    b.mesh.position.addScaledVector(b.up, dt * 1.2);
    if (u >= 1) {
      sys.planetGroup.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mat.dispose();
      sys.bursts.splice(i, 1);
    }
  }
}
