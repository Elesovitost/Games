import * as THREE from "./three.js";

export const BURN_DURATION = 10;
export const CHAR_COLOR = 0x1a120e;

const MAX_FIRE_LIGHTS = 10;
let _liveLights = 0;

const _size = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _box = new THREE.Box3();
const _part = new THREE.Box3();

let _maps = null;

function ensureMaps() {
  if (_maps) return _maps;
  _maps = {
    flame: makeFlameMap(),
    glow: makeRadialMap([
      [0, "rgba(255,245,200,1)"],
      [0.18, "rgba(255,170,50,0.85)"],
      [0.5, "rgba(255,70,8,0.28)"],
      [1, "rgba(0,0,0,0)"]
    ]),
    ember: makeRadialMap([
      [0, "rgba(255,255,230,1)"],
      [0.2, "rgba(255,190,70,0.95)"],
      [0.55, "rgba(255,80,10,0.4)"],
      [1, "rgba(0,0,0,0)"]
    ]),
    smoke: makeRadialMap([
      [0, "rgba(55,50,46,0.7)"],
      [0.4, "rgba(42,40,38,0.4)"],
      [0.75, "rgba(30,28,26,0.12)"],
      [1, "rgba(20,18,16,0)"]
    ])
  };
  return _maps;
}

function makeRadialMap(stops, res = 64) {
  const c = document.createElement("canvas");
  c.width = c.height = res;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(res / 2, res / 2, 0, res / 2, res / 2, res / 2);
  for (const [t, col] of stops) g.addColorStop(t, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, res, res);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

/** Jazyk plamene — širší spodek, špička nahoře, měkký okraj. */
function makeFlameMap() {
  const w = 64;
  const h = 128;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");

  const tongue = (cx, lean, width, alpha) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(cx, h * 0.96);
    ctx.bezierCurveTo(cx - width, h * 0.72, cx - width * 0.85 + lean, h * 0.38, cx + lean * 0.4, h * 0.06);
    ctx.bezierCurveTo(cx + width * 0.85 + lean, h * 0.38, cx + width, h * 0.72, cx, h * 0.96);
    ctx.closePath();
    const g = ctx.createLinearGradient(cx, h * 0.98, cx + lean * 0.2, h * 0.04);
    g.addColorStop(0, "rgba(255,255,245,1)");
    g.addColorStop(0.12, "rgba(255,236,150,0.98)");
    g.addColorStop(0.32, "rgba(255,150,28,0.92)");
    g.addColorStop(0.58, "rgba(255,70,8,0.55)");
    g.addColorStop(0.82, "rgba(180,18,0,0.18)");
    g.addColorStop(1, "rgba(40,0,0,0)");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  };

  tongue(w * 0.5, 0, w * 0.42, 1);
  tongue(w * 0.42, -6, w * 0.28, 0.7);
  tongue(w * 0.58, 7, w * 0.26, 0.65);
  tongue(w * 0.5, 2, w * 0.16, 0.85);

  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function spriteMat(map, color, additive) {
  return new THREE.SpriteMaterial({
    map,
    color,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    opacity: 1,
    fog: false
  });
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

/**
 * Charakteristický rozměr objektu v lokálním prostoru `root` (metry).
 * Stačí předat skupinu stromu / zvířete / budovy.
 */
export function fireSizeOf(root) {
  if (!root) return 1;
  root.updateWorldMatrix(true, true);
  _inv.copy(root.matrixWorld).invert();
  _box.makeEmpty();
  root.traverse((ch) => {
    if (!ch.isMesh || !ch.geometry) return;
    const g = ch.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    _part.copy(g.boundingBox);
    _part.applyMatrix4(ch.matrixWorld);
    _part.applyMatrix4(_inv);
    _box.union(_part);
  });
  if (_box.isEmpty()) return 1;
  _box.getSize(_size);
  return Math.max(_size.x, _size.y, _size.z, 0.35);
}

/**
 * Univerzální oheň. Lokální Y = nahoru od země objektu.
 * `size` = obálka v metrech (malé zvíře ~1, strom ~4, budova ~6–10).
 *
 * @param {number|{ size?: number, light?: boolean, density?: number }} sizeOrOpts
 */
export function createFireFx(sizeOrOpts = 1) {
  const opts = typeof sizeOrOpts === "number" ? { size: sizeOrOpts } : sizeOrOpts || {};
  const maps = ensureMaps();
  const group = new THREE.Group();
  group.frustumCulled = false;
  group.name = "fireFx";

  let size = Math.max(0.25, opts.size ?? 1);
  let strength = 1;
  let t = 0;
  const density = clamp(opts.density ?? 1, 0.25, 1);

  const nFlames = Math.round(clamp((5 + size * 2.4) * density, 5, 16));
  const nEmbers = Math.round(clamp((5 + size * 2.2) * density, 4, 18));
  const nSmoke = Math.round(clamp((3 + size * 1.3) * density, 3, 10));

  const heatHex = [0xfff6c8, 0xffcc55, 0xff8a18, 0xff4a08, 0xff2200];
  const flames = [];
  const embers = [];
  const smokes = [];
  const mats = [];

  const glowMat = spriteMat(maps.glow, 0xffb040, true);
  mats.push(glowMat);
  const glow = new THREE.Sprite(glowMat);
  glow.frustumCulled = false;
  glow.renderOrder = 5;
  group.add(glow);

  const coreMat = spriteMat(maps.glow, 0xfff2c0, true);
  mats.push(coreMat);
  const core = new THREE.Sprite(coreMat);
  core.frustumCulled = false;
  core.renderOrder = 8;
  group.add(core);

  for (let i = 0; i < nFlames; i++) {
    const layer = i / nFlames;
    const hex = heatHex[(layer * (heatHex.length - 1) + Math.random() * 0.7) | 0] || 0xff8a18;
    const mat = spriteMat(maps.flame, hex, true);
    mats.push(mat);
    const spr = new THREE.Sprite(mat);
    spr.center.set(0.5, 0);
    spr.frustumCulled = false;
    spr.renderOrder = 7;
    group.add(spr);
    flames.push({
      spr,
      mat,
      phase: rand(0, Math.PI * 2),
      speed: rand(9, 16),
      life: rand(0.38, 0.85),
      age: rand(0, 0.8),
      ang: rand(0, Math.PI * 2),
      rad: Math.pow(Math.random(), 0.65),
      y0: rand(0.02, 0.22),
      lean: rand(-0.35, 0.35),
      w: rand(0.32, 0.62) * (layer < 0.35 ? 0.75 : 1),
      h: rand(0.85, 1.45),
      spin: rand(-0.8, 0.8)
    });
  }

  for (let i = 0; i < nEmbers; i++) {
    const mat = spriteMat(maps.ember, Math.random() > 0.35 ? 0xffe080 : 0xff6010, true);
    mats.push(mat);
    const spr = new THREE.Sprite(mat);
    spr.frustumCulled = false;
    spr.renderOrder = 9;
    group.add(spr);
    embers.push({
      spr,
      mat,
      age: rand(0, 1),
      life: rand(0.45, 1.15),
      ang: rand(0, Math.PI * 2),
      rad: rand(0.1, 1),
      speed: rand(0.9, 1.8),
      jitter: rand(0, Math.PI * 2),
      s: rand(0.035, 0.08)
    });
  }

  for (let i = 0; i < nSmoke; i++) {
    const mat = spriteMat(maps.smoke, Math.random() > 0.5 ? 0x3a3734 : 0x2a2826, false);
    mats.push(mat);
    const spr = new THREE.Sprite(mat);
    spr.frustumCulled = false;
    spr.renderOrder = 4;
    group.add(spr);
    smokes.push({
      spr,
      mat,
      age: rand(0, 1),
      life: rand(1.4, 2.6),
      ang: rand(0, Math.PI * 2),
      rad: rand(0.15, 0.85),
      drift: rand(-0.4, 0.4),
      s: rand(0.45, 0.85)
    });
    spr.center.set(0.5, 0.2);
  }

  let light = null;
  const wantLight = opts.light !== false && _liveLights < MAX_FIRE_LIGHTS;
  if (wantLight) {
    light = new THREE.PointLight(0xff6a22, 0, 1, 2);
    light.castShadow = false;
    group.add(light);
    _liveLights++;
  }

  const layout = () => {
    glow.position.set(0, size * 0.22, 0);
    core.position.set(0, size * 0.18, 0);
    if (light) {
      light.position.set(0, size * 0.45, 0);
      light.distance = size * 5.5;
    }
  };
  layout();

  const resetEmber = (e) => {
    e.age = 0;
    e.life = rand(0.45, 1.2);
    e.ang = rand(0, Math.PI * 2);
    e.rad = rand(0.05, 1);
    e.speed = rand(0.9, 2.0);
  };

  const resetSmoke = (s) => {
    s.age = 0;
    s.life = rand(1.3, 2.7);
    s.ang = rand(0, Math.PI * 2);
    s.rad = rand(0.1, 0.9);
    s.drift = rand(-0.5, 0.5);
  };

  return {
    group,
    setSize(next) {
      size = Math.max(0.25, next);
      layout();
    },
    setStrength(s) {
      strength = clamp(s, 0, 1);
    },
    update(dt) {
      t += dt;
      const st = strength;
      const R = size * 0.4;
      const H = size * 1.08;
      const wind = Math.sin(t * 0.85) * size * 0.07;
      const flicker =
        0.72 +
        0.28 * (0.5 + 0.5 * Math.sin(t * 17.3)) *
          (0.5 + 0.5 * Math.sin(t * 31.1 + 1.2));

      glow.scale.set(size * 1.6 * st, size * 1.05 * st, 1);
      glowMat.opacity = 0.55 * st * flicker;
      core.scale.set(size * 0.42 * st * flicker, size * 0.38 * st * flicker, 1);
      coreMat.opacity = 0.9 * st * flicker;

      if (light) {
        light.intensity = (1.6 + size * 1.15) * st * flicker;
      }

      for (const f of flames) {
        f.age += dt;
        if (f.age >= f.life) {
          f.age = 0;
          f.life = rand(0.38, 0.9);
          f.ang = rand(0, Math.PI * 2);
          f.rad = Math.pow(Math.random(), 0.65);
        }
        const u = f.age / f.life;
        const env = Math.sin(u * Math.PI);
        const wob = 0.55 + 0.45 * Math.abs(Math.sin(t * f.speed + f.phase));
        const rad = f.rad * R * (0.35 + u * 0.75);
        f.spr.position.set(
          Math.cos(f.ang) * rad + wind * (0.4 + u) + Math.sin(t * 3.2 + f.phase) * size * 0.03,
          (f.y0 + u * 0.38) * H,
          Math.sin(f.ang) * rad + Math.cos(t * 2.6 + f.phase) * size * 0.03
        );
        const sc = st * wob * (0.55 + 0.45 * env);
        f.spr.scale.set(f.w * size * sc * (0.75 + wob * 0.35), f.h * size * sc, 1);
        f.mat.opacity = (0.35 + env * 0.65) * st * wob;
        f.mat.rotation = f.lean * 0.35 + Math.sin(t * 4.5 + f.phase) * 0.12 + f.spin * u * 0.25;
      }

      for (const e of embers) {
        e.age += dt;
        if (e.age >= e.life) resetEmber(e);
        const u = e.age / e.life;
        const rad = e.rad * R * (0.2 + u * 0.9);
        e.spr.position.set(
          Math.cos(e.ang) * rad + wind * u * 1.4 + Math.sin(t * 8 + e.jitter) * size * 0.04,
          (0.12 + u * e.speed) * H,
          Math.sin(e.ang) * rad + Math.cos(t * 7 + e.jitter) * size * 0.04
        );
        const pop = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
        const sc = e.s * size * st * (0.6 + pop);
        e.spr.scale.set(sc, sc, 1);
        e.mat.opacity = 0.95 * st * pop;
      }

      for (const s of smokes) {
        s.age += dt;
        if (s.age >= s.life) resetSmoke(s);
        const u = s.age / s.life;
        const rad = s.rad * R * 0.55 + u * R * 0.35;
        s.spr.position.set(
          Math.cos(s.ang) * rad + wind * u * 2.2 + s.drift * u * size,
          (0.45 + u * 1.15) * H,
          Math.sin(s.ang) * rad
        );
        const sc = s.s * size * (0.7 + u * 1.8) * (0.45 + 0.55 * st);
        s.spr.scale.set(sc * 1.15, sc, 1);
        s.mat.opacity = (1 - u) * (1 - u) * 0.42 * st;
        s.mat.rotation = s.drift * u * 0.8;
      }
    },
    dispose() {
      if (light) {
        _liveLights = Math.max(0, _liveLights - 1);
        light = null;
      }
      group.removeFromParent();
      for (const m of mats) m.dispose();
      mats.length = 0;
      flames.length = 0;
      embers.length = 0;
      smokes.length = 0;
    }
  };
}

/**
 * Připojí oheň na cokoliv. Velikost se vezme z objektu, pokud ji nezadáš.
 * @param {THREE.Object3D} parent
 * @param {{ size?: number, pad?: number, light?: boolean }} [opts]
 */
export function attachFire(parent, opts = {}) {
  const pad = opts.pad ?? 1.22;
  const measured = fireSizeOf(parent);
  const size = opts.size ?? measured * pad;
  const fx = createFireFx({ size, light: opts.light });
  if (opts.lift != null) fx.group.position.y = opts.lift;
  else if (!_box.isEmpty()) fx.group.position.y = _box.min.y + (_box.max.y - _box.min.y) * 0.38;
  parent.add(fx.group);
  return fx;
}

const _fireQueue = [];

/**
 * Handle vracený okamžitě — chová se stejně jako výsledek `attachFire`
 * (setStrength/update/dispose), ale samotné částice ohně (~20-30 sprite
 * objektů) se vytvoří až v `pumpFireQueue`. Hoření/poškození u volajícího
 * (strom, zvíře) začíná okamžitě beze změny — jen vizuální plamínky
 * naskočí o snímek či dva později, když výbuch zapálí víc věcí najednou.
 */
class QueuedFire {
  constructor(parent, opts) {
    this.parent = parent;
    this.opts = opts;
    this.group = null;
    this._fx = null;
    this._disposed = false;
    this._pendingStrength = null;
    this._pendingSize = null;
  }
  setStrength(s) {
    this._pendingStrength = s;
    if (this._fx) this._fx.setStrength(s);
  }
  setSize(s) {
    this._pendingSize = s;
    if (this._fx) this._fx.setSize(s);
  }
  update(dt) {
    if (this._fx) this._fx.update(dt);
  }
  dispose() {
    this._disposed = true;
    if (this._fx) {
      this._fx.dispose();
      this._fx = null;
    }
  }
}

/** Stejné jako `attachFire`, ale zařadí se do fronty — viz `pumpFireQueue`. */
export function attachFireQueued(parent, opts = {}) {
  const handle = new QueuedFire(parent, opts);
  _fireQueue.push(handle);
  return handle;
}

/**
 * Zpracuje pár čekajících ohňů za snímek, aby výbuch zasahující víc
 * stromů/zvířat najednou nevytvořil desítky sprite objektů v jednom
 * snímku. Volat jednou za snímek (main.js).
 */
export function pumpFireQueue(maxPerFrame = 3) {
  if (!_fireQueue.length) return;
  let n = Math.min(maxPerFrame, _fireQueue.length);
  while (n-- > 0) {
    const handle = _fireQueue.shift();
    if (handle._disposed) continue;
    const fx = attachFire(handle.parent, handle.opts);
    handle._fx = fx;
    handle.group = fx.group;
    if (handle._pendingStrength != null) fx.setStrength(handle._pendingStrength);
    if (handle._pendingSize != null) fx.setSize(handle._pendingSize);
  }
}

export function tintMeshBlack(root, hex = CHAR_COLOR) {
  const col = new THREE.Color(hex);
  root.traverse((ch) => {
    if (!ch.isMesh || !ch.material) return;
    const list = Array.isArray(ch.material) ? ch.material : [ch.material];
    for (const m of list) {
      if (m.color) m.color.copy(col);
      if (m.emissive) {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
      if ("roughness" in m) m.roughness = 0.96;
      m.needsUpdate = true;
    }
  });
}

/** Žhavý nádech na materiálech, dokud objekt hoří. */
export function setBurnGlow(materials, strength = 1) {
  const list = Array.isArray(materials) ? materials : [materials];
  const s = Math.max(0, strength);
  for (const m of list) {
    if (!m?.emissive) continue;
    m.emissive.setHex(0xff3a0a);
    m.emissiveIntensity = 0.38 * s;
  }
}

