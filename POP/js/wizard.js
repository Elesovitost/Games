import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tangentFrame, tmp } from "./utils.js";

const SKIN = 0xc68642;
const ROBE = 0x4a2d7a;
const ROBE_DARK = 0x2e1a4f;
const HAT = 0x2a1848;
const HAT_BAND = 0xd4a017;
const STAFF = 0x6b4423;
const STAFF_TIP = 0x5ec8ff;
const PANTS = 0x3a2a55;
const BOOTS = 0x2a1f18;

function box(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02 })
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Minecraft-style blokový kouzelník (lokální Y = nahoru od povrchu, +Z = obličej). */
export function createWizardMesh(robeColor = ROBE) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const robe = Number(robeColor) || ROBE;
  const robeDark = new THREE.Color(robe).multiplyScalar(0.55).getHex();

  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.18, 0.7, 0);
  leftLeg.add(box(0.28, 0.55, 0.28, PANTS, 0, -0.275, 0));
  leftLeg.add(box(0.3, 0.18, 0.32, BOOTS, 0, -0.62, 0.02));

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.18, 0.7, 0);
  rightLeg.add(box(0.28, 0.55, 0.28, PANTS, 0, -0.275, 0));
  rightLeg.add(box(0.3, 0.18, 0.32, BOOTS, 0, -0.62, 0.02));

  body.add(box(0.58, 0.72, 0.36, robe, 0, 1.05, 0));
  body.add(box(0.62, 0.22, 0.4, robeDark, 0, 1.42, 0));
  body.add(box(0.7, 0.55, 0.12, robeDark, 0, 1.0, -0.22));

  body.add(box(0.48, 0.48, 0.48, SKIN, 0, 1.7, 0));

  body.add(box(0.72, 0.1, 0.72, robeDark, 0, 1.98, 0));
  body.add(box(0.5, 0.12, 0.5, HAT_BAND, 0, 2.08, 0));
  body.add(box(0.36, 0.28, 0.36, robeDark, 0, 2.28, 0));
  body.add(box(0.22, 0.28, 0.22, robeDark, 0, 2.52, 0));
  body.add(box(0.12, 0.22, 0.12, robeDark, 0, 2.72, 0));

  const leftArm = new THREE.Group();
  leftArm.position.set(-0.42, 1.35, 0);
  leftArm.add(box(0.22, 0.55, 0.22, robe, 0, -0.22, 0));
  leftArm.add(box(0.2, 0.16, 0.2, SKIN, 0, -0.52, 0));

  const rightArm = new THREE.Group();
  rightArm.position.set(0.42, 1.35, 0);
  rightArm.add(box(0.22, 0.55, 0.22, robe, 0, -0.22, 0));
  rightArm.add(box(0.2, 0.16, 0.2, SKIN, 0, -0.52, 0));

  const staffPivot = new THREE.Group();
  staffPivot.position.set(0.05, -0.35, 0.22);
  const staff = box(0.08, 1.35, 0.08, STAFF, 0, 0.15, 0.08);
  staff.rotation.x = 0.12;
  staffPivot.add(staff);
  const tipMat = new THREE.MeshStandardMaterial({
    color: STAFF_TIP,
    emissive: STAFF_TIP,
    emissiveIntensity: 0.35,
    roughness: 0.4,
    metalness: 0.1
  });
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), tipMat);
  tip.position.set(0, 0.88, 0.18);
  tip.castShadow = true;
  staffPivot.add(tip);
  rightArm.add(staffPivot);

  body.add(leftLeg, rightLeg, leftArm, rightArm);
  root.add(body);

  // Mesh sahá cca po y≈2.83 (špička klobouku) → škáluj na wizardHeightM metrů
  const meshH = 2.83;
  root.scale.setScalar(CONFIG.wizardHeightM / meshH);

  const castFx = new THREE.Group();
  castFx.visible = false;
  const sparks = [];
  const colors = [0xa8e8ff, 0xd4b4ff, 0xffe08a, 0x7cf0c8];
  for (let i = 0; i < 16; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: colors[i % colors.length],
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    });
    const sp = new THREE.Mesh(new THREE.SphereGeometry(0.07 + (i % 3) * 0.025, 8, 6), mat);
    castFx.add(sp);
    sparks.push(sp);
  }
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xc8a0ff,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const auraRing = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.045, 8, 32), ringMat);
  auraRing.rotation.x = Math.PI / 2;
  castFx.add(auraRing);
  const auraRing2 = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.035, 8, 28), ringMat.clone());
  auraRing2.rotation.x = Math.PI / 2;
  castFx.add(auraRing2);
  body.add(castFx);

  root.userData.parts = {
    leftLeg, rightLeg, leftArm, rightArm,
    staffPivot, tip, tipMat, castFx, sparks, auraRing, auraRing2
  };
  return root;
}

const MARKER_LIFT = 0.2;

/** Malá pulzující kulička na místě kliknutí. */
class MoveMarker {
  constructor(planetGroup, terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.visible = false;

    this.mat = new THREE.MeshBasicMaterial({
      color: 0xffe566,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), this.mat);
    this.core.frustumCulled = false;
    this.core.renderOrder = 2;
    this.group.add(this.core);
    planetGroup.add(this.group);

    this.dir = new THREE.Vector3(0, 1, 0);
    this.t = 0;
    this._east = new THREE.Vector3();
    this._north = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._p0 = new THREE.Vector3();
    this._pE = new THREE.Vector3();
    this._pN = new THREE.Vector3();
  }

  #place() {
    const h = this.terrain.height(this.dir);
    this._p0.copy(this.dir).multiplyScalar(h);

    tangentFrame(this.dir, this._east, this._north);
    const eps = 0.035;
    this._tmp.copy(this.dir).addScaledVector(this._east, eps).normalize();
    this._pE.copy(this._tmp).multiplyScalar(this.terrain.height(this._tmp));
    this._tmp2.copy(this.dir).addScaledVector(this._north, eps).normalize();
    this._pN.copy(this._tmp2).multiplyScalar(this.terrain.height(this._tmp2));
    this._n.crossVectors(this._pE.sub(this._p0), this._pN.sub(this._p0));
    if (this._n.lengthSq() < 1e-10) this._n.copy(this.dir);
    else this._n.normalize();
    if (this._n.dot(this.dir) < 0) this._n.negate();

    this.group.position.copy(this._p0).addScaledVector(this._n, MARKER_LIFT);
  }

  show(dir) {
    this.dir.copy(dir).normalize();
    this.#place();
    this.group.visible = true;
    this.t = 0;
  }

  hide() {
    this.group.visible = false;
  }

  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;
    this.#place();
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 5.5);
    this.core.scale.setScalar(0.85 + pulse * 0.3);
    this.mat.opacity = 0.55 + pulse * 0.35;
  }
}

export class Wizard {
  constructor(planetGroup, terrain, spawnDir, opts = {}) {
    this.planetGroup = planetGroup;
    this.terrain = terrain;
    this.id = opts.id || "local";
    this.name = opts.name || "Čaroděj";
    this.color = Number(opts.color) || ROBE;
    this.remote = !!opts.remote;
    this.mesh = createWizardMesh(this.color);
    this.planetGroup.add(this.mesh);
    this.marker = this.remote ? null : new MoveMarker(planetGroup, terrain);

    this.dir = new THREE.Vector3().fromArray(spawnDir).normalize();
    this.facing = new THREE.Vector3();
    this.targetDir = new THREE.Vector3();
    this.hasTarget = false;
    this.walkPhase = 0;
    this.moving = false;
    this.casting = false;
    this.castT = 0;
    this.castDuration = 0;
    this._onCastComplete = null;
    this._castFace = new THREE.Vector3();

    this._right = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._move = new THREE.Vector3();
    this._trial = new THREE.Vector3();
    this._basisX = new THREE.Vector3();
    this._mat = new THREE.Matrix4();
    this._invPlanet = new THREE.Matrix4();
    this._camRightLocal = new THREE.Vector3();
    this._slopeSample = new THREE.Vector3();
    this._speedMul = 1;
    this.maxHp = CONFIG.wizardMaxHp;
    this.hp = this.maxHp;
    this.dead = false;
    this.ghost = null;
    this.ghostT = 0;
    this._ghostMats = [];

    this.#placeOnLand(this.dir);
    tangentFrame(this.dir, tmp.east, tmp.north);
    this.facing.copy(tmp.north);
    this.#applyPose();
    if (!this.remote) this.#syncHealthUi();
  }

  dispose() {
    this.planetGroup.remove(this.mesh);
    this.mesh.traverse((ch) => {
      ch.geometry?.dispose();
      if (ch.material) {
        if (Array.isArray(ch.material)) ch.material.forEach((m) => m.dispose());
        else ch.material.dispose();
      }
    });
    if (this.marker) {
      this.planetGroup.remove(this.marker.group);
      this.marker.core.geometry.dispose();
      this.marker.mat.dispose();
    }
    if (this.ghost) {
      this.planetGroup.remove(this.ghost);
      for (const m of this._ghostMats) m.dispose();
    }
  }

  /** Vzdálený hráč — snap / hladká pozice ze sítě. */
  applyNetPose(dirArr, facingArr, flags = {}) {
    if (!this.remote) return;
    this.dir.set(dirArr[0], dirArr[1], dirArr[2]).normalize();
    if (facingArr) {
      this.facing.set(facingArr[0], facingArr[1], facingArr[2]);
    }
    this.moving = !!flags.moving;
    if (typeof flags.hp === "number" && !this.dead) {
      this.hp = flags.hp;
    }
    this.mesh.position.copy(this.dir).multiplyScalar(this.#height(this.dir));
    this.#applyPose();
  }

  get isBusy() {
    return this.casting || this.dead;
  }

  takeDamage(amount) {
    if (this.dead || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.#syncHealthUi();
    if (this.hp <= 0) this.#die();
  }

  #syncHealthUi() {
    if (this.remote) return;
    const fill = document.getElementById("health-fill");
    const text = document.getElementById("health-text");
    const pct = (this.hp / this.maxHp) * 100;
    if (fill) {
      fill.style.width = `${pct}%`;
      fill.classList.toggle("low", pct <= 30);
      fill.classList.toggle("mid", pct > 30 && pct <= 60);
    }
    if (text) text.textContent = String(Math.ceil(this.hp));
  }

  #die() {
    if (this.dead) return;
    this.dead = true;
    this.#clearTarget();
    this.casting = false;
    this._onCastComplete = null;
    this.moving = false;
    const parts = this.mesh.userData.parts;
    if (parts?.castFx) parts.castFx.visible = false;

    this.#spawnGhost();
  }

  #spawnGhost() {
    this.#applyPose();
    const ghost = this.mesh.clone(true);
    ghost.traverse((ch) => {
      if (!ch.isMesh || !ch.material) return;
      const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
      const next = mats.map((m) => {
        const gm = new THREE.MeshBasicMaterial({
          color: m.color ? m.color.clone() : new THREE.Color(0xc8e8ff),
          transparent: true,
          opacity: 0.45,
          depthWrite: false
        });
        this._ghostMats.push(gm);
        return gm;
      });
      ch.material = next.length === 1 ? next[0] : next;
      ch.castShadow = false;
      ch.receiveShadow = false;
    });
    ghost.position.copy(this.mesh.position);
    ghost.quaternion.copy(this.mesh.quaternion);
    ghost.scale.copy(this.mesh.scale);
    this.planetGroup.add(ghost);
    this.ghost = ghost;
    this.ghostT = 0;
  }

  #height(dir) {
    return this.terrain.height(dir);
  }

  #isWalkable(dir) {
    return this.#height(dir) > CONFIG.waterLevel + CONFIG.wizardMinLand;
  }

  #snap(dir) {
    this.dir.copy(dir).normalize();
    this.mesh.position.copy(this.dir).multiplyScalar(this.#height(this.dir));
  }

  #clearTarget() {
    this.hasTarget = false;
    this.marker?.hide();
  }

  setDestination(localPoint) {
    if (this.casting || this.dead) return false;
    this._trial.copy(localPoint).normalize();
    if (!this.#isWalkable(this._trial)) return false;
    this.targetDir.copy(this._trial);
    this.hasTarget = true;
    this.marker?.show(this.targetDir);
    return true;
  }

  /** Rychlost podle sklonu: do kopce zpomalí, z kopce lehce zrychlí. */
  #slopeSpeedMul(moveDir) {
    const probe = 0.55;
    const h0 = this.#height(this.dir);
    this._slopeSample.copy(this.mesh.position).addScaledVector(moveDir, probe);
    if (this._slopeSample.lengthSq() < 1e-8) return 1;
    this._slopeSample.normalize();
    const h1 = this.#height(this._slopeSample);
    const grade = (h1 - h0) / probe;

    if (grade >= 0) {
      // 0 flat → 1, ~0.4 mírný → ~0.55, ~1.0 prudký → ~0.25, 1.6+ → min
      const mul = 1 / (1 + grade * grade * 3.2 + grade * 1.1);
      return Math.max(CONFIG.wizardUphillMin, mul);
    }
    // z kopce: grade záporný
    return Math.min(CONFIG.wizardDownhillBoost, 1 - grade * 0.4);
  }

  #endCast() {
    this.casting = false;
    const cb = this._onCastComplete;
    this._onCastComplete = null;
    const parts = this.mesh.userData.parts;
    if (parts) {
      if (parts.castFx) parts.castFx.visible = false;
      if (parts.tipMat) parts.tipMat.emissiveIntensity = 0.35;
      if (parts.staffPivot) parts.staffPivot.rotation.set(0, 0, 0);
      parts.rightArm.rotation.set(0, 0, 0);
      parts.leftArm.rotation.set(0, 0, 0);
    }
    if (cb) cb();
  }

  /** Začni vizuální show kouzlení směrem k cíli. onComplete po skončení. */
  startCast(targetDir, duration = CONFIG.spellDuration, onComplete = null) {
    if (this.casting || this.dead) return false;
    this.#clearTarget();
    this.casting = true;
    this.castT = 0;
    this.castDuration = duration;
    this._onCastComplete = onComplete;
    this._castFace.copy(targetDir).normalize();
    this._castFace.addScaledVector(this.dir, -this._castFace.dot(this.dir));
    if (this._castFace.lengthSq() > 1e-8) {
      this.facing.copy(this._castFace).normalize();
    }
    const parts = this.mesh.userData.parts;
    if (parts?.castFx) parts.castFx.visible = true;
    return true;
  }

  #placeOnLand(preferred) {
    this._trial.copy(preferred).normalize();
    if (this.#isWalkable(this._trial)) {
      this.#snap(this._trial);
      return;
    }
    tangentFrame(this._trial, tmp.east, tmp.north);
    for (let ring = 1; ring <= 24; ring++) {
      const angStep = Math.PI / Math.max(4, ring * 2);
      const offset = ring * 0.04;
      for (let a = 0; a < Math.PI * 2; a += angStep) {
        this._trial.copy(preferred)
          .addScaledVector(tmp.east, Math.cos(a) * offset)
          .addScaledVector(tmp.north, Math.sin(a) * offset)
          .normalize();
        if (this.#isWalkable(this._trial)) {
          this.#snap(this._trial);
          return;
        }
      }
    }
    this.#snap(preferred);
  }

  #applyPose() {
    this.facing.addScaledVector(this.dir, -this.facing.dot(this.dir));
    if (this.facing.lengthSq() < 1e-8) {
      tangentFrame(this.dir, tmp.east, this.facing);
    } else {
      this.facing.normalize();
    }
    this._basisX.crossVectors(this.dir, this.facing).normalize();
    this.facing.crossVectors(this._basisX, this.dir).normalize();
    this._mat.makeBasis(this._basisX, this.dir, this.facing);
    this.mesh.quaternion.setFromRotationMatrix(this._mat);
    // Mrtvý — leží na boku (překlopit kolem lokální X)
    if (this.dead) this.mesh.rotateOnAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  }

  #arriveAngle() {
    return CONFIG.wizardArrive / Math.max(CONFIG.planetR, 1);
  }

  update(dt, keys, camRight) {
    if (this.remote) {
      if (this.casting) {
        this.castT += dt;
        if (this.castT >= this.castDuration) this.#endCast();
      }
      this.mesh.position.copy(this.dir).multiplyScalar(this.#height(this.dir));
      this.#applyPose();
      this.#animate(dt);
      if (this.dead) this.#updateGhost(dt);
      return;
    }

    if (this.dead) {
      this.mesh.position.copy(this.dir).multiplyScalar(this.#height(this.dir));
      this.#applyPose();
      this.#updateGhost(dt);
      this.marker?.update(dt);
      return;
    }

    this._invPlanet.copy(this.planetGroup.matrixWorld).invert();
    this._camRightLocal.copy(camRight).transformDirection(this._invPlanet);

    this._right.copy(this._camRightLocal).addScaledVector(this.dir, -this._camRightLocal.dot(this.dir));
    if (this._right.lengthSq() < 1e-8) {
      tangentFrame(this.dir, this._right, this._fwd);
    } else {
      this._right.normalize();
      this._fwd.crossVectors(this.dir, this._right).normalize();
    }

    this._move.set(0, 0, 0);
    if (!this.casting) {
      if (keys.KeyW) this._move.add(this._fwd);
      if (keys.KeyS) this._move.sub(this._fwd);
      if (keys.KeyA) this._move.sub(this._right);
      if (keys.KeyD) this._move.add(this._right);

      const keyboard = this._move.lengthSq() > 1e-8;
      if (keyboard) {
        this.#clearTarget();
        this._move.normalize();
      } else if (this.hasTarget) {
        const dot = Math.min(1, Math.max(-1, this.dir.dot(this.targetDir)));
        if (Math.acos(dot) <= this.#arriveAngle()) {
          this.#snap(this.targetDir);
          this.#clearTarget();
        } else {
          this._move.copy(this.targetDir).addScaledVector(this.dir, -dot);
          if (this._move.lengthSq() > 1e-10) this._move.normalize();
          else this.#clearTarget();
        }
      }

      this.moving = this._move.lengthSq() > 1e-8;
      if (this.moving) {
        this._speedMul = this.#slopeSpeedMul(this._move);
        const step = CONFIG.wizardSpeed * this._speedMul * dt;
        this._trial.copy(this.mesh.position).addScaledVector(this._move, step);
        if (this._trial.lengthSq() > 1e-8) {
          this._trial.normalize();
          if (this.#isWalkable(this._trial)) {
            this.#snap(this._trial);
            this.facing.copy(this._move);
          } else if (this.hasTarget) {
            this.#clearTarget();
          }
        }
      } else {
        this._speedMul = 1;
      }
    } else {
      this.moving = false;
      this._speedMul = 1;
      this.castT += dt;
      if (this.castT >= this.castDuration) this.#endCast();
    }

    // Drž nohy na povrchu (morph pod ním)
    this.mesh.position.copy(this.dir).multiplyScalar(this.#height(this.dir));

    this.#applyPose();
    this.#animate(dt);
    this.marker?.update(dt);
  }

  #updateGhost(dt) {
    if (!this.ghost) return;
    this.ghostT += dt;
    const rise = 2.8 * dt;
    this.ghost.position.addScaledVector(this.dir, rise);
    const fade = Math.max(0, 1 - this.ghostT / 3.2);
    for (const m of this._ghostMats) m.opacity = 0.45 * fade;
    if (this.ghostT >= 3.2) {
      this.planetGroup.remove(this.ghost);
      for (const m of this._ghostMats) m.dispose();
      this._ghostMats.length = 0;
      this.ghost = null;
    }
  }

  #animate(dt) {
    const parts = this.mesh.userData.parts;
    if (!parts) return;

    if (this.casting) {
      const t = this.castT;
      const pulse = 0.5 + 0.5 * Math.sin(t * 11);
      const u = Math.min(1, t / Math.max(this.castDuration, 0.01));

      // Zvednuté ruce + točení hole kolem vlastní osy
      parts.rightArm.rotation.x = -1.35;
      parts.rightArm.rotation.z = -0.55 + Math.sin(t * 2.4) * 0.08;
      parts.rightArm.rotation.y = Math.sin(t * 1.6) * 0.15;
      parts.leftArm.rotation.x = -0.85 + Math.sin(t * 5) * 0.15;
      parts.leftArm.rotation.z = 0.55;
      parts.leftLeg.rotation.x = 0;
      parts.rightLeg.rotation.x = 0;

      if (parts.staffPivot) {
        parts.staffPivot.rotation.y = t * 9.5;
        parts.staffPivot.rotation.z = Math.sin(t * 6) * 0.2;
      }
      if (parts.tipMat) parts.tipMat.emissiveIntensity = 0.9 + pulse * 2.4;

      if (parts.castFx) {
        parts.castFx.position.set(0, 1.1, 0);
        if (parts.auraRing) {
          parts.auraRing.rotation.z = t * 2.2;
          parts.auraRing.scale.setScalar(0.85 + pulse * 0.35 + u * 0.25);
          if (parts.auraRing.material) parts.auraRing.material.opacity = 0.25 + pulse * 0.4;
        }
        if (parts.auraRing2) {
          parts.auraRing2.rotation.z = -t * 3.1;
          parts.auraRing2.position.y = 0.35 + Math.sin(t * 3) * 0.15;
          parts.auraRing2.scale.setScalar(0.9 + (1 - pulse) * 0.3);
          if (parts.auraRing2.material) parts.auraRing2.material.opacity = 0.2 + pulse * 0.35;
        }
        if (parts.sparks) {
          const n = parts.sparks.length;
          for (let i = 0; i < n; i++) {
            const sp = parts.sparks[i];
            const layer = i < 8 ? 0 : 1;
            const a = t * (2.8 + layer * 1.4) + (i / n) * Math.PI * 2;
            const r = (0.55 + layer * 0.35) + 0.15 * Math.sin(t * 4 + i);
            const y = 0.2 + layer * 0.55 + Math.sin(t * 3.5 + i * 0.7) * 0.35 + u * 0.2;
            sp.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
            sp.scale.setScalar(0.65 + pulse * 0.7);
            if (sp.material) sp.material.opacity = 0.3 + pulse * 0.55;
          }
        }
      }
      return;
    }

    parts.rightArm.rotation.set(0, 0, 0);
    parts.leftArm.rotation.set(0, 0, 0);
    if (parts.staffPivot) parts.staffPivot.rotation.set(0, 0, 0);

    if (this.moving) this.walkPhase += dt * (7 + 5 * this._speedMul);
    else this.walkPhase *= 0.85;
    const swing = this.moving ? Math.sin(this.walkPhase) * (0.35 + 0.25 * this._speedMul) : 0;
    parts.leftLeg.rotation.x = swing;
    parts.rightLeg.rotation.x = -swing;
    parts.leftArm.rotation.x = -swing * 0.7;
    parts.rightArm.rotation.x = swing * 0.45;
  }
}
