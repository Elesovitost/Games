import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { tangentFrame } from "../utils.js";
import { SPELLS } from "./defs.js";
import { disposeProjectile, spawnBurst, surfaceDist } from "./fx-common.js";

function shatterIceball(sys, pos, dir) {
  spawnBurst(sys, pos, dir, 0xffffff, 0.55);
  spawnBurst(sys, pos, dir, 0xb8dcff, 0.4);
  spawnBurst(sys, pos, dir, 0xe8f4ff, 0.3);
}

/** Ledová koule Ø 3 m — kutálí se 50 m po povrchu směrem ke kliknutí. */
export function launchIceball(sys, targetDir) {
  const target = targetDir.clone().normalize();
  const startDir = sys.wizard.dir.clone().normalize();
  const radius = SPELLS.iceball.diameter * 0.5;

  sys._tmp.copy(target).addScaledVector(startDir, -startDir.dot(target));
  if (sys._tmp.lengthSq() < 1e-8) {
    tangentFrame(startDir, sys._tmp, sys._tmp2);
  } else {
    sys._tmp.normalize();
  }

  const mat = new THREE.MeshStandardMaterial({
    color: 0xf2f8ff,
    emissive: 0xa8d4ff,
    emissiveIntensity: 0.25,
    roughness: 0.25,
    metalness: 0.05,
    transparent: true,
    opacity: 0.92
  });
  const core = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 16), mat);
  core.castShadow = true;
  const ball = new THREE.Group();
  ball.add(core);
  const h0 = sys.terrain.height(startDir);
  ball.position.copy(startDir).multiplyScalar(h0 + radius);
  ball.frustumCulled = false;
  sys.planetGroup.add(ball);

  sys.projectiles.push({
    kind: "iceball",
    ball,
    mat,
    glowMat: null,
    dir: startDir.clone(),
    moveDir: sys._tmp.clone(),
    radius,
    traveled: 0,
    maxTravel: SPELLS.iceball.travel,
    life: 12,
    roll: 0,
    hitWizard: false,
    ownerId: sys.wizard?.id ?? null
  });
}

/** @returns {boolean} true pokud projektil zůstal */
export function updateIceball(sys, p, dt) {
  const step = SPELLS.iceball.speed * dt;
  p.moveDir.addScaledVector(p.dir, -p.moveDir.dot(p.dir));
  if (p.moveDir.lengthSq() < 1e-10) {
    shatterIceball(sys, p.ball.position.clone(), p.dir.clone());
    disposeProjectile(sys, p);
    return false;
  }
  p.moveDir.normalize();
  p.dir.addScaledVector(p.moveDir, step / Math.max(CONFIG.planetR, 1)).normalize();
  p.moveDir.addScaledVector(p.dir, -p.moveDir.dot(p.dir)).normalize();

  const h = sys.terrain.height(p.dir);
  p.ball.position.copy(p.dir).multiplyScalar(h + p.radius);
  p.traveled += step;

  if (!p.hitWizard && p.traveled > 2.5) {
    const touchR = p.radius + 0.45;
    const list = sys.getWizards?.() || (sys.wizard ? [sys.wizard] : []);
    for (const w of list) {
      if (!w || w.dead) continue;
      if (p.ownerId && w.id === p.ownerId) continue;
      if (surfaceDist(p.dir, w.dir) <= touchR) {
        p.hitWizard = true;
        w.takeDamage(SPELLS.iceball.contactDamage);
        break;
      }
    }
  }

  sys._axis.crossVectors(p.dir, p.moveDir);
  if (sys._axis.lengthSq() > 1e-8) {
    sys._axis.normalize();
    const angle = step / p.radius;
    p.ball.rotateOnWorldAxis(sys._axis, angle);
  }

  if (p.traveled >= p.maxTravel || p.life <= 0) {
    shatterIceball(sys, p.ball.position.clone(), p.dir.clone());
    disposeProjectile(sys, p);
    return false;
  }
  return true;
}
