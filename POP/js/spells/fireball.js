import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { SPELLS } from "./defs.js";
import { tangentFrame, tmp } from "../utils.js";
import { applyAoeDamage, spawnBurst, spawnScorchMark } from "./fx-common.js";
import { isWaterAt, spawnWaterSplash } from "./water-fx.js";

const SMOKE_COLORS = [0x3a3835, 0x4a4844, 0x555048, 0x2e2c28];
const _yUp = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _coalCol = new THREE.Color(0x1a1008);

function spawnSmokePuff(sys, pos, vel, opts = {}) {
  const mat = new THREE.MeshBasicMaterial({
    color: opts.color ?? SMOKE_COLORS[(Math.random() * SMOKE_COLORS.length) | 0],
    transparent: true,
    opacity: opts.opacity ?? 0.42,
    depthWrite: false
  });
  const s = opts.size ?? 0.07 + Math.random() * 0.05;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(s, 6, 5), mat);
  mesh.position.copy(pos);
  sys.planetGroup.add(mesh);
  if (!sys.smokePuffs) sys.smokePuffs = [];
  sys.smokePuffs.push({
    mesh,
    mat,
    vel: vel.clone(),
    t: 0,
    life: opts.life ?? 0.55 + Math.random() * 0.35,
    grow: opts.grow ?? 0.22 + Math.random() * 0.12
  });
}

/** Kouřový pruh za koulí — protáhlý obláček podél směru letu. */
function spawnSmokeStreak(sys, pos, vel, up) {
  const speed = vel.length();
  if (speed < 0.5) return;
  const back = vel.clone().multiplyScalar(-1 / speed);
  tangentFrame(up, tmp.east, tmp.north);
  const side = tmp.east.multiplyScalar((Math.random() - 0.5) * 0.12);

  const mat = new THREE.MeshBasicMaterial({
    color: SMOKE_COLORS[(Math.random() * SMOKE_COLORS.length) | 0],
    transparent: true,
    opacity: 0.48,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), mat);
  mesh.position.copy(pos).add(side);
  mesh.scale.set(0.55 + Math.random() * 0.2, 0.55 + Math.random() * 0.2, 1.6 + Math.random() * 0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), back);
  mesh.quaternion.copy(q);
  sys.planetGroup.add(mesh);

  if (!sys.smokePuffs) sys.smokePuffs = [];
  const drift = back.clone().multiplyScalar(-0.8 + Math.random() * 0.3);
  drift.addScaledVector(up, 0.2 + Math.random() * 0.35);
  sys.smokePuffs.push({
    mesh,
    mat,
    vel: drift,
    t: 0,
    life: 0.85 + Math.random() * 0.55,
    grow: 0.35 + Math.random() * 0.15
  });
}

function spawnFireShards(sys, pos, normalDir, count = 72) {
  tangentFrame(normalDir, tmp.east, tmp.north);
  if (!sys.fireDebris) sys.fireDebris = [];

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.85;
    const spread = 1.1 + Math.random() * 2.4;
    const vel = tmp.east
      .clone()
      .multiplyScalar(Math.cos(a) * spread)
      .addScaledVector(tmp.north, Math.sin(a) * spread);
    vel.addScaledVector(normalDir, 1.0 + Math.random() * 2.2);

    const w = 0.065 + Math.random() * 0.15;
    const h = 0.055 + Math.random() * 0.13;
    const d = 0.06 + Math.random() * 0.14;
    const hot = Math.random() > 0.35;
    const mat = new THREE.MeshStandardMaterial({
      color: hot ? 0xff8820 : 0x3a2010,
      emissive: hot ? 0xff5500 : 0xff3300,
      emissiveIntensity: 1.2 + Math.random() * 0.9,
      roughness: 0.82,
      metalness: 0.04,
      transparent: true,
      opacity: 0.96
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    mesh.position.copy(pos).addScaledVector(normalDir, 0.04 + Math.random() * 0.1);
    mesh.castShadow = true;
    sys.planetGroup.add(mesh);

    sys.fireDebris.push({
      mesh,
      mat,
      vel,
      dir: normalDir.clone(),
      radius: Math.max(w, h, d) * 0.5,
      state: "air",
      t: 0,
      groundT: 0,
      coolT: 0,
      restTime: 0.25 + Math.random() * 0.85,
      coolLife: 1.0 + Math.random() * 1.4,
      rotVel: new THREE.Vector3(
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18
      ),
      baseScale: mesh.scale.clone(),
      hot,
      coolFrom: null
    });
  }
}

function explodeFireball(sys, pos, dir) {
  const def = SPELLS.fireball;
  const onWater = isWaterAt(sys, dir);

  if (onWater) {
    spawnWaterSplash(sys, dir, def.burnRadius * 1.6);
    spawnBurst(sys, pos, dir, 0xd8ecff, 0.45);
    spawnBurst(sys, pos, dir, 0xb8dcf0, 0.32);
  } else {
    spawnScorchMark(sys, dir, def.burnRadius);
    sys.terrain.scorch(dir, Math.max(2.6, def.burnRadius * 2.5), true);
    spawnBurst(sys, pos, dir, 0xff3a08, 0.65);
    spawnBurst(sys, pos, dir, 0xff9020, 0.5);
    spawnBurst(sys, pos, dir, 0xffe8a0, 0.35);
    spawnFireShards(sys, pos, dir);
  }

  applyAoeDamage(
    sys,
    dir,
    def.damageRadius,
    def.damageCenter,
    def.damageEdge
  );
}

function disposeFireball(sys, p) {
  sys.planetGroup.remove(p.ball);
  for (const g of p.geos) g.dispose();
  for (const m of p.mats) m.dispose();
  if (p.light) p.ball.remove(p.light);
}

/** Ohnivá koule: vystřel z hlavy kouzelníka směrem k cíli. */
export function launchFireball(sys, targetDir) {
  const w = sys.wizard;
  if (!w) return;

  const target = targetDir.clone().normalize();
  const th = sys.terrain.height(target);
  const aim = target.clone().multiplyScalar(th);

  const headLift = CONFIG.wizardHeightM - 0.12;
  const from = w.mesh.position.clone().addScaledVector(w.dir, headLift);

  sys._vel.copy(aim).sub(from);
  const dist = sys._vel.length();
  if (dist < 0.15) {
    explodeFireball(sys, aim, target);
    return;
  }
  sys._vel.multiplyScalar(SPELLS.fireball.speed / dist);

  const r = SPELLS.fireball.radius;
  const geos = [];
  const mats = [];

  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff0c0,
    emissiveIntensity: 2.2,
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 1,
    depthWrite: false
  });
  const coreGeo = new THREE.SphereGeometry(r * 0.45, 10, 8);
  geos.push(coreGeo);
  mats.push(coreMat);
  const core = new THREE.Mesh(coreGeo, coreMat);

  const midMat = new THREE.MeshStandardMaterial({
    color: 0xff6600,
    emissive: 0xff4400,
    emissiveIntensity: 1.6,
    roughness: 0.25,
    metalness: 0.08,
    transparent: true,
    opacity: 0.96,
    depthWrite: false
  });
  const midGeo = new THREE.SphereGeometry(r, 12, 10);
  geos.push(midGeo);
  mats.push(midMat);
  const mid = new THREE.Mesh(midGeo, midMat);

  const outerMat = new THREE.MeshBasicMaterial({
    color: 0xff2200,
    transparent: true,
    opacity: 0.55,
    depthWrite: false
  });
  const outerGeo = new THREE.SphereGeometry(r * 1.4, 10, 8);
  geos.push(outerGeo);
  mats.push(outerMat);
  const outer = new THREE.Mesh(outerGeo, outerMat);

  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xff8800,
    transparent: true,
    opacity: 0.32,
    depthWrite: false
  });
  const flameGeo = new THREE.SphereGeometry(r * 1.9, 8, 6);
  geos.push(flameGeo);
  mats.push(flameMat);
  const flame = new THREE.Mesh(flameGeo, flameMat);

  const light = new THREE.PointLight(0xffaa44, 4.5, 7, 1.5);

  const ball = new THREE.Group();
  ball.add(light, flame, outer, mid, core);
  ball.position.copy(from);
  ball.frustumCulled = false;
  sys.planetGroup.add(ball);

  sys.projectiles.push({
    kind: "fireball",
    ball,
    geos,
    mats,
    light,
    vel: sys._vel.clone(),
    target,
    aim,
    radius: r,
    traveled: 0,
    maxDist: dist + headLift + 6,
    life: 6,
    smokeAcc: 0,
    burnT: 0
  });
}

/** @returns {boolean} true pokud projektil zůstal */
export function updateFireball(sys, p, dt) {
  const speed = SPELLS.fireball.speed;
  const step = speed * dt;
  p.ball.position.addScaledVector(p.vel, dt);
  p.traveled += step;
  p.burnT += dt;
  p.smokeAcc += dt;

  const pos = p.ball.position;
  const len = pos.length();
  let hit = p.life <= 0 || p.traveled >= p.maxDist;

  if (len > 1e-5) {
    sys._tmp.copy(pos).multiplyScalar(1 / len);
    const terrainH = sys.terrain.height(sys._tmp);
    const onWater = terrainH < CONFIG.waterLevel + 0.06;
    const surface = onWater ? CONFIG.waterLevel : terrainH;
    if (len - p.radius <= surface + 0.05) hit = true;

    if (!hit) {
      if (p.smokeAcc >= 0.022) {
        p.smokeAcc = 0;
        const back = p.vel.clone().normalize().multiplyScalar(-0.18);
        spawnSmokeStreak(sys, pos.clone().add(back), p.vel, sys._tmp);
        if (Math.random() > 0.45) {
          const puffVel = p.vel
            .clone()
            .multiplyScalar(-0.2)
            .addScaledVector(sys._tmp, 0.3 + Math.random() * 0.25);
          spawnSmokePuff(sys, pos.clone().add(back), puffVel, {
            opacity: 0.35,
            life: 0.7,
            grow: 0.28,
            size: 0.1
          });
        }
      }
    }
  }

  const flicker = 0.72 + 0.28 * Math.sin(p.burnT * 32);
  const flicker2 = 0.65 + 0.35 * Math.sin(p.burnT * 47 + 1.2);
  if (p.light) {
    p.light.intensity = 4.2 * flicker;
    p.light.color.setHSL(0.08 + flicker2 * 0.04, 1, 0.55 + flicker * 0.15);
  }
  if (p.mats[0]?.emissiveIntensity != null) {
    p.mats[0].emissiveIntensity = 1.8 + flicker2 * 1.4;
    p.mats[0].opacity = 0.92 + flicker * 0.08;
  }
  if (p.mats[1]?.emissiveIntensity != null) {
    p.mats[1].emissiveIntensity = 1.2 + flicker * 1.1;
    p.mats[1].opacity = 0.88 + flicker2 * 0.12;
  }
  if (p.mats[2]) p.mats[2].opacity = 0.45 + flicker2 * 0.2;
  if (p.mats[3]) p.mats[3].opacity = 0.22 + flicker * 0.15;
  const wobble = 1 + 0.1 * Math.sin(p.burnT * 24);
  p.ball.scale.setScalar(wobble);

  if (hit) {
    const dir = len > 1e-5 ? sys._tmp.clone() : p.target.clone();
    const terrainH = len > 1e-5 ? sys.terrain.height(sys._tmp) : CONFIG.waterLevel;
    const surface = terrainH < CONFIG.waterLevel + 0.06 ? CONFIG.waterLevel : terrainH;
    const hitPos =
      len > 1e-5
        ? pos.clone().addScaledVector(sys._tmp, -(len - surface + 0.02))
        : pos.clone();
    explodeFireball(sys, hitPos, dir);
    disposeFireball(sys, p);
    return false;
  }
  return true;
}

export function updateSmokePuffs(sys, dt) {
  if (!sys.smokePuffs?.length) return;
  for (let i = sys.smokePuffs.length - 1; i >= 0; i--) {
    const s = sys.smokePuffs[i];
    s.t += dt;
    const u = s.t / s.life;
    s.mesh.position.addScaledVector(s.vel, dt);
    s.vel.multiplyScalar(0.965);
    s.mesh.scale.x *= 1 + dt * 0.35;
    s.mesh.scale.y *= 1 + dt * 0.35;
    s.mesh.scale.z *= 1 + dt * 0.12;
    s.mat.opacity = Math.max(0, s.mat.opacity * (1 - u * u * dt * 2.5));
    if (u >= 1) {
      sys.planetGroup.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mat.dispose();
      sys.smokePuffs.splice(i, 1);
    }
  }
}

export function updateFireDebris(sys, dt) {
  if (!sys.fireDebris?.length) return;

  for (let i = sys.fireDebris.length - 1; i >= 0; i--) {
    const s = sys.fireDebris[i];
    s.t += dt;

    if (s.state === "air") {
      const pos = s.mesh.position;
      tmp.dir.copy(pos);
      const rLen = tmp.dir.length();
      if (rLen > 1e-6) tmp.dir.multiplyScalar(1 / rLen);
      else tmp.dir.copy(s.dir);

      s.vel.addScaledVector(tmp.dir, -11.5 * dt);
      s.vel.multiplyScalar(0.982);
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
        s.mesh.rotation.x += s.rotVel.x * 0.12;
        s.mesh.rotation.z += s.rotVel.z * 0.12;
        s.state = "ground";
        s.groundT = 0;
        s.vel.set(0, 0, 0);
      }
    } else if (s.state === "ground") {
      s.groundT += dt;
      const h = sys.terrain.height(s.dir) + s.radius * 0.35;
      s.mesh.position.copy(s.dir).multiplyScalar(h);
      _quat.setFromUnitVectors(_yUp, s.dir);
      s.mesh.quaternion.copy(_quat);

      const glow = Math.max(0.15, 1 - s.groundT * 0.35);
      s.mat.emissiveIntensity = (s.hot ? 1.3 : 0.9) * glow;

      if (s.groundT >= s.restTime) {
        s.state = "cool";
        s.coolT = 0;
        s.coolFrom = s.mat.color.clone();
        s.emFrom = s.mat.emissiveIntensity;
      }
    } else if (s.state === "cool") {
      s.coolT += dt;
      const u = s.coolT / s.coolLife;
      const h = sys.terrain.height(s.dir) + s.radius * 0.3 * (1 - u * 0.5);
      s.mesh.position.copy(s.dir).multiplyScalar(h);

      s.mesh.scale.set(
        s.baseScale.x * (1 - u * 0.15),
        s.baseScale.y * (1 - u * 0.35),
        s.baseScale.z * (1 - u * 0.15)
      );

      s.mat.emissiveIntensity = s.emFrom * (1 - u * u);
      if (s.coolFrom) s.mat.color.copy(s.coolFrom).lerp(_coalCol, u);
      s.mat.opacity = 0.96 * (1 - u);

      if (u >= 1) {
        sys.planetGroup.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mat.dispose();
        sys.fireDebris.splice(i, 1);
      }
    }
  }
}
