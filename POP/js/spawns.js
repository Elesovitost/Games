import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tangentFrame, disposeObject, tmp } from "./utils.js";
import { createSurfaceRingMesh, drapeRing } from "./surface.js";
import { getMap } from "./maps.js";
import { GoldenTree } from "./tree.js";

const RUNE_RADIUS = 3.4;
export { RUNE_RADIUS };
const Y_UP = new THREE.Vector3(0, 1, 0);
const _east = new THREE.Vector3();
const _north = new THREE.Vector3();
const _toCenter = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _quat = new THREE.Quaternion();

function createRuneStone() {
  const g = new THREE.Group();
  const rock = new THREE.MeshStandardMaterial({
    color: 0x3a3548,
    roughness: 0.82,
    flatShading: true,
    emissive: 0x1a1028,
    emissiveIntensity: 0.25
  });
  const glow = new THREE.MeshStandardMaterial({
    color: 0xd4b46a,
    emissive: 0xffcc66,
    emissiveIntensity: 1.35,
    roughness: 0.35,
    metalness: 0.4,
    flatShading: true
  });

  const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.72, 0.12), rock);
  pillar.position.y = 0.36;
  g.add(pillar);

  const rune = new THREE.Group();
  const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.38, 0.04), glow);
  vBar.position.y = 0.42;
  rune.add(vBar);
  const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.04), glow);
  hBar.position.y = 0.48;
  rune.add(hBar);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.022, 6, 14), glow);
  ring.position.set(0, 0.42, 0.08);
  rune.add(ring);
  rune.position.z = 0.08;
  g.add(rune);

  g.add(new THREE.PointLight(0xffcc66, 0.55, 4.2));
  g.traverse((ch) => {
    if (ch.isMesh) {
      ch.castShadow = true;
      ch.receiveShadow = true;
      ch.raycast = () => {};
    }
  });
  return g;
}

function snapOnSurface(obj, dir, faceCenter) {
  const up = dir;
  obj.position.copy(up).multiplyScalar(obj.userData._h);
  if (faceCenter) {
    tangentFrame(up, _east, _north);
    _toCenter.copy(faceCenter).addScaledVector(up, -faceCenter.dot(up));
    if (_toCenter.lengthSq() > 1e-8) {
      _toCenter.normalize();
      _east.crossVectors(up, _toCenter).normalize();
      _north.crossVectors(_east, up).normalize();
    }
    obj.quaternion.setFromRotationMatrix(_basis.makeBasis(_east, up, _north));
  } else {
    _quat.setFromUnitVectors(Y_UP, up);
    obj.quaternion.copy(_quat);
  }
}

/** Dekorace spawnů: runový kruh + zlatý strom — vždy na povrchu terénu. */
export class SpawnDecor {
  constructor(game) {
    this.game = game;
    this.root = new THREE.Group();
    game.planetGroup.add(this.root);
    this.rings = [];
    this.stones = [];
    this.trees = [];
  }

  clear() {
    while (this.root.children.length) {
      const ch = this.root.children[0];
      this.root.remove(ch);
      disposeObject(ch);
    }
    this.rings.length = 0;
    this.stones.length = 0;
    this.trees.length = 0;
  }

  rebuild(mapId) {
    this.clear();
    const map = getMap(mapId ?? this.game.mapId);
    const focuses = map.spawnFocus || [];
    const terrain = this.game.terrain;

    for (let s = 0; s < focuses.length; s++) {
      const focus = new THREE.Vector3(focuses[s][0], focuses[s][1], focuses[s][2]).normalize();
      const center = terrain.pickStartDir(focus);
      this.#placeRuneCircle(center, s);
      this.#placeGoldenTree(center, s);
    }
  }

  pickTreeAt(clientX, clientY) {
    const game = this.game;
    const rect = game.canvas.getBoundingClientRect();
    game.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    game.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    game.raycaster.setFromCamera(game.pointer, game.camera);
    const meshes = [];
    for (const t of this.trees) {
      if (t.hitProxy) meshes.push(t.hitProxy);
    }
    if (!meshes.length) return null;
    const hits = game.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const mesh = hits[0].object;
    return this.trees.find((t) => t.hitProxy === mesh) || null;
  }

  #placeRuneCircle(centerDir, seed) {
    const terrain = this.game.terrain;
    const up = centerDir.clone().normalize();
    const east0 = new THREE.Vector3();
    const north0 = new THREE.Vector3();
    tangentFrame(up, east0, north0);
    const radius = RUNE_RADIUS;

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffe29a,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending
    });
    const glowRing = createSurfaceRingMesh(ringMat, 64);
    drapeRing(glowRing.geometry, terrain, up, east0, north0, radius - 0.18, radius + 0.18, 0.1);
    this.root.add(glowRing);
    this.rings.push({
      mesh: glowRing,
      up,
      east: east0.clone(),
      north: north0.clone(),
      rIn: radius - 0.18,
      rOut: radius + 0.18,
      lift: 0.1
    });

    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + seed * 0.15;
      const dir = up.clone()
        .multiplyScalar(CONFIG.planetR)
        .addScaledVector(east0, Math.cos(a) * radius)
        .addScaledVector(north0, Math.sin(a) * radius)
        .normalize();
      const stone = createRuneStone();
      stone.scale.setScalar(0.85 + ((i + seed * 3) % 5) * 0.04);
      stone.userData._h = terrain.height(dir);
      stone.userData.faceCenter = up;
      this.root.add(stone);
      this.stones.push({ mesh: stone, dir });
      snapOnSurface(stone, dir, up);
    }
  }

  #placeGoldenTree(centerDir, seed) {
    const terrain = this.game.terrain;
    const up = centerDir.clone().normalize();
    const east0 = new THREE.Vector3();
    const north0 = new THREE.Vector3();
    tangentFrame(up, east0, north0);

    const dist = RUNE_RADIUS + 2.2;
    const preferred = 0.9 + seed * 1.05;
    let treeDir = null;

    for (let k = 0; k < 20; k++) {
      const step = Math.ceil(k / 2) * 0.32;
      const ang = preferred + (k % 2 === 0 ? step : -step);
      tmp.dir
        .copy(up)
        .multiplyScalar(CONFIG.planetR)
        .addScaledVector(east0, Math.cos(ang) * dist)
        .addScaledVector(north0, Math.sin(ang) * dist)
        .normalize();
      const h = terrain.height(tmp.dir);
      if (h > CONFIG.waterLevel + 0.25) {
        treeDir = tmp.dir.clone();
        break;
      }
    }

    if (!treeDir) {
      tmp.dir
        .copy(up)
        .multiplyScalar(CONFIG.planetR)
        .addScaledVector(east0, Math.cos(preferred) * dist)
        .addScaledVector(north0, Math.sin(preferred) * dist)
        .normalize();
      treeDir = tmp.dir.clone();
    }

    const tree = new GoldenTree(seed);
    const h = Math.max(terrain.height(treeDir), CONFIG.waterLevel + 0.15);
    tree.placeRadial(treeDir.clone().multiplyScalar(h), treeDir);
    this.root.add(tree.root);
    this.trees.push(tree);
  }

  /** Přilepí runy, kruhy i stromy na aktuální výšku terénu. */
  #snapToTerrain() {
    const terrain = this.game.terrain;
    for (const s of this.stones) {
      s.mesh.userData._h = terrain.height(s.dir);
      snapOnSurface(s.mesh, s.dir, s.mesh.userData.faceCenter);
    }
    // Záře kruhu jen při morphu terénu (jinak zbytečně drahé)
    if (terrain.jobs?.length) {
      for (const r of this.rings) {
        drapeRing(r.mesh.geometry, terrain, r.up, r.east, r.north, r.rIn, r.rOut, r.lift);
      }
    }
    for (const t of this.trees) t.snapToGround(terrain);
  }

  update(dt, elapsed) {
    if (this.game.quality?.shouldSnapDecor?.()) this.#snapToTerrain();
    for (const r of this.rings) {
      r.mesh.material.opacity = 0.4 + Math.sin(elapsed * 2.2) * 0.18;
    }
    for (const t of this.trees) t.update(dt, elapsed);
  }
}
