import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tmp, disposeObject } from "./utils.js";
import { applyRadialDamage, COMBAT } from "./combat.js";
import { isObjectVisible } from "./visibility.js";

function createFireballModel() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 10, 8),
    new THREE.MeshBasicMaterial({
      color: 0xfff4b0,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    })
  );
  g.add(core);
  const mid = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 10, 8),
    new THREE.MeshBasicMaterial({
      color: 0xff7718,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    })
  );
  g.add(mid);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 10, 8),
    new THREE.MeshBasicMaterial({
      color: 0xff3308,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    })
  );
  g.add(halo);
  g.add(new THREE.PointLight(0xff6611, 4.5, 8));
  core.castShadow = true;
  mid.castShadow = true;
  g.userData.core = core;
  g.userData.mid = mid;
  g.userData.halo = halo;
  return g;
}

export class Fireballs {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  launch(fromDir, toLocal) {
    const mesh = createFireballModel();
    this.game.planetGroup.add(mesh);
    const up = fromDir.clone().normalize();
    const h = this.game.terrain.height(up);
    const start = up.clone().multiplyScalar(h).addScaledVector(up, CONFIG.wizardHeight * 0.62);
    const end = toLocal.clone();
    mesh.position.copy(start);
    this.list.push({
      mesh,
      start,
      end,
      travel: 0,
      dist: Math.max(start.distanceTo(end), 0.08),
      spark: 0
    });
  }

  clear() {
    for (const b of this.list) {
      this.game.planetGroup.remove(b.mesh);
      disposeObject(b.mesh);
    }
    this.list.length = 0;
  }

  update(dt, elapsed, opts = {}) {
    const { terrain, effects, planetGroup } = this.game;
    const camera = this.game.camera;
    const skipVis = opts.skipOffscreen && camera;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      const onScreen = !skipVis || isObjectVisible(camera, b.mesh, 12);
      const move = CONFIG.fireballSpeed * dt;
      const steps = Math.max(1, Math.ceil(move / 0.1));
      const step = move / steps;
      let hit = null;
      for (let s = 0; s < steps; s++) {
        b.travel = Math.min(b.dist, b.travel + step);
        const t = b.travel / b.dist;
        tmp.dir.lerpVectors(b.start, b.end, t);
        const r = tmp.dir.length();
        const h = terrain.height(tmp.dir);
        const onLine = t > 0.05 && h >= r - 0.1;
        if (onLine || t >= 1) {
          tmp.center.copy(tmp.dir).normalize().multiplyScalar(h + 0.04);
          hit = { water: !terrain.isLand(tmp.center) };
          break;
        }
      }

      if (hit) {
        const pos = tmp.center.clone();
        if (hit.water) effects.waterSplash(pos);
        else {
          effects.fireburst(pos);
          terrain.deform(pos, "scorch", CONFIG.scorchRadius);
        }
        applyRadialDamage(this.game, pos, COMBAT.fireball.radius, COMBAT.fireball.damage);
        planetGroup.remove(b.mesh);
        disposeObject(b.mesh);
        this.list.splice(i, 1);
        continue;
      }

      const t = b.travel / b.dist;
      b.mesh.position.lerpVectors(b.start, b.end, t);
      if (onScreen) {
        const flicker = 0.88 + Math.sin(elapsed * 28 + t * 12) * 0.14;
        b.mesh.scale.setScalar(flicker);
        if (b.mesh.userData.core) {
          b.mesh.userData.core.scale.setScalar(0.9 + Math.sin(elapsed * 36) * 0.18);
        }
        b.spark -= dt;
        if (b.spark <= 0) {
          b.spark = 0.045;
          effects.ember(b.mesh.position);
        }
      }
    }
  }
}
