import * as THREE from "../three.js";
import { SPELLS } from "./defs.js";

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _yUp = new THREE.Vector3(0, 1, 0);

function makeRing(radius, color, opacity) {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035, 6, 28), mat);
  mesh.castShadow = false;
  return { mesh, mat };
}

export function spawnHypnosis(sys, targetDir) {
  const def = SPELLS.hypnosis;
  const dir = targetDir.clone().normalize();
  const group = new THREE.Group();
  group.frustumCulled = false;

  const rings = [];
  const cols = [0xf0c070, 0xd080ff, 0xffe8a8];
  for (let i = 0; i < 4; i++) {
    const r = makeRing(0.45 + i * 0.38, cols[i % cols.length], 0.72 - i * 0.1);
    r.mesh.rotation.x = Math.PI / 2;
    r.mesh.position.y = 0.35 + i * 0.22;
    group.add(r.mesh);
    rings.push(r);
  }

  const spiralPts = [];
  const turns = 3.2;
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const a = t * Math.PI * 2 * turns;
    const rad = 0.12 + t * 1.35;
    spiralPts.push(new THREE.Vector3(Math.cos(a) * rad, 0.2 + t * 1.1, Math.sin(a) * rad));
  }
  const spiralMat = new THREE.MeshBasicMaterial({
    color: 0xe8b0ff,
    transparent: true,
    opacity: 0.8,
    depthWrite: false
  });
  const spiral = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spiralPts), 48, 0.03, 5, false),
    spiralMat
  );
  spiral.castShadow = false;
  group.add(spiral);

  const light = new THREE.PointLight(0xd090ff, 3.2, 10, 2);
  light.castShadow = false;
  light.position.set(0, 0.8, 0);
  group.add(light);

  sys.planetGroup.add(group);
  if (!sys.hypnoses) sys.hypnoses = [];
  sys.hypnoses.push({
    group,
    rings,
    spiral,
    spiralMat,
    light,
    dir,
    t: 0,
    life: 2.4,
    charmed: false
  });

  poseHypnosis(sys, sys.hypnoses[sys.hypnoses.length - 1]);
  charmNear(sys, dir, def.radius, def.holdTime);
}

function poseHypnosis(sys, h) {
  const ht = sys.terrain.height(h.dir);
  _pos.copy(h.dir).multiplyScalar(ht);
  _quat.setFromUnitVectors(_yUp, h.dir);
  h.group.position.copy(_pos);
  h.group.quaternion.copy(_quat);
}

function charmNear(sys, centerDir, radiusM, hold) {
  const w = sys.wizard;
  sys.critters?.charmNear?.(centerDir, radiusM, w, hold);
  sys.longnecks?.charmNear?.(centerDir, radiusM, w, hold);
  sys.worms?.charmNear?.(centerDir, radiusM, w, hold);
}

export function updateHypnoses(sys, dt) {
  const list = sys.hypnoses;
  if (!list?.length) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i];
    h.t += dt;
    poseHypnosis(sys, h);
    const u = Math.min(1, h.t / h.life);
    const fade = u < 0.18 ? u / 0.18 : u > 0.62 ? 1 - (u - 0.62) / 0.38 : 1;
    const pulse = 0.85 + 0.15 * Math.sin(h.t * 9);
    h.group.rotation.y += dt * 2.4;
    h.spiral.rotation.y -= dt * 3.1;
    h.spiralMat.opacity = 0.75 * fade;
    for (let k = 0; k < h.rings.length; k++) {
      const r = h.rings[k];
      r.mesh.scale.setScalar((0.85 + k * 0.04) * pulse);
      r.mat.opacity = (0.65 - k * 0.08) * fade;
      r.mesh.rotation.z += dt * (1.8 - k * 0.25) * (k % 2 === 0 ? 1 : -1);
    }
    if (h.light) h.light.intensity = 3.2 * fade * pulse;
    if (h.t >= h.life) {
      disposeHypnosis(sys, h);
      list.splice(i, 1);
    }
  }
}

function disposeHypnosis(sys, h) {
  sys.planetGroup.remove(h.group);
  for (const r of h.rings) {
    r.mesh.geometry.dispose();
    r.mat.dispose();
  }
  h.spiral.geometry.dispose();
  h.spiralMat.dispose();
  h.light.dispose();
}

export function disposeHypnoses(sys) {
  if (!sys.hypnoses) return;
  for (const h of sys.hypnoses) disposeHypnosis(sys, h);
  sys.hypnoses.length = 0;
}
