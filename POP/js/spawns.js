import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tangentFrame, capWithMargin, dirNearCaps } from "./utils.js";

export const SPAWN_ZONE_RADIUS = 2;
const RING_RADIUS = SPAWN_ZONE_RADIUS;
const STONE_COUNT = 12;
const SURFACE_LIFT = 0.02;
const POOL_RADIUS = 0.58;
/** Výchozí barvy prázdných slotů (bez hráče). */
const DEFAULT_SLOT_COLORS = [0x66ffc8, 0xa8f0ff, 0xffd080, 0xe8a0ff];

const RUNE_RIM_HEX = 0xffe29a;

/** @type {{ core: THREE.CanvasTexture, rim: THREE.CanvasTexture }[]} */
let _runeMaps = null;

function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function makeRuneCanvas(pattern, style) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.shadowColor = style.glow;
  ctx.shadowBlur = style.blur;
  ctx.beginPath();
  pattern(ctx);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function ensureRuneMaps() {
  if (_runeMaps) return _runeMaps;
  _runeMaps = [];
  const patterns = [
    (ctx) => {
      ctx.moveTo(32, 10);
      ctx.lineTo(32, 54);
      ctx.moveTo(32, 18);
      ctx.lineTo(48, 28);
      ctx.moveTo(32, 30);
      ctx.lineTo(48, 40);
    },
    (ctx) => {
      ctx.moveTo(22, 12);
      ctx.lineTo(22, 52);
      ctx.lineTo(46, 32);
      ctx.closePath();
    },
    (ctx) => {
      ctx.moveTo(24, 12);
      ctx.lineTo(24, 52);
      ctx.moveTo(24, 12);
      ctx.lineTo(44, 24);
      ctx.lineTo(24, 34);
      ctx.moveTo(24, 34);
      ctx.lineTo(46, 52);
    },
    (ctx) => {
      ctx.moveTo(40, 12);
      ctx.lineTo(24, 28);
      ctx.lineTo(40, 36);
      ctx.lineTo(24, 52);
    },
    (ctx) => {
      ctx.moveTo(32, 52);
      ctx.lineTo(32, 22);
      ctx.moveTo(32, 28);
      ctx.lineTo(18, 14);
      ctx.moveTo(32, 28);
      ctx.lineTo(46, 14);
    },
    (ctx) => {
      ctx.moveTo(18, 18);
      ctx.lineTo(46, 46);
      ctx.moveTo(46, 18);
      ctx.lineTo(18, 46);
    },
    (ctx) => {
      ctx.moveTo(22, 12);
      ctx.lineTo(22, 52);
      ctx.moveTo(42, 12);
      ctx.lineTo(42, 52);
      ctx.moveTo(22, 20);
      ctx.lineTo(42, 36);
    },
    (ctx) => {
      ctx.moveTo(32, 12);
      ctx.lineTo(48, 28);
      ctx.lineTo(32, 44);
      ctx.lineTo(16, 28);
      ctx.closePath();
      ctx.moveTo(32, 44);
      ctx.lineTo(32, 54);
    }
  ];

  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i];
    _runeMaps.push({
      rim: makeRuneCanvas(p, {
        color: "#ffe29a",
        glow: "rgba(255,210,120,0.95)",
        width: 6.5,
        blur: 8
      }),
      core: makeRuneCanvas(p, {
        color: "#ffffff",
        glow: "rgba(255,255,255,0.85)",
        width: 2.8,
        blur: 3
      })
    });
  }
  return _runeMaps;
}

/** Nepravidelný hranol s plochým vrškem (extrude 5–7úhelníku). */
function makeStoneGeometry(seed) {
  const n = 5 + (seed % 3);
  const shape = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (hash01(seed * 1.7 + i) - 0.5) * 0.35;
    const r = 0.2 + hash01(seed * 3.3 + i * 2.1) * 0.1;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  const h = 0.28 + hash01(seed * 9.1) * 0.1;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: h,
    bevelEnabled: true,
    bevelThickness: 0.028,
    bevelSize: 0.024,
    bevelSegments: 1,
    curveSegments: 1
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  geo.translate(
    -(bb.min.x + bb.max.x) * 0.5,
    -bb.min.y,
    -(bb.min.z + bb.max.z) * 0.5
  );

  // lehké „otlučení“ boků, vršek nechat rovný
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const topY = geo.boundingBox.max.y;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > topY - 0.012) continue;
    const j = 1 + (hash01(seed * 11 + i * 1.3) - 0.5) * 0.12;
    pos.setX(i, pos.getX(i) * j);
    pos.setZ(i, pos.getZ(i) * j);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  return { geo, topY: geo.boundingBox.max.y };
}

function makeRuneStone(glowColor, seed) {
  const g = new THREE.Group();
  const runes = ensureRuneMaps();
  const glyph = runes[seed % runes.length];
  const { geo, topY } = makeStoneGeometry(seed);

  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x6a655c,
    roughness: 0.94,
    metalness: 0.02,
    flatShading: true
  });
  rockMat.color.offsetHSL(
    (hash01(seed * 0.4) - 0.5) * 0.04,
    0,
    (hash01(seed) - 0.5) * 0.1
  );
  const rock = new THREE.Mesh(geo, rockMat);
  rock.castShadow = true;
  rock.receiveShadow = true;

  // ploška na vršku pod runou
  const padR = 0.13 + hash01(seed * 4.5) * 0.035;
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x3e3b36,
    roughness: 0.78,
    metalness: 0.05
  });
  const pad = new THREE.Mesh(new THREE.CircleGeometry(padR, 10), padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = topY + 0.004;
  pad.receiveShadow = true;

  const runeSize = padR * 1.55;
  const rimMat = new THREE.MeshBasicMaterial({
    map: glyph.rim,
    color: RUNE_RIM_HEX,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const runeMat = new THREE.MeshBasicMaterial({
    map: glyph.core,
    color: glowColor,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const rim = new THREE.Mesh(new THREE.PlaneGeometry(runeSize, runeSize), rimMat);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = topY + 0.008;
  rim.renderOrder = 2;
  const rune = new THREE.Mesh(new THREE.PlaneGeometry(runeSize * 0.92, runeSize * 0.92), runeMat);
  rune.rotation.x = -Math.PI / 2;
  rune.position.y = topY + 0.01;
  rune.renderOrder = 3;

  const poolMat = new THREE.MeshBasicMaterial({
    color: glowColor,
    transparent: true,
    opacity: 0.16,
    depthWrite: false
  });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(POOL_RADIUS, 12), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.01;
  pool.renderOrder = 1;

  g.add(rock, pad, rim, rune, pool);
  g.userData.runeMat = runeMat;
  g.userData.rimMat = rimMat;
  g.userData.poolMat = poolMat;
  g.userData.glowColor = glowColor;
  return g;
}

/** Kruh runových kamenů (r = 2 m) na spawn pointu — sleduje aktuální povrch. */
export class SpawnMarkers {
  constructor(planetGroup, terrain, spawnDirs) {
    this.planetGroup = planetGroup;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.planetGroup.add(this.group);
    /** @type {{ mesh: THREE.Group, ringDir: THREE.Vector3, angle: number, scale: number, slot: number }[]} */
    this.entries = [];
    /** @type {number[]} */
    this.slotColors = spawnDirs.map((_, i) => DEFAULT_SLOT_COLORS[i % DEFAULT_SLOT_COLORS.length]);
    this.t = 0;

    this._east = new THREE.Vector3();
    this._north = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._stoneDir = new THREE.Vector3();
    this._p0 = new THREE.Vector3();
    this._pE = new THREE.Vector3();
    this._pN = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._yUp = new THREE.Vector3(0, 1, 0);
    this.spawnCenters = spawnDirs.map((d) =>
      new THREE.Vector3(d[0], d[1], d[2]).normalize()
    );

    for (let s = 0; s < spawnDirs.length; s++) {
      this.#buildRing(spawnDirs[s], s, this.slotColors[s]);
    }
    this.refresh();
  }

  #buildRing(spawnArr, slot, glowColor) {
    this._dir.fromArray(spawnArr).normalize();
    for (let i = 0; i < STONE_COUNT; i++) {
      const angle = (i / STONE_COUNT) * Math.PI * 2;
      const seed = slot * 97 + i * 13 + 5;
      const mesh = makeRuneStone(glowColor, seed);
      mesh.scale.setScalar(1.15 + (i % 3) * 0.12);
      this.group.add(mesh);
      this.entries.push({
        mesh,
        ringDir: this._dir.clone(),
        angle,
        scale: mesh.scale.x,
        slot
      });
    }
  }

  /** Slot (index spawnu) nejbližší danému směru. */
  slotForDir(dir) {
    if (!this.spawnCenters.length) return 0;
    this._dir.copy(dir).normalize();
    let best = 0;
    let bestDot = -2;
    for (let i = 0; i < this.spawnCenters.length; i++) {
      const d = this._dir.dot(this.spawnCenters[i]);
      if (d > bestDot) {
        bestDot = d;
        best = i;
      }
    }
    return best;
  }

  /** Nastaví barvu run u jednoho spawn slotu. */
  setSlotColor(slot, hex) {
    const color = Number(hex);
    if (!Number.isFinite(color) || slot < 0 || slot >= this.slotColors.length) return;
    if (this.slotColors[slot] === color) return;
    this.slotColors[slot] = color;
    for (const entry of this.entries) {
      if (entry.slot !== slot) continue;
      const { runeMat, poolMat } = entry.mesh.userData;
      if (runeMat) runeMat.color.setHex(color);
      if (poolMat) poolMat.color.setHex(color);
      entry.mesh.userData.glowColor = color;
    }
  }

  /**
   * Barvy run = barvy hráčů na jejich spawnDir.
   * Volná místa nechá výchozí slot barvy.
   */
  syncFromWizards(wizards) {
    if (!wizards) return;
    const claimed = new Set();
    for (const w of wizards.values()) {
      if (!w?.spawnDir || w.color == null) continue;
      const slot = this.slotForDir(w.spawnDir);
      claimed.add(slot);
      this.setSlotColor(slot, w.color);
    }
    for (let i = 0; i < this.slotColors.length; i++) {
      if (claimed.has(i)) continue;
      this.setSlotColor(i, DEFAULT_SLOT_COLORS[i % DEFAULT_SLOT_COLORS.length]);
    }
  }

  /** Směr + normála povrchu v bodě (local dir). */
  #surfaceAt(dir, outPos, outNormal) {
    const h = this.terrain.height(dir);
    this._p0.copy(dir).multiplyScalar(h);

    tangentFrame(dir, this._east, this._north);
    const eps = 0.035;
    this._tmp.copy(dir).addScaledVector(this._east, eps).normalize();
    this._pE.copy(this._tmp).multiplyScalar(this.terrain.height(this._tmp));
    this._tmp2.copy(dir).addScaledVector(this._north, eps).normalize();
    this._pN.copy(this._tmp2).multiplyScalar(this.terrain.height(this._tmp2));

    outNormal.crossVectors(this._pE.sub(this._p0), this._pN.sub(this._p0));
    if (outNormal.lengthSq() < 1e-10) outNormal.copy(dir);
    else outNormal.normalize();
    if (outNormal.dot(dir) < 0) outNormal.negate();

    outPos.copy(this._p0);
  }

  #placeEntry(entry) {
    const { mesh, ringDir, angle, scale } = entry;
    tangentFrame(ringDir, this._east, this._north);
    const ox = Math.cos(angle) * RING_RADIUS;
    const oy = Math.sin(angle) * RING_RADIUS;
    const hCenter = this.terrain.height(ringDir);
    this._stoneDir
      .copy(ringDir)
      .multiplyScalar(hCenter)
      .addScaledVector(this._east, ox)
      .addScaledVector(this._north, oy)
      .normalize();

    this.#surfaceAt(this._stoneDir, this._p0, this._n);
    mesh.quaternion.setFromUnitVectors(this._yUp, this._n);
    mesh.position.copy(this._p0).addScaledVector(this._n, SURFACE_LIFT);
    mesh.scale.setScalar(scale);
  }

  /** Je kouzelník uvnitř některého spawn kruhu? */
  isInSpawnZone(wizardDir) {
    this._dir.copy(wizardDir).normalize();
    for (const center of this.spawnCenters) {
      const dot = Math.min(1, Math.max(-1, this._dir.dot(center)));
      if (Math.acos(dot) * CONFIG.planetR <= SPAWN_ZONE_RADIUS) return true;
    }
    return false;
  }

  /** Přepočítá pozice kamenů podle aktuálního terénu (po morphu / resetu). */
  refresh() {
    for (const entry of this.entries) this.#placeEntry(entry);
  }

  /**
   * Přepočítá jen kameny v okolí aktivních morphů terénu — margin navíc
   * pokrývá poloměr kruhu (RING_RADIUS), aby se nezaseklo dosednutí
   * u okraje. Bez morphů = plný refresh.
   */
  refreshNear(morphs, margin = RING_RADIUS + 2.2) {
    if (!morphs?.length) {
      this.refresh();
      return;
    }
    const caps = morphs.map((m) => capWithMargin(m.cap, margin));
    for (const entry of this.entries) {
      if (!dirNearCaps(entry.ringDir, caps)) continue;
      this.#placeEntry(entry);
    }
  }

  /** Jen pulz jasu run — pozice se mění jen přes refresh(). */
  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;

    const wave = 0.5 + 0.5 * Math.sin(this.t * 2.4);
    for (let i = 0; i < this.entries.length; i++) {
      const { runeMat, rimMat, poolMat } = this.entries[i].mesh.userData;
      const phase = Math.sin(this.t * 2.4 + i * 0.55);
      const flicker = 0.5 + 0.5 * phase;
      const mix = wave * 0.65 + flicker * 0.35;

      if (rimMat) rimMat.opacity = 0.5 + mix * 0.5;
      if (runeMat) runeMat.opacity = 0.7 + mix * 0.3;
      if (poolMat) poolMat.opacity = 0.08 + mix * 0.14;
    }
  }

  hide() {
    this.group.visible = false;
  }

  show() {
    this.group.visible = true;
  }
}
