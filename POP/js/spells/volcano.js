import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { SPELLS } from "./defs.js";
import { spawnBurst, surfaceDist } from "./fx-common.js";
import { dirSeed } from "./tornado.js";
import { tangentFrame, tmp, surfaceOffsetDir } from "../utils.js";

const SEGS = 64;
const RINGS = 14;
const LIFT = 0.022;

function smoothstep(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function smoothedReach(segReach, i) {
  const a = segReach[(i - 1 + SEGS) % SEGS];
  const b = segReach[i];
  const c = segReach[(i + 1) % SEGS];
  const d = segReach[(i + 2) % SEGS];
  return a * 0.12 + b * 0.5 + c * 0.28 + d * 0.1;
}

const LAVA_VERT = `
attribute float aHeat;
attribute float aWater;
varying float vHeat;
varying float vWater;
void main() {
  vHeat = aHeat;
  vWater = aWater;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const LAVA_FRAG = `
uniform float uTime;
uniform float uOpacity;
uniform float uCool;
varying float vHeat;
varying float vWater;
void main() {
  float t = clamp(vHeat, 0.0, 1.0);
  vec3 scCore = vec3(0.003, 0.002, 0.001);
  vec3 scRim = vec3(0.14, 0.10, 0.07);
  vec3 scorchCol = mix(scCore, scRim, t * t * (3.0 - 2.0 * t));
  float scorchA = uOpacity * mix(0.94, 0.72, t * t);

  if (vWater > 0.5) discard;

  float pulseAmt = 1.0 - uCool;
  float pulse = 1.0 + pulseAmt * 0.28 * sin(uTime * 6.2 + vHeat * 14.0);
  float crack = pow(max(0.0, sin(vHeat * 48.0 - uTime * 9.0)), 3.0) * pulseAmt;
  vec3 black = vec3(0.025, 0.012, 0.006);
  vec3 red = vec3(0.95, 0.06, 0.01);
  vec3 yellow = vec3(1.0, 0.82, 0.1);
  float hot = 1.0 - vHeat;
  vec3 hotCol = mix(black, red, smoothstep(0.0, 0.4, hot));
  hotCol = mix(hotCol, yellow, smoothstep(0.25, 0.9, hot) * pulse);
  hotCol += yellow * crack * hot * 0.42;
  hotCol *= 0.88 + 0.12 * pulse;
  float hotA = uOpacity * mix(0.97, 0.72, t * t);

  vec3 col = mix(hotCol, scorchCol, uCool);
  float a = mix(hotA, scorchA, uCool);
  gl_FragColor = vec4(col, a);
}
`;

let _lavaMat = null;

function lavaMaterial() {
  if (!_lavaMat) {
    _lavaMat = new THREE.ShaderMaterial({
      vertexShader: LAVA_VERT,
      fragmentShader: LAVA_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.95 },
        uCool: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });
  }
  return _lavaMat.clone();
}

/** Plochá síť — jen pruhy mezi soustřednými kruhy, bez středového vrcholu. */
function buildLavaMesh(sys, centerDir) {
  const vertCount = RINGS * SEGS;
  const positions = new Float32Array(vertCount * 3);
  const heats = new Float32Array(vertCount);
  const waters = new Float32Array(vertCount);
  const indices = [];

  for (let r = 0; r < RINGS - 1; r++) {
    const baseA = r * SEGS;
    const baseB = (r + 1) * SEGS;
    for (let i = 0; i < SEGS; i++) {
      const next = (i + 1) % SEGS;
      indices.push(baseA + i, baseB + i, baseB + next);
      indices.push(baseA + i, baseB + next, baseA + next);
    }
  }

  for (let r = 0; r < RINGS; r++) {
    const heat = (r + 1) / RINGS;
    for (let i = 0; i < SEGS; i++) heats[r * SEGS + i] = heat;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aHeat", new THREE.BufferAttribute(heats, 1));
  geo.setAttribute("aWater", new THREE.BufferAttribute(waters, 1));
  geo.setIndex(indices);

  const mat = lavaMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 0;
  sys.planetGroup.add(mesh);

  return { mesh, mat, centerDir: centerDir.clone(), waters };
}

function placeOnSurface(terrain, dir, lift, out) {
  const h = terrain.height(dir);
  out.copy(dir).multiplyScalar(h + lift);
}

function isUnderwater(terrain, dir) {
  return terrain.height(dir) < CONFIG.waterLevel + 0.04;
}

function refreshLavaGeometry(terrain, lava, segReach) {
  const pos = lava.mesh.geometry.attributes.position;
  const waterAttr = lava.mesh.geometry.attributes.aWater;
  const smooth = lava._smoothReach || (lava._smoothReach = new Float32Array(SEGS));
  for (let i = 0; i < SEGS; i++) smooth[i] = smoothedReach(segReach, i);

  tangentFrame(lava.centerDir, tmp.east, tmp.north);
  const east = tmp.east;
  const north = tmp.north;
  const p = tmp.v;
  const sampleDir = tmp.dir;

  for (let r = 0; r < RINGS; r++) {
    const ringFrac = (r + 1) / RINGS;
    for (let i = 0; i < SEGS; i++) {
      const reach = smooth[i] * ringFrac;
      if (reach < 0.04) {
        sampleDir.copy(lava.centerDir);
        placeOnSurface(terrain, sampleDir, LIFT, p);
      } else {
        const angle = (i / SEGS) * Math.PI * 2;
        surfaceOffsetDir(lava.centerDir, east, north, angle, reach, sampleDir);
        placeOnSurface(terrain, sampleDir, LIFT, p);
      }
      const vi = r * SEGS + i;
      pos.setXYZ(vi, p.x, p.y, p.z);
      waterAttr.setX(vi, isUnderwater(terrain, sampleDir) ? 1 : 0);
    }
  }
  pos.needsUpdate = true;
  waterAttr.needsUpdate = true;
}

function downhillFactor(terrain, centerDir, angle, east, north) {
  const probe = surfaceOffsetDir(centerDir, east, north, angle, 2.5, tmp.dir);
  const drop = terrain.height(centerDir) - terrain.height(probe);
  return Math.min(1.45, Math.max(0.55, 1 + drop * 0.22));
}

function segmentReach(volcano, i) {
  const def = SPELLS.volcano;
  const maxR = volcano.segMax[i];
  const t = volcano.elapsed;

  if (t < def.lavaFillTime) {
    const u = smoothstep(t / def.lavaFillTime);
    return def.craterRadius * (0.2 + 0.8 * u);
  }

  const flowT = t - def.lavaFillTime;
  if (flowT < def.lavaFlowTime) {
    const base = def.craterRadius;
    const delay = volcano.segDelay[i];
    const u = smoothstep((flowT - delay) / Math.max(0.05, def.lavaFlowTime - delay * 0.55));
    return base + (maxR - base) * u;
  }

  return maxR;
}

function isWizardInLava(volcano, wizardDir) {
  const dist = surfaceDist(volcano.dir, wizardDir);
  if (dist < 0.15) return true;

  tangentFrame(volcano.dir, tmp.east, tmp.north);
  const rel = tmp.v.copy(wizardDir).addScaledVector(volcano.dir, -volcano.dir.dot(wizardDir));
  if (rel.lengthSq() < 1e-10) return dist <= volcano.segMax[0] * 0.5;
  rel.normalize();
  let angle = Math.atan2(rel.dot(tmp.north), rel.dot(tmp.east));
  if (angle < 0) angle += Math.PI * 2;
  const segF = (angle / (Math.PI * 2)) * SEGS;
  const segA = Math.floor(segF) % SEGS;
  const segB = (segA + 1) % SEGS;
  const blend = segF - Math.floor(segF);
  const reach =
    smoothedReach(volcano.segReach, segA) * (1 - blend) +
    smoothedReach(volcano.segReach, segB) * blend;
  return dist <= reach + 0.3;
}

export function spawnVolcano(sys, targetDir) {
  const def = SPELLS.volcano;
  const dir = targetDir.clone().normalize();
  const seed = dirSeed(dir);

  tangentFrame(dir, tmp.east, tmp.north);
  const east = tmp.east;
  const north = tmp.north;

  const segMax = new Float32Array(SEGS);
  const segDelay = new Float32Array(SEGS);
  const segReach = new Float32Array(SEGS);
  for (let i = 0; i < SEGS; i++) {
    const angle = (i / SEGS) * Math.PI * 2;
    const wobble =
      0.58 +
      0.18 * Math.sin(i * 2.17 + seed * 11.3) +
      0.14 * Math.sin(i * 5.41 + seed * 4.7) +
      0.1 * Math.sin(i * 9.8 + seed * 2.1);
    const down = downhillFactor(sys.terrain, dir, angle, east, north);
    segMax[i] = def.lavaRadius * wobble * down;
    segDelay[i] =
      dirSeed(tmp.v.copy(dir).multiplyScalar(i + 1)) * 0.38 * def.lavaFlowTime / down;
    segReach[i] = 0;
  }

  const lava = buildLavaMesh(sys, dir);

  const light = new THREE.PointLight(0xff6622, 0, 18, 2);
  sys.planetGroup.add(light);

  const h = sys.terrain.height(dir);
  const burstPos = dir.clone().multiplyScalar(h);
  spawnBurst(sys, burstPos, dir, 0xff6620, 0.55);
  spawnBurst(sys, burstPos, dir, 0xffaa44, 0.35);

  const volcano = {
    dir,
    elapsed: 0,
    segMax,
    segDelay,
    segReach,
    lava,
    light,
    seed,
    sfxLava: null
  };
  for (let i = 0; i < SEGS; i++) {
    volcano.segReach[i] = segmentReach(volcano, i);
  }
  refreshLavaGeometry(sys.terrain, lava, volcano.segReach);

  const listener = sys.getListenerDir?.();
  if (listener && sys.audio) {
    volcano.sfxLava = sys.audio.startSfxLoop("lava", dir, listener);
  }

  sys.volcanos.push(volcano);
}

export function updateVolcanos(sys, dt) {
  if (!sys.volcanos?.length) return;
  const def = SPELLS.volcano;
  const list = sys.getWizards?.() || (sys.wizard ? [sys.wizard] : []);
  const listener = sys.getListenerDir?.();

  for (const w of list) {
    if (w) w._lavaMoveMul = 1;
  }

  for (let v = sys.volcanos.length - 1; v >= 0; v--) {
    const volcano = sys.volcanos[v];
    volcano.elapsed += dt;

    const activeEnd = def.lavaFillTime + def.lavaFlowTime + def.lavaDuration;
    const totalLife = activeEnd + def.lavaFadeTime;
    const fadeStart = activeEnd;

    if (volcano.elapsed >= totalLife) {
      sys.audio?.stopSfxLoop(volcano.sfxLava);
      volcano.sfxLava = null;
      finalizeVolcanoAsScorch(sys, volcano);
      sys.volcanos.splice(v, 1);
      continue;
    }

    const flowDone = volcano.elapsed >= def.lavaFillTime + def.lavaFlowTime;
    for (let i = 0; i < SEGS; i++) {
      volcano.segReach[i] = flowDone ? volcano.segMax[i] : segmentReach(volcano, i);
    }
    refreshLavaGeometry(sys.terrain, volcano.lava, volcano.segReach);

    let fadeMul = 1;
    if (volcano.elapsed > fadeStart) {
      fadeMul = 1 - smoothstep((volcano.elapsed - fadeStart) / def.lavaFadeTime);
    }
    if (volcano.sfxLava?.alive && listener) {
      sys.audio.updateSfxLoop(volcano.sfxLava, volcano.dir, listener, fadeMul);
    }

    let opacity = 0.95;
    let lightI = 1.8;
    let cool = 0;
    if (volcano.elapsed > fadeStart) {
      const u = smoothstep((volcano.elapsed - fadeStart) / def.lavaFadeTime);
      cool = u;
      opacity = 0.95;
      lightI = 1.8 * (1 - u);
    } else if (volcano.elapsed < def.lavaFillTime) {
      opacity = 0.5 + 0.45 * smoothstep(volcano.elapsed / def.lavaFillTime);
      lightI = 0.35 + 1.45 * smoothstep(volcano.elapsed / def.lavaFillTime);
    }

    volcano.lava.mat.uniforms.uTime.value = volcano.elapsed;
    volcano.lava.mat.uniforms.uOpacity.value = opacity;
    volcano.lava.mat.uniforms.uCool.value = cool;

    const lh = sys.terrain.height(volcano.dir) + LIFT + 0.35;
    volcano.light.position.set(
      volcano.dir.x * lh,
      volcano.dir.y * lh,
      volcano.dir.z * lh
    );
    volcano.light.intensity = lightI * (0.65 + 0.35 * Math.sin(volcano.elapsed * 8));

    const damaging =
      volcano.elapsed >= def.lavaFillTime + def.lavaFlowTime &&
      volcano.elapsed < activeEnd;

    if (damaging) {
      for (const w of list) {
        if (!w || w.dead) continue;
        if (!isWizardInLava(volcano, w.dir)) continue;
        w._lavaMoveMul = CONFIG.wizardWaterSpeedMul;
        if (!w.godMode && !w.remote) {
          w.takeDamage(def.lavaDps * dt, { knock: false });
        }
      }
    }
  }
}

function finalizeVolcanoAsScorch(sys, volcano) {
  const mat = volcano.lava.mat;
  mat.uniforms.uCool.value = 1;
  mat.uniforms.uOpacity.value = 0.94;

  sys.planetGroup.remove(volcano.light);
  volcano.light.dispose();

  const reach = new Float32Array(SEGS);
  for (let i = 0; i < SEGS; i++) reach[i] = volcano.segMax[i];

  volcano.lava.mesh.renderOrder = 0;
  sys.scorchMarks.push({
    kind: "irregular",
    mesh: volcano.lava.mesh,
    mat,
    centerDir: [volcano.dir.x, volcano.dir.y, volcano.dir.z],
    reach,
    lift: LIFT,
    segments: SEGS,
    rings: RINGS
  });
}

function disposeVolcano(sys, volcano) {
  sys.audio?.stopSfxLoop(volcano.sfxLava, 0.05);
  volcano.sfxLava = null;
  sys.planetGroup.remove(volcano.lava.mesh);
  volcano.lava.mesh.geometry.dispose();
  volcano.lava.mat.dispose();
  sys.planetGroup.remove(volcano.light);
  volcano.light.dispose();
}

export function disposeVolcanos(sys) {
  if (!sys.volcanos) return;
  for (const v of sys.volcanos) disposeVolcano(sys, v);
  sys.volcanos.length = 0;
}
