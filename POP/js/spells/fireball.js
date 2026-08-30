import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { SPELLS } from "./defs.js";
import { applyAoeDamage, disposeProjectile, spawnBurst } from "./fx-common.js";

function explodeFireball(sys, pos, dir) {
  sys.terrain.scorch(dir, SPELLS.fireball.burnRadius);
  spawnBurst(sys, pos, dir, 0xff9020, 0.5);
  spawnBurst(sys, pos, dir, 0xffe080, 0.35);
  applyAoeDamage(
    sys,
    dir,
    SPELLS.fireball.damageRadius,
    SPELLS.fireball.damageCenter,
    SPELLS.fireball.damageEdge,
    sys._castOwnerId
  );
}

/** Ohnivá koule: přímka ze středu kouzelníka na bod na povrchu. */
export function launchFireball(sys, targetDir) {
  const target = targetDir.clone().normalize();
  const th = sys.terrain.height(target);
  const aim = target.clone().multiplyScalar(th);

  const centerH = CONFIG.wizardHeightM * 0.5;
  const from = sys.wizard.mesh.position.clone().addScaledVector(sys.wizard.dir, centerH);

  sys._vel.copy(aim).sub(from);
  const dist = sys._vel.length();
  if (dist < 0.15) {
    explodeFireball(sys, aim, target);
    return;
  }
  sys._vel.multiplyScalar(SPELLS.fireball.speed / dist);

  const r = SPELLS.fireball.radius;
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff7a20,
    transparent: true,
    opacity: 0.95,
    depthWrite: false
  });
  const core = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), mat);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffcc55,
    transparent: true,
    opacity: 0.35,
    depthWrite: false
  });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(r * 1.7, 10, 8), glowMat);
  const ball = new THREE.Group();
  ball.add(glow, core);
  ball.position.copy(from);
  ball.frustumCulled = false;
  sys.planetGroup.add(ball);

  sys.projectiles.push({
    kind: "fireball",
    ball,
    mat,
    glowMat,
    vel: sys._vel.clone(),
    target,
    aim,
    radius: r,
    traveled: 0,
    maxDist: dist + 2,
    life: 4
  });
}

/** @returns {boolean} true pokud projektil zůstal */
export function updateFireball(sys, p, dt) {
  const step = SPELLS.fireball.speed * dt;
  p.ball.position.addScaledVector(p.vel, dt);
  p.traveled += step;

  const pos = p.ball.position;
  const len = pos.length();
  let hit = p.life <= 0 || p.traveled >= p.maxDist;
  if (len > 1e-5) {
    sys._tmp.copy(pos).multiplyScalar(1 / len);
    const surface = sys.terrain.height(sys._tmp);
    if (len - p.radius <= surface + 0.05) hit = true;
    if (pos.distanceToSquared(p.aim) < (p.radius + 0.4) ** 2) hit = true;
  }
  if (hit) {
    const dir = len > 1e-5 ? sys._tmp.clone() : p.target.clone();
    explodeFireball(sys, pos.clone(), dir);
    disposeProjectile(sys, p);
    return false;
  }
  const s = 0.95 + 0.12 * Math.sin(performance.now() * 0.025);
  p.ball.scale.setScalar(s);
  return true;
}
