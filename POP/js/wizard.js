import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { slerpDirection, tangentFrame, tmp } from "./utils.js";

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

export class Wizard {
  constructor(game, opts = {}) {
    this.game = game;
    this.id = opts.id || "local";
    this.name = opts.name || "";
    this.color = opts.color != null ? opts.color : 0xc41c12;
    const focus = opts.focus
      ? opts.focus.clone().normalize()
      : new THREE.Vector3(...CONFIG.focusDir).normalize();
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

  dispose() {
    this.game.planetGroup.remove(this.mesh);
    this.mesh.traverse((ch) => {
      if (ch.geometry) ch.geometry.dispose();
      if (ch.material) {
        if (Array.isArray(ch.material)) ch.material.forEach((m) => m.dispose());
        else ch.material.dispose();
      }
    });
  }

  place() {
    const h = this.game.terrain.height(this.dir);
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
  }

  walkTo(localTarget, onWater) {
    if (!this.game.terrain.isLand(localTarget)) {
      onWater();
      return false;
    }
    this.move.from.copy(this.dir);
    this.move.to.copy(localTarget).normalize();
    this.move.ang = Math.max(this.move.from.angleTo(this.move.to), 0.0001);
    this.move.t = 0;
    this.move.active = true;
    return true;
  }

  update(dt, elapsed) {
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

    const ud = this.mesh.userData;
    const walking = this.move.active ? 1 : 0;
    this.gait += dt * (walking ? 11.4 * THREE.MathUtils.clamp(this.walkMul, 0.38, 1.55) : 2.2);
    const gait = this.gait;
    const swing = walking ? 0.72 : 0.08;
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
