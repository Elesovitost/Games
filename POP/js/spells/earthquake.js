import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { tangentFrame, tmp, surfaceOffsetDir } from "../utils.js";
import { SPELLS } from "./defs.js";
import { surfaceDist } from "./fx-common.js";
import { isWaterAt } from "./water-fx.js";

/** Zdvih jedné desky (m) — každá jede vlastní fází, zlom až 40 cm. */
const AMP = 0.2;
/** Jak rychle zlomy dojdou od středu k okraji (s). */
const GROW_TIME = 0.55;
const WALL_HALF = 0.055;
const WALL_STEP = 0.48;
const WALL_COLOR = 0x3a2414;

function blockWave(block, elapsed, duration) {
  const u = Math.min(1, elapsed / Math.max(1e-5, duration));
  const c = Math.cos(Math.PI * 2 * block.cycles * u + block.phase);
  return block.sign * Math.sign(c) * Math.pow(Math.abs(c), 0.4);
}

function fadeAt(dist, radius, edgeFade) {
  if (dist > radius - edgeFade) {
    let f = Math.max(0, (radius - dist) / edgeFade);
    return f * f * (3 - 2 * f);
  }
  return 1;
}

/** Úsečky Voronoi hran mezi semínky, oříznuté na kruh zóny. */
function voronoiEdges(blocks, radius) {
  const edges = [];
  const n = blocks.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = blocks[i];
      const b = blocks[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const sep = Math.hypot(dx, dy);
      if (sep < 1e-4) continue;
      const mx = (a.x + b.x) * 0.5;
      const my = (a.y + b.y) * 0.5;
      const ux = dx / sep;
      const uy = dy / sep;
      const px = -uy;
      const py = ux;
      const mp = mx * px + my * py;
      const disc = mp * mp - (mx * mx + my * my - radius * radius);
      if (disc < 0) continue;
      const sd = Math.sqrt(disc);
      let t0 = -mp - sd;
      let t1 = -mp + sd;
      let valid = true;
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        const s = blocks[k];
        const sax = s.x - a.x;
        const say = s.y - a.y;
        const rhsA = (s.x * s.x + s.y * s.y - a.x * a.x - a.y * a.y) * 0.5;
        const coeffA = px * sax + py * say;
        const constA = mx * sax + my * say;
        if (Math.abs(coeffA) < 1e-8) {
          if (constA > rhsA + 1e-5) {
            valid = false;
            break;
          }
        } else if (coeffA > 0) t1 = Math.min(t1, (rhsA - constA) / coeffA);
        else t0 = Math.max(t0, (rhsA - constA) / coeffA);

        const sbx = s.x - b.x;
        const sby = s.y - b.y;
        const rhsB = (s.x * s.x + s.y * s.y - b.x * b.x - b.y * b.y) * 0.5;
        const coeffB = px * sbx + py * sby;
        const constB = mx * sbx + my * sby;
        if (Math.abs(coeffB) < 1e-8) {
          if (constB > rhsB + 1e-5) {
            valid = false;
            break;
          }
        } else if (coeffB > 0) t1 = Math.min(t1, (rhsB - constB) / coeffB);
        else t0 = Math.max(t0, (rhsB - constB) / coeffB);
      }
      if (!valid || t1 - t0 < 0.18) continue;
      edges.push({
        x0: mx + px * t0,
        y0: my + py * t0,
        x1: mx + px * t1,
        y1: my + py * t1,
        nx: ux,
        ny: uy,
        a: i,
        b: j
      });
    }
  }
  return edges;
}

function collectWallSamples(terrain, center, east, north, morph) {
  const samples = [];
  const { blocks, radius, edgeFade } = morph;
  const dir = new THREE.Vector3();

  const addRibbon = (x0, y0, x1, y1, nx, ny, blockA, blockB) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.12) return;
    const n = Math.max(2, Math.ceil(len / WALL_STEP) + 1);
    let run = [];
    const flush = () => {
      if (run.length >= 2) samples.push({ pts: run, nx, ny, blockA, blockB });
      run = [];
    };
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const dist = Math.hypot(x, y);
      if (dist > radius) {
        flush();
        continue;
      }
      surfaceOffsetDir(center, east, north, Math.atan2(y, x), dist, dir);
      const restH = terrain.height(dir);
      if (terrain.wetness(dir) > 0.45) {
        flush();
        continue;
      }
      const sph = Math.acos(Math.min(1, Math.max(-1, dir.dot(center)))) * CONFIG.planetR;
      run.push({
        dx: dir.x,
        dy: dir.y,
        dz: dir.z,
        restH,
        fade: fadeAt(sph, radius, edgeFade),
        dist: sph
      });
    }
    flush();
  };

  for (const e of voronoiEdges(blocks, radius)) {
    addRibbon(e.x0, e.y0, e.x1, e.y1, e.nx, e.ny, e.a, e.b);
  }
  return samples;
}

function makeWallMesh(ribbons, east, north) {
  let vertCount = 0;
  for (const r of ribbons) vertCount += r.pts.length * 2;
  if (vertCount < 4) return null;

  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const indices = [];
  const n3 = new THREE.Vector3();
  let base = 0;

  for (const r of ribbons) {
    const nPts = r.pts.length;
    n3.copy(east).multiplyScalar(r.nx).addScaledVector(north, r.ny).normalize();
    for (let i = 0; i < nPts; i++) {
      const o = (base + i * 2) * 3;
      normals[o] = n3.x;
      normals[o + 1] = n3.y;
      normals[o + 2] = n3.z;
      normals[o + 3] = n3.x;
      normals[o + 4] = n3.y;
      normals[o + 5] = n3.z;
    }
    for (let i = 0; i < nPts - 1; i++) {
      const a = base + i * 2;
      const b = a + 1;
      const d = a + 2;
      const e = a + 3;
      indices.push(a, d, b, b, d, e);
    }
    base += nPts * 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setIndex(indices);
  const mat = new THREE.MeshStandardMaterial({
    color: WALL_COLOR,
    roughness: 0.96,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.userData.ribbons = ribbons;
  mesh.userData.nWorld = { east, north };
  return mesh;
}

function writeWalls(mesh, drives, front) {
  const ribbons = mesh.userData.ribbons;
  const pos = mesh.geometry.attributes.position;
  const east = mesh.userData.nWorld.east;
  const north = mesh.userData.nWorld.north;
  const n3 = tmp.n;
  let w = 0;
  for (const r of ribbons) {
    n3.copy(east).multiplyScalar(r.nx).addScaledVector(north, r.ny).normalize();
    const dA = drives[r.blockA] || 0;
    const dB = drives[r.blockB] || 0;
    for (const p of r.pts) {
      let reveal = 1;
      if (p.dist > front) reveal = Math.max(0, 1 - (p.dist - front) / 0.9);
      const mag = p.fade * reveal;
      const hL = p.restH + dA * mag;
      const hR = p.restH + dB * mag;
      pos.setXYZ(
        w,
        p.dx * hL - n3.x * WALL_HALF,
        p.dy * hL - n3.y * WALL_HALF,
        p.dz * hL - n3.z * WALL_HALF
      );
      pos.setXYZ(
        w + 1,
        p.dx * hR + n3.x * WALL_HALF,
        p.dy * hR + n3.y * WALL_HALF,
        p.dz * hR + n3.z * WALL_HALF
      );
      w += 2;
    }
  }
  pos.needsUpdate = true;
}

function applyQuakeDrive(q) {
  const front = Math.min(q.radius, (q.elapsed / GROW_TIME) * q.radius);
  q.front = front;
  const morph = q.morph;
  if (morph?.blocks && morph.blockDrive) {
    for (let i = 0; i < morph.blocks.length; i++) {
      morph.blockDrive[i] = AMP * blockWave(morph.blocks[i], q.elapsed, q.duration);
    }
    morph.front = front;
  }
  if (q.wall && morph?.blockDrive) writeWalls(q.wall, morph.blockDrive, front);
}

function triggerQuakeFall(w, centerDir) {
  const def = SPELLS.earthquake;
  const dmg = def.fallDamage;
  w.takeDamage(dmg, { fromDir: centerDir, knock: false });
  if (!w.dead && !w.godMode && !w.immortal) {
    w.applyKnockdown(dmg, centerDir, {
      awayFrom: centerDir,
      rotations: def.fallRotations ?? 1,
      rollDistance: def.fallDistance ?? 3
    });
  }
}

function victimKey(w) {
  return String(w.id ?? "local");
}

function updateVictims(sys, quake) {
  const def = SPELLS.earthquake;
  const radius = quake.front ?? def.effectRadius;
  sys.critters?.hurtNear(quake.centerDir, radius);
  sys.longnecks?.dodgeNear(quake.centerDir, radius);
  const list = sys.getWizards?.() || (sys.wizard ? [sys.wizard] : []);
  const now = quake.elapsed;
  const active = new Set();

  for (const w of list) {
    if (!w || w.dead || w.remote || w.godMode || w.immortal) continue;
    if (isWaterAt(sys, w.dir)) {
      quake.victims.delete(victimKey(w));
      continue;
    }
    const dist = surfaceDist(quake.centerDir, w.dir);
    if (dist > radius) {
      quake.victims.delete(victimKey(w));
      continue;
    }
    active.add(victimKey(w));
    let st = quake.victims.get(victimKey(w));
    if (!st) {
      st = { wasDown: false, graceUntil: -1 };
      quake.victims.set(victimKey(w), st);
    }

    if (w.knockdown || w.tornado) {
      st.wasDown = !!w.knockdown;
      continue;
    }

    if (st.wasDown) {
      st.wasDown = false;
      st.graceUntil = now + def.walkGrace;
      continue;
    }

    if (now < st.graceUntil) continue;

    triggerQuakeFall(w, quake.centerDir);
    st.wasDown = true;
  }

  for (const key of [...quake.victims.keys()]) {
    if (!active.has(key)) quake.victims.delete(key);
  }
}

export function spawnEarthquake(sys, targetDir) {
  const def = SPELLS.earthquake;
  const centerDir = targetDir.clone().normalize();
  const radius = def.effectRadius;
  const morph = sys.terrain.beginQuakeMorph(centerDir, radius);

  const group = new THREE.Group();
  group.frustumCulled = false;
  let wall = null;
  if (morph) {
    tangentFrame(centerDir, tmp.east, tmp.north);
    const east = tmp.east.clone();
    const north = tmp.north.clone();
    const ribbons = collectWallSamples(sys.terrain, centerDir, east, north, morph);
    wall = makeWallMesh(ribbons, east, north);
    if (wall) group.add(wall);
  }
  sys.planetGroup.add(group);

  const listener = sys.getListenerDir?.();
  const sfx =
    listener && sys.audio
      ? sys.audio.startSfxLoop("earthquake", centerDir, listener)
      : null;

  if (!sys.earthquakes) sys.earthquakes = [];
  const q = {
    centerDir,
    group,
    wall,
    morph,
    radius,
    front: 0,
    elapsed: 0,
    life: def.duration,
    duration: def.duration,
    shaking: true,
    victims: new Map(),
    sfx
  };
  sys.earthquakes.push(q);
  applyQuakeDrive(q);
}

export function updateEarthquakes(sys, dt) {
  if (!sys.earthquakes?.length) return;
  const listener = sys.getListenerDir?.();
  for (const q of sys.earthquakes) {
    if (!q.shaking) continue;

    q.elapsed += dt;
    q.life -= dt;

    if (q.sfx?.alive && listener) {
      sys.audio?.updateSfxLoop(q.sfx, q.centerDir, listener);
    }

    applyQuakeDrive(q);
    if (q.life > 0) updateVictims(sys, q);

    if (q.life <= 0) {
      q.shaking = false;
      sys.audio?.stopSfxLoop(q.sfx);
      q.sfx = null;
      q.victims.clear();
      if (q.morph) q.morph.released = true;
    }
  }
}

function disposeOneEarthquake(sys, q) {
  sys.audio?.stopSfxLoop(q.sfx, 0.05);
  q.sfx = null;
  if (q.morph && !q.morph.released) q.morph.released = true;
  if (q.group) {
    sys.planetGroup.remove(q.group);
    if (q.wall) {
      q.wall.geometry.dispose();
      q.wall.material.dispose();
    }
  }
  q.victims?.clear();
}

export function disposeEarthquakes(sys) {
  if (!sys.earthquakes) return;
  for (const q of sys.earthquakes) disposeOneEarthquake(sys, q);
  sys.earthquakes.length = 0;
}
