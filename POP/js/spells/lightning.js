import * as THREE from "../three.js";
import { tangentFrame, tmp } from "../utils.js";
import { SPELLS } from "./defs.js";
import { applyAoeDamage, spawnScorchMark } from "./fx-common.js";

/** Fractal mid-point path (ostré zlomy jako reálný blesk). */
function lightningPath(from, to, generations, maxOffset) {
  let pts = [from.clone(), to.clone()];
  for (let g = 0; g < generations; g++) {
    const next = [pts[0]];
    const off = maxOffset * Math.pow(0.48, g);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const mid = a.clone().lerp(b, 0.45 + Math.random() * 0.1);
      const along = new THREE.Vector3().subVectors(b, a);
      const len = along.length() || 1;
      along.multiplyScalar(1 / len);
      let side = new THREE.Vector3().crossVectors(along, new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() < 1e-6) side.crossVectors(along, new THREE.Vector3(1, 0, 0));
      side.normalize();
      const side2 = new THREE.Vector3().crossVectors(along, side).normalize();
      mid.addScaledVector(side, (Math.random() - 0.5) * 2 * off);
      mid.addScaledVector(side2, (Math.random() - 0.5) * 2 * off);
      next.push(mid, b.clone());
    }
    pts = next;
  }
  return pts;
}

/** Lineární křivka po bodech — ostré zlomy. */
function polylineCurve(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + points[i].distanceTo(points[i - 1]));
  }
  const total = cum[cum.length - 1] || 1;
  const curve = new THREE.Curve();
  curve.getPoint = (t, optionalTarget = new THREE.Vector3()) => {
    const d = Math.min(1, Math.max(0, t)) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const u = (d - cum[i - 1]) / Math.max(1e-8, cum[i] - cum[i - 1]);
    return optionalTarget.copy(points[i - 1]).lerp(points[i], u);
  };
  return curve;
}

function makeBoltTube(points, radius, color, opacity) {
  const curve = polylineCurve(points);
  const tubular = Math.max(16, Math.min(80, (points.length - 1) * 4));
  const geo = new THREE.TubeGeometry(curve, tubular, radius, 5, false);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.userData.baseOpacity = opacity;
  return mesh;
}

function rebuildBoltTubes(b) {
  const main = lightningPath(b.sky, b.ground, 5, 3.2);
  tangentFrame(b.dir, tmp.east, tmp.north);

  const specs = [
    { pts: main, r: 0.11, color: 0xffffff, op: 1 },
    { pts: main, r: 0.28, color: 0xa8e8ff, op: 0.45 },
    { pts: main, r: 0.55, color: 0x4aa8ff, op: 0.18 }
  ];

  const branchCount = b.branchCount ?? 5;
  for (let f = 0; f < branchCount; f++) {
    const u = 0.18 + (f / branchCount) * 0.5 + Math.random() * 0.08;
    const i0 = Math.max(1, Math.min(main.length - 3, Math.floor(u * (main.length - 1))));
    const start = main[i0].clone();
    const toward = main[Math.min(i0 + 2, main.length - 1)].clone().sub(start).normalize();
    const end = start.clone()
      .addScaledVector(toward, 2 + Math.random() * 5)
      .addScaledVector(tmp.east, (Math.random() - 0.5) * 6)
      .addScaledVector(tmp.north, (Math.random() - 0.5) * 6)
      .addScaledVector(b.dir, -(1 + Math.random() * 4));
    const bpts = lightningPath(start, end, 3, 1.4);
    specs.push({ pts: bpts, r: 0.06, color: 0xffffff, op: 0.95 });
    specs.push({ pts: bpts, r: 0.18, color: 0x9ad4ff, op: 0.35 });
  }

  const n = Math.min(b.tubes.length, specs.length);
  for (let i = 0; i < n; i++) {
    const s = specs[i];
    const mesh = b.tubes[i];
    mesh.geometry.dispose();
    const curve = polylineCurve(s.pts);
    const tubular = Math.max(16, Math.min(80, (s.pts.length - 1) * 4));
    mesh.geometry = new THREE.TubeGeometry(curve, tubular, s.r, 5, false);
    mesh.userData.baseOpacity = s.op;
    mesh.material.opacity = s.op;
  }
}

/** Blesk: silný kanál (trubice), odbočky, jiskry, spálenina. */
export function strikeLightning(sys, targetDir) {
  const dir = targetDir.clone().normalize();
  const h = sys.terrain.height(dir);
  const ground = dir.clone().multiplyScalar(h);
  const sky = dir.clone().multiplyScalar(h + 40);

  tangentFrame(dir, tmp.east, tmp.north);
  const group = new THREE.Group();
  group.frustumCulled = false;

  const tubes = [];

  const addTube = (pts, radius, color, opacity) => {
    if (pts.length < 2) return null;
    const mesh = makeBoltTube(pts, radius, color, opacity);
    group.add(mesh);
    tubes.push(mesh);
    return mesh;
  };

  const main = lightningPath(sky, ground, 5, 3.2);
  addTube(main, 0.11, 0xffffff, 1);
  addTube(main, 0.28, 0xa8e8ff, 0.45);
  addTube(main, 0.55, 0x4aa8ff, 0.18);

  const branchCount = 4 + Math.floor(Math.random() * 3);
  for (let f = 0; f < branchCount; f++) {
    const u = 0.18 + Math.random() * 0.55;
    const i0 = Math.max(1, Math.min(main.length - 3, Math.floor(u * (main.length - 1))));
    const start = main[i0].clone();
    const toward = main[Math.min(i0 + 2, main.length - 1)].clone().sub(start).normalize();
    const end = start.clone()
      .addScaledVector(toward, 2 + Math.random() * 5)
      .addScaledVector(tmp.east, (Math.random() - 0.5) * 6)
      .addScaledVector(tmp.north, (Math.random() - 0.5) * 6)
      .addScaledVector(dir, -(1 + Math.random() * 4));
    const bpts = lightningPath(start, end, 3, 1.4);
    addTube(bpts, 0.06, 0xffffff, 0.95);
    addTube(bpts, 0.18, 0x9ad4ff, 0.35);
  }

  const sparks = [];
  for (let i = 0; i < 36; i++) {
    const sm = new THREE.LineBasicMaterial({
      color: i % 3 === 0 ? 0xffffff : i % 3 === 1 ? 0xa8e8ff : 0xffe8a8,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const tip = ground.clone().addScaledVector(dir, 0.15 + Math.random() * 0.35);
    const vel = new THREE.Vector3()
      .addScaledVector(tmp.east, (Math.random() - 0.5) * 14)
      .addScaledVector(tmp.north, (Math.random() - 0.5) * 14)
      .addScaledVector(dir, 5 + Math.random() * 12);
    const streakLen = 0.35 + Math.random() * 0.55;
    const geo = new THREE.BufferGeometry().setFromPoints([
      tip,
      tip.clone().addScaledVector(vel.clone().normalize(), -streakLen)
    ]);
    const line = new THREE.Line(geo, sm);
    line.frustumCulled = false;
    line.renderOrder = 7;
    group.add(line);
    sparks.push({ line, mat: sm, tip, vel, streakLen, life: 0.5 + Math.random() * 0.65 });
  }

  // Osvětlení okolního terénu při úderu
  const lightGround = new THREE.PointLight(0xd8f4ff, 28, 22, 1.6);
  lightGround.position.copy(ground).addScaledVector(dir, 2.2);
  lightGround.castShadow = false;
  group.add(lightGround);

  const lightBolt = new THREE.PointLight(0xb8e8ff, 12, 18, 1.8);
  lightBolt.position.copy(ground).lerp(sky, 0.35);
  lightBolt.castShadow = false;
  group.add(lightBolt);

  sys.planetGroup.add(group);
  sys.bolts.push({
    group,
    tubes,
    sparks,
    lights: [
      { light: lightGround, base: 28 },
      { light: lightBolt, base: 12 }
    ],
    sky,
    ground,
    dir,
    branchCount,
    t: 0,
    hold: 1,
    fade: 0.4,
    nextJitter: 0.12
  });

  spawnScorchMark(sys, dir, SPELLS.lightning.burnRadius);
  sys.terrain.scorch(dir, Math.max(2.2, SPELLS.lightning.burnRadius), true);
  applyAoeDamage(
    sys,
    dir,
    SPELLS.lightning.damageRadius,
    SPELLS.lightning.damageCenter,
    SPELLS.lightning.damageEdge,
    sys._castOwnerId
  );
}

export function updateBolts(sys, dt) {
  for (let i = sys.bolts.length - 1; i >= 0; i--) {
    const b = sys.bolts[i];
    b.t += dt;
    const hold = b.hold ?? 1;
    const fade = b.fade ?? 0.4;
    const total = hold + fade;

    let flicker = 1;
    if (b.t < hold) {
      const pulse = Math.abs(Math.sin(b.t * 55)) * Math.abs(Math.sin(b.t * 17));
      flicker = 0.55 + 0.45 * pulse;
      if (pulse > 0.85) flicker = 1;
      if (b.sky && b.tubes && b.t >= (b.nextJitter ?? 0)) {
        b.nextJitter = b.t + 0.1 + Math.random() * 0.08;
        rebuildBoltTubes(b);
      }
    } else {
      flicker = Math.max(0, 1 - (b.t - hold) / fade);
    }

    if (b.tubes) {
      for (const mesh of b.tubes) {
        const base = mesh.userData.baseOpacity ?? 1;
        mesh.material.opacity = base * flicker;
      }
    }

    if (b.lights) {
      for (const L of b.lights) {
        L.light.intensity = L.base * flicker;
      }
    }

    if (b.sparks) {
      for (const sp of b.sparks) {
        sp.life -= dt;
        sp.tip.addScaledVector(sp.vel, dt);
        sp.vel.multiplyScalar(0.94);
        const vlen = sp.vel.length() || 1;
        const along = sp.vel.clone().multiplyScalar(1 / vlen);
        const tail = sp.tip.clone().addScaledVector(along, -sp.streakLen);
        sp.line.geometry.setFromPoints([sp.tip, tail]);
        sp.mat.opacity = Math.max(0, Math.min(1, sp.life * 1.6));
        sp.streakLen *= 0.992;
      }
    }

    if (b.t >= total) {
      if (b.group) {
        sys.planetGroup.remove(b.group);
        for (const mesh of b.tubes || []) {
          mesh.geometry.dispose();
          mesh.material.dispose();
        }
        for (const sp of b.sparks || []) {
          sp.line.geometry.dispose();
          sp.mat.dispose();
        }
        for (const L of b.lights || []) L.light.dispose();
      }
      sys.bolts.splice(i, 1);
    }
  }
}
