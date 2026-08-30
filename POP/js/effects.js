import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tangentFrame, disposeObject, tmp } from "./utils.js";
import { createSurfaceRingMesh, drapeRing, sampleGround } from "./surface.js";
import { isWorldPointVisible } from "./visibility.js";

const Y_UP = new THREE.Vector3(0, 1, 0);
const fireMat = (color, opacity) => new THREE.MeshBasicMaterial({
  color,
  transparent: true,
  opacity,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  fog: false
});

export class Effects {
  constructor(planetGroup, terrain) {
    this.group = planetGroup;
    this.terrain = terrain;
    this.items = [];
  }

  add(item) {
    this.group.add(item.mesh);
    this.items.push(item);
  }

  clear() {
    for (const f of this.items) {
      this.group.remove(f.mesh);
      disposeObject(f.mesh);
    }
    this.items.length = 0;
  }

  cast(localPos, color, scaleMul = 1) {
    const n = localPos.clone().normalize();
    tangentFrame(n, tmp.east, tmp.north);
    const east = tmp.east.clone();
    const north = tmp.north.clone();
    const h = this.terrain.height(n);
    const base = n.clone().multiplyScalar(h + 0.06);
    const qCol = new THREE.Quaternion().setFromUnitVectors(Y_UP, n);
    const group = new THREE.Group();
    const rings = [];
    for (let i = 0; i < 3; i++) {
      const ring = createSurfaceRingMesh(
        new THREE.MeshBasicMaterial({
          color: i === 1 ? 0xfff4c8 : color,
          transparent: true,
          opacity: 0.8 - i * 0.15,
          side: THREE.DoubleSide,
          depthWrite: false,
          fog: false
        }),
        40
      );
      ring.userData.baseScale = scaleMul;
      ring.userData.rIn = (0.12 + i * 0.05) * scaleMul;
      ring.userData.rOut = (0.18 + i * 0.05) * scaleMul;
      drapeRing(ring.geometry, this.terrain, n, east, north, ring.userData.rIn, ring.userData.rOut, 0.07);
      group.add(ring);
      rings.push(ring);
    }
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05 * scaleMul, 0.18 * scaleMul, 2.4 * scaleMul, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false
      })
    );
    column.position.copy(n).multiplyScalar(h + 1.2 * scaleMul);
    column.quaternion.copy(qCol);
    group.add(column);
    const sparks = [];
    const sparkGeo = new THREE.SphereGeometry(0.045 * scaleMul, 6, 5);
    for (let i = 0; i < 7; i++) {
      const spark = new THREE.Mesh(
        sparkGeo,
        new THREE.MeshBasicMaterial({ color: 0xfff6d0, transparent: true, opacity: 0.95, fog: false })
      );
      spark.userData.phase = (i / 7) * Math.PI * 2;
      group.add(spark);
      sparks.push(spark);
    }
    const light = new THREE.PointLight(color, 3.5 * scaleMul, 8);
    light.position.copy(base);
    group.add(light);
    group.userData = { rings, column, sparks, light, up: n, east, north, h0: h, scaleMul };
    this.add({ mesh: group, age: 0, life: 1.15, type: "cast" });
  }

  swampVapors(centerLocal) {
    const group = new THREE.Group();
    const up = centerLocal.clone().normalize();
    tangentFrame(up, tmp.east, tmp.north);
    const east = tmp.east.clone();
    const north = tmp.north.clone();
    for (let i = 0; i < 9; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(1, 7, 6),
        new THREE.MeshBasicMaterial({
          color: 0x6a5a48,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
          fog: false
        })
      );
      puff.userData.up = up.clone();
      puff.userData.base = centerLocal.clone()
        .addScaledVector(east, (Math.random() - 0.5) * CONFIG.swampRadius * 1.4)
        .addScaledVector(north, (Math.random() - 0.5) * CONFIG.swampRadius * 1.4)
        .addScaledVector(up, 0.35 + Math.random() * 0.4);
      puff.userData.phase = Math.random() * Math.PI * 2;
      puff.position.copy(puff.userData.base);
      puff.scale.setScalar(0.22 + Math.random() * 0.18);
      group.add(puff);
    }
    this.add({ mesh: group, age: 0, life: 14, type: "vapor" });
  }

  fireBreath(fromLocal, toLocal, onWater) {
    const from = fromLocal.clone();
    const to = toLocal.clone();
    const dir = to.clone().sub(from);
    const dist = Math.max(dir.length(), 0.2);
    dir.multiplyScalar(1 / dist);
    tangentFrame(dir, tmp.east, tmp.north);
    const east = tmp.east.clone();
    const north = tmp.north.clone();
    const up = to.clone().normalize();
    const group = new THREE.Group();
    const jets = [];
    const jetCols = [0xfff4b0, 0xffaa33, 0xff5510];
    for (let i = 0; i < 3; i++) {
      const jet = new THREE.Mesh(
        new THREE.ConeGeometry(0.09 + i * 0.08, dist * (0.92 - i * 0.04), 7),
        fireMat(jetCols[i], 0.85 - i * 0.18)
      );
      jet.position.copy(from).lerp(to, 0.48);
      jet.quaternion.setFromUnitVectors(Y_UP, dir);
      jet.userData.baseOpacity = jet.material.opacity;
      group.add(jet);
      jets.push(jet);
    }

    const flames = [];
    const flameCols = [0xfff6cc, 0xffcc55, 0xff7718, 0xff3308];
    for (let i = 0; i < 16; i++) {
      const t = (i + 0.4) / 16;
      const flame = new THREE.Mesh(
        new THREE.SphereGeometry(0.07 + t * 0.11, 6, 5),
        fireMat(flameCols[i % flameCols.length], 0.95)
      );
      flame.userData.along = t;
      flame.userData.ox = (Math.random() - 0.5) * 0.22;
      flame.userData.oy = (Math.random() - 0.5) * 0.22;
      flame.userData.phase = Math.random() * Math.PI * 2;
      flame.userData.baseOpacity = 0.95;
      group.add(flame);
      flames.push(flame);
    }

    const embers = [];
    for (let i = 0; i < 14; i++) {
      const ember = new THREE.Mesh(
        new THREE.SphereGeometry(0.018 + Math.random() * 0.02, 5, 4),
        fireMat(Math.random() > 0.4 ? 0xffee88 : 0xff6622, 1)
      );
      ember.userData.along = 0.15 + Math.random() * 0.7;
      ember.userData.ox = (Math.random() - 0.5) * 0.55;
      ember.userData.oy = (Math.random() - 0.5) * 0.55;
      ember.userData.lift = 0.08 + Math.random() * 0.22;
      ember.userData.phase = Math.random() * Math.PI * 2;
      ember.userData.baseOpacity = 1;
      group.add(ember);
      embers.push(ember);
    }

    const bursts = [];
    if (!onWater) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const burst = new THREE.Mesh(
          new THREE.SphereGeometry(0.06, 5, 4),
          fireMat(i % 2 ? 0xffaa33 : 0xffeeaa, 0.95)
        );
        burst.userData.ang = a;
        burst.userData.baseOpacity = 0.95;
        group.add(burst);
        bursts.push(burst);
      }
    }

    const rings = [];
    if (!onWater) {
      for (let i = 0; i < 2; i++) {
        const ring = createSurfaceRingMesh(fireMat(i ? 0xff6610 : 0xffee88, 0.8), 28);
        ring.userData.baseOpacity = 0.8;
        ring.userData.rIn = 0.08 + i * 0.04;
        ring.userData.rOut = 0.16 + i * 0.05;
        drapeRing(ring.geometry, this.terrain, up, east, north, ring.userData.rIn, ring.userData.rOut, 0.06);
        group.add(ring);
        rings.push(ring);
      }
    }

    const light = new THREE.PointLight(0xff6611, 5, 9);
    light.position.copy(from).lerp(to, 0.55);
    group.add(light);
    group.userData = { from, to, dir, east, north, up, jets, flames, embers, bursts, rings, light, onWater, terrain: true };
    this.add({ mesh: group, age: 0, life: 0.72, type: "firebreath" });
  }

  waterSplash(centerLocal) {
    const up = centerLocal.clone().normalize();
    tangentFrame(up, tmp.east, tmp.north);
    const east = tmp.east.clone();
    const north = tmp.north.clone();
    const h = this.terrain.height(up);
    const base = up.clone().multiplyScalar(h + 0.04);
    const group = new THREE.Group();

    const rings = [];
    const ringCols = [0xf4fbff, 0xc8e8f8, 0x9ad0ea];
    for (let i = 0; i < 3; i++) {
      const ring = createSurfaceRingMesh(
        new THREE.MeshBasicMaterial({
          color: ringCols[i],
          transparent: true,
          opacity: 0.85 - i * 0.12,
          side: THREE.DoubleSide,
          depthWrite: false,
          fog: false
        }),
        36
      );
      ring.userData.baseOpacity = ring.material.opacity;
      ring.userData.rIn = 0.1 + i * 0.04;
      ring.userData.rOut = 0.18 + i * 0.05;
      ring.userData.grow = 2.4 + i * 1.6;
      drapeRing(ring.geometry, this.terrain, up, east, north, ring.userData.rIn, ring.userData.rOut, 0.05);
      group.add(ring);
      rings.push(ring);
    }

    const foam = [];
    for (let i = 0; i < 12; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.12 + Math.random() * 0.1, 7, 6),
        new THREE.MeshBasicMaterial({
          color: i % 3 === 0 ? 0xe8f6ff : 0xffffff,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          fog: false
        })
      );
      const a = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
      puff.userData.ox = Math.cos(a) * (0.15 + Math.random() * 0.35);
      puff.userData.oy = Math.sin(a) * (0.15 + Math.random() * 0.35);
      puff.userData.lift = 0.18 + Math.random() * 0.35;
      puff.userData.phase = Math.random() * Math.PI * 2;
      puff.userData.baseOpacity = 0.65 + Math.random() * 0.2;
      group.add(puff);
      foam.push(puff);
    }

    const drops = [];
    for (let i = 0; i < 10; i++) {
      const drop = new THREE.Mesh(
        new THREE.SphereGeometry(0.035 + Math.random() * 0.03, 5, 4),
        new THREE.MeshBasicMaterial({
          color: 0xd8f0ff,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          fog: false
        })
      );
      const a = Math.random() * Math.PI * 2;
      drop.userData.ox = Math.cos(a) * (0.08 + Math.random() * 0.55);
      drop.userData.oy = Math.sin(a) * (0.08 + Math.random() * 0.55);
      drop.userData.lift = 0.45 + Math.random() * 0.7;
      drop.userData.baseOpacity = 0.9;
      group.add(drop);
      drops.push(drop);
    }

    group.userData = { base, up, east, north, rings, foam, drops };
    this.add({ mesh: group, age: 0, life: 1.35, type: "splash" });
  }

  ember(localPos) {
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.03 + Math.random() * 0.025, 5, 4),
      fireMat(Math.random() > 0.45 ? 0xffee88 : 0xff6610, 0.95)
    );
    spark.position.copy(localPos);
    spark.userData.baseOpacity = 0.95;
    this.add({ mesh: spark, age: 0, life: 0.28, type: "ember" });
  }

  fireburst(localPos) {
    const up = localPos.clone().normalize();
    tangentFrame(up, tmp.east, tmp.north);
    const east = tmp.east.clone();
    const north = tmp.north.clone();
    const h = this.terrain.height(up);
    const origin = up.clone().multiplyScalar(h + 0.04);
    const group = new THREE.Group();
    const rings = [];
    for (let i = 0; i < 3; i++) {
      const ring = createSurfaceRingMesh(fireMat(i === 1 ? 0xfff0a0 : 0xff5510, 0.85 - i * 0.15), 32);
      ring.userData.baseOpacity = ring.material.opacity;
      ring.userData.rIn = 0.08 + i * 0.04;
      ring.userData.rOut = 0.16 + i * 0.05;
      ring.userData.grow = 2.6 + i * 1.8;
      drapeRing(ring.geometry, this.terrain, up, east, north, ring.userData.rIn, ring.userData.rOut, 0.06);
      group.add(ring);
      rings.push(ring);
    }
    const bursts = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const burst = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 6, 5),
        fireMat(i % 2 ? 0xffaa33 : 0xfff1b0, 0.95)
      );
      burst.userData.ang = a;
      burst.userData.baseOpacity = 0.95;
      group.add(burst);
      bursts.push(burst);
    }
    const light = new THREE.PointLight(0xff6611, 7, 11);
    light.position.copy(origin).addScaledVector(up, 0.3);
    group.add(light);
    group.userData = { up, east, north, origin, rings, bursts, light };
    this.add({ mesh: group, age: 0, life: 0.62, type: "fireburst" });
  }

  lightning(localPos) {
    const group = new THREE.Group();
    const up = localPos.clone().normalize();
    tangentFrame(up, tmp.east, tmp.north);
    const east = tmp.east.clone();
    const north = tmp.north.clone();
    const h = this.terrain.height(up);
    const ground = up.clone().multiplyScalar(h + 0.04);
    const sky = up.clone().multiplyScalar(h + 16);

    const jaggedPath = (from, to, segs, jitter) => {
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const p = from.clone().lerp(to, t);
        if (i > 0 && i < segs) {
          const amp = jitter * (0.35 + Math.abs(Math.sin(t * Math.PI)));
          p.addScaledVector(east, (Math.random() - 0.5) * amp);
          p.addScaledVector(north, (Math.random() - 0.5) * amp);
        }
        pts.push(p);
      }
      return pts;
    };

    const addBolt = (pts, radius, color, opacity) => {
      const curve = new THREE.CatmullRomCurve3(pts);
      group.add(new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.max(8, pts.length * 2), radius, 5, false),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          fog: false,
          depthWrite: false
        })
      ));
    };

    const main = jaggedPath(sky, ground, 14, 1.15);
    addBolt(main, 0.2, 0x88c8ff, 0.35);
    addBolt(main, 0.07, 0xf7ffff, 1);
    const mid = main[7];
    const forkEnd = mid.clone()
      .addScaledVector(east, 0.9 + Math.random())
      .addScaledVector(north, (Math.random() - 0.5) * 1.2)
      .addScaledVector(up, -2.2);
    addBolt(jaggedPath(mid, forkEnd, 6, 0.55), 0.04, 0xe4f4ff, 0.9);

    const rings = [];
    for (let i = 0; i < 3; i++) {
      const ring = createSurfaceRingMesh(
        new THREE.MeshBasicMaterial({
          color: i === 1 ? 0xffffff : 0x88c8ff,
          transparent: true,
          opacity: 0.9 - i * 0.2,
          side: THREE.DoubleSide,
          depthWrite: false,
          fog: false
        }),
        40
      );
      ring.userData.baseOpacity = ring.material.opacity;
      ring.userData.rIn = 0.15 + i * 0.08;
      ring.userData.rOut = 0.28 + i * 0.1;
      ring.userData.grow = 3.2 + i * 2.4;
      drapeRing(ring.geometry, this.terrain, up, east, north, ring.userData.rIn, ring.userData.rOut, 0.07);
      group.add(ring);
      rings.push(ring);
    }

    const light = new THREE.PointLight(0xb8deff, 12, 28);
    light.position.copy(ground);
    group.add(light);
    group.userData = { light, rings, up, east, north };
    this.add({ mesh: group, light, age: 0, life: 0.84, type: "lightning" });
  }

  update(dt, opts = {}) {
    const camera = opts.camera;
    const skipOff = opts.skipOffscreen && camera;
    const _pos = new THREE.Vector3();
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i];
      if (skipOff) {
        f.mesh.getWorldPosition(_pos);
        if (!isWorldPointVisible(camera, _pos, 10)) {
          f.age += dt;
          if (f.age >= f.life) {
            this.group.remove(f.mesh);
            disposeObject(f.mesh);
            this.items.splice(i, 1);
          }
          continue;
        }
      }
      f.age += dt;
      const u = Math.min(1, f.age / f.life);
      const handlers = {
        lightning: () => this.#updateLightning(f, u),
        firebreath: () => this.#updateFire(f, u),
        fireburst: () => this.#updateBurst(f, u),
        ember: () => this.#fadeGroup(f, u, 0),
        splash: () => this.#updateSplash(f, u),
        cast: () => this.#updateCast(f, u, dt),
        vapor: () => this.#updateVapor(f, u)
      };
      const done = handlers[f.type] ? handlers[f.type]() : this.#updateFallback(f, u);
      if (done) {
        this.group.remove(f.mesh);
        disposeObject(f.mesh);
        this.items.splice(i, 1);
      }
    }
  }

  #fadeGroup(f, u, lightMax) {
    const fade = (1 - u) * (1 - u);
    f.mesh.traverse((ch) => {
      if (ch.material && ch.material.opacity !== undefined) {
        if (ch.userData.baseOpacity === undefined) ch.userData.baseOpacity = ch.material.opacity;
        ch.material.opacity = ch.userData.baseOpacity * fade;
      }
    });
    if (f.light) f.light.intensity = lightMax * fade;
    return u >= 1;
  }

  #updateLightning(f, u) {
    const fade = (1 - u) * (1 - u);
    const ud = f.mesh.userData;
    if (ud.rings) {
      for (let i = 0; i < ud.rings.length; i++) {
        const ring = ud.rings[i];
        const grow = 1 + u * ring.userData.grow;
        drapeRing(
          ring.geometry,
          this.terrain,
          ud.up,
          ud.east,
          ud.north,
          ring.userData.rIn * grow,
          ring.userData.rOut * grow,
          0.07
        );
        ring.material.opacity = ring.userData.baseOpacity * fade;
      }
    }
    f.mesh.traverse((ch) => {
      if (ch.isMesh && ch.material && ch.material.opacity !== undefined && !ud.rings?.includes(ch)) {
        if (ch.userData.baseOpacity === undefined) ch.userData.baseOpacity = ch.material.opacity;
        ch.material.opacity = ch.userData.baseOpacity * fade;
      }
    });
    if (f.light) f.light.intensity = 12 * fade;
    return u >= 1;
  }

  #updateBurst(f, u) {
    const ud = f.mesh.userData;
    const fade = 1 - u;
    if (ud.rings) {
      for (let i = 0; i < ud.rings.length; i++) {
        const ring = ud.rings[i];
        const grow = 1 + u * ring.userData.grow;
        drapeRing(
          ring.geometry,
          this.terrain,
          ud.up,
          ud.east,
          ud.north,
          ring.userData.rIn * grow,
          ring.userData.rOut * grow,
          0.06
        );
        ring.material.opacity = ring.userData.baseOpacity * fade;
      }
    }
    if (ud.bursts) {
      for (let i = 0; i < ud.bursts.length; i++) {
        const b = ud.bursts[i];
        const rad = 0.1 + u * 0.85;
        sampleGround(
          this.terrain,
          ud.up,
          ud.east,
          ud.north,
          Math.cos(b.userData.ang) * rad,
          Math.sin(b.userData.ang) * rad,
          0.1 + u * 0.28,
          tmp.center
        );
        b.position.copy(tmp.center);
        b.scale.setScalar(0.7 + u * 1.5);
        b.material.opacity = b.userData.baseOpacity * fade;
      }
    }
    if (ud.light) ud.light.intensity = 8 * fade;
    return u >= 1;
  }

  #updateFire(f, u) {
    const ud = f.mesh.userData;
    const fade = 1 - u;
    const burst = Math.min(1, f.age / 0.18);
    if (ud.jets) {
      for (let i = 0; i < ud.jets.length; i++) {
        const jet = ud.jets[i];
        const flicker = 0.82 + Math.sin(f.age * 38 + i * 2.1) * 0.18;
        jet.scale.set(flicker * (1 + u * 0.35), burst, flicker * (1 + u * 0.35));
        jet.material.opacity = jet.userData.baseOpacity * fade * (0.7 + 0.3 * Math.sin(f.age * 28 + i));
      }
    }
    if (ud.flames) {
      for (let i = 0; i < ud.flames.length; i++) {
        const fl = ud.flames[i];
        const along = Math.min(1, fl.userData.along + u * 0.55);
        const spread = 0.35 + u * 1.4;
        fl.position.copy(ud.from).lerp(ud.to, along)
          .addScaledVector(ud.east, fl.userData.ox * spread)
          .addScaledVector(ud.north, fl.userData.oy * spread);
        const s = (0.45 + along * 1.4) * (0.8 + Math.sin(f.age * 22 + fl.userData.phase) * 0.25);
        fl.scale.setScalar(s);
        fl.material.opacity = fl.userData.baseOpacity * fade * (0.55 + 0.45 * Math.sin(f.age * 30 + i));
      }
    }
    if (ud.embers) {
      for (let i = 0; i < ud.embers.length; i++) {
        const em = ud.embers[i];
        const along = Math.min(1, em.userData.along + u * 0.8);
        em.position.copy(ud.from).lerp(ud.to, along)
          .addScaledVector(ud.east, em.userData.ox * (0.4 + u * 1.8))
          .addScaledVector(ud.north, em.userData.oy * (0.4 + u * 1.8))
          .addScaledVector(ud.up, em.userData.lift * u);
        em.scale.setScalar(1 + u * 0.6);
        em.material.opacity = em.userData.baseOpacity * fade * fade;
      }
    }
    if (ud.bursts) {
      for (let i = 0; i < ud.bursts.length; i++) {
        const b = ud.bursts[i];
        const rad = 0.12 + u * 0.7;
        sampleGround(
          this.terrain,
          ud.up,
          ud.east,
          ud.north,
          Math.cos(b.userData.ang) * rad,
          Math.sin(b.userData.ang) * rad,
          0.08 + u * 0.22,
          tmp.center
        );
        b.position.copy(tmp.center);
        b.scale.setScalar(0.7 + u * 1.4);
        b.material.opacity = b.userData.baseOpacity * fade;
      }
    }
    if (ud.rings) {
      for (let i = 0; i < ud.rings.length; i++) {
        const ring = ud.rings[i];
        const grow = 1 + u * (3.2 + i * 2.2);
        drapeRing(
          ring.geometry,
          this.terrain,
          ud.up,
          ud.east,
          ud.north,
          ring.userData.rIn * grow,
          ring.userData.rOut * grow,
          0.06
        );
        ring.material.opacity = ring.userData.baseOpacity * fade;
      }
    }
    if (ud.light) ud.light.intensity = 6.5 * fade * (0.7 + 0.3 * Math.sin(f.age * 40));
    return u >= 1;
  }

  #updateSplash(f, u) {
    const ud = f.mesh.userData;
    const fade = u < 0.12 ? u / 0.12 : u > 0.45 ? Math.max(0, (1 - u) / 0.55) : 1;
    if (ud.rings) {
      for (let i = 0; i < ud.rings.length; i++) {
        const ring = ud.rings[i];
        const grow = 1 + u * ring.userData.grow;
        drapeRing(
          ring.geometry,
          this.terrain,
          ud.up,
          ud.east,
          ud.north,
          ring.userData.rIn * grow,
          ring.userData.rOut * grow,
          0.05
        );
        ring.material.opacity = ring.userData.baseOpacity * fade * (1 - u * 0.35);
      }
    }
    if (ud.foam) {
      for (let i = 0; i < ud.foam.length; i++) {
        const puff = ud.foam[i];
        const rise = Math.sin(Math.min(1, u * 1.4) * Math.PI) * puff.userData.lift;
        sampleGround(
          this.terrain,
          ud.up,
          ud.east,
          ud.north,
          puff.userData.ox * (1 + u * 1.6),
          puff.userData.oy * (1 + u * 1.6),
          rise,
          tmp.center
        );
        puff.position.copy(tmp.center);
        puff.scale.setScalar((0.7 + (i % 4) * 0.12) * (1 + u * 1.3));
        puff.material.opacity = puff.userData.baseOpacity * fade;
      }
    }
    if (ud.drops) {
      for (let i = 0; i < ud.drops.length; i++) {
        const drop = ud.drops[i];
        const t = Math.min(1, u * 1.15);
        const arc = t * (1 - t) * 4;
        sampleGround(
          this.terrain,
          ud.up,
          ud.east,
          ud.north,
          drop.userData.ox * t,
          drop.userData.oy * t,
          drop.userData.lift * arc,
          tmp.center
        );
        drop.position.copy(tmp.center);
        drop.material.opacity = drop.userData.baseOpacity * fade;
      }
    }
    return u >= 1;
  }

  #updateCast(f, u, dt) {
    const fade = 1 - u;
    const ud = f.mesh.userData;
    if (ud.rings) {
      for (let r = 0; r < ud.rings.length; r++) {
        const ring = ud.rings[r];
        const grow = 1 + u * (3.5 + r * 1.8);
        drapeRing(
          ring.geometry,
          this.terrain,
          ud.up,
          ud.east,
          ud.north,
          ring.userData.rIn * grow,
          ring.userData.rOut * grow,
          0.07
        );
        ring.material.opacity = (0.75 - r * 0.14) * fade;
      }
    }
    if (ud.column) {
      ud.column.scale.y = 1 + u * 1.6;
      ud.column.material.opacity = 0.35 * fade;
    }
    if (ud.sparks) {
      for (let s = 0; s < ud.sparks.length; s++) {
        const spark = ud.sparks[s];
        const a = spark.userData.phase + f.age * 4;
        const rad = 0.35 + u * 0.7;
        sampleGround(
          this.terrain,
          ud.up,
          ud.east,
          ud.north,
          Math.cos(a) * rad,
          Math.sin(a) * rad,
          0.25 + u * 1.1,
          tmp.center
        );
        spark.position.copy(tmp.center);
        spark.material.opacity = 0.95 * fade;
      }
    }
    if (ud.light) ud.light.intensity = 3.5 * fade;
    return u >= 1;
  }

  #updateVapor(f, u) {
    const fade = u < 0.12 ? u / 0.12 : u > 0.7 ? Math.max(0, (1 - u) / 0.3) : 1;
    for (let p = 0; p < f.mesh.children.length; p++) {
      const puff = f.mesh.children[p];
      const phase = puff.userData.phase + f.age * 0.85;
      puff.position.copy(puff.userData.base)
        .addScaledVector(puff.userData.up, Math.sin(phase) * 0.22 + f.age * 0.07);
      puff.material.opacity = 0.22 * fade * (0.55 + 0.45 * Math.sin(phase * 1.4));
      puff.scale.setScalar((0.22 + (p % 5) * 0.03) * (1 + Math.sin(phase) * 0.2 + u * 0.5));
    }
    return u >= 1;
  }

  #updateFallback(f, u) {
    f.mesh.scale.setScalar(1 + u * 6);
    if (f.mesh.material) f.mesh.material.opacity = Math.max(0, 0.9 * (1 - u));
    return u >= 1;
  }
}
