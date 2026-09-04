/**
 * Host-autorita pro světové entity (zvířata, vodní život).
 * Host simuluje AI; klienti interpolují snímky a jen kreslí.
 */
import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { slerpDirection } from "../utils.js";

const FLAGS = {
  DEAD: 1,
  BURNING: 2,
  GONE: 4,
  TORNADO: 8,
  MOVING: 16,
  ARRIVED_TREE: 32,
  CHARRED: 64
};

const LAND_STATES = [
  "wander",
  "graze",
  "look",
  "flee",
  "swim",
  "treeTrance",
  "charm",
  "dead",
  "dodgeCrouch",
  "dodge",
  "browse",
  "tunnel",
  "peek"
];

const PEEK_STAGES = [null, "rise", "hold", "dive"];
const TORNADO_PHASES = ["climb", "air", "lie", "rise"];
const WATER_MODES = ["cruise", "rise", "look", "dive"];

const STATE_ID = Object.create(null);
for (let i = 0; i < LAND_STATES.length; i++) STATE_ID[LAND_STATES[i]] = i;

const _dirA = new THREE.Vector3();
const _dirB = new THREE.Vector3();
const _faceA = new THREE.Vector3();
const _faceB = new THREE.Vector3();

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function packDir(v) {
  return [round4(v.x), round4(v.y), round4(v.z)];
}

function vecFromArr(out, arr) {
  if (!arr) return false;
  out.set(arr[0], arr[1], arr[2]).normalize();
  return true;
}

function landMoving(c) {
  if (c.dead || c.gone || c.vanished) return false;
  if (c.tornado) return true;
  if (c.netMoving) return true;
  const s = c.state;
  if (s === "wander" || s === "flee" || s === "swim" || s === "dodge" || s === "dodgeCrouch" || s === "tunnel") return true;
  if (s === "treeTrance") return !c.arrivedTree;
  return false;
}

function landFlags(c) {
  let k = 0;
  if (c.dead) k |= FLAGS.DEAD;
  if (c.burning) k |= FLAGS.BURNING;
  if (c.charred) k |= FLAGS.CHARRED;
  if (c.gone || c.vanished) k |= FLAGS.GONE;
  if (c.tornado) k |= FLAGS.TORNADO;
  if (landMoving(c)) k |= FLAGS.MOVING;
  if (c.arrivedTree) k |= FLAGS.ARRIVED_TREE;
  return k;
}

function packLand(c) {
  const row = {
    i: c.id,
    d: packDir(c.dir),
    f: packDir(c.facing),
    s: STATE_ID[c.state] ?? 0,
    k: landFlags(c),
    h: Math.round(c.hp ?? 0)
  };
  if (c.path) {
    const ps = PEEK_STAGES.indexOf(c.peekStage);
    row.ps = ps < 0 ? 0 : ps;
    row.pt = round4(c.peekT || 0);
  }
  if (c.tornado) {
    const td = c.tornado;
    const tp = TORNADO_PHASES.indexOf(td.phase);
    row.tp = tp < 0 ? 0 : tp;
    row.tr = round4(c.mesh?.position.length() || 0);
    row.ts = round4(td.spinY || 0);
    row.tz = round4(td.sideZ || 0);
    row.tb = round4(td.bodyRoll || 0);
    row.ta = round4(td.preAmp || 0);
  }
  return row;
}

function packWater(c, i) {
  return {
    i,
    d: packDir(c.dir),
    f: packDir(c.facing),
    u: round4(c.submerge || 0),
    m: Math.max(0, WATER_MODES.indexOf(c.mode)),
    e: round4(c.hue || 0)
  };
}

function packList(list, packFn) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!c) continue;
    out.push(packFn(c, i));
  }
  return out;
}

/** Odchozí snímek světa (jen host). */
export function buildWorldPacket(game) {
  return {
    kind: "world",
    c: packList(game.critters?.list || [], packLand),
    l: packList(game.longnecks?.list || [], packLand),
    w: packList(game.worms?.list || [], packLand),
    a: packList(game.waterLife?.list || [], packWater)
  };
}

export function markHerdRemote(herd, remote) {
  if (!herd) return;
  herd.remote = !!remote;
  const list = herd.list;
  if (!list) return;
  for (let i = 0; i < list.length; i++) {
    if (list[i]) list[i].remote = !!remote;
  }
}

export function pushEntitySnap(entity, snap) {
  const t = performance.now() * 0.001;
  snap.time = t;
  let buf = entity._netBuf;
  if (!buf) {
    buf = [];
    entity._netBuf = buf;
  }
  const last = buf[buf.length - 1];
  if (last && t - last.time < 0.001) {
    Object.assign(last, snap);
    last.time = t;
    return;
  }
  buf.push(snap);
  while (buf.length > 24) buf.shift();
}

function sampleSnaps(entity) {
  const buf = entity._netBuf;
  if (!buf?.length) return null;
  const renderT = performance.now() * 0.001 - CONFIG.netPoseInterpDelay;
  while (buf.length > 2 && buf[1].time <= renderT) buf.shift();
  if (buf.length === 1) return { a: buf[0], b: buf[0], alpha: 1, latest: buf[0] };
  const a = buf[0];
  const b = buf[1];
  const span = b.time - a.time;
  const alpha =
    span > 1e-6
      ? THREE.MathUtils.clamp((renderT - a.time) / span, 0, 1)
      : renderT >= b.time
        ? 1
        : 0;
  return { a, b, alpha, latest: buf[buf.length - 1] };
}

function applyFlags(entity, k) {
  const gone = !!(k & FLAGS.GONE);
  const dead = !!(k & FLAGS.DEAD) || gone;
  if (gone && !entity.gone && !entity.vanished) {
    entity.die?.({ fromNet: true, vanish: true, force: true });
    entity.gone = true;
    entity.vanished = true;
    if (entity.mesh) entity.mesh.visible = false;
  } else if (dead && !entity.dead) {
    entity.die?.({ fromNet: true, ignite: !!(k & FLAGS.BURNING), force: true });
  }
  if (typeof entity.syncBurn === "function") {
    entity.syncBurn(!!(k & FLAGS.BURNING), !!(k & FLAGS.CHARRED));
  } else if ((k & FLAGS.BURNING) && entity.ignite && !entity.burning && !entity.charred) {
    entity.ignite();
  }
  entity.arrivedTree = !!(k & FLAGS.ARRIVED_TREE);
  entity.netMoving = !!(k & FLAGS.MOVING);
  entity.netTornado = !!(k & FLAGS.TORNADO);
}

function lerpScalar(a, b, t) {
  return a + (b - a) * t;
}

/** Interpoluje síťové snímky do dir/facing/state. @returns {boolean} */
export function applyEntityNet(entity) {
  const sample = sampleSnaps(entity);
  if (!sample) return false;
  const { a, b, alpha, latest } = sample;
  if (vecFromArr(_dirA, a.d) && vecFromArr(_dirB, b.d)) {
    slerpDirection(entity.dir, _dirA, _dirB, alpha);
  } else if (vecFromArr(_dirB, b.d)) {
    entity.dir.copy(_dirB);
  } else if (vecFromArr(_dirA, a.d)) {
    entity.dir.copy(_dirA);
  }
  if (vecFromArr(_faceA, a.f) && vecFromArr(_faceB, b.f)) {
    slerpDirection(entity.facing, _faceA, _faceB, alpha);
  } else if (vecFromArr(_faceB, b.f)) {
    entity.facing.copy(_faceB);
  } else if (vecFromArr(_faceA, a.f)) {
    entity.facing.copy(_faceA);
  }
  if (latest.s != null) entity.state = LAND_STATES[latest.s] ?? entity.state;
  if (latest.h != null && entity.hp != null) entity.hp = latest.h;
  if (latest.k != null) applyFlags(entity, latest.k);
  if (latest.ps != null) entity.peekStage = PEEK_STAGES[latest.ps] ?? null;
  if (a.pt != null && b.pt != null) entity.peekT = lerpScalar(a.pt, b.pt, alpha);
  else if (latest.pt != null) entity.peekT = latest.pt;
  if (a.u != null && b.u != null) entity.submerge = lerpScalar(a.u, b.u, alpha);
  else if (latest.u != null) entity.submerge = latest.u;
  if (latest.m != null) entity.mode = WATER_MODES[latest.m] ?? entity.mode;
  if (latest.e != null) entity.hue = latest.e;
  applyTornadoNet(entity, a, b, alpha, latest);
  return true;
}

function applyTornadoNet(entity, a, b, alpha, latest) {
  const flagged = !!(latest.k & FLAGS.TORNADO);
  if (!flagged) {
    if (entity.remote && entity.tornado) entity.endTornadoCapture?.();
    entity.netRadius = 0;
    return;
  }
  const phase = TORNADO_PHASES[latest.tp] ?? entity.tornado?.phase ?? "climb";
  const spinY = a.ts != null && b.ts != null ? lerpScalar(a.ts, b.ts, alpha) : latest.ts ?? 0;
  const sideZ = a.tz != null && b.tz != null ? lerpScalar(a.tz, b.tz, alpha) : latest.tz ?? 0;
  const bodyRoll = a.tb != null && b.tb != null ? lerpScalar(a.tb, b.tb, alpha) : latest.tb ?? 0;
  const preAmp = a.ta != null && b.ta != null ? lerpScalar(a.ta, b.ta, alpha) : latest.ta ?? 0;
  const radius = a.tr != null && b.tr != null ? lerpScalar(a.tr, b.tr, alpha) : latest.tr ?? 0;
  if (!entity.tornado) {
    entity.tornado = {
      phase,
      t: 0,
      source: null,
      centerDir: entity.dir.clone(),
      spinY,
      sideZ,
      preAmp,
      orbitAng: 0,
      height: 0,
      wallU: 0,
      bodyRoll
    };
  } else {
    entity.tornado.phase = phase;
    entity.tornado.spinY = spinY;
    entity.tornado.sideZ = sideZ;
    entity.tornado.preAmp = preAmp;
    entity.tornado.bodyRoll = bodyRoll;
  }
  entity.netRadius = radius;
}

function applyHerdSnaps(list, rows) {
  if (!list?.length || !rows?.length) return;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const c = list[row.i] ?? list[i];
    if (!c) continue;
    pushEntitySnap(c, row);
  }
}

/** Příchozí hostovský snímek. */
export function applyWorldPacket(game, intent) {
  if (!intent) return;
  applyHerdSnaps(game.critters?.list, intent.c);
  applyHerdSnaps(game.longnecks?.list, intent.l);
  applyHerdSnaps(game.worms?.list, intent.w);
  applyHerdSnaps(game.waterLife?.list, intent.a);
}
