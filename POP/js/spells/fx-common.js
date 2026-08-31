import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { tangentFrame, tmp } from "../utils.js";

/** Vzdálenost po povrchu (m). */
export function surfaceDist(a, b) {
  const d = Math.min(1, Math.max(-1, a.dot(b)));
  return Math.acos(d) * CONFIG.planetR;
}

export function applyAoeDamage(sys, centerDir, radiusM, dmgCenter, dmgEdge) {
  const list = sys.getWizards?.() || (sys.wizard ? [sys.wizard] : []);
  for (const w of list) {
    if (!w || w.dead) continue;
    const dist = surfaceDist(centerDir, w.dir);
    if (dist >= radiusM) continue;
    const t = dist / radiusM;
    const dmg = dmgCenter + (dmgEdge - dmgCenter) * t;
    w.takeDamage(dmg);
  }
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

/** Bod na povrchu ve směru od středu (distM v metrech po povrchu). */
function surfaceDirFrom(center, east, north, angle, distM) {
  const omega = distM / CONFIG.planetR;
  const sinW = Math.sin(omega);
  const cosW = Math.cos(omega);
  return center
    .clone()
    .multiplyScalar(cosW)
    .addScaledVector(east, Math.cos(angle) * sinW)
    .addScaledVector(north, Math.sin(angle) * sinW)
    .normalize();
}

/** Spálenina kopírující terén — síť z více prstenců po výškové mapě. */
export function spawnScorchMark(sys, dir, radiusM) {
  const centerDir = dir.clone().normalize();
  tangentFrame(centerDir, tmp.east, tmp.north);
  const east = tmp.east;
  const north = tmp.north;

  const rings = 5;
  const segments = 22;
  const lift = 0.045;
  const positions = [];
  const indices = [];
  const ringIdx = [];

  const ch = sys.terrain.height(centerDir);
  positions.push(
    centerDir.x * (ch + lift),
    centerDir.y * (ch + lift),
    centerDir.z * (ch + lift)
  );

  for (let ri = 1; ri <= rings; ri++) {
    const frac = ri / rings;
    const ring = [];
    for (let sj = 0; sj < segments; sj++) {
      const angle = (sj / segments) * Math.PI * 2;
      let rM = radiusM * frac;
      if (ri === rings) {
        const wobble =
          0.55 +
          0.28 * Math.sin(sj * 2.3 + 1.7) +
          0.22 * Math.sin(sj * 5.1 + 0.4) +
          Math.random() * 0.12;
        rM *= wobble;
      }
      const d = surfaceDirFrom(centerDir, east, north, angle, rM);
      const h = sys.terrain.height(d);
      ring.push(positions.length / 3);
      positions.push(d.x * (h + lift), d.y * (h + lift), d.z * (h + lift));
    }
    ringIdx.push(ring);
  }

  for (let sj = 0; sj < segments; sj++) {
    const nj = (sj + 1) % segments;
    indices.push(0, ringIdx[0][sj], ringIdx[0][nj]);
  }

  for (let ri = 0; ri < ringIdx.length - 1; ri++) {
    const inner = ringIdx[ri];
    const outer = ringIdx[ri + 1];
    for (let sj = 0; sj < segments; sj++) {
      const nj = (sj + 1) % segments;
      const a = inner[sj];
      const b = inner[nj];
      const c = outer[sj];
      const d = outer[nj];
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

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
