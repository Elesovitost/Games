/**
 * Síťový stav kouzelníka — jedno místo pro serializaci / aplikaci.
 * Nový efekt: přidej handler do FX_HANDLERS (serialize + apply).
 *
 * Knock: intent = nízká latence, pose.knock = záloha; seq zabraňuje dvojitému startu.
 * Tornado na remote: jen FX z pose (lokální sim na remote neběží).
 */
import * as THREE from "../three.js";
import { slerpDirection } from "../utils.js";

const _dirA = new THREE.Vector3();
const _dirB = new THREE.Vector3();
const _faceA = new THREE.Vector3();
const _faceB = new THREE.Vector3();

function vecFromArr(out, arr) {
  if (!arr) return false;
  out.set(arr[0], arr[1], arr[2]).normalize();
  return true;
}

const FX_HANDLERS = {
  immortality: {
    serialize(w) {
      const inv = w.immortal;
      if (!inv) return null;
      return {
        type: "immortality",
        t: inv.t,
        hold: inv.hold,
        spinZ: inv.spinZ,
        rolling: !!inv.rolling
      };
    },
    lerp(a, b, alpha) {
      return {
        type: "immortality",
        t: a.t + (b.t - a.t) * alpha,
        hold: b.hold,
        spinZ: a.spinZ + (b.spinZ - a.spinZ) * alpha,
        rolling: alpha >= 0.5 ? b.rolling : a.rolling
      };
    },
    apply(w, fx) {
      if (!w.immortal) {
        w.beginImmortality({
          hold: fx.hold,
          t: fx.t,
          spinZ: fx.spinZ,
          rolling: fx.rolling
        });
      } else {
        w.immortal.t = fx.t;
        w.immortal.hold = fx.hold;
        w.immortal.spinZ = fx.spinZ;
        w.immortal.rolling = !!fx.rolling;
      }
    },
    clear(w) {
      if (w.immortal) w.endImmortality();
    }
  },
  tornado: {
    serialize(w) {
      const td = w.tornado;
      if (!td) return null;
      return {
        type: "tornado",
        phase: td.phase,
        spinY: td.spinY,
        sideZ: td.sideZ ?? 0,
        bodyRoll: td.bodyRoll || 0,
        preAmp: td.preAmp || 0
      };
    },
    lerp(a, b, alpha) {
      return {
        type: "tornado",
        phase: alpha >= 0.5 ? b.phase : a.phase,
        spinY: a.spinY + (b.spinY - a.spinY) * alpha,
        sideZ: a.sideZ + (b.sideZ - a.sideZ) * alpha,
        bodyRoll: a.bodyRoll + (b.bodyRoll - a.bodyRoll) * alpha,
        preAmp: a.preAmp + (b.preAmp - a.preAmp) * alpha
      };
    },
    apply(w, fx, _alpha) {
      if (!w.tornado) {
        w.tornado = {
          phase: fx.phase,
          t: 0,
          centerDir: w.dir.clone(),
          spinY: fx.spinY,
          sideZ: fx.sideZ,
          preAmp: fx.preAmp,
          bodyRoll: fx.bodyRoll,
          orbitAng: 0,
          height: 0,
          wallU: 0
        };
      } else {
        w.tornado.phase = fx.phase;
        w.tornado.spinY = fx.spinY;
        w.tornado.sideZ = fx.sideZ;
        w.tornado.preAmp = fx.preAmp;
        w.tornado.bodyRoll = fx.bodyRoll;
      }
    },
    clear(w) {
      if (w.tornado) w.endTornadoCapture();
    }
  }
};

function serializeFx(w) {
  for (const h of Object.values(FX_HANDLERS)) {
    const fx = h.serialize(w);
    if (fx) return fx;
  }
  return null;
}

function lerpFx(a, b, alpha) {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  if (a.type !== b.type) return alpha >= 0.5 ? b : a;

  const handler = FX_HANDLERS[a.type];
  if (!handler?.lerp) return alpha >= 0.5 ? b : a;
  return handler.lerp(a, b, alpha);
}

/** Odchozí pose snímek (lokální hráč → síť). */
export function buildPosePacket(w) {
  if (!w) return null;
  const p = w.mesh.position;
  return {
    kind: "pose",
    pos: [p.x, p.y, p.z],
    dir: [w.dir.x, w.dir.y, w.dir.z],
    facing: [w.facing.x, w.facing.y, w.facing.z],
    moving: !!w.moving,
    hp: w.hp,
    knock: w.knockdown
      ? {
          seq: w.knockdown.seq,
          amt: w.knockdown.amount,
          from: [w.knockdown.fromDir.x, w.knockdown.fromDir.y, w.knockdown.fromDir.z],
          rotations: w.knockdown.rotations ?? null,
          rollDistance: w.knockdown.rollDist ?? null,
          away: !!w.knockdown.away
        }
      : null,
    fx: serializeFx(w)
  };
}

function lerpPos(out, a, b, alpha) {
  if (!a?.pos || !b?.pos) {
    const src = b?.pos || a?.pos;
    if (src) out.set(src[0], src[1], src[2]);
    return !!src;
  }
  out.set(
    a.pos[0] + (b.pos[0] - a.pos[0]) * alpha,
    a.pos[1] + (b.pos[1] - a.pos[1]) * alpha,
    a.pos[2] + (b.pos[2] - a.pos[2]) * alpha
  );
  return true;
}

/**
 * Interpoluje dva buffer snímky a aplikuje na vzdáleného kouzelníka.
 * @returns {boolean} true pokud byla nastavena světová pozice ze sítě
 */
export function applyInterpolatedPose(w, a, b, alpha, outPos) {
  const hasDirA = vecFromArr(_dirA, a?.dir);
  const hasDirB = vecFromArr(_dirB, b?.dir);
  if (hasDirA && hasDirB) {
    slerpDirection(w.dir, _dirA, _dirB, alpha);
  } else if (hasDirB) {
    w.dir.copy(_dirB);
  } else if (hasDirA) {
    w.dir.copy(_dirA);
  }

  const hasFaceA = vecFromArr(_faceA, a?.facing);
  const hasFaceB = vecFromArr(_faceB, b?.facing);
  if (hasFaceA && hasFaceB) {
    slerpDirection(w.facing, _faceA, _faceB, alpha);
  } else if (hasFaceB) {
    w.facing.copy(_faceB);
  } else if (hasFaceA) {
    w.facing.copy(_faceA);
  } else if (hasDirB) {
    w.facing.copy(w.dir);
  }

  w.moving = alpha >= 0.5 ? !!b?.moving : !!a?.moving;
  w.wantsWalk = w.moving;

  const hasPos = lerpPos(outPos, a, b, alpha);
  if (hasPos) w.mesh.position.copy(outPos);

  const fx = lerpFx(a?.fx, b?.fx, alpha);
  if (fx) {
    const handler = FX_HANDLERS[fx.type];
    handler?.apply(w, fx, alpha);
  } else {
    for (const h of Object.values(FX_HANDLERS)) h.clear(w);
  }

  return hasPos;
}

/** Nový síťový snímek do bufferu (applyNetPose). */
export function poseSnapshotFromIntent(flags, dirArr, facingArr) {
  return {
    pos: flags.pos ? flags.pos.slice() : null,
    dir: dirArr.slice(),
    facing: facingArr ? facingArr.slice() : dirArr.slice(),
    moving: !!flags.moving,
    hp: flags.hp,
    knock: flags.knock || null,
    fx: flags.fx || null,
    time: performance.now() * 0.001
  };
}

export function applyKnockFromSnapshot(w, knock, hp) {
  if (!knock || knock.seq <= w._lastKnockSeqApplied) return;
  if (w.knockdown?.seq === knock.seq) return;
  w.applyKnockdown(knock.amt, knock.from, {
    seq: knock.seq,
    hp,
    rotations: knock.rotations ?? undefined,
    rollDistance: knock.rollDistance ?? undefined,
    awayFrom: knock.away ? knock.from : undefined
  });
}
