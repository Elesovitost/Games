import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { tangentFrame, tmp } from "../utils.js";
import { SPELLS } from "./defs.js";
import { disposeProjectile, spawnBurst, surfaceDist } from "./fx-common.js";
import { isWaterAt, spawnWaterSplash } from "./water-fx.js";

const _yUp = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _wetCol = new THREE.Color(0x7aabcc);

function spawnIceShards(sys, pos, normalDir, count = 78) {
  tangentFrame(normalDir, tmp.east, tmp.north);
  if (!sys.iceDebris) sys.iceDebris = [];

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.9;
    const spread = 2.8 + Math.random() * 6.2;
    const vel = tmp.east
      .clone()
      .multiplyScalar(Math.cos(a) * spread)
      .addScaledVector(tmp.north, Math.sin(a) * spread);
    vel.addScaledVector(normalDir, 2.0 + Math.random() * 4.8);

    const w = 0.07 + Math.random() * 0.16;
    const h = 0.06 + Math.random() * 0.14;
    const d = 0.065 + Math.random() * 0.15;
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.55 + Math.random() * 0.06, 0.25, 0.88 + Math.random() * 0.08),
      emissive: 0xc8e8ff,
      emissiveIntensity: 0.18 + Math.random() * 0.12,
      roughness: 0.18 + Math.random() * 0.2,
      metalness: 0.02,
      transparent: true,
      opacity: 0.92
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    mesh.position.copy(pos).addScaledVector(normalDir, 0.04 + Math.random() * 0.12);
    mesh.castShadow = true;
    sys.planetGroup.add(mesh);

    sys.iceDebris.push({
      mesh,
      mat,
      vel,
      dir: normalDir.clone(),
      radius: Math.max(w, h, d) * 0.5,
      state: "air",
      t: 0,
      groundT: 0,
      meltT: 0,
      restTime: 0.35 + Math.random() * 1.1,
      meltLife: 0.7 + Math.random() * 1.0,
      rotVel: new THREE.Vector3(
        (Math.random() - 0.5) * 16,
        (Math.random() - 0.5) * 16,
        (Math.random() - 0.5) * 16
      ),
      baseScale: mesh.scale.clone()
    });
  }
}

function shatterIceball(sys, pos, dir, projectile = null) {
  if (projectile?.sfxRoll) {
    sys.audio?.stopIceRoll(projectile.sfxRoll, 0.04);
    projectile.sfxRoll = null;
  }
  const listener = sys.getListenerDir?.();
  if (listener) sys.audio?.playAt("icebreak", dir, listener);

  spawnBurst(sys, pos, dir, 0xffffff, 0.42);
  spawnBurst(sys, pos, dir, 0xb8dcff, 0.28);
  spawnIceShards(sys, pos, dir);
}

/** @returns {boolean} true pokud projektil zůstal */
export function updateIceball(sys, p, dt) {
  const step = SPELLS.iceball.speed * dt;
  p.moveDir.addScaledVector(p.dir, -p.moveDir.dot(p.dir));
  if (p.moveDir.lengthSq() < 1e-10) {
    shatterIceball(sys, p.ball.position.clone(), p.dir.clone(), p);
    disposeProjectile(sys, p);
    return false;
  }
  p.moveDir.normalize();
  p.dir.addScaledVector(p.moveDir, step / Math.max(CONFIG.planetR, 1)).normalize();
  p.moveDir.addScaledVector(p.dir, -p.moveDir.dot(p.dir)).normalize();

  const h = sys.terrain.height(p.dir);
  p.ball.position.copy(p.dir).multiplyScalar(h + p.radius);
  p.traveled += step;

  if (isWaterAt(sys, p.dir)) {
    const splashPos = p.dir.clone().multiplyScalar(CONFIG.waterLevel + p.radius * 0.12);
    spawnWaterSplash(sys, p.dir, p.radius);
    shatterIceball(sys, splashPos, p.dir.clone(), p);
    disposeProjectile(sys, p);
    return false;
  }

  sys.terrain.paintIceTrail(p.dir, p.radius * 1.15);

  if (p.sfxRoll) {
    const listener = sys.getListenerDir?.();
    if (listener) {
      sys.audio?.updateIceRoll(
        p.sfxRoll,
        p.dir,
        listener,
        dt,
        SPELLS.iceball.speed
      );
    }
  }

  if (p.traveled > 2.5) {
    const touchR = p.radius + 0.45;
    const list = sys.getWizards?.() || (sys.wizard ? [sys.wizard] : []);
    for (const w of list) {
      if (!w || w.dead) continue;
      if (surfaceDist(p.dir, w.dir) <= touchR) {
        if (!w.remote) {
          w.takeDamage(SPELLS.iceball.contactDamage, { fromDir: p.dir.clone() });
        }
        shatterIceball(sys, p.ball.position.clone(), p.dir.clone(), p);
        disposeProjectile(sys, p);
        return false;
      }
    }
    if (sys.critters?.hurtNear(p.dir, touchR) || sys.longnecks?.dodgeNear(p.dir, touchR)) {
      shatterIceball(sys, p.ball.position.clone(), p.dir.clone(), p);
      disposeProjectile(sys, p);
      return false;
    }
  }

  sys._axis.crossVectors(p.dir, p.moveDir);
  if (sys._axis.lengthSq() > 1e-8) {
    sys._axis.normalize();
    const angle = step / p.radius;
    p.ball.rotateOnWorldAxis(sys._axis, angle);
  }

  if (p.traveled >= p.maxTravel || p.life <= 0) {
    shatterIceball(sys, p.ball.position.clone(), p.dir.clone(), p);
    disposeProjectile(sys, p);
    return false;
  }
  return true;
}

export function updateIceDebris(sys, dt) {
  if (!sys.iceDebris?.length) return;

  for (let i = sys.iceDebris.length - 1; i >= 0; i--) {
    const s = sys.iceDebris[i];
    s.t += dt;

    if (s.state === "air") {
      const pos = s.mesh.position;
      tmp.dir.copy(pos);
      const rLen = tmp.dir.length();
      if (rLen > 1e-6) tmp.dir.multiplyScalar(1 / rLen);
      else tmp.dir.copy(s.dir);

      s.vel.addScaledVector(tmp.dir, -11.5 * dt);
      s.vel.multiplyScalar(0.985);
      pos.addScaledVector(s.vel, dt);

      s.mesh.rotation.x += s.rotVel.x * dt;
      s.mesh.rotation.y += s.rotVel.y * dt;
      s.mesh.rotation.z += s.rotVel.z * dt;

      tmp.dir.copy(pos);
      const len = tmp.dir.length();
      if (len < 1e-6) continue;
      tmp.dir.multiplyScalar(1 / len);
      s.dir.copy(tmp.dir);

      const groundR = sys.terrain.height(s.dir) + s.radius * 0.35;
      if (len <= groundR) {
        s.mesh.position.copy(s.dir).multiplyScalar(groundR);
        _quat.setFromUnitVectors(_yUp, s.dir);
        s.mesh.quaternion.copy(_quat);
        s.mesh.rotation.x += s.rotVel.x * 0.15;
        s.mesh.rotation.z += s.rotVel.z * 0.15;
        s.state = "ground";
        s.groundT = 0;
        s.vel.set(0, 0, 0);
        s.mat.emissiveIntensity = 0.08;
      }
    } else if (s.state === "ground") {
      s.groundT += dt;
      const h = sys.terrain.height(s.dir) + s.radius * 0.35;
      s.mesh.position.copy(s.dir).multiplyScalar(h);
      _quat.setFromUnitVectors(_yUp, s.dir);
      s.mesh.quaternion.copy(_quat);

      if (s.groundT >= s.restTime) {
        s.state = "melt";
        s.meltT = 0;
        s.meltFrom = s.mat.color.clone();
      }
    } else if (s.state === "melt") {
      s.meltT += dt;
      const u = s.meltT / s.meltLife;
      const h = sys.terrain.height(s.dir) + s.radius * 0.2 * (1 - u);
      s.mesh.position.copy(s.dir).multiplyScalar(h);

      const flat = 1 - u * 0.75;
      s.mesh.scale.set(
        s.baseScale.x * (1 + u * 0.35),
        s.baseScale.y * flat,
        s.baseScale.z * (1 + u * 0.35)
      );

      s.mat.opacity = 0.88 * (1 - u * u);
      s.mat.emissiveIntensity = 0.06 * (1 - u);
      if (s.meltFrom) s.mat.color.copy(s.meltFrom).lerp(_wetCol, u);

      if (u >= 1) {
        sys.planetGroup.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mat.dispose();
        sys.iceDebris.splice(i, 1);
      }
    }
  }
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

  const listener = sys.getListenerDir?.();
  const sfxRoll =
    listener && sys.audio
      ? sys.audio.startIceRoll(startDir, listener, { speed: SPELLS.iceball.speed, radius })
      : null;

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
    sfxRoll
  });
}
