import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tangentFrame } from "./utils.js";

export const SPAWN_ZONE_RADIUS = 2;
const RING_RADIUS = SPAWN_ZONE_RADIUS;
const MUSHROOM_COUNT = 14;
const SURFACE_LIFT = 0.02;
const POOL_RADIUS = 0.38;

function makeMushroom(glowColor) {
  const g = new THREE.Group();

  const stemMat = new THREE.MeshStandardMaterial({
    color: 0xe8e0d0,
    roughness: 0.85,
    metalness: 0.02
  });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.28, 8), stemMat);
  stem.position.y = 0.14;

  const capMat = new THREE.MeshStandardMaterial({
    color: 0xc45a8c,
    emissive: glowColor,
    emissiveIntensity: 0.55,
    roughness: 0.55,
    metalness: 0.05
  });
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), capMat);
  cap.scale.set(1, 0.55, 1);
  cap.position.y = 0.34;

  const spotMat = new THREE.MeshBasicMaterial({
    color: 0xfff0d0,
    transparent: true,
    opacity: 0.85
  });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), spotMat);
    spot.position.set(Math.cos(a) * 0.1, 0.38, Math.sin(a) * 0.08);
    g.add(spot);
  }

  const poolMat = new THREE.MeshBasicMaterial({
    color: glowColor,
    transparent: true,
    opacity: 0.08,
    depthWrite: false
  });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(POOL_RADIUS, 12), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.012;
  pool.renderOrder = 1;
  g.add(pool);

  g.add(stem, cap);
  g.userData.capMat = capMat;
  g.userData.poolMat = poolMat;
  return g;
}

/** Světélkující kruh hub (r = 2 m) na spawn pointu — sleduje aktuální povrch. */
export class SpawnMarkers {
  constructor(planetGroup, terrain, spawnDirs) {
    this.planetGroup = planetGroup;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.planetGroup.add(this.group);
    /** @type {{ mush: THREE.Group, ringDir: THREE.Vector3, angle: number, scale: number }[]} */
    this.entries = [];
    this.t = 0;

    this._east = new THREE.Vector3();
    this._north = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._mushDir = new THREE.Vector3();
    this._p0 = new THREE.Vector3();
    this._pE = new THREE.Vector3();
    this._pN = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._yUp = new THREE.Vector3(0, 1, 0);
    this.spawnCenters = spawnDirs.map((d) =>
      new THREE.Vector3(d[0], d[1], d[2]).normalize()
    );

    const colors = [0x66ffc8, 0xa8f0ff, 0xffd080, 0xe8a0ff];
    for (let s = 0; s < spawnDirs.length; s++) {
      this.#buildRing(spawnDirs[s], colors[s % colors.length]);
    }
    this.refresh();
  }

  #buildRing(spawnArr, glowColor) {
    this._dir.fromArray(spawnArr).normalize();
    for (let i = 0; i < MUSHROOM_COUNT; i++) {
      const angle = (i / MUSHROOM_COUNT) * Math.PI * 2;
      const mush = makeMushroom(glowColor);
      mush.scale.setScalar(0.85 + (i % 3) * 0.12);
      this.group.add(mush);
      this.entries.push({
        mush,
        ringDir: this._dir.clone(),
        angle,
        scale: mush.scale.x
      });
    }
  }

  /** Směr + normála povrchu v bodě (local dir). */
  #surfaceAt(dir, outPos, outNormal) {
    const h = this.terrain.height(dir);
    this._p0.copy(dir).multiplyScalar(h);

    tangentFrame(dir, this._east, this._north);
    const eps = 0.035;
    this._tmp.copy(dir).addScaledVector(this._east, eps).normalize();
    this._pE.copy(this._tmp).multiplyScalar(this.terrain.height(this._tmp));
    this._tmp2.copy(dir).addScaledVector(this._north, eps).normalize();
    this._pN.copy(this._tmp2).multiplyScalar(this.terrain.height(this._tmp2));

    outNormal.crossVectors(this._pE.sub(this._p0), this._pN.sub(this._p0));
    if (outNormal.lengthSq() < 1e-10) outNormal.copy(dir);
    else outNormal.normalize();
    if (outNormal.dot(dir) < 0) outNormal.negate();

    outPos.copy(this._p0);
  }

  #placeEntry(entry) {
    const { mush, ringDir, angle, scale } = entry;
    tangentFrame(ringDir, this._east, this._north);
    const ox = Math.cos(angle) * RING_RADIUS;
    const oy = Math.sin(angle) * RING_RADIUS;
    const hCenter = this.terrain.height(ringDir);
    this._mushDir
      .copy(ringDir)
      .multiplyScalar(hCenter)
      .addScaledVector(this._east, ox)
      .addScaledVector(this._north, oy)
      .normalize();

    this.#surfaceAt(this._mushDir, this._p0, this._n);
    mush.position.copy(this._p0).addScaledVector(this._n, SURFACE_LIFT);
    mush.quaternion.setFromUnitVectors(this._yUp, this._n);
    mush.scale.setScalar(scale);
  }

  /** Je kouzelník uvnitř některého spawn kruhu? */
  isInSpawnZone(wizardDir) {
    this._dir.copy(wizardDir).normalize();
    for (const center of this.spawnCenters) {
      const dot = Math.min(1, Math.max(-1, this._dir.dot(center)));
      if (Math.acos(dot) * CONFIG.planetR <= SPAWN_ZONE_RADIUS) return true;
    }
    return false;
  }

  /** Přepočítá pozice hub podle aktuálního terénu (po morphu / resetu). */
  refresh() {
    for (const entry of this.entries) this.#placeEntry(entry);
  }

  /** Jen pulz emissive — pozice se mění jen přes refresh(). */
  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;

    const wave = 0.5 + 0.5 * Math.sin(this.t * 2.4);
    for (let i = 0; i < this.entries.length; i++) {
      const cap = this.entries[i].mush.userData.capMat;
      const pool = this.entries[i].mush.userData.poolMat;
      const phase = Math.sin(this.t * 2.4 + i * 0.55);
      const flicker = 0.5 + 0.5 * phase;
      const mix = wave * 0.65 + flicker * 0.35;

      if (cap) cap.emissiveIntensity = 0.28 + mix * 0.38;
      if (pool) pool.opacity = 0.03 + mix * 0.1;
    }
  }

  hide() {
    this.group.visible = false;
  }

  show() {
    this.group.visible = true;
  }
}
