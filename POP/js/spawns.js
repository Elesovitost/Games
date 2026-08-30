import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tangentFrame } from "./utils.js";

const RING_RADIUS = 2;
const MUSHROOM_COUNT = 14;

function makeMushroom(glowColor) {
  const g = new THREE.Group();

  const stemMat = new THREE.MeshStandardMaterial({
    color: 0xe8e0d0,
    roughness: 0.85,
    metalness: 0.02
  });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.28, 8), stemMat);
  stem.position.y = 0.14;
  stem.castShadow = true;

  const capMat = new THREE.MeshStandardMaterial({
    color: 0xc45a8c,
    emissive: glowColor,
    emissiveIntensity: 0.55,
    roughness: 0.55,
    metalness: 0.05
  });
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), capMat);
  cap.scale.set(1, 0.55, 1);
  cap.position.y = 0.34;
  cap.castShadow = true;

  const spotMat = new THREE.MeshBasicMaterial({
    color: 0xfff0d0,
    transparent: true,
    opacity: 0.85
  });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), spotMat);
    spot.position.set(Math.cos(a) * 0.1, 0.38, Math.sin(a) * 0.08);
    g.add(spot);
  }

  g.add(stem, cap);
  g.userData.capMat = capMat;
  return g;
}

/** Světélkující kruh hub (r = 2 m) na spawn pointu. */
export class SpawnMarkers {
  constructor(planetGroup, terrain, spawnDirs) {
    this.planetGroup = planetGroup;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.planetGroup.add(this.group);
    this.mushrooms = [];
    this.t = 0;

    this._east = new THREE.Vector3();
    this._north = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._radial = new THREE.Vector3();
    this._yUp = new THREE.Vector3(0, 1, 0);
    this._center = new THREE.Vector3();

    const colors = [0x66ffc8, 0xa8f0ff, 0xffd080, 0xe8a0ff];
    for (let s = 0; s < spawnDirs.length; s++) {
      this.#buildRing(spawnDirs[s], colors[s % colors.length]);
    }
  }

  #buildRing(spawnArr, glowColor) {
    this._dir.fromArray(spawnArr).normalize();
    tangentFrame(this._dir, this._east, this._north);
    const hCenter = this.terrain.height(this._dir);
    this._center.copy(this._dir).multiplyScalar(hCenter);

    for (let i = 0; i < MUSHROOM_COUNT; i++) {
      const a = (i / MUSHROOM_COUNT) * Math.PI * 2;
      const ox = Math.cos(a) * RING_RADIUS;
      const oy = Math.sin(a) * RING_RADIUS;

      this._tmp.copy(this._center)
        .addScaledVector(this._east, ox)
        .addScaledVector(this._north, oy)
        .normalize();

      const h = this.terrain.height(this._tmp);
      // +Y stonku = radiála od středu (stabilní, bez krocení při rotaci planety)
      const mush = makeMushroom(glowColor);
      mush.position.copy(this._tmp).multiplyScalar(h);
      this._radial.copy(this._tmp);
      mush.quaternion.setFromUnitVectors(this._yUp, this._radial);
      mush.scale.setScalar(0.85 + (i % 3) * 0.12);

      this.group.add(mush);
      this.mushrooms.push(mush);
    }
  }

  update(dt) {
    this.t += dt;
    const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.t * 2.8));
    for (let i = 0; i < this.mushrooms.length; i++) {
      const cap = this.mushrooms[i].userData.capMat;
      if (!cap) continue;
      const phase = Math.sin(this.t * 2.8 + i * 0.45);
      cap.emissiveIntensity = pulse * (0.7 + 0.45 * phase);
    }
  }
}
