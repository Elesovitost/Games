import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tmp, disposeObject } from "./utils.js";
import { applyRadialDamage, COMBAT } from "./combat.js";
import { isSurfaceDirVisible } from "./visibility.js";

const Y_UP = new THREE.Vector3(0, 1, 0);

function createDragonModel() {
  const g = new THREE.Group();
  const hide = new THREE.MeshStandardMaterial({
    color: 0x8b1a12,
    emissive: 0x3a0804,
    emissiveIntensity: 0.35,
    roughness: 0.55,
    metalness: 0.12,
    flatShading: true
  });
  const hideDark = new THREE.MeshStandardMaterial({
    color: 0x5a100c,
    emissive: 0x2a0402,
    emissiveIntensity: 0.25,
    roughness: 0.6,
    flatShading: true
  });
  const belly = new THREE.MeshStandardMaterial({
    color: 0xc48a48,
    roughness: 0.7,
    flatShading: true
  });
  const membrane = new THREE.MeshStandardMaterial({
    color: 0x6a1420,
    emissive: 0x2a0610,
    emissiveIntensity: 0.2,
    roughness: 0.75,
    flatShading: true,
    side: THREE.DoubleSide
  });
  const claw = new THREE.MeshStandardMaterial({
    color: 0xe8d090,
    roughness: 0.4,
    metalness: 0.25,
    flatShading: true
  });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 9, 7), hide);
  body.scale.set(0.72, 0.7, 1.85);
  g.add(body);
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.14, 7, 6), belly);
  chest.scale.set(0.7, 0.55, 1.2);
  chest.position.set(0, -0.06, -0.08);
  g.add(chest);

  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.1 + i * 0.01, 4), hideDark);
    sp.position.set(0, 0.14, -0.25 + i * 0.14);
    sp.rotation.x = 0.15;
    g.add(sp);
  }

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.32, 6), hide);
  neck.rotation.x = Math.PI / 2 + 0.35;
  neck.position.set(0, 0.08, -0.42);
  g.add(neck);

  const head = new THREE.Group();
  head.position.set(0, 0.16, -0.58);
  g.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), hide);
  skull.scale.set(0.85, 0.75, 1.15);
  head.add(skull);
  const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.22, 5), hide);
  jaw.rotation.x = -Math.PI / 2;
  jaw.position.set(0, -0.02, -0.16);
  head.add(jaw);
  const lower = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), belly);
  lower.rotation.x = -Math.PI / 2 + 0.25;
  lower.position.set(0, -0.05, -0.12);
  head.add(lower);

  const hornL = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.16, 4), claw);
  hornL.position.set(0.055, 0.1, 0.02);
  hornL.rotation.set(-0.7, 0, 0.25);
  head.add(hornL);
  const hornR = hornL.clone();
  hornR.position.x = -0.055;
  hornR.rotation.z = -0.25;
  head.add(hornR);
  const hornL2 = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.09, 4), claw);
  hornL2.position.set(0.08, 0.04, 0);
  hornL2.rotation.set(-0.4, 0.5, 0.6);
  head.add(hornL2);
  const hornR2 = hornL2.clone();
  hornR2.position.x = -0.08;
  hornR2.rotation.y = -0.5;
  hornR2.rotation.z = -0.6;
  head.add(hornR2);

  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffcc33 });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 5), eyeMat);
  eyeL.position.set(0.065, 0.04, -0.1);
  head.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = -0.065;
  head.add(eyeR);

  /** 3 segmenty: rameno → předloktí → tip + blány */
  function makeWing(side) {
    const s = side;
    const root = new THREE.Group();
    root.position.set(s * 0.1, 0.1, 0.02);

    const seg0 = new THREE.Group();
    root.add(seg0);
    const bone0 = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.016, 0.38, 5), hideDark);
    bone0.rotation.z = s * Math.PI / 2;
    bone0.position.set(s * 0.19, 0, 0);
    seg0.add(bone0);
    const mem0 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.01, 0.4), membrane);
    mem0.position.set(s * 0.2, -0.02, 0.06);
    mem0.rotation.y = s * 0.12;
    seg0.add(mem0);

    const seg1 = new THREE.Group();
    seg1.position.set(s * 0.38, 0, 0.02);
    seg0.add(seg1);
    const bone1 = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.012, 0.34, 5), hideDark);
    bone1.rotation.z = s * Math.PI / 2;
    bone1.position.set(s * 0.17, 0, 0);
    seg1.add(bone1);
    const mem1 = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.01, 0.34), membrane);
    mem1.position.set(s * 0.17, -0.025, 0.1);
    mem1.rotation.y = s * 0.28;
    seg1.add(mem1);

    const seg2 = new THREE.Group();
    seg2.position.set(s * 0.34, 0, 0.04);
    seg1.add(seg2);
    const bone2 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.006, 0.28, 4), hideDark);
    bone2.rotation.z = s * Math.PI / 2;
    bone2.position.set(s * 0.14, 0, 0);
    seg2.add(bone2);
    const mem2 = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.008, 0.26), membrane);
    mem2.position.set(s * 0.12, -0.02, 0.12);
    mem2.rotation.y = s * 0.4;
    seg2.add(mem2);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 4), hideDark);
    tip.rotation.z = s * -Math.PI / 2;
    tip.position.set(s * 0.28, 0, 0.08);
    seg2.add(tip);

    root.userData.segs = [seg0, seg1, seg2];
    return root;
  }

  const wingL = makeWing(1);
  const wingR = makeWing(-1);
  g.add(wingL);
  g.add(wingR);

  function makeLeg(x) {
    const leg = new THREE.Group();
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.16, 5), hide);
    thigh.position.y = -0.08;
    thigh.rotation.x = 0.5;
    leg.add(thigh);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), hideDark);
    foot.position.set(0, -0.16, 0.04);
    foot.scale.set(1, 0.6, 1.3);
    leg.add(foot);
    leg.position.set(x, -0.08, 0.05);
    return leg;
  }
  g.add(makeLeg(0.1));
  g.add(makeLeg(-0.1));

  const tailRoot = new THREE.Group();
  tailRoot.position.set(0, 0.02, 0.32);
  g.add(tailRoot);
  const tail1 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.045, 0.35, 6), hide);
  tail1.rotation.x = Math.PI / 2;
  tail1.position.z = 0.18;
  tailRoot.add(tail1);
  const tail2 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.02, 0.32, 5), hide);
  tail2.rotation.x = Math.PI / 2 + 0.2;
  tail2.position.set(0, -0.03, 0.48);
  tailRoot.add(tail2);
  const tailFin = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 4), hideDark);
  tailFin.rotation.x = Math.PI / 2;
  tailFin.position.set(0, -0.05, 0.68);
  tailRoot.add(tailFin);

  // Persistentní paprsek tlama → zem (aktualizuje se při chrlění)
  const beam = new THREE.Group();
  beam.visible = false;
  const beamCols = [0xfff6c8, 0xffaa33, 0xff5510];
  for (let i = 0; i < 3; i++) {
    const jet = new THREE.Mesh(
      new THREE.ConeGeometry(0.06 + i * 0.05, 1, 7),
      new THREE.MeshBasicMaterial({
        color: beamCols[i],
        transparent: true,
        opacity: 0.8 - i * 0.18,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false
      })
    );
    jet.geometry.translate(0, 0.5, 0);
    beam.add(jet);
  }
  const muzzleGlow = new THREE.PointLight(0xff6611, 0, 10);
  head.add(muzzleGlow);
  // beam žije v planetGroup (world/local), držíme ref
  g.userData.beam = beam;
  g.userData.muzzleGlow = muzzleGlow;
  g.userData.mouthLocal = new THREE.Vector3(0, 0.12, -0.82);
  g.userData.fireRoot = beam; // kompatibilita
  g.userData.wingL = wingL;
  g.userData.wingR = wingR;
  g.userData.tailRoot = tailRoot;
  g.userData.head = head;

  g.traverse((ch) => {
    if (ch.isMesh && ch.material && ch.material.isMeshStandardMaterial) {
      ch.castShadow = true;
      ch.receiveShadow = true;
    }
  });
  return g;
}

function flapWing(wing, side, flap, elapsed) {
  if (!wing?.userData?.segs) return;
  const [a, b, c] = wing.userData.segs;
  const s = side;
  // Elegantní vlna přes 3 segmenty
  const f0 = flap;
  const f1 = Math.sin(elapsed * 5.2 + 0.7) * 0.35;
  const f2 = Math.sin(elapsed * 5.2 + 1.4) * 0.28;
  wing.rotation.z = s * (0.2 + f0 * 0.55);
  wing.rotation.x = f0 * 0.08;
  a.rotation.z = s * f0 * 0.15;
  b.rotation.z = s * (0.12 + f1 * 0.5);
  b.rotation.y = s * f0 * 0.08;
  c.rotation.z = s * (0.18 + f2 * 0.55);
}

export class Dragons {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  spawn(localPos, opts = {}) {
    const mesh = createDragonModel();
    this.game.planetGroup.add(mesh);
    this.game.planetGroup.add(mesh.userData.beam);

    const spawnDir = localPos.clone().normalize();
    const tangent = new THREE.Vector3();
    if (Math.abs(spawnDir.y) < 0.9) tangent.set(0, 1, 0).cross(spawnDir).normalize();
    else tangent.set(1, 0, 0).cross(spawnDir).normalize();
    let s = opts.seed != null ? opts.seed >>> 0 : (Math.random() * 0xffffffff) >>> 0;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const orbit = CONFIG.dragonOrbit * (0.9 + rnd() * 0.2);
    this.list.push({
      mesh,
      spawnDir,
      tangent,
      angle: rnd() * Math.PI * 2,
      speed: CONFIG.dragonSpeed * (0.94 + rnd() * 0.12),
      orbit,
      wobble: rnd() * Math.PI * 2,
      // Cyklus 2 s oheň / 3 s pauza
      breathOn: true,
      breathTimer: CONFIG.dragonBreathOn * (0.4 + rnd() * 0.3),
      scorchAcc: 0,
      damageAcc: 0,
      bank: 0,
      age: 0,
      life: CONFIG.dragonLife,
      baseScale: CONFIG.dragonScale || 2,
      _from: new THREE.Vector3(),
      _to: new THREE.Vector3(),
      _dir: new THREE.Vector3()
    });
  }

  clear() {
    for (const d of this.list) {
      if (d.mesh.userData.beam) {
        this.game.planetGroup.remove(d.mesh.userData.beam);
        disposeObject(d.mesh.userData.beam);
      }
      this.game.planetGroup.remove(d.mesh);
      disposeObject(d.mesh);
    }
    this.list.length = 0;
  }

  update(dt, elapsed) {
    const { terrain, planetGroup } = this.game;
    const breathOnDur = CONFIG.dragonBreathOn || 2;
    const breathOffDur = CONFIG.dragonBreathOff || 3;
    const scorchR = CONFIG.dragonScorchRadius || 0.7;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.age += dt;
      if (d.age >= d.life) {
        if (d.mesh.userData.beam) {
          planetGroup.remove(d.mesh.userData.beam);
          disposeObject(d.mesh.userData.beam);
        }
        planetGroup.remove(d.mesh);
        disposeObject(d.mesh);
        this.list.splice(i, 1);
        continue;
      }

      d.wobble += dt;
      const prevAngle = d.angle;
      d.angle += dt * d.speed;

      // Elegantní dráha: pomalejší výškové vlny + mírný bank
      tmp.dir.copy(d.spawnDir).applyAxisAngle(d.tangent, d.orbit);
      tmp.dir.applyAxisAngle(d.spawnDir, d.angle).normalize();
      const glide = Math.sin(d.wobble * 0.7) * 0.35 + Math.sin(d.wobble * 1.3) * 0.12;
      const alt = terrain.height(tmp.dir) + CONFIG.dragonAlt + glide;
      d.mesh.position.copy(tmp.dir).multiplyScalar(alt);

      // Look-ahead dál vpřed → plynulejší směr
      tmp.dir2.copy(d.spawnDir).applyAxisAngle(d.tangent, d.orbit);
      tmp.dir2.applyAxisAngle(d.spawnDir, d.angle + 0.28).normalize();
      tmp.center.copy(tmp.dir2).multiplyScalar(terrain.height(tmp.dir2) + CONFIG.dragonAlt + glide * 0.5);
      d.mesh.up.copy(tmp.dir).transformDirection(planetGroup.matrixWorld);
      d.mesh.lookAt(planetGroup.localToWorld(tmp.center));
      d.mesh.rotateY(Math.PI);

      // Bank do zatáčky
      const turn = d.angle - prevAngle;
      d.bank = THREE.MathUtils.lerp(d.bank, -turn * 18, Math.min(1, dt * 4));
      d.mesh.rotateZ(d.bank);

      // --- Dech: 2 s ano / 3 s ne ---
      d.breathTimer -= dt;
      if (d.breathTimer <= 0) {
        d.breathOn = !d.breathOn;
        d.breathTimer = d.breathOn ? breathOnDur : breathOffDur;
        d.scorchAcc = 0;
      }

      const fade = d.age > d.life - 2 ? Math.max(0.05, (d.life - d.age) / 2) : 1;
      d.mesh.scale.setScalar(d.baseScale * fade);

      // Mávání křídel vázané na let
      const flap = Math.sin(elapsed * 5.2) * 0.55;
      flapWing(d.mesh.userData.wingL, 1, flap, elapsed);
      flapWing(d.mesh.userData.wingR, -1, flap, elapsed);
      if (d.mesh.userData.tailRoot) {
        d.mesh.userData.tailRoot.rotation.y = Math.sin(elapsed * 2.1) * 0.22;
        d.mesh.userData.tailRoot.rotation.x = Math.sin(elapsed * 1.6) * 0.1;
      }

      const beam = d.mesh.userData.beam;
      const glow = d.mesh.userData.muzzleGlow;
      const onScreen = isSurfaceDirVisible(this.game.camera, planetGroup, d.mesh.position, 22);

      if (d.breathOn) {
        tmp.dir.copy(d.mesh.position).normalize();
        const gh = terrain.height(tmp.dir);
        d._to.copy(tmp.dir).multiplyScalar(gh + 0.04);

        if (onScreen) {
          d.mesh.updateMatrixWorld(true);
          d._from.copy(d.mesh.userData.mouthLocal).applyMatrix4(d.mesh.matrixWorld);
          planetGroup.worldToLocal(d._from);
          d._dir.copy(d._to).sub(d._from);
          const dist = Math.max(d._dir.length(), 0.5);
          d._dir.multiplyScalar(1 / dist);

          beam.visible = true;
          beam.position.copy(d._from);
          beam.quaternion.setFromUnitVectors(Y_UP, d._dir);
          beam.scale.set(1.1 + Math.sin(elapsed * 20) * 0.15, dist, 1.1 + Math.sin(elapsed * 17) * 0.12);
          if (glow) glow.intensity = 3.5 + Math.sin(elapsed * 22) * 0.8;

          d.scorchAcc += dt;
          if (d.scorchAcc >= 0.09) {
            d.scorchAcc = 0;
            if (terrain.isLand(d._to)) {
              terrain.deform(d._to, "scorch", scorchR);
            }
          }
        } else {
          if (beam) beam.visible = false;
          if (glow) glow.intensity = 0;
        }

        d.damageAcc += dt;
        if (d.damageAcc >= 0.35) {
          d.damageAcc = 0;
          applyRadialDamage(this.game, d._to, COMBAT.dragonBreath.radius * 0.55, COMBAT.dragonBreath.damage * 0.35, { hostOnly: true });
        }
      } else {
        if (beam) beam.visible = false;
        if (glow) glow.intensity = 0;
        d.damageAcc = 0;
      }
    }
  }
}
