import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { COMBAT } from "./combat.js";
import { slerpDirection, tangentFrame, tmp, disposeObject } from "./utils.js";
import { cameraPoseAt, lerpCameraPose, applyCameraPose } from "./sky.js";

function limb(len, radius, mat) {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.72, radius, len, 5), mat);
  mesh.position.y = -len * 0.5;
  g.add(mesh);
  return g;
}

function createWizardModel(robeColor = 0xc41c12) {
  const root = new THREE.Group();
  const robeCol = new THREE.Color(robeColor);
  const robe = new THREE.MeshStandardMaterial({
    color: robeCol,
    emissive: robeCol.clone().multiplyScalar(0.28),
    roughness: 0.52,
    metalness: 0.08,
    flatShading: true
  });
  const skin = new THREE.MeshStandardMaterial({
    color: 0xe8b896,
    roughness: 0.72,
    flatShading: true
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x3a140c,
    roughness: 0.62,
    flatShading: true
  });
  const wood = new THREE.MeshStandardMaterial({
    color: 0x6b4423,
    roughness: 0.82,
    flatShading: true
  });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xd4b46a,
    roughness: 0.4,
    metalness: 0.35,
    flatShading: true
  });

  const hips = new THREE.Group();
  hips.position.y = 0.175;
  root.add(hips);

  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.115, 0.2, 7), robe);
  skirt.position.y = 0.02;
  hips.add(skirt);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.09, 0.16, 7), robe);
  torso.position.y = 0.145;
  hips.add(torso);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.012, 5, 10), gold);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.08;
  hips.add(belt);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.052, 8, 7), skin);
  head.position.y = 0.255;
  hips.add(head);
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.068, 0.11, 7), robe);
  hood.position.y = 0.31;
  hips.add(hood);
  const beard = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.07, 5), dark);
  beard.position.set(0, 0.215, 0.038);
  beard.rotation.x = 0.55;
  hips.add(beard);

  const armL = limb(0.155, 0.022, robe);
  armL.position.set(0.095, 0.2, 0);
  hips.add(armL);
  const armR = limb(0.155, 0.022, robe);
  armR.position.set(-0.095, 0.2, 0);
  hips.add(armR);

  const staff = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.44, 5), wood);
  pole.position.y = -0.08;
  staff.add(pole);
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 8, 6),
    new THREE.MeshStandardMaterial({
      color: 0xff6622,
      emissive: 0xff3311,
      emissiveIntensity: 1.1,
      roughness: 0.35
    })
  );
  orb.position.y = 0.15;
  staff.add(orb);
  staff.add(new THREE.PointLight(0xff4411, 0.55, 3.4));
  staff.position.set(0, -0.02, 0.02);
  staff.rotation.z = 0.18;
  armR.add(staff);

  const handL = new THREE.Mesh(new THREE.SphereGeometry(0.02, 5, 4), skin);
  handL.position.y = -0.16;
  armL.add(handL);

  const legL = limb(0.165, 0.028, dark);
  legL.position.set(0.04, 0.175, 0);
  root.add(legL);
  const legR = limb(0.165, 0.028, dark);
  legR.position.set(-0.04, 0.175, 0);
  root.add(legR);
  const footL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.022, 0.07), dark);
  footL.position.set(0, -0.165, 0.018);
  legL.add(footL);
  const footR = footL.clone();
  legR.add(footR);

  root.userData = { hips, armL, armR, legL, legR, staff, orb };
  return root;
}

function createGrave() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({
    color: 0x6a6e72,
    roughness: 0.92,
    flatShading: true
  });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.48, 0.08), stone);
  slab.position.y = 0.24;
  g.add(slab);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.2), stone);
  base.position.y = 0.04;
  g.add(base);
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.04), stone);
  crossV.position.set(0, 0.42, 0.06);
  g.add(crossV);
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.04), stone);
  crossH.position.set(0, 0.48, 0.06);
  g.add(crossH);
  g.traverse((ch) => {
    if (ch.isMesh) {
      ch.castShadow = true;
      ch.receiveShadow = true;
    }
  });
  return g;
}

export class Wizard {
  constructor(game, opts = {}) {
    this.game = game;
    this.id = opts.id || "local";
    this.name = opts.name || "";
    this.color = opts.color != null ? opts.color : 0xc41c12;
    const focus = opts.focus
      ? opts.focus.clone().normalize()
      : new THREE.Vector3(...CONFIG.focusDir).normalize();
    this.spawnFocus = focus.clone();
    this.dir = game.terrain.pickStartDir(focus);
    this.facing = new THREE.Vector3();
    tangentFrame(this.dir, tmp.east, tmp.north);
    this.facing.copy(tmp.north);
    this.move = {
      active: false,
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      t: 0,
      ang: 1
    };
    this.basis = new THREE.Matrix4();
    this.gait = 0;
    this.walkMul = 1;
    this.hp = COMBAT.maxHp;
    this.lives = COMBAT.maxLives;
    this.state = "alive";
    this.ghost = null;
    this.alt = 0;
    this.grave = null;
    this.matBackup = [];
    this.mesh = createWizardModel(this.color);
    this.mesh.scale.setScalar(CONFIG.wizardHeight / 0.48);
    this.mesh.traverse((ch) => {
      if (ch.isMesh) {
        ch.castShadow = true;
        ch.receiveShadow = true;
      }
    });
    game.planetGroup.add(this.mesh);
    this.place();
  }

  get canControl() {
    return this.state === "alive";
  }

  dispose() {
    this.#removeGrave();
    this.game.planetGroup.remove(this.mesh);
    disposeObject(this.mesh);
  }

  place() {
    const h = this.game.terrain.height(this.dir) + this.alt;
    this.mesh.position.copy(this.dir).normalize().multiplyScalar(h);
    tmp.east.crossVectors(this.dir, this.facing);
    if (tmp.east.lengthSq() < 1e-10) {
      tangentFrame(this.dir, tmp.east, tmp.north);
    } else {
      tmp.east.normalize();
      tmp.north.crossVectors(tmp.east, this.dir).normalize();
    }
    this.basis.makeBasis(tmp.east, this.dir, tmp.north);
    this.mesh.quaternion.setFromRotationMatrix(this.basis);
    if (this.state === "dead") {
      this.mesh.rotateOnAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    }
  }

  walkTo(localTarget, onWater) {
    if (!this.canControl) return false;
    if (!this.game.terrain.isLand(localTarget)) {
      if (onWater) onWater();
      return false;
    }
    this.move.from.copy(this.dir);
    this.move.to.copy(localTarget).normalize();
    this.move.ang = Math.max(this.move.from.angleTo(this.move.to), 0.0001);
    this.move.t = 0;
    this.move.active = true;
    return true;
  }

  takeDamage(amount) {
    if (this.state !== "alive" || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.id === this.game.wizard?.id) this.game.ui?.refreshVitality?.();
    if (this.hp > 0) return;
    this.lives = Math.max(0, this.lives - 1);
    this.move.active = false;
    if (this.lives <= 0) {
      this.#finalDeath();
    } else {
      this.#startGhost();
    }
    if (this.id === this.game.wizard?.id) {
      this.game.ui?.refreshVitality?.();
      if (this.lives > 0) this.game.ui.toast("Duch · zbývá " + this.lives + " životů");
      else this.game.ui.toast("Padl jsi");
      this.game.ui.setSpell(null);
    }
  }

  #startGhost() {
    this.state = "ghost";
    this.alt = 0;
    this.move.active = false;
    this.#setGhostLook(true);
    this.place();
    // Cíl letu = pevnina u spawnu (ať po dosednutí není skok bokem).
    const landAt = this.game.terrain.pickStartDir(this.spawnFocus);
    this.ghost = {
      phase: "appear",
      t: 0,
      riseAlt: 12,
      from: this.dir.clone(),
      to: landAt.clone().normalize(),
      camFrom: null
    };
    if (this.#isLocal()) {
      this.game.camLocked = true;
      this.game.ui.setSpell(null);
    }
  }

  #isLocal() {
    return this.id === this.game.wizard?.id;
  }

  #ghostWorldFocus() {
    return this.mesh.getWorldPosition(new THREE.Vector3());
  }

  #ghostWorldUp() {
    return this.dir.clone().transformDirection(this.game.planetGroup.matrixWorld).normalize();
  }

  #targetCamPose() {
    return cameraPoseAt(this.#ghostWorldFocus(), this.#ghostWorldUp());
  }

  #captureCamPose() {
    const cam = this.game.camera;
    const target = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(cam.quaternion)
      .multiplyScalar(CONFIG.camLook + CONFIG.camBack)
      .add(cam.position);
    return {
      position: cam.position.clone(),
      up: cam.up.clone(),
      target
    };
  }

  #followCamera(blend = 1) {
    if (!this.#isLocal()) return;
    const to = this.#targetCamPose();
    if (blend >= 0.999 || !this.ghost?.camFrom) {
      applyCameraPose(this.game.camera, to);
      return;
    }
    lerpCameraPose(this.game.camera, this.ghost.camFrom, to, blend);
  }

  #finalDeath() {
    this.state = "dead";
    this.hp = 0;
    this.alt = 0;
    this.#setGhostLook(false);
    this.place();
    this.#spawnGrave();
    if (this.#isLocal()) this.game.camLocked = false;
  }

  #respawn() {
    this.state = "alive";
    this.hp = COMBAT.maxHp;
    this.alt = 0;
    // Zůstaň přesně tam, kam duch dosedl.
    this.dir.normalize();
    tangentFrame(this.dir, tmp.east, tmp.north);
    this.facing.copy(tmp.north);
    this.#setGhostLook(false);
    this.ghost = null;
    this.place();
    if (this.#isLocal()) {
      this.game.camLocked = false;
      this.game.ui?.refreshVitality?.();
    }
  }

  #updateGhost(dt) {
    const g = this.ghost;
    g.t += dt;
    const riseAlt = g.riseAlt || 12;

    // 1) Duch na zemi
    if (g.phase === "appear") {
      this.alt = 0;
      this.place();
      if (g.t >= 0.45) {
        g.phase = "focus";
        g.t = 0;
        if (this.#isLocal()) g.camFrom = this.#captureCamPose();
      }
      return;
    }

    // 2) Plynulé nacentrování kamery na ducha
    if (g.phase === "focus") {
      this.alt = 0;
      this.place();
      const dur = 1.15;
      const u = Math.min(1, g.t / dur);
      this.#followCamera(u);
      if (u >= 1) {
        g.phase = "rise";
        g.t = 0;
        g.camFrom = null;
      }
      return;
    }

    // 3) Výlet nahoru — kamera stále na něm
    if (g.phase === "rise") {
      this.alt = Math.min(riseAlt, this.alt + dt * 4.2);
      this.place();
      this.#followCamera(1);
      if (this.alt >= riseAlt - 0.05) {
        g.phase = "travel";
        g.t = 0;
        g.from.copy(this.dir);
      }
      return;
    }

    // 4) Přesun na spawn
    if (g.phase === "travel") {
      const u = Math.min(1, g.t / 2.2);
      const e = u * u * (3 - 2 * u);
      slerpDirection(this.dir, g.from, g.to, e);
      this.alt = riseAlt;
      this.place();
      this.#followCamera(1);
      if (u >= 1) {
        g.phase = "land";
        g.t = 0;
      }
      return;
    }

    // 5) Klesání a změna zpět na kouzelníka
    if (g.phase === "land") {
      this.alt = Math.max(0, riseAlt - g.t * 7.5);
      this.place();
      this.#followCamera(1);
      if (this.alt <= 0) this.#respawn();
    }
  }

  #setGhostLook(ghostly) {
    if (ghostly && !this.matBackup.length) {
      const seen = new Set();
      this.mesh.traverse((ch) => {
        if (!ch.isMesh || !ch.material) return;
        const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
        for (const m of mats) {
          if (seen.has(m)) continue;
          seen.add(m);
          this.matBackup.push({
            mat: m,
            opacity: m.opacity !== undefined ? m.opacity : 1,
            transparent: !!m.transparent,
            emissive: m.emissive ? m.emissive.clone() : null,
            emissiveIntensity: m.emissiveIntensity,
            depthWrite: m.depthWrite !== false
          });
          m.transparent = true;
          m.opacity = 0.38;
          m.depthWrite = false;
          if (m.emissive) {
            m.emissive.setHex(0x88bbff);
            if (m.emissiveIntensity !== undefined) m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.45);
          }
          m.needsUpdate = true;
        }
      });
    } else if (!ghostly && this.matBackup.length) {
      for (const b of this.matBackup) {
        b.mat.transparent = b.transparent;
        b.mat.opacity = b.opacity;
        b.mat.depthWrite = b.depthWrite;
        if (b.emissive && b.mat.emissive) b.mat.emissive.copy(b.emissive);
        if (b.emissiveIntensity !== undefined && b.mat.emissiveIntensity !== undefined) {
          b.mat.emissiveIntensity = b.emissiveIntensity;
        }
        b.mat.needsUpdate = true;
      }
      this.matBackup.length = 0;
    }
  }

  #spawnGrave() {
    this.#removeGrave();
    this.grave = createGrave();
    const h = this.game.terrain.height(this.dir);
    this.grave.position.copy(this.dir).normalize().multiplyScalar(h);
    tangentFrame(this.dir, tmp.east, tmp.north);
    this.basis.makeBasis(tmp.east, this.dir, tmp.north);
    this.grave.quaternion.setFromRotationMatrix(this.basis);
    this.grave.scale.setScalar(0.01);
    this.grave.userData.grow = 0;
    this.game.planetGroup.add(this.grave);
  }

  #removeGrave() {
    if (!this.grave) return;
    this.game.planetGroup.remove(this.grave);
    disposeObject(this.grave);
    this.grave = null;
  }

  update(dt, elapsed) {
    if (this.grave) {
      this.grave.userData.grow = Math.min(1, this.grave.userData.grow + dt * 1.4);
      const g = this.grave.userData.grow;
      const s = g * g * (3 - 2 * g);
      this.grave.scale.setScalar(0.15 + s * 0.95);
    }

    if (this.state === "ghost" && this.ghost) {
      this.#updateGhost(dt);
      this.#animateIdle(dt, elapsed, 0);
      return;
    }

    if (this.state === "dead") {
      this.place();
      return;
    }

    if (this.move.active) {
      const curH = this.game.terrain.height(this.dir);
      const remain = Math.max(this.dir.angleTo(this.move.to), 1e-4);
      slerpDirection(tmp.peek, this.dir, this.move.to, Math.min(1, 0.014 / remain));
      const nextH = this.game.terrain.height(tmp.peek);
      const ds = Math.max(this.dir.angleTo(tmp.peek) * (curH + nextH) * 0.5, 1e-4);
      const slope = (nextH - curH) / ds;
      this.walkMul = THREE.MathUtils.clamp(Math.exp(-slope * 1.6), 0.2, 2.45);
      if (slope < 0) this.walkMul *= 0.5;
      this.move.t += dt * (CONFIG.wizardSpeed * this.walkMul) / this.move.ang;
      const u = Math.min(this.move.t, 1);
      slerpDirection(this.dir, this.move.from, this.move.to, u * u * (3 - 2 * u));
      tmp.peek.copy(this.move.to).sub(this.dir);
      tmp.peek.addScaledVector(this.dir, -tmp.peek.dot(this.dir));
      if (tmp.peek.lengthSq() > 1e-8) this.facing.copy(tmp.peek).normalize();
      if (u >= 1) this.move.active = false;
    } else {
      this.walkMul = 1;
    }
    this.place();
    this.#animateIdle(dt, elapsed, this.move.active ? 1 : 0);
  }

  #animateIdle(dt, elapsed, walking) {
    const ud = this.mesh.userData;
    this.gait += dt * (walking ? 11.4 * THREE.MathUtils.clamp(this.walkMul, 0.38, 1.55) : this.state === "ghost" ? 1.2 : 2.2);
    const gait = this.gait;
    const swing = walking ? 0.72 : this.state === "ghost" ? 0.04 : 0.08;
    const armSwing = walking ? 0.55 : 0.12;
    ud.legL.rotation.x = -Math.sin(gait) * swing;
    ud.legR.rotation.x = Math.sin(gait) * swing;
    ud.armL.rotation.x = Math.sin(gait) * armSwing;
    ud.armR.rotation.x = -Math.sin(gait) * armSwing + 0.35;
    ud.armR.rotation.z = 0.22;
    ud.hips.position.y = 0.175 + Math.abs(Math.sin(gait)) * 0.018 * walking + Math.sin(elapsed * 2.4) * 0.006;
    ud.hips.rotation.y = Math.sin(gait) * 0.12 * walking;
    if (ud.orb) {
      const pulse = 1 + Math.sin(elapsed * 5) * 0.12;
      ud.orb.scale.setScalar(pulse);
    }
  }
}
