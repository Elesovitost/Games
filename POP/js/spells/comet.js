import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { tmp, tangentFrame, surfaceOffsetDir } from "../utils.js";
import { createFireFx } from "../burn.js";
import { SPELLS } from "./defs.js";
import { surfaceDist } from "./fx-common.js";
import { isWaterAt, spawnWaterSplash } from "./water-fx.js";
import { LAVA_VERT, LAVA_FRAG } from "./volcano.js";
import { spawnFireShards } from "./fireball.js";

const _start = new THREE.Vector3();
const _impact = new THREE.Vector3();
const _world = new THREE.Vector3();
const _ray = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _zFwd = new THREE.Vector3(0, 0, 1);
const _yUp = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _mat = new THREE.Matrix4();

const GEO = {
  rock: null,
  sphere: null,
  cone: null
};

let _mistMap = null;
let _lavaMap = null;

const TRAIL_PUFFS = 64;
/** Stejné tempo rozplynutí jako mlha nad kráterem (s). */
const TRAIL_LIFE = 2.7;

function geo() {
  if (!GEO.rock) {
    GEO.rock = new THREE.IcosahedronGeometry(1, 1);
    GEO.sphere = new THREE.SphereGeometry(1, 10, 8);
    GEO.cone = new THREE.ConeGeometry(1, 1, 7, 1, true);
  }
  return GEO;
}

/**
 * Jedna malá sdílená textura pro všechnu mlhu. Nepravidelná alfa rozbije
 * obrys koule, ale renderuje se jen několik levných billboardů.
 */
function mistMap() {
  if (_mistMap) return _mistMap;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,1)");
  grad.addColorStop(0.72, "rgba(255,255,255,0.82)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 13; i++) {
    const a = i * 2.39996;
    const r = 8 + (i % 4) * 4;
    const x = 32 + Math.cos(a) * r;
    const y = 32 + Math.sin(a) * r * 0.8;
    const hole = ctx.createRadialGradient(x, y, 0, x, y, 4 + (i % 3) * 2);
    hole.addColorStop(0, "rgba(0,0,0,0.22)");
    hole.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = hole;
    ctx.fillRect(0, 0, size, size);
  }
  _mistMap = new THREE.CanvasTexture(canvas);
  _mistMap.needsUpdate = true;
  return _mistMap;
}

/** Procedurální tmavá kůra s jasnými lávovými žilami; jedna 64px textura. */
function lavaMap() {
  if (_lavaMap) return _lavaMap;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const base = ctx.createRadialGradient(19, 16, 1, 32, 32, 46);
  base.addColorStop(0, "#ff9a24");
  base.addColorStop(0.18, "#8f2608");
  base.addColorStop(0.5, "#2a130d");
  base.addColorStop(1, "#0e0a08");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  ctx.lineCap = "round";
  for (let i = 0; i < 15; i++) {
    const y = (i * 17 + 9) % size;
    ctx.beginPath();
    ctx.moveTo(-4, y);
    for (let x = 4; x <= size + 4; x += 8) {
      const wave = Math.sin(x * 0.31 + i * 1.7) * (2 + (i % 3));
      ctx.lineTo(x, y + wave);
    }
    ctx.strokeStyle = i % 4 === 0 ? "rgba(255,225,105,0.9)" : "rgba(255,72,8,0.7)";
    ctx.lineWidth = i % 4 === 0 ? 1.15 : 0.7;
    ctx.stroke();
  }

  _lavaMap = new THREE.CanvasTexture(canvas);
  _lavaMap.wrapS = _lavaMap.wrapT = THREE.RepeatWrapping;
  _lavaMap.needsUpdate = true;
  return _lavaMap;
}

/** Start je vysoko v obraze a daleko od kamery; dráha pak zůstává přímá. */
function approachStart(sys, camera, out) {
  const def = SPELLS.comet;
  _world.set(0, def.approachNdcY, 0.5).unproject(camera);
  _ray.copy(_world).sub(camera.position).normalize();
  _world.copy(camera.position).addScaledVector(_ray, def.approachCameraDist);
  sys.planetGroup.worldToLocal(_world);
  return out.copy(_world);
}

function poseTail(mesh, len, behind = 0) {
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.z = -behind - len * 0.5;
  mesh.scale.y = len;
}

function makeComet(radius) {
  const g = geo();
  const group = new THREE.Group();
  group.frustumCulled = false;
  const mats = [];

  const lava = lavaMap();
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: lava,
    roughness: 0.96,
    metalness: 0.04,
    emissive: 0xff4a0a,
    emissiveMap: lava,
    emissiveIntensity: 0.9,
    flatShading: true
  });
  mats.push(rockMat);
  const rock = new THREE.Mesh(g.rock, rockMat);
  rock.scale.set(radius * 1.05, radius * 0.86, radius * 0.95);

  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xff6a16,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  mats.push(glowMat);
  const glow = new THREE.Mesh(g.sphere, glowMat);
  glow.scale.setScalar(radius * 1.25);

  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffedb0,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  mats.push(coreMat);
  const core = new THREE.Mesh(g.cone, coreMat);
  core.scale.set(radius * 0.26, 1, radius * 0.26);

  const fireMat = new THREE.MeshBasicMaterial({
    color: 0xff7a18,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  mats.push(fireMat);
  const fire = new THREE.Mesh(g.cone, fireMat);
  fire.scale.set(radius * 0.68, 1, radius * 0.68);

  const smoke = [];
  const map = mistMap();
  for (let i = 0; i < 8; i++) {
    const mat = new THREE.SpriteMaterial({
      map,
      color: i < 2 ? 0x302824 : 0x171615,
      transparent: true,
      opacity: 0.48 - i * 0.022,
      depthWrite: false,
      fog: false
    });
    mats.push(mat);
    const sprite = new THREE.Sprite(mat);
    sprite.position.z = -radius * (1.25 + i * 0.92);
    const s = radius * (1.55 + i * 0.25);
    sprite.scale.set(s * 1.25, s, 1);
    sprite.frustumCulled = false;
    smoke.push(sprite);
    group.add(sprite);
  }

  const light = new THREE.PointLight(0xff6a18, 6, 35, 2);
  group.add(rock, glow, fire, core, light);
  return { group, rock, glow, core, fire, smoke, light, mats };
}

/**
 * Stopa podél celé dráhy start→dopad. U startu úzká (1/5), u komety plná;
 * puff se hned po odhalení začne rozplývat.
 */
function makeTrail(sys, radius, start, impact) {
  const trail = [];
  const map = mistMap();
  _vel.copy(impact).sub(start).normalize();
  tangentFrame(_vel, tmp.east, tmp.north);
  for (let i = 0; i < TRAIL_PUFFS; i++) {
    const pathU = i / (TRAIL_PUFFS - 1);
    /** 1/5 na začátku letu → plná šířka u dopadu. */
    const taper = 0.2 + 0.8 * pathU;
    const size = radius * 1.55 * taper * 1.5;
    const mat = new THREE.SpriteMaterial({
      map,
      color: i % 5 === 0 ? 0x302925 : 0x121212,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.lerpVectors(start, impact, pathU);
    /** Mírný nepravidelný rozhoz do stran — ať to není rovný kužel. */
    const jx = Math.sin(i * 2.39996 + 0.7) * 0.55 + Math.sin(i * 5.1) * 0.22;
    const jy = Math.cos(i * 1.732 + 1.3) * 0.55 + Math.sin(i * 3.7 + 0.4) * 0.22;
    const jitter = size * 0.42;
    sprite.position.addScaledVector(tmp.east, jx * jitter);
    sprite.position.addScaledVector(tmp.north, jy * jitter);
    sprite.scale.set(size * 1.2, size, 1);
    sprite.visible = false;
    sprite.frustumCulled = false;
    sys.planetGroup.add(sprite);
    trail.push({
      sprite,
      mat,
      pathU,
      size,
      age: -1
    });
  }
  return trail;
}

function updateTrail(comet, dt) {
  const u = comet.phase === "flight"
    ? Math.min(1, comet.t / SPELLS.comet.flightTime)
    : 1;
  for (let i = 0; i < comet.trail.length; i++) {
    const puff = comet.trail[i];
    if (puff.age < 0) {
      if (puff.pathU > u) continue;
      puff.sprite.visible = true;
      puff.age = 0;
    }
    puff.age += dt;
    const fade = Math.max(0, 1 - puff.age / TRAIL_LIFE);
    puff.mat.opacity = 0.62 * fade * fade;
    const grow = puff.size * (1 + (1 - fade) * 2.6);
    puff.sprite.scale.set(grow * 1.2, grow, 1);
    if (fade <= 0) puff.sprite.visible = false;
  }
}

const BUN_VERT = `
varying float vFacing;
void main() {
  vec3 wN = normalize(mat3(modelMatrix) * normal);
  vec3 wP = (modelMatrix * vec4(position, 1.0)).xyz;
  vFacing = abs(dot(wN, normalize(cameraPosition - wP)));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BUN_FRAG = `
uniform vec3 uColor;
uniform float uOpacity;
varying float vFacing;
void main() {
  float core = smoothstep(0.06, 0.82, vFacing);
  float a = core * core * uOpacity;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor * (0.5 + 0.5 * core), a);
}
`;

function bunMat(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 }
    },
    vertexShader: BUN_VERT,
    fragmentShader: BUN_FRAG,
    transparent: true,
    depthWrite: false
  });
}

/**
 * Prach jako zploštělé oválné bochánky nad povrchem. Skupina je
 * naklopená podle planety (Y = nahoru), ne karty na hraně.
 */
function makeMist(sys, pos, up) {
  tangentFrame(up, tmp.east, tmp.north);
  if (sys.camera) {
    tmp.dir.copy(sys.camera.position);
    sys.planetGroup.worldToLocal(tmp.dir);
    tmp.dir.sub(pos);
    tmp.dir.addScaledVector(up, -tmp.dir.dot(up));
    if (tmp.dir.lengthSq() < 1e-8) tmp.dir.copy(tmp.north);
    else tmp.dir.normalize();
  } else {
    tmp.dir.copy(tmp.north);
  }
  tmp.dir2.crossVectors(up, tmp.dir).normalize();

  const group = new THREE.Group();
  group.position.copy(pos);
  group.quaternion.setFromRotationMatrix(_mat.makeBasis(tmp.dir2, up, tmp.dir));
  group.frustumCulled = false;

  const sphere = geo().sphere;
  const mats = [bunMat(0x1c1a19), bunMat(0x292522), bunMat(0x100f0f)];
  // [side, alongCam, lift, rx, ry, rz, mat] — vyšší bochánky níž u země
  const specs = [
    [0, 0, 2.2, 9.2, 4.0, 7.0, 2],
    [-3.2, 1.2, 1.6, 5.1, 3.0, 4.1, 0],
    [3.4, 0.8, 1.65, 5.0, 3.1, 4.0, 1],
    [-1.6, -2.8, 1.7, 5.6, 3.2, 4.5, 2],
    [2.2, 2.6, 1.75, 4.9, 3.1, 3.9, 0],
    [-3.5, -1.5, 1.75, 5.1, 3.2, 4.1, 1],
    [1.2, -3.2, 1.85, 5.4, 3.3, 4.3, 2],
    [0.4, 3.0, 2.15, 6.6, 3.7, 5.4, 0],
    [-2.4, 2.8, 1.85, 5.6, 3.2, 4.5, 1],
    [2.8, -2.2, 1.9, 5.4, 3.2, 4.3, 2]
  ];
  const sprites = [];
  for (const [side, along, lift, sx, sy, sz, mi] of specs) {
    const sprite = new THREE.Mesh(sphere, mats[mi]);
    sprite.position.set(side, lift, along);
    sprite.scale.set(sx, sy, sz);
    sprite.frustumCulled = false;
    group.add(sprite);
    sprites.push({ sprite, sx, sy, sz, lift });
  }
  sys.planetGroup.add(group);
  return { mats, sprites, group };
}

const LAVA_LIFT = 0.09;
const LAVA_RINGS = 6;
const LAVA_SEGS = 32;
const COMET_LAVA_COOL_TIME_MUL = 0.5;

function lavaFreezeT(elapsed) {
  const hot = SPELLS.volcano.lavaHeatTime * COMET_LAVA_COOL_TIME_MUL;
  const freeze = SPELLS.volcano.lavaFreezeTime * COMET_LAVA_COOL_TIME_MUL;
  const after = Math.max(0, elapsed - hot);
  const u = (after - freeze * 0.35) / Math.max(0.1, freeze * 0.6);
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
}

/**
 * Disk lávy přes kráter + okolí. Stejný shader jako sopka: žhavá kůra,
 * gradientní nepravidelný okraj, uFreeze → ztuhlá spálenina.
 */
function makeLavaCrust(sys, center, radius, craterR) {
  const n = 1 + LAVA_RINGS * LAVA_SEGS;
  const positions = new Float32Array(n * 3);
  const covers = new Float32Array(n);
  const heats = new Float32Array(n);
  const coords = new Float32Array(n * 2);
  const dirs = new Float32Array(n * 3);
  tangentFrame(center, tmp.east, tmp.north);

  const write = (i, dir, eastM, northM, distM) => {
    const wobble =
      0.82 +
      0.18 * Math.sin(eastM * 0.71 + northM * 0.53) +
      0.08 * Math.sin(eastM * 1.37 - northM * 1.11);
    let cover = 1;
    if (distM > craterR) {
      const t = (distM - craterR) / Math.max(1e-5, radius - craterR);
      cover = Math.max(0, (1 - t) * (1 - t) * wobble);
    }
    const h = sys.terrain.height(dir) + LAVA_LIFT;
    const j = i * 3;
    positions[j] = dir.x * h;
    positions[j + 1] = dir.y * h;
    positions[j + 2] = dir.z * h;
    dirs[j] = dir.x;
    dirs[j + 1] = dir.y;
    dirs[j + 2] = dir.z;
    covers[i] = cover;
    heats[i] = cover;
    coords[i * 2] = eastM * 2.4;
    coords[i * 2 + 1] = northM * 2.4;
  };

  write(0, center, 0, 0, 0);
  for (let ring = 1; ring <= LAVA_RINGS; ring++) {
    const r = (ring / LAVA_RINGS) * radius;
    for (let s = 0; s < LAVA_SEGS; s++) {
      const a = (s / LAVA_SEGS) * Math.PI * 2;
      const eastM = Math.cos(a) * r;
      const northM = Math.sin(a) * r;
      surfaceOffsetDir(center, tmp.east, tmp.north, a, r, tmp.dir);
      write(1 + (ring - 1) * LAVA_SEGS + s, tmp.dir, eastM, northM, r);
    }
  }

  const indices = [];
  for (let s = 0; s < LAVA_SEGS; s++) {
    indices.push(0, 1 + s, 1 + ((s + 1) % LAVA_SEGS));
  }
  for (let ring = 1; ring < LAVA_RINGS; ring++) {
    const inner = 1 + (ring - 1) * LAVA_SEGS;
    const outer = 1 + ring * LAVA_SEGS;
    for (let s = 0; s < LAVA_SEGS; s++) {
      const next = (s + 1) % LAVA_SEGS;
      indices.push(inner + s, outer + s, outer + next, inner + s, outer + next, inner + next);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aCover", new THREE.BufferAttribute(covers, 1));
  geometry.setAttribute("aHeat", new THREE.BufferAttribute(heats, 1));
  geometry.setAttribute("aCoord", new THREE.BufferAttribute(coords, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

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
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.renderOrder = 0;
  mesh.frustumCulled = false;
  sys.planetGroup.add(mesh);

  const light = new THREE.PointLight(0xff6a18, 4.5, 22, 2);
  light.position.copy(center).multiplyScalar(sys.terrain.height(center) + 1.2);
  sys.planetGroup.add(light);

  return {
    mesh,
    mat,
    light,
    dirs,
    radius,
    terrainVersion: sys.terrain.morphVersion,
    frozen: false
  };
}

function restickLava(sys, lava) {
  if (lava.terrainVersion === sys.terrain.morphVersion) return;
  const pos = lava.mesh.geometry.attributes.position;
  const arr = pos.array;
  for (let i = 0; i < pos.count; i++) {
    const j = i * 3;
    tmp.dir.set(lava.dirs[j], lava.dirs[j + 1], lava.dirs[j + 2]);
    const h = sys.terrain.height(tmp.dir) + LAVA_LIFT;
    arr[j] = lava.dirs[j] * h;
    arr[j + 1] = lava.dirs[j + 1] * h;
    arr[j + 2] = lava.dirs[j + 2] * h;
  }
  pos.needsUpdate = true;
  lava.mesh.geometry.computeVertexNormals();
  lava.terrainVersion = sys.terrain.morphVersion;
}

function freezeCometLava(sys, comet) {
  const fx = comet.impactFx;
  const lava = fx?.lava;
  if (!lava || lava.frozen) return;
    lava.frozen = true;

  if (lava.light) {
    sys.planetGroup.remove(lava.light);
    lava.light.dispose();
    lava.light = null;
  }

  const dirs = lava.dirs;
  const mesh = lava.mesh;
  const mat = lava.mat;
  sys.scorchMarks.push({
    kind: "lava",
    mesh,
    mat,
    cap: {
      x: comet.target.x,
      y: comet.target.y,
      z: comet.target.z,
      cos: Math.cos((lava.radius + 1.2) / CONFIG.planetR)
    },
    refresh: (terrain) => {
      const pos = mesh.geometry.attributes.position;
      const arr = pos.array;
      for (let i = 0; i < pos.count; i++) {
        const j = i * 3;
        tmp.dir.set(dirs[j], dirs[j + 1], dirs[j + 2]);
        const h = terrain.height(tmp.dir) + LAVA_LIFT;
        arr[j] = dirs[j] * h;
        arr[j + 1] = dirs[j + 1] * h;
        arr[j + 2] = dirs[j + 2] * h;
      }
      pos.needsUpdate = true;
    }
  });
  fx.lava = null;
}

function updateLavaCrust(sys, comet) {
  const lava = comet.impactFx?.lava;
  if (!lava || lava.frozen) return;
  restickLava(sys, lava);
  const freeze = lavaFreezeT(comet.t);
  lava.mat.uniforms.uTime.value = comet.t;
  lava.mat.uniforms.uFreeze.value = freeze;
  if (lava.light) {
    lava.light.intensity = 4.5 * (1 - freeze) * (0.78 + 0.22 * Math.sin(comet.t * 7.3));
  }
  if (freeze >= 0.999) freezeCometLava(sys, comet);
}

function cometLavaHeat(comet, dir) {
  const lava = comet.impactFx?.lava;
  if (!lava || lava.frozen || !dir) return 0;
  const dist = surfaceDist(comet.target, dir);
  if (dist > lava.radius) return 0;
  const inner = SPELLS.comet.craterRadius;
  const edge = Math.max(1e-5, lava.radius - inner);
  const cover = dist <= inner ? 1 : Math.max(0, 1 - (dist - inner) / edge) ** 2;
  const hot = 1 - lavaFreezeT(comet.t);
  return cover > 0.05 && hot > 0.02 ? cover * hot : 0;
}

function applyCometLavaDamage(sys, comet, dt) {
  const lava = comet.impactFx?.lava;
  if (!lava || lava.frozen) return;

  const list = sys.getWizards?.() || (sys.wizard ? [sys.wizard] : []);
  for (const w of list) {
    if (!w || w.dead) continue;
    const heat = cometLavaHeat(comet, w.dir);
    if (heat <= 0) continue;
    w._lavaMoveMul = CONFIG.wizardWaterSpeedMul;
    if (w.godMode || w.remote) continue;
    w.takeDamage(SPELLS.volcano.lavaDps * Math.max(0.35, heat) * dt, { knock: false });
  }

  if (sys.critters) {
    for (const c of sys.critters.list) {
      if (c.charred || cometLavaHeat(comet, c.dir) <= 0) continue;
      c.ignite();
      if (!c.dead) c.die({ fromDir: comet.target, noSlide: true });
    }
  }
  if (sys.longnecks) {
    for (const c of sys.longnecks.list) {
      if (c.dead || c.gone || cometLavaHeat(comet, c.dir) <= 0) continue;
      c.die({ fromDir: comet.target, ignite: true });
    }
  }
  sys.trees?.igniteWhere((dir) => cometLavaHeat(comet, dir) > 0);
}

function makeImpact(sys, pos, up) {
  const mist = makeMist(sys, pos, up);

  const fire = createFireFx({ size: 8, light: true, density: 0.42 });
  fire.group.position.copy(pos).addScaledVector(up, 0.15);
  fire.group.quaternion.copy(_quat.setFromUnitVectors(_yUp, up));
  fire.setStrength(0);
  sys.planetGroup.add(fire.group);

  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffe9b0,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const flash = new THREE.Mesh(geo().sphere, flashMat);
  flash.position.copy(pos).addScaledVector(up, 0.8);
  flash.scale.setScalar(1.2);
  flash.frustumCulled = false;
  sys.planetGroup.add(flash);

  return { mist, fire, flash, flashMat, lava: null };
}

function updateImpact(sys, comet, dt) {
  const def = SPELLS.comet;
  const fx = comet.impactFx;
  comet.t += dt;
  const t = comet.t;

  if (!comet.onWater && !fx.lava && !comet.lavaDone && t >= 0.02) {
    fx.lava = makeLavaCrust(sys, comet.target, def.scorchRadius, def.craterRadius);
    comet.lavaDone = true;
  }
  updateLavaCrust(sys, comet);
  applyCometLavaDamage(sys, comet, dt);

  if (fx.fire) {
    const u = Math.min(1, t / 0.5);
    const strength = u < 0.18 ? u / 0.18 : 1 - (u - 0.18) / 0.82;
    fx.fire.setStrength(Math.max(0, strength));
    fx.fire.update(dt);
    if (u >= 1) {
      fx.fire.dispose();
      fx.fire = null;
    }
  }

  const flashU = Math.min(1, t / 0.22);
  fx.flash.scale.setScalar(1.2 + flashU * 9);
  fx.flashMat.opacity = 0.9 * (1 - flashU) * (1 - flashU);
  fx.flash.visible = flashU < 1;

  let mistOpacity;
  let spread;
  if (t < def.dustHold) {
    const u = t / Math.max(1e-5, def.dustHold);
    const e = u * u * (3 - 2 * u);
    mistOpacity = 0.78 * e;
    spread = 0.42 + e * 0.58;
  } else {
    const u = Math.min(1, (t - def.dustHold) / def.dustFade);
    mistOpacity = 0.78 * (1 - u) * (1 - u);
    spread = 1 + u * 2.6;
  }
  fx.mist.mats[0].uniforms.uOpacity.value = mistOpacity;
  fx.mist.mats[1].uniforms.uOpacity.value = mistOpacity;
  fx.mist.mats[2].uniforms.uOpacity.value = mistOpacity;
  const rising = t < def.dustHold + def.dustFade;
  for (let i = 0; i < fx.mist.sprites.length; i++) {
    const p = fx.mist.sprites[i];
    const wobble = 1 + 0.04 * Math.sin(t * (1.1 + i * 0.12) + i);
    p.sprite.scale.set(p.sx * spread * wobble, p.sy * spread * wobble, p.sz * spread);
    if (rising) p.sprite.position.y += dt * (0.28 + i * 0.03);
    p.sprite.visible = mistOpacity > 0.02;
  }

  const lavaLife = (SPELLS.volcano.lavaHeatTime + SPELLS.volcano.lavaFreezeTime) * COMET_LAVA_COOL_TIME_MUL;
  return t < Math.max(def.dustHold + def.dustFade, lavaLife) || !!fx.lava;
}

function applyCometBlast(sys, dir) {
  const def = SPELLS.comet;
  const list = sys.getWizards?.() || (sys.wizard ? [sys.wizard] : []);
  for (const w of list) {
    if (!w || w.dead || w.remote) continue;
    const dist = surfaceDist(dir, w.dir);
    if (dist >= def.damageRadius) continue;
    const u = dist / def.damageRadius;
    const damage = def.damageCenter + (def.damageEdge - def.damageCenter) * u;
    w.takeDamage(damage, { fromDir: dir });
  }
  sys.critters?.blastNear(dir, def.craterRadius, def.damageRadius);
  sys.longnecks?.blastNear(dir, def.craterRadius, def.damageRadius);
  sys.trees?.vaporizeNear(dir, def.craterRadius);
  sys.trees?.igniteNear(dir, def.damageRadius);
}

function hitComet(sys, comet) {
  const def = SPELLS.comet;
  const dir = comet.target;
  const onWater = isWaterAt(sys, dir);
  comet.onWater = onWater;
  const pos = _impact.copy(dir).multiplyScalar(sys.terrain.height(dir));

  const listener = sys.getListenerDir?.(tmp.dir);
  if (listener) {
    sys.audio?.playEffectAt("meteorImpact", dir, listener, {
      casterId: comet.casterId,
      volume: 1.25
    });
  }
  if (comet.sfxFly) {
    sys.audio?.stopSfxLoop(comet.sfxFly, 0.04);
    comet.sfxFly = null;
  }
  comet.group.visible = false;

  sys.terrain.beginMorph(dir, -1, 0, {
    radius: def.craterRadius,
    amount: def.craterDepth
  });
  if (onWater) spawnWaterSplash(sys, dir, 5);

  applyCometBlast(sys, dir);
  comet.impactFx = makeImpact(sys, pos, dir);
  if (!onWater) {
    spawnFireShards(sys, pos, dir, { count: 140, speed: 4.05, size: 2.2 });
  }
  comet.phase = "impact";
  comet.t = 0;
}

function disposeComet(sys, comet) {
  if (comet.sfxFly) sys.audio?.stopSfxLoop(comet.sfxFly, 0.04);
  comet.sfxFly = null;
  if (comet.group) sys.planetGroup.remove(comet.group);
  for (const mat of comet.mats || []) mat.dispose();
  for (const puff of comet.trail || []) {
    sys.planetGroup.remove(puff.sprite);
    puff.mat.dispose();
  }

  const fx = comet.impactFx;
  if (!fx) return;
  fx.fire?.dispose();
  if (fx.lava) {
    if (fx.lava.light) {
      sys.planetGroup.remove(fx.lava.light);
      fx.lava.light.dispose();
    }
    sys.planetGroup.remove(fx.lava.mesh);
    fx.lava.mesh.geometry.dispose();
    fx.lava.mat.dispose();
    fx.lava = null;
  }
  sys.planetGroup.remove(fx.flash);
  fx.flashMat.dispose();
  sys.planetGroup.remove(fx.mist.group);
  for (const mat of fx.mist.mats) mat.dispose();
}

export function spawnComet(sys, targetDir) {
  const def = SPELLS.comet;
  const target = targetDir.clone().normalize();
  _impact.copy(target).multiplyScalar(sys.terrain.height(target));

  if (sys.camera) {
    sys.camera.updateMatrixWorld(true);
    sys.planetGroup.updateMatrixWorld(true);
    approachStart(sys, sys.camera, _start);
    /** Posuň start víc nad cíl — pád je kolmější zeshora. */
    _world.copy(_impact).addScaledVector(target, def.approachHeight);
    _start.lerp(_world, def.approachVerticalBlend);
  } else {
    _start.copy(_impact).addScaledVector(target, def.approachHeight);
  }

  const radius = def.diameter * 0.5;
  const built = makeComet(radius);
  built.group.position.copy(_start);
  _vel.copy(_impact).sub(_start).normalize();
  built.group.quaternion.setFromUnitVectors(_zFwd, _vel);

  const pathLen = _start.distanceTo(_impact);
  const fireLen = Math.min(radius * 3.2, pathLen * 0.24);
  const coreLen = fireLen * 0.52;
  poseTail(built.core, coreLen, radius * 0.12);
  poseTail(built.fire, fireLen, radius * 0.16);
  sys.planetGroup.add(built.group);

  const listener = sys.getListenerDir?.();
  let sfxFly = null;
  if (listener && sys.audio) {
    sfxFly = sys.audio.startSfxLoop("meteorFly", target, listener, {
      volume: 1.05,
      loop: false
    });
    if (!sfxFly) {
      sys.audio.playEffectAt("meteorFly", target, listener, {
        casterId: sys._castOwnerId,
        volume: 1.05
      });
    }
  }

  if (!sys.comets) sys.comets = [];
  sys.comets.push({
    target,
    start: _start.clone(),
    impact: _impact.clone(),
    group: built.group,
    rock: built.rock,
    glow: built.glow,
    core: built.core,
    fire: built.fire,
    smoke: built.smoke,
    mats: built.mats,
    trail: makeTrail(sys, radius, _start, _impact),
    coreLen,
    fireLen,
    sfxFly,
    casterId: sys._castOwnerId,
    t: 0,
    phase: "flight",
    impactFx: null,
    onWater: false,
    lavaDone: false
  });
}

export function updateComets(sys, dt) {
  if (!sys.comets?.length) return;
  const listener = sys.getListenerDir?.();

  for (let i = sys.comets.length - 1; i >= 0; i--) {
    const comet = sys.comets[i];
    if (comet.phase === "impact") {
      updateTrail(comet, dt);
      if (!updateImpact(sys, comet, dt)) {
        disposeComet(sys, comet);
        sys.comets.splice(i, 1);
      }
      continue;
    }

    comet.t += dt;
    const u = Math.min(1, comet.t / SPELLS.comet.flightTime);
    /** Přímka a konstantní rychlost; perspektiva vytvoří prudké přiblížení. */
    comet.group.position.lerpVectors(comet.start, comet.impact, u);
    comet.rock.rotation.x += dt * 2.2;
    comet.rock.rotation.z += dt * 1.4;

    const pulse = 0.82 + 0.18 * Math.sin(comet.t * 25);
    comet.glow.material.opacity = 0.3 + 0.13 * pulse;
    comet.core.material.opacity = 0.54 + 0.2 * pulse;
    comet.fire.material.opacity = 0.45 + 0.16 * pulse;
    for (let k = 0; k < comet.smoke.length; k++) {
      comet.smoke[k].material.opacity = (0.48 - k * 0.022) * (0.86 + 0.14 * pulse);
    }

    updateTrail(comet, dt);

    const tailGrow = 0.4 + 0.6 * Math.min(1, u * 4);
    poseTail(comet.core, comet.coreLen * tailGrow, SPELLS.comet.diameter * 0.06);
    poseTail(comet.fire, comet.fireLen * tailGrow, SPELLS.comet.diameter * 0.08);

    /** Koule zmizí těsně nad zemí; dopad a FX běží dál v hitComet. */
    if (comet.group.visible) {
      const distLeft = comet.group.position.distanceTo(comet.impact);
      if (distLeft < SPELLS.comet.diameter * 0.55) {
        comet.group.visible = false;
      }
    }

    if (comet.sfxFly?.alive && listener) {
      sys.audio?.updateSfxLoop(comet.sfxFly, comet.target, listener);
    }
    if (u >= 1) hitComet(sys, comet);
  }
}

export function disposeComets(sys) {
  if (!sys.comets) return;
  for (const comet of sys.comets) disposeComet(sys, comet);
  sys.comets.length = 0;
}
