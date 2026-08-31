import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tangentFrame, tmp } from "./utils.js";

const ROBE = 0x1a2848;
const ROBE_DARK = 0x0c1424;
const GOLD = 0xd4a837;
const GOLD_DIM = 0xa88628;
const FACE_VOID = 0x060810;
const MAGIC = 0x5ec8ff;
const MAGIC_BRIGHT = 0xa8eeff;

function mat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.88,
    metalness: opts.metalness ?? 0.02
  });
  if (opts.emissive) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 0.4;
  }
  return m;
}

function box(w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
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
  const robeDark = new THREE.Color(robe).multiplyScalar(0.42).getHex();
  const robeMat = mat(robe);
  const robeDarkMat = mat(robeDark);
  const goldMat = mat(GOLD, { roughness: 0.55, metalness: 0.35 });
  const goldDimMat = mat(GOLD_DIM, { roughness: 0.6, metalness: 0.25 });
  const voidMat = mat(FACE_VOID, { roughness: 1 });
  const magicMats = [];
  const magicMat = mat(MAGIC_BRIGHT, {
    emissive: MAGIC,
    emissiveIntensity: 0.5,
    roughness: 0.35,
    metalness: 0.1
  });
  const magicHotMat = mat(0xffffff, {
    emissive: MAGIC_BRIGHT,
    emissiveIntensity: 0.75,
    roughness: 0.2,
    metalness: 0.15
  });
  magicMats.push(magicMat, magicHotMat);

  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.12, 0.52, 0);
  leftLeg.add(box(0.22, 0.34, 0.22, robeDarkMat, 0, -0.13, 0));
  leftLeg.add(box(0.14, 0.32, 0.06, robeMat, 0.06, -0.2, 0.2));
  leftLeg.add(box(0.26, 0.09, 0.32, robeDarkMat, 0, -0.36, 0.1));

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.12, 0.52, 0);
  rightLeg.add(box(0.22, 0.34, 0.22, robeDarkMat, 0, -0.13, 0));
  rightLeg.add(box(0.14, 0.32, 0.06, robeMat, -0.06, -0.2, 0.2));
  rightLeg.add(box(0.26, 0.09, 0.32, robeDarkMat, 0, -0.36, 0.1));

  // Dlouhý hábit
  body.add(box(0.62, 1.12, 0.38, robeMat, 0, 0.72, 0));
  body.add(box(0.66, 0.08, 0.42, goldMat, 0, 0.16, 0.01));
  body.add(box(0.08, 1.05, 0.1, goldMat, 0, 0.7, 0.2));
  body.add(box(0.58, 0.32, 0.34, robeMat, 0, 1.38, 0));
  body.add(box(0.12, 0.18, 0.08, goldMat, 0, 1.52, 0.18));
  body.add(box(0.26, 0.16, 0.3, robeMat, -0.34, 1.46, -0.03));
  body.add(box(0.26, 0.16, 0.3, robeMat, 0.34, 1.46, -0.03));
  body.add(box(0.22, 0.1, 0.28, goldDimMat, -0.34, 1.48, 0.02));
  body.add(box(0.22, 0.1, 0.28, goldDimMat, 0.34, 1.48, 0.02));

  // Hlava v kápi — černý stín místo obličeje
  body.add(box(0.4, 0.4, 0.38, voidMat, 0, 1.72, 0.04));
  body.add(box(0.52, 0.46, 0.42, robeDarkMat, 0, 1.74, -0.05));
  body.add(box(0.54, 0.14, 0.46, robeDarkMat, 0, 1.98, -0.02));
  body.add(box(0.46, 0.22, 0.12, robeDarkMat, 0, 1.62, -0.22));
  body.add(box(0.48, 0.06, 0.08, goldMat, 0, 1.58, 0.22));
  body.add(box(0.06, 0.4, 0.08, goldMat, -0.22, 1.74, 0.22));
  body.add(box(0.06, 0.4, 0.08, goldMat, 0.22, 1.74, 0.22));
  body.add(box(0.44, 0.06, 0.08, goldMat, 0, 1.94, 0.18));

  const leftArm = new THREE.Group();
  leftArm.position.set(-0.38, 1.34, 0);
  leftArm.add(box(0.22, 0.3, 0.22, robeMat, 0, -0.12, 0));
  leftArm.add(box(0.24, 0.08, 0.24, goldMat, 0, -0.34, 0));
  leftArm.add(box(0.2, 0.16, 0.2, robeDarkMat, 0, -0.48, 0));

  const rightArm = new THREE.Group();
  rightArm.position.set(0.38, 1.34, 0);
  rightArm.add(box(0.22, 0.3, 0.22, robeMat, 0, -0.12, 0));
  rightArm.add(box(0.22, 0.26, 0.22, magicMat, 0, -0.36, 0));
  rightArm.add(box(0.14, 0.14, 0.14, magicHotMat, 0.04, -0.48, 0.06));
  rightArm.add(box(0.1, 0.1, 0.1, magicMat, -0.06, -0.42, 0.1));
  rightArm.add(box(0.08, 0.08, 0.08, magicHotMat, 0.08, -0.5, -0.04));

  const castFx = new THREE.Group();
  castFx.visible = false;
  castFx.position.set(0, -0.52, 0.1);
  const sparks = [];
  const sparkColors = [0xa8eeff, 0x5ec8ff, 0xd4f4ff, 0x88ddff];
  for (let i = 0; i < 10; i++) {
    const sm = new THREE.MeshBasicMaterial({
      color: sparkColors[i % sparkColors.length],
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    });
    const sp = new THREE.Mesh(
      new THREE.SphereGeometry(0.05 + (i % 2) * 0.02, 6, 5),
      sm
    );
    castFx.add(sp);
    sparks.push(sp);
  }
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x88ddff,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const handRing = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.018, 6, 20), ringMat);
  handRing.rotation.x = Math.PI / 2;
  castFx.add(handRing);
  rightArm.add(castFx);

  body.add(leftLeg, rightLeg, leftArm, rightArm);
  root.add(body);

  // Nohy na y=0, celková výška = wizardHeightM (2 m)
  const bbox = new THREE.Box3().setFromObject(body);
  body.position.y -= bbox.min.y;
  bbox.setFromObject(body);
  const meshH = bbox.max.y - bbox.min.y;
  root.scale.setScalar(CONFIG.wizardHeightM / meshH);

  root.userData.parts = {
    body,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    castFx,
    sparks,
    handRing,
    ringMat,
    magicMats
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
    this.walkBlend = 0;
    this.wantsWalk = false;
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
    this.wantsWalk = this.moving;
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
    return this.#height(dir) > CONFIG.wizardMinTerrainR;
  }

  #isInWater() {
    return this.#height(this.dir) < CONFIG.waterLevel + 0.04;
  }

  #isHeadSubmerged() {
    const headH = this.#height(this.dir) + CONFIG.wizardHeightM - 0.12;
    return headH < CONFIG.waterLevel;
  }

  #waterSpeedMul() {
    return this.#isInWater() ? CONFIG.wizardWaterSpeedMul : 1;
  }

  #applyDrowning(dt) {
    if (this.dead || !this.#isHeadSubmerged()) return;
    this.takeDamage(CONFIG.wizardDrownHpPerSec * dt);
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
      if (parts.magicMats) {
        for (const m of parts.magicMats) m.emissiveIntensity = 0.5;
      }
      parts.rightArm.rotation.set(0, 0, 0);
      parts.leftArm.rotation.set(0, 0, 0);
    }
    if (cb) cb();
  }

  /** Začni vizuální show kouzlení směrem k cíli. onComplete po skončení. */
  startCast(targetDir, duration = CONFIG.spellDuration, onComplete = null) {
    if (this.casting || this.dead) return false;
    this.#clearTarget();
    this.wantsWalk = false;
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
      this.#updateWalkBlend(dt);
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
      this.wantsWalk = this.moving;
      this.moving = this.wantsWalk || this.walkBlend > 0.06;

      if (this.wantsWalk && this.walkBlend > 0.02) {
        this._speedMul = this.#slopeSpeedMul(this._move) * this.#waterSpeedMul();
        const step = CONFIG.wizardSpeed * this._speedMul * this.walkBlend * dt;
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
      } else if (!this.wantsWalk) {
        this._speedMul = 1;
      }
    } else {
      this.wantsWalk = false;
      this.moving = false;
      this._speedMul = 1;
      this.castT += dt;
      if (this.castT >= this.castDuration) this.#endCast();
    }

    // Drž nohy na povrchu (morph pod ním)
    this.mesh.position.copy(this.dir).multiplyScalar(this.#height(this.dir));
    this.#applyDrowning(dt);

    this.#applyPose();
    this.#updateWalkBlend(dt);
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

  /** Plynulý rozjezd / dojezd chůze (0 = stojí, 1 = plná chůze). */
  #updateWalkBlend(dt) {
    const target = this.casting || this.dead ? 0 : (this.wantsWalk ? 1 : 0);
    const rate = target > this.walkBlend ? 3.2 : 5;
    this.walkBlend += (target - this.walkBlend) * Math.min(1, dt * rate);
    if (this.walkBlend < 0.003 && target === 0) this.walkBlend = 0;
  }

  #animate(dt) {
    const parts = this.mesh.userData.parts;
    if (!parts) return;

    if (this.casting) {
      const t = this.castT;
      const pulse = 0.5 + 0.5 * Math.sin(t * 10);
      const circle = t * 2.4;

      // Pravá ruka nahoře, lehké kroužení
      parts.rightArm.rotation.x = -1.35 + Math.sin(t * 1.6) * 0.06;
      parts.rightArm.rotation.y = Math.sin(circle) * 0.32;
      parts.rightArm.rotation.z = -0.35 + Math.cos(circle) * 0.22;
      parts.leftArm.rotation.x = -0.4;
      parts.leftArm.rotation.z = 0.2;
      parts.leftLeg.rotation.x = 0;
      parts.rightLeg.rotation.x = 0;
      if (parts.body) parts.body.position.y = 0;

      if (parts.magicMats) {
        parts.magicMats[0].emissiveIntensity = 0.55 + pulse * 1.2;
        parts.magicMats[1].emissiveIntensity = 0.75 + pulse * 1.6;
      }

      if (parts.castFx) {
        if (parts.handRing) {
          parts.handRing.rotation.z = t * 4.5;
          parts.handRing.scale.setScalar(0.9 + pulse * 0.25);
          if (parts.ringMat) parts.ringMat.opacity = 0.3 + pulse * 0.45;
        }
        if (parts.sparks) {
          const n = parts.sparks.length;
          for (let i = 0; i < n; i++) {
            const sp = parts.sparks[i];
            const a = circle * 1.2 + (i / n) * Math.PI * 2;
            const r = 0.12 + 0.06 * Math.sin(t * 5 + i);
            sp.position.set(Math.cos(a) * r, Math.sin(t * 3 + i) * 0.06, Math.sin(a) * r);
            sp.scale.setScalar(0.7 + pulse * 0.5);
            if (sp.material) sp.material.opacity = 0.35 + pulse * 0.5;
          }
        }
      }
      return;
    }

    parts.rightArm.rotation.set(0, 0, 0);
    parts.leftArm.rotation.set(0, 0, 0);
    parts.leftLeg.rotation.set(0, 0, 0);
    parts.rightLeg.rotation.set(0, 0, 0);
    if (parts.body) parts.body.position.y = 0;

    const b = this.walkBlend;
    if (b < 0.001) return;

    this.walkPhase += dt * (5.5 + 4.2 * this._speedMul) * (0.35 + 0.65 * b);
    const amp = (0.58 + 0.34 * this._speedMul) * b;
    const s = Math.sin(this.walkPhase) * amp;
    const lift = 0.22 * b;

    parts.leftLeg.rotation.x = s + Math.max(0, s) * lift;
    parts.rightLeg.rotation.x = -s + Math.max(0, -s) * lift;
    parts.leftLeg.rotation.z = s * 0.12;
    parts.rightLeg.rotation.z = -s * 0.12;

    parts.leftArm.rotation.x = -s * 0.8;
    parts.rightArm.rotation.x = s * 0.65;
    parts.leftArm.rotation.z = s * 0.2;
    parts.rightArm.rotation.z = -s * 0.16;

    if (parts.body) {
      parts.body.position.y = Math.abs(Math.sin(this.walkPhase * 2)) * 0.04 * b;
    }
  }
}
