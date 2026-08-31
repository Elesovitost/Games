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
    w.takeDamage(dmg, { fromDir: centerDir });
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

const SCORCH_VERT = `
attribute float aEdge;
varying float vEdge;
void main() {
  vEdge = aEdge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SCORCH_FRAG = `
varying float vEdge;
void main() {
  float t = clamp(vEdge, 0.0, 1.0);
  float a = pow(1.0 - t, 2.6);
  vec3 core = vec3(0.003, 0.002, 0.001);
  vec3 rim = vec3(0.14, 0.10, 0.07);
  vec3 col = mix(core, rim, t * t * (3.0 - 2.0 * t));
  gl_FragColor = vec4(col, a * 0.94);
}
`;

let _scorchMat = null;

function scorchMaterial() {
  if (!_scorchMat) {
    _scorchMat = new THREE.ShaderMaterial({
      vertexShader: SCORCH_VERT,
      fragmentShader: SCORCH_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });
  }
  return _scorchMat;
}

/** Spálenina — jeden nepravidelný kotouč, uprostřed černá, k okraji do průhledna. */
export function spawnScorchMark(sys, dir, radiusM) {
  const centerDir = dir.clone().normalize();
  tangentFrame(centerDir, tmp.east, tmp.north);
  const east = tmp.east;
  const north = tmp.north;
  const R = radiusM * 1.5;
  const segments = 36;
  const lift = 0.045;

  const positions = [];
  const edges = [];
  const indices = [];
  const ringDirs = [];

  const ch = sys.terrain.height(centerDir);
  positions.push(
    centerDir.x * (ch + lift),
    centerDir.y * (ch + lift),
    centerDir.z * (ch + lift)
  );
  edges.push(0);

  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const wobble =
      0.76 +
      0.14 * Math.sin(angle * 2.7 + 0.8) +
      0.1 * Math.sin(angle * 5.9 + 2.1) +
      0.07 * Math.sin(angle * 11.3 + 1.4) +
      Math.random() * 0.07;
    const d = surfaceDirFrom(centerDir, east, north, angle, R * wobble);
    ringDirs.push(d.x, d.y, d.z);
    const h = sys.terrain.height(d);
    positions.push(d.x * (h + lift), d.y * (h + lift), d.z * (h + lift));
    edges.push(1);
    const next = i + 1;
    indices.push(0, i + 1, next < segments ? next + 1 : 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("aEdge", new THREE.Float32BufferAttribute(edges, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, scorchMaterial());
  mesh.renderOrder = 2;
  sys.planetGroup.add(mesh);
  sys.scorchMarks.push({
    mesh,
    centerDir: [centerDir.x, centerDir.y, centerDir.z],
    ringDirs,
    lift,
    segments
  });
}

function refreshScorchMark(terrain, mark) {
  const pos = mark.mesh.geometry.attributes.position;
  const lift = mark.lift;
  const cx = mark.centerDir[0];
  const cy = mark.centerDir[1];
  const cz = mark.centerDir[2];
  const ch = terrain.height({ x: cx, y: cy, z: cz });
  pos.setXYZ(0, cx * (ch + lift), cy * (ch + lift), cz * (ch + lift));

  const ring = mark.ringDirs;
  for (let i = 0; i < mark.segments; i++) {
    const j = i * 3;
    const dx = ring[j];
    const dy = ring[j + 1];
    const dz = ring[j + 2];
    const h = terrain.height({ x: dx, y: dy, z: dz });
    pos.setXYZ(i + 1, dx * (h + lift), dy * (h + lift), dz * (h + lift));
  }
  pos.needsUpdate = true;
  mark.mesh.geometry.computeVertexNormals();
}

/** Přilepí spáleniny na aktuální tvar terénu (elevace / deprese). */
export function updateScorchMarks(sys) {
  if (!sys.scorchMarks?.length) return;
  for (const mark of sys.scorchMarks) refreshScorchMark(sys.terrain, mark);
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
