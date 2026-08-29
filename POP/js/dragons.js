import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tmp, disposeObject } from "./utils.js";

function createDragonModel() {
  const g = new THREE.Group();
  const hide = new THREE.MeshStandardMaterial({
    color: 0xb42810,
    emissive: 0x4a0c04,
    roughness: 0.48,
    flatShading: true
  });
  const belly = new THREE.MeshStandardMaterial({
    color: 0xd4a056,
    roughness: 0.65,
    flatShading: true
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), hide);
  body.scale.set(0.7, 0.62, 1.55);
  g.add(body);
  const under = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), belly);
  under.scale.set(0.65, 0.45, 1.25);
  under.position.y = -0.05;
  g.add(under);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), hide);
  head.position.set(0, 0.07, -0.36);
  g.add(head);
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 5), hide);
  snout.rotation.x = -Math.PI / 2;
  snout.position.set(0, 0.03, -0.5);
  g.add(snout);
  const hornL = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12, 4), hide);
  hornL.position.set(0.05, 0.16, -0.32);
  hornL.rotation.x = -0.5;
  g.add(hornL);
  const hornR = hornL.clone();
  hornR.position.x = -0.05;
  g.add(hornR);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffee66 });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4), eyeMat);
  eyeL.position.set(0.06, 0.1, -0.44);
  g.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = -0.06;
  g.add(eyeR);
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.035, 0.38), hide);
  wingL.position.set(0.32, 0.12, 0.02);
  wingL.rotation.y = 0.25;
  g.add(wingL);
  const wingR = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.035, 0.38), hide);
  wingR.position.set(-0.32, 0.12, 0.02);
  wingR.rotation.y = -0.25;
  g.add(wingR);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.55, 5), hide);
  tail.position.set(0, 0.02, 0.52);
  tail.rotation.x = Math.PI / 2;
  g.add(tail);

  const fireRoot = new THREE.Group();
  fireRoot.position.set(0, 0.02, -0.62);
  fireRoot.visible = false;
  const fireCols = [0xfff6c8, 0xffcc44, 0xff7a18, 0xff3300, 0xaa1100];
  for (let i = 0; i < fireCols.length; i++) {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.04 + i * 0.028, 0.28 + i * 0.14, 6),
      new THREE.MeshBasicMaterial({
        color: fireCols[i],
        transparent: true,
        opacity: 0.92 - i * 0.12,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false
      })
    );
    flame.rotation.x = -Math.PI / 2;
    flame.position.z = -0.08 - i * 0.09;
    fireRoot.add(flame);
  }
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshBasicMaterial({
      color: 0xffeeaa,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    })
  );
  fireRoot.add(glow);
  fireRoot.add(new THREE.PointLight(0xff6611, 3.4, 7));
  g.add(fireRoot);
  g.userData.fireRoot = fireRoot;
  g.userData.wingL = wingL;
  g.userData.wingR = wingR;
  g.traverse((ch) => {
    if (ch.isMesh && ch.material && ch.material.isMeshStandardMaterial) {
      ch.castShadow = true;
      ch.receiveShadow = true;
    }
  });
  return g;
}

export class Dragons {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  spawn(localPos, opts = {}) {
    const mesh = createDragonModel();
    this.game.planetGroup.add(mesh);
    const spawnDir = localPos.clone().normalize();
    const tangent = new THREE.Vector3();
    if (Math.abs(spawnDir.y) < 0.9) tangent.set(0, 1, 0).cross(spawnDir).normalize();
    else tangent.set(1, 0, 0).cross(spawnDir).normalize();
    let s = opts.seed != null ? opts.seed >>> 0 : (Math.random() * 0xffffffff) >>> 0;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const orbit = CONFIG.dragonOrbit * (0.88 + rnd() * 0.24);
    this.list.push({
      mesh,
      spawnDir,
      tangent,
      angle: rnd() * Math.PI * 2,
      speed: CONFIG.dragonSpeed * (0.92 + rnd() * 0.16),
      orbit,
      wobble: rnd() * Math.PI * 2,
      breathIn: 1.6 + rnd() * 0.8,
      breathGap: 2.8 + rnd() * 0.5,
      breathing: 0,
      age: 0,
      life: CONFIG.dragonLife
    });
  }

  clear() {
    for (const d of this.list) {
      this.game.planetGroup.remove(d.mesh);
      disposeObject(d.mesh);
    }
    this.list.length = 0;
  }

  update(dt, elapsed) {
    const { terrain, effects, planetGroup } = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.age += dt;
      if (d.age >= d.life) {
        planetGroup.remove(d.mesh);
        disposeObject(d.mesh);
        this.list.splice(i, 1);
        continue;
      }
      d.wobble += dt;
      d.angle += dt * d.speed;

      tmp.dir.copy(d.spawnDir).applyAxisAngle(d.tangent, d.orbit);
      tmp.dir.applyAxisAngle(d.spawnDir, d.angle).normalize();
      const alt = terrain.height(tmp.dir) + CONFIG.dragonAlt + Math.sin(d.wobble * 1.4) * 0.12;
      d.mesh.position.copy(tmp.dir).multiplyScalar(alt);

      tmp.dir2.copy(d.spawnDir).applyAxisAngle(d.tangent, d.orbit);
      tmp.dir2.applyAxisAngle(d.spawnDir, d.angle + 0.18).normalize();
      tmp.center.copy(tmp.dir2).multiplyScalar(terrain.height(tmp.dir2) + CONFIG.dragonAlt);
      d.mesh.up.copy(tmp.dir).transformDirection(planetGroup.matrixWorld);
      d.mesh.lookAt(planetGroup.localToWorld(tmp.center));
      d.mesh.rotateY(Math.PI);

      d.breathIn -= dt;
      if (d.breathIn <= 0) {
        d.breathIn = d.breathGap || 3.0;
        d.breathing = 0.7;
        d.mesh.updateMatrix();
        const fireRoot = d.mesh.userData.fireRoot;
        tmp.peek.copy(fireRoot.position).applyMatrix4(d.mesh.matrix);
        const gh = terrain.height(tmp.dir);
        tmp.center.copy(tmp.dir).multiplyScalar(gh + 0.05);
        const onWater = !terrain.isLand(tmp.center);
        effects.fireBreath(tmp.peek, tmp.center, onWater);
        if (onWater) effects.waterSplash(tmp.center);
        else terrain.deform(tmp.center, "scorch", CONFIG.scorchRadius);
      }
      d.breathing = Math.max(0, d.breathing - dt);

      const fade = d.age > d.life - 2 ? Math.max(0.05, (d.life - d.age) / 2) : 1;
      d.mesh.scale.setScalar(fade);
      const flap = Math.sin(elapsed * 9) * 0.38;
      if (d.mesh.userData.wingL) d.mesh.userData.wingL.rotation.z = 0.28 + flap;
      if (d.mesh.userData.wingR) d.mesh.userData.wingR.rotation.z = -0.28 - flap;
      const fireRoot = d.mesh.userData.fireRoot;
      if (fireRoot) {
        fireRoot.visible = d.breathing > 0;
        fireRoot.children.forEach((ch, idx) => {
          if (!ch.material || ch.material.opacity === undefined) {
            if (ch.isLight) ch.intensity = d.breathing > 0 ? 4.2 : 0;
            return;
          }
          const s = 0.85 + Math.sin(elapsed * 26 + idx * 1.7) * 0.32;
          ch.scale.set(s, 1.1 + Math.sin(elapsed * 22 + idx) * 0.4, s);
          if (ch.userData.baseOpacity === undefined) ch.userData.baseOpacity = ch.material.opacity;
          ch.material.opacity = ch.userData.baseOpacity * (0.6 + 0.4 * Math.sin(elapsed * 18 + idx)) * fade;
        });
      }
    }
  }
}
