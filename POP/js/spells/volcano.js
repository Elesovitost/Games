import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { SPELLS } from "./defs.js";
import { spawnBurst } from "./fx-common.js";
import { tangentFrame, surfaceOffsetDir } from "../utils.js";

/**
 * Láva = výškové pole na mřížce kolem kráteru (azimutální ekvidistantní
 * projekce — vzdálenosti od středu jsou po povrchu planety přesné).
 *
 * Tok mezi buňkami řídí spád hladiny `terén + mocnost`, takže láva nikdy
 * neteče do kopce, prohlubně nejprve zaplní a do mírného stoupání se dostane
 * jen tlakem vlastní vrstvy. `lavaYield` je mez tekutosti — hustá tekutina se
 * na malém spádu zastaví a tvoří oblé laloky. `lavaCrust` je ztuhlá vrstva,
 * která už neodteče, takže se láva šíří a nemizí z míst, kudy protekla.
 */
/**
 * Mřížka musí být jemnější než terén (icosphere subdiv 6 → hrana ~1,5 m),
 * jinak plát lávy prořízne svah sopky a terén ho schová.
 * cell = 2 * lavaRadius / GRID — při dosahu 76 m to je 0,79 m.
 */
const GRID = 192;
const SUBSTEPS = 6;
/** Nadzdvižení nad terén proti z-fightingu (m) */
const LIFT = 0.09;

const NX = [1, 1, 0, -1, -1, -1, 0, 1];
const NY = [0, 1, 1, 1, 0, -1, -1, -1];
const ND = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];

const STEAM_COLORS = [0xcfd4d6, 0xb9c0c4, 0xdde2e4];
const ASH_COLORS = [0x2b2724, 0x38332e, 0x211e1b];

const _dir = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _side = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _cell = { x: 0, y: 0 };

function smoothstep(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/* --------------------------------------------------------------- mřížka */

function createLavaField(terrain, centerDir, radiusM) {
  const n = GRID * GRID;
  const field = {
    center: centerDir.clone().normalize(),
    east: new THREE.Vector3(),
    north: new THREE.Vector3(),
    radius: radiusM,
    cell: (2 * radiusM) / GRID,
    dirs: new Float32Array(n * 3),
    coord: new Float32Array(n * 2),
    dist: new Float32Array(n),
    terr: new Float32Array(n),
    lava: new Float32Array(n),
    temp: new Float32Array(n),
    cover: new Float32Array(n),
    vis: new Float32Array(n),
    visCover: new Float32Array(n),
    flux: new Float32Array(n),
    drain: new Float32Array(n),
    heatIn: new Float32Array(n),
    open: new Uint8Array(n),
    shore: new Uint8Array(n),
    source: null,
    centerCell: (GRID >> 1) * GRID + (GRID >> 1),
    minX: GRID,
    minY: GRID,
    maxX: -1,
    maxY: -1,
    wetCount: 0,
    terrainVersion: 0,
    hotU: 0,
    hotV: 0,
    hasHot: false
  };

  tangentFrame(field.center, field.east, field.north);
  buildCellDirs(field);
  sampleTerrain(terrain, field);
  markOpenCells(field);
  return field;
}

function buildCellDirs(field) {
  const { dirs, coord, dist, cell, radius } = field;
  for (let iy = 0; iy < GRID; iy++) {
    const v = (iy + 0.5) * cell - radius;
    for (let ix = 0; ix < GRID; ix++) {
      const u = (ix + 0.5) * cell - radius;
      const i = iy * GRID + ix;
      const r = Math.hypot(u, v);
      coord[i * 2] = u;
      coord[i * 2 + 1] = v;
      dist[i] = r;
      surfaceOffsetDir(field.center, field.east, field.north, Math.atan2(v, u), r, _dir);
      dirs[i * 3] = _dir.x;
      dirs[i * 3 + 1] = _dir.y;
      dirs[i * 3 + 2] = _dir.z;
    }
  }
}

/**
 * Výšky terénu po buňkách přesně. Interpolace z hrubšího rasteru podstřelovala
 * strmý svah kužele, takže plát lávy skončil pod povrchem sopky.
 */
function sampleTerrain(terrain, field) {
  const { terr, dirs } = field;
  for (let i = 0; i < terr.length; i++) {
    const j = i * 3;
    _dir.set(dirs[j], dirs[j + 1], dirs[j + 2]);
    terr[i] = terrain.height(_dir);
  }
}

/** Jen stopa lávy — ztuhlá kůra se přilepuje na terén každý snímek morfu. */
function sampleTerrainCovered(terrain, field) {
  const { terr, dirs, cover } = field;
  const x0 = Math.max(0, field.minX - 2);
  const x1 = Math.min(GRID - 1, field.maxX + 2);
  const y0 = Math.max(0, field.minY - 2);
  const y1 = Math.min(GRID - 1, field.maxY + 2);
  for (let iy = y0; iy <= y1; iy++) {
    for (let ix = x0; ix <= x1; ix++) {
      const i = iy * GRID + ix;
      if (cover[i] <= 0.02) continue;
      const j = i * 3;
      _dir.set(dirs[j], dirs[j + 1], dirs[j + 2]);
      terr[i] = terrain.height(_dir);
    }
  }
}

/** Kam láva smí — v disku a nad hladinou. U vody se zastaví a syčí. */
function markOpenCells(field) {
  const { open, shore, terr, dist, cell, radius } = field;
  const waterR = CONFIG.waterLevel + 0.02;
  const limit = radius - cell * 2;
  for (let i = 0; i < open.length; i++) {
    open[i] = dist[i] <= limit && terr[i] >= waterR ? 1 : 0;
  }
  for (let iy = 0; iy < GRID; iy++) {
    for (let ix = 0; ix < GRID; ix++) {
      const i = iy * GRID + ix;
      shore[i] = 0;
      if (!open[i]) continue;
      for (let k = 0; k < 8; k++) {
        const jx = ix + NX[k];
        const jy = iy + NY[k];
        if (jx < 0 || jx >= GRID || jy < 0 || jy >= GRID) continue;
        if (!open[jy * GRID + jx]) {
          shore[i] = 1;
          break;
        }
      }
    }
  }
}

/** Buňky pod jícnem, kam se láva vlévá. */
function buildSourceCells(field, sourceRadius) {
  const r = Math.max(field.cell * 1.4, sourceRadius);
  const src = [];
  for (let i = 0; i < field.dist.length; i++) {
    if (field.dist[i] <= r) src.push(i);
  }
  if (!src.length) src.push(field.centerCell);
  field.source = src;
  for (let k = 0; k < src.length; k++) {
    markWet(field, src[k] % GRID, (src[k] / GRID) | 0);
  }
}

function markWet(field, ix, iy) {
  if (ix < field.minX) field.minX = ix;
  if (ix > field.maxX) field.maxX = ix;
  if (iy < field.minY) field.minY = iy;
  if (iy > field.maxY) field.maxY = iy;
}

function sampleGrid(arr, fx, fy) {
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  if (ix < 0 || iy < 0 || ix >= GRID - 1 || iy >= GRID - 1) {
    const cx = Math.min(GRID - 1, Math.max(0, Math.round(fx)));
    const cy = Math.min(GRID - 1, Math.max(0, Math.round(fy)));
    return arr[cy * GRID + cx];
  }
  const tx = fx - ix;
  const ty = fy - iy;
  const row = iy * GRID + ix;
  const a = arr[row];
  const b = arr[row + 1];
  const c = arr[row + GRID];
  const d = arr[row + GRID + 1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/** Směr na planetě → zlomkové souřadnice v mřížce; false = mimo dosah. */
function gridCoordAt(field, dir, out) {
  const dot = Math.min(1, Math.max(-1, field.center.dot(dir)));
  const r = Math.acos(dot) * CONFIG.planetR;
  if (r >= field.radius) return false;
  let u = 0;
  let v = 0;
  if (r > 1e-4) {
    _tan.copy(dir).addScaledVector(field.center, -dot);
    if (_tan.lengthSq() > 1e-12) {
      _tan.normalize();
      u = _tan.dot(field.east) * r;
      v = _tan.dot(field.north) * r;
    }
  }
  out.x = (u + field.radius) / field.cell - 0.5;
  out.y = (v + field.radius) / field.cell - 0.5;
  return true;
}

function blurPass(read, write) {
  for (let iy = 0; iy < GRID; iy++) {
    for (let ix = 0; ix < GRID; ix++) {
      const i = iy * GRID + ix;
      let sum = read[i] * 4;
      let w = 4;
      if (ix > 0) { sum += read[i - 1]; w++; }
      if (ix < GRID - 1) { sum += read[i + 1]; w++; }
      if (iy > 0) { sum += read[i - GRID]; w++; }
      if (iy < GRID - 1) { sum += read[i + GRID]; w++; }
      write[i] = sum / w;
    }
  }
}

function blurGrid(src, dst, passes) {
  const a = new Float32Array(src.length);
  const b = new Float32Array(src.length);
  let read = src;
  for (let p = 0; p < passes; p++) {
    const write = p === passes - 1 ? dst : (read === a ? b : a);
    blurPass(read, write);
    read = write;
  }
}

/* -------------------------------------------------------------- fyzika */

function injectLava(field, volume) {
  const src = field.source;
  const add = volume / (src.length * field.cell * field.cell);
  for (let k = 0; k < src.length; k++) {
    const i = src[k];
    if (!field.open[i]) continue;
    field.lava[i] += add;
    field.temp[i] = 1;
  }
}

/**
 * Krok toku. Přetéká jen to, co je nad ztuhlou kůrou, a jen tam, kde hladina
 * spadne aspoň o mez tekutosti. Výtok ~ spád × mocnost² (viskózní film).
 * Všechny buňky se počítají ze stejného stavu, aby šíření nemělo směrovou
 * úchylku podle pořadí v mřížce.
 */
function flowStep(field, def, dt, mobility) {
  const { terr, lava, temp, flux, drain, heatIn, open, cover, cell } = field;
  const crust = def.lavaCrust;
  const yieldH = def.lavaYield;

  const x0 = Math.max(0, field.minX - 1);
  const x1 = Math.min(GRID - 1, field.maxX + 1);
  const y0 = Math.max(0, field.minY - 1);
  const y1 = Math.min(GRID - 1, field.maxY + 1);
  if (x1 < x0 || y1 < y0) return;

  for (let iy = y0; iy <= y1; iy++) {
    const row = iy * GRID;
    flux.fill(0, row + x0, row + x1 + 1);
    drain.fill(0, row + x0, row + x1 + 1);
    heatIn.fill(0, row + x0, row + x1 + 1);
  }

  const nb = field.nb || (field.nb = new Int32Array(8));
  const nw = field.nw || (field.nw = new Float32Array(8));

  for (let iy = y0; iy <= y1; iy++) {
    for (let ix = x0; ix <= x1; ix++) {
      const i = iy * GRID + ix;
      const thick = lava[i];
      const avail = thick - crust;
      if (avail <= 1e-4) continue;

      const head = terr[i] + thick;
      let count = 0;
      let sum = 0;
      let maxDrop = 0;
      for (let k = 0; k < 8; k++) {
        const jx = ix + NX[k];
        const jy = iy + NY[k];
        if (jx < 0 || jx >= GRID || jy < 0 || jy >= GRID) continue;
        const j = jy * GRID + jx;
        if (!open[j]) continue;
        const drop = head - terr[j] - lava[j] - yieldH;
        if (drop <= 0) continue;
        nb[count] = j;
        nw[count] = drop / (ND[k] * cell);
        sum += nw[count];
        count++;
        if (drop > maxDrop) maxDrop = drop;
      }
      if (!count) continue;

      let out = (mobility * avail * Math.sqrt(avail) * sum * dt) / cell;
      if (out > avail) out = avail;
      if (out > maxDrop * 0.85) out = maxDrop * 0.85;
      if (out <= 1e-6) continue;

      drain[i] = out;
      const hot = temp[i];
      const scale = out / sum;
      for (let k = 0; k < count; k++) {
        const j = nb[k];
        const share = nw[k] * scale;
        flux[j] += share;
        heatIn[j] += share * hot;
        markWet(field, j % GRID, (j / GRID) | 0);
      }
    }
  }

  for (let iy = y0; iy <= y1; iy++) {
    for (let ix = x0; ix <= x1; ix++) {
      const i = iy * GRID + ix;
      const gain = flux[i];
      const loss = drain[i];
      if (gain > 1e-7) {
        const kept = Math.max(0, lava[i] - loss);
        const total = kept + gain;
        temp[i] = (kept * temp[i] + heatIn[i]) / total;
        lava[i] = total;
      } else if (loss > 0) {
        lava[i] = Math.max(0, lava[i] - loss);
      }
      const thick = lava[i];
      if (thick <= 0) continue;
      if (temp[i] > 0) temp[i] = Math.max(0, temp[i] - dt / def.lavaHeatTime);
      const cov = Math.min(1, thick / crust);
      if (cov > cover[i]) {
        if (cover[i] <= 0.02 && cov > 0.02) field.wetCount++;
        cover[i] = cov;
      }
    }
  }
}

/* -------------------------------------------------------------- render */

const LAVA_VERT = `
attribute float aCover;
attribute float aHeat;
attribute vec2 aCoord;
varying float vCover;
varying float vHeat;
varying vec2 vCoord;
void main() {
  vCover = aCover;
  vHeat = aHeat;
  vCoord = aCoord;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const LAVA_FRAG = `
uniform float uTime;
uniform float uFreeze;
uniform float uOpacity;
varying float vCover;
varying float vHeat;
varying vec2 vCoord;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm2(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s / 0.9375;
}

void main() {
  float cov = clamp(vCover, 0.0, 1.0);
  float coarse = fbm2(vCoord * 0.55 + 3.0);
  float fine = fbm2(vCoord * 2.6 - 11.0);

  /* Nehomogenní gradientní okraj — po ztuhnutí širší a rozmytější */
  float lo = mix(0.03, 0.05, uFreeze);
  float hi = mix(0.52, 0.92, uFreeze);
  float edge = smoothstep(lo, hi, cov * (0.7 + 0.55 * coarse));
  if (edge < 0.004) discard;

  float heat = clamp(vHeat, 0.0, 1.0) * (1.0 - uFreeze);
  float crack = smoothstep(
    0.46, 0.8,
    fine + 0.16 * sin(vCoord.x * 1.6 + vCoord.y * 1.1 - uTime * 0.8)
  );
  float glow = heat * (0.3 + 0.7 * crack);
  glow *= 0.86 + 0.14 * sin(uTime * 3.2 + coarse * 14.0);

  vec3 rock = mix(vec3(0.05, 0.042, 0.04), vec3(0.115, 0.095, 0.084), fine);
  rock *= 0.78 + 0.4 * coarse;
  vec3 molten = mix(vec3(0.9, 0.14, 0.02), vec3(1.0, 0.8, 0.24), smoothstep(0.3, 1.0, glow));
  vec3 col = mix(rock, molten, smoothstep(0.04, 0.42, glow));

  /* Trvalá spálenina — nehomogenní šedo-černá, ne plná čerň */
  float mottle = coarse * 0.62 + fine * 0.38;
  float speck = fract(fine * 7.31 + coarse * 3.17);
  vec3 charDark = vec3(0.016, 0.015, 0.014);
  vec3 charGray = vec3(0.078, 0.076, 0.072);
  vec3 charred = mix(charDark, charGray, smoothstep(0.22, 0.9, mottle));
  charred *= 0.7 + 0.34 * speck;
  col = mix(col, charred, uFreeze);

  /* Místy semitransparentní — prosvítá terén pod ztuhlou kůrou */
  float holes = smoothstep(0.3, 0.88, mottle * 0.65 + speck * 0.35 - cov * 0.12);
  float freezeAlpha = mix(0.22, 0.96, holes);

  gl_FragColor = vec4(col, edge * uOpacity * mix(1.0, freezeAlpha, uFreeze));
}
`;

function buildLavaRender(sys, field) {
  const n = GRID * GRID;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const h = field.terr[i] + LIFT;
    positions[i * 3] = field.dirs[i * 3] * h;
    positions[i * 3 + 1] = field.dirs[i * 3 + 1] * h;
    positions[i * 3 + 2] = field.dirs[i * 3 + 2] * h;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aCover", new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute("aHeat", new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute("aCoord", new THREE.BufferAttribute(field.coord, 2));
  geo.setIndex(
    new THREE.BufferAttribute(new Uint16Array((GRID - 1) * (GRID - 1) * 6), 1)
  );
  geo.setDrawRange(0, 0);

  const mat = new THREE.ShaderMaterial({
    vertexShader: LAVA_VERT,
    fragmentShader: LAVA_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uFreeze: { value: 0 },
      uOpacity: { value: 1 }
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 0;
  mesh.frustumCulled = false;
  sys.planetGroup.add(mesh);
  return { mesh, mat };
}

/** Kreslí se jen pokryté čtverce — plocha roste se stopou lávy. */
function rebuildLavaIndex(field, mesh) {
  const idx = mesh.geometry.index.array;
  const cover = field.visCover;
  const x0 = Math.max(0, field.minX - 2);
  const x1 = Math.min(GRID - 2, field.maxX + 1);
  const y0 = Math.max(0, field.minY - 2);
  const y1 = Math.min(GRID - 2, field.maxY + 1);
  let c = 0;
  for (let iy = y0; iy <= y1; iy++) {
    for (let ix = x0; ix <= x1; ix++) {
      const a = iy * GRID + ix;
      const b = a + 1;
      const d = a + GRID;
      const e = d + 1;
      if (cover[a] + cover[b] + cover[d] + cover[e] < 0.01) continue;
      idx[c] = a; idx[c + 1] = d; idx[c + 2] = e;
      idx[c + 3] = a; idx[c + 4] = e; idx[c + 5] = b;
      c += 6;
    }
  }
  mesh.geometry.index.needsUpdate = true;
  mesh.geometry.setDrawRange(0, c);
}

/**
 * Přelije stav simulace do meshe. Mocnost i pokrytí se rozmazávají, takže
 * povrch i okraje laloků jsou hladké a zaoblené.
 * @returns {number} součet tepla pro světla
 */
function refreshLavaMesh(field, render, thickMul) {
  const { terr, dirs, lava, temp, cover, vis, visCover, coord } = field;
  const geo = render.mesh.geometry;
  const pos = geo.attributes.position;
  const covAttr = geo.attributes.aCover;
  const heatAttr = geo.attributes.aHeat;
  const posArr = pos.array;
  const covArr = covAttr.array;
  const heatArr = heatAttr.array;

  const x0 = Math.max(0, field.minX - 2);
  const x1 = Math.min(GRID - 1, field.maxX + 2);
  const y0 = Math.max(0, field.minY - 2);
  const y1 = Math.min(GRID - 1, field.maxY + 2);
  if (x1 < x0 || y1 < y0) return 0;

  for (let iy = y0; iy <= y1; iy++) {
    for (let ix = x0; ix <= x1; ix++) {
      const i = iy * GRID + ix;
      let st = lava[i] * 4;
      let sc = cover[i] * 4;
      let w = 4;
      if (ix > 0) { st += lava[i - 1]; sc += cover[i - 1]; w++; }
      if (ix < GRID - 1) { st += lava[i + 1]; sc += cover[i + 1]; w++; }
      if (iy > 0) { st += lava[i - GRID]; sc += cover[i - GRID]; w++; }
      if (iy < GRID - 1) { st += lava[i + GRID]; sc += cover[i + GRID]; w++; }
      vis[i] = st / w;
      visCover[i] = sc / w;
    }
  }

  let heatSum = 0;
  let heatU = 0;
  let heatV = 0;
  for (let iy = y0; iy <= y1; iy++) {
    for (let ix = x0; ix <= x1; ix++) {
      const i = iy * GRID + ix;
      const h = terr[i] + vis[i] * thickMul + LIFT;
      const j = i * 3;
      posArr[j] = dirs[j] * h;
      posArr[j + 1] = dirs[j + 1] * h;
      posArr[j + 2] = dirs[j + 2] * h;
      covArr[i] = visCover[i];
      const t = temp[i];
      heatArr[i] = t;
      if (t > 0.2 && visCover[i] > 0.4) {
        const w = t * t;
        heatSum += w;
        heatU += w * coord[i * 2];
        heatV += w * coord[i * 2 + 1];
      }
    }
  }

  pos.needsUpdate = true;
  covAttr.needsUpdate = true;
  heatAttr.needsUpdate = true;

  if (heatSum > 1e-4) {
    field.hotU = heatU / heatSum;
    field.hotV = heatV / heatSum;
    field.hasHot = true;
  }
  return heatSum;
}

/* -------------------------------------------------------------- efekty */

function spawnPuff(sys, pos, vel, opts) {
  const mat = new THREE.MeshBasicMaterial({
    color: opts.color,
    transparent: true,
    opacity: opts.opacity,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(opts.size, 6, 5), mat);
  mesh.position.copy(pos);
  sys.planetGroup.add(mesh);
  if (!sys.smokePuffs) sys.smokePuffs = [];
  sys.smokePuffs.push({ mesh, mat, vel: vel.clone(), t: 0, life: opts.life });
}

/** Fontána a dýmový sloup nad jícnem. */
function eruptionFx(sys, field, power) {
  const surf = field.terr[field.centerCell] + field.lava[field.centerCell];
  _pos.copy(field.center).multiplyScalar(surf + 0.25);
  tangentFrame(field.center, _tan, _side);

  spawnBurst(sys, _pos, field.center, 0xff7418, 0.32 + Math.random() * 0.22);
  if (Math.random() < 0.5) spawnBurst(sys, _pos, field.center, 0xffc24a, 0.26);

  _vel
    .copy(field.center)
    .multiplyScalar(2.6 + Math.random() * 2.4 * power)
    .addScaledVector(_tan, (Math.random() - 0.5) * 1.4)
    .addScaledVector(_side, (Math.random() - 0.5) * 1.4);
  spawnPuff(sys, _pos, _vel, {
    color: ASH_COLORS[(Math.random() * ASH_COLORS.length) | 0],
    opacity: 0.32 + Math.random() * 0.2,
    size: 0.45 + Math.random() * 0.5,
    life: 2.4 + Math.random() * 1.6
  });
}

/** Pára tam, kde láva dosáhla vody. */
function steamFx(sys, field) {
  const x0 = Math.max(0, field.minX);
  const x1 = Math.min(GRID - 1, field.maxX);
  const y0 = Math.max(0, field.minY);
  const y1 = Math.min(GRID - 1, field.maxY);
  let found = 0;
  let pick = -1;
  for (let iy = y0; iy <= y1; iy++) {
    for (let ix = x0; ix <= x1; ix++) {
      const i = iy * GRID + ix;
      if (!field.shore[i] || field.lava[i] < 0.05 || field.temp[i] < 0.2) continue;
      found++;
      if (Math.random() < 1 / found) pick = i;
    }
  }
  if (pick < 0) return;
  const j = pick * 3;
  _dir.set(field.dirs[j], field.dirs[j + 1], field.dirs[j + 2]);
  _pos.copy(_dir).multiplyScalar(field.terr[pick] + 0.2);
  _vel.copy(_dir).multiplyScalar(1.8 + Math.random() * 1.8);
  spawnPuff(sys, _pos, _vel, {
    color: STEAM_COLORS[(Math.random() * STEAM_COLORS.length) | 0],
    opacity: 0.3 + Math.random() * 0.2,
    size: 0.3 + Math.random() * 0.32,
    life: 1.4 + Math.random()
  });
}

/* --------------------------------------------------------------- kouzlo */

export function spawnVolcano(sys, targetDir, shape = null) {
  const def = SPELLS.volcano;
  const dir = targetDir.clone().normalize();

  const field = createLavaField(sys.terrain, dir, def.lavaRadius);
  field.terrainVersion = sys.terrain.morphVersion;
  buildSourceCells(field, (shape?.floorRadius ?? def.craterFloorRadius) * 0.85);

  const render = buildLavaRender(sys, field);
  /** Jedno světlo — drží se těžiště žhavé lávy, tedy putuje s výlevem */
  const light = new THREE.PointLight(0xff6018, 0, 30, 2);
  light.position.copy(dir).multiplyScalar(sys.terrain.height(dir) + 0.5);
  sys.planetGroup.add(light);

  _pos.copy(dir).multiplyScalar(sys.terrain.height(dir));
  spawnBurst(sys, _pos, dir, 0xff6620, 0.6);
  spawnBurst(sys, _pos, dir, 0xffaa44, 0.4);

  const volcano = {
    dir,
    field,
    render,
    light,
    elapsed: 0,
    fxTimer: 0,
    steamTimer: 0,
    indexedCount: -1,
    sfxLava: null
  };

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
  const totalLife = def.eruptTime + def.lavaFreezeTime;

  for (const w of list) {
    if (w) w._lavaMoveMul = 1;
  }

  for (let v = sys.volcanos.length - 1; v >= 0; v--) {
    const volcano = sys.volcanos[v];
    const field = volcano.field;
    volcano.elapsed += dt;

    if (volcano.elapsed >= totalLife) {
      freezeVolcano(sys, volcano);
      sys.volcanos.splice(v, 1);
      continue;
    }

    if (field.terrainVersion !== sys.terrain.morphVersion && !sys.terrain.morphs.length) {
      field.terrainVersion = sys.terrain.morphVersion;
      sampleTerrain(sys.terrain, field);
      markOpenCells(field);
    }

    const erupting = volcano.elapsed < def.eruptTime;
    const after = Math.max(0, volcano.elapsed - def.eruptTime);
    /** Chladnoucí láva tuhne — tekutost klesá k nule */
    const mobility =
      def.lavaMobility *
      (1 - smoothstep(after / Math.max(0.1, def.lavaFreezeTime * 0.8)) * 0.97);
    const power = erupting
      ? Math.min(1, volcano.elapsed / 0.8) *
        (1 - 0.7 * smoothstep((volcano.elapsed - def.eruptTime * 0.75) / (def.eruptTime * 0.25)))
      : 0;

    const sub = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) {
      if (erupting) injectLava(field, def.eruptRate * power * sub);
      flowStep(field, def, sub, mobility);
    }

    const freeze = smoothstep(
      (after - def.lavaFreezeTime * 0.35) / (def.lavaFreezeTime * 0.6)
    );
    const heat = refreshLavaMesh(field, volcano.render, 1 - freeze * 0.55);
    if (field.wetCount !== volcano.indexedCount) {
      volcano.indexedCount = field.wetCount;
      rebuildLavaIndex(field, volcano.render.mesh);
    }

    volcano.render.mat.uniforms.uTime.value = volcano.elapsed;
    volcano.render.mat.uniforms.uFreeze.value = freeze;
    updateVolcanoLight(volcano, heat, 1 - freeze);

    volcano.fxTimer -= dt;
    if (erupting && volcano.fxTimer <= 0) {
      volcano.fxTimer = 0.1 + Math.random() * 0.1;
      eruptionFx(sys, field, power);
    }
    volcano.steamTimer -= dt;
    if (volcano.steamTimer <= 0) {
      volcano.steamTimer = 0.2 + Math.random() * 0.15;
      steamFx(sys, field);
    }

    if (volcano.sfxLava?.alive && listener) {
      sys.audio.updateSfxLoop(volcano.sfxLava, volcano.dir, listener, 1 - freeze * 0.9);
    }

    applyLavaDamage(field, list, def, dt, 1 - freeze);
  }
}

function updateVolcanoLight(volcano, heat, active) {
  const field = volcano.field;
  const pulse = 0.74 + 0.26 * Math.sin(volcano.elapsed * 7.3);
  volcano.light.intensity = active * pulse * (0.9 + Math.min(2.2, heat * 0.02));
  if (!field.hasHot) return;

  const u = field.hotU;
  const v = field.hotV;
  const r = Math.hypot(u, v);
  surfaceOffsetDir(field.center, field.east, field.north, Math.atan2(v, u), r, _dir);
  const gx = (u + field.radius) / field.cell - 0.5;
  const gy = (v + field.radius) / field.cell - 0.5;
  const surf = sampleGrid(field.terr, gx, gy) + sampleGrid(field.vis, gx, gy) + 0.6;
  volcano.light.position.copy(_dir).multiplyScalar(surf);
}

function applyLavaDamage(field, list, def, dt, hotFactor) {
  if (hotFactor <= 0.02) return;
  for (const w of list) {
    if (!w || w.dead) continue;
    if (!gridCoordAt(field, w.dir, _cell)) continue;
    if (sampleGrid(field.vis, _cell.x, _cell.y) < 0.05) continue;
    w._lavaMoveMul = CONFIG.wizardWaterSpeedMul;
    if (w.godMode || w.remote) continue;
    const hot = Math.max(0.35, sampleGrid(field.temp, _cell.x, _cell.y));
    w.takeDamage(def.lavaDps * hot * hotFactor * dt, { knock: false });
  }
}

/* ---------------------------------------------------- trvalá spálenina */

/** Stopa lávy zůstane jako spáleniště — mesh kůry i barva vrcholů terénu. */
function freezeVolcano(sys, volcano) {
  const field = volcano.field;
  const mat = volcano.render.mat;
  mat.uniforms.uFreeze.value = 1;

  field.temp.fill(0);
  refreshLavaMesh(field, volcano.render, 0.45);
  rebuildLavaIndex(field, volcano.render.mesh);

  sys.audio?.stopSfxLoop(volcano.sfxLava, 0.6);
  volcano.sfxLava = null;
  sys.planetGroup.remove(volcano.light);
  volcano.light.dispose();

  paintTerrainScorch(sys, field);

  const render = volcano.render;
  sys.scorchMarks.push({
    kind: "lava",
    mesh: render.mesh,
    mat,
    refresh: (terrain) => {
      sampleTerrainCovered(terrain, field);
      refreshLavaMesh(field, render, 0.45);
    }
  });

  field.flux = null;
  field.drain = null;
  field.heatIn = null;
}

/** Rozmytá stopa do barvy terénu — nepravidelná šedo-černá s dírami. */
function paintTerrainScorch(sys, field) {
  const halo = new Float32Array(GRID * GRID);
  blurGrid(field.cover, halo, 3);
  sys.terrain.scorchField(field.center, field.radius, (dx, dy, dz) => {
    _dir.set(dx, dy, dz);
    if (!gridCoordAt(field, _dir, _cell)) return 0;
    const c = sampleGrid(halo, _cell.x, _cell.y);
    if (c <= 0.01) return 0;
    const n1 = 0.5 + 0.5 * Math.sin(dx * 61.3 + dy * 37.9 + dz * 83.1);
    const n2 = 0.5 + 0.5 * Math.sin(dx * 127.7 - dy * 94.2 + dz * 51.5);
    const n3 = 0.5 + 0.5 * Math.sin(dx * 23.1 + dy * 173.4 - dz * 112.8);
    const patch = n1 * 0.42 + n2 * 0.33 + n3 * 0.25;
    const holes = 0.34 + 0.66 * n2;
    const grain = patch * holes;
    return Math.min(0.9, Math.pow(Math.min(1, c * 1.28), 0.68) * (0.4 + 0.6 * grain));
  });
}

function disposeVolcano(sys, volcano) {
  sys.audio?.stopSfxLoop(volcano.sfxLava, 0.05);
  volcano.sfxLava = null;
  sys.planetGroup.remove(volcano.render.mesh);
  volcano.render.mesh.geometry.dispose();
  volcano.render.mat.dispose();
  sys.planetGroup.remove(volcano.light);
  volcano.light.dispose();
}

export function disposeVolcanos(sys) {
  if (!sys.volcanos) return;
  for (const v of sys.volcanos) disposeVolcano(sys, v);
  sys.volcanos.length = 0;
}
