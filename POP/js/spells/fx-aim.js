import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { tangentFrame } from "../utils.js";

const RING_SEGS = 64;
const RING_LIFT = 0.18;
const AIM_LIFT = 0.16;
const SPIRAL_SEGS = 48;

/** Kruhová linie dosahu — kopíruje terén kolem kouzelníka. */
export class RangeRing {
  constructor(planetGroup, terrain) {
    this.terrain = terrain;
    this.radius = 20;
    this.visible = false;

    const positions = new Float32Array(RING_SEGS * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    this.mat = new THREE.LineBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.75,
      depthWrite: false
    });
    this.line = new THREE.LineLoop(this.geo, this.mat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 3;
    this.line.visible = false;
    planetGroup.add(this.line);

    this._east = new THREE.Vector3();
    this._north = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._center = new THREE.Vector3();
  }

  show(radius) {
    this.radius = radius;
    this.visible = true;
    this.line.visible = true;
  }

  hide() {
    this.visible = false;
    this.line.visible = false;
  }

  update(centerDir) {
    if (!this.visible) return;
    this._center.copy(centerDir).normalize();
    tangentFrame(this._center, this._east, this._north);
    const ang = this.radius / CONFIG.planetR;
    const pos = this.geo.attributes.position;

    for (let i = 0; i < RING_SEGS; i++) {
      const a = (i / RING_SEGS) * Math.PI * 2;
      this._tmp.copy(this._center)
        .addScaledVector(this._east, Math.cos(a) * ang)
        .addScaledVector(this._north, Math.sin(a) * ang)
        .normalize();
      const h = this.terrain.height(this._tmp) + RING_LIFT;
      pos.setXYZ(i, this._tmp.x * h, this._tmp.y * h, this._tmp.z * h);
    }
    pos.needsUpdate = true;
    this.geo.computeBoundingSphere();
    this.mat.opacity = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(performance.now() * 0.004));
  }

  setColor(hex) {
    this.mat.color.setHex(hex);
  }
}

/** Malý terč pod kurzorem při míření kouzla. */
export class AimReticle {
  constructor(planetGroup, terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.visible = false;

    this.mat = new THREE.LineBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    });

    const ringPts = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0));
    }
    this.ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      this.mat
    );

    const hGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.85, 0, 0), new THREE.Vector3(-0.3, 0, 0),
      new THREE.Vector3(0.3, 0, 0), new THREE.Vector3(0.85, 0, 0)
    ]);
    const vGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -0.85, 0), new THREE.Vector3(0, -0.3, 0),
      new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(0, 0.85, 0)
    ]);
    this.crossH = new THREE.LineSegments(hGeo, this.mat);
    this.crossV = new THREE.LineSegments(vGeo, this.mat);

    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), dotMat);
    this.dotMat = dotMat;

    this.group.add(this.ring, this.crossH, this.crossV, this.dot);
    this.group.frustumCulled = false;
    planetGroup.add(this.group);

    this.dir = new THREE.Vector3(0, 1, 0);
    this.inRange = true;
    this._east = new THREE.Vector3();
    this._north = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._x = new THREE.Vector3();
    this._y = new THREE.Vector3();
    this._mat = new THREE.Matrix4();
    this._p0 = new THREE.Vector3();
    this._pE = new THREE.Vector3();
    this._pN = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
  }

  setColor(hex) {
    this.mat.color.setHex(hex);
    this.dotMat.color.setHex(hex);
  }

  show() {
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
  }

  place(dir, inRange) {
    this.dir.copy(dir).normalize();
    this.inRange = inRange;
    const h = this.terrain.height(this.dir);
    this._p0.copy(this.dir).multiplyScalar(h);

    tangentFrame(this.dir, this._east, this._north);
    const eps = 0.04;
    this._tmp.copy(this.dir).addScaledVector(this._east, eps).normalize();
    this._pE.copy(this._tmp).multiplyScalar(this.terrain.height(this._tmp));
    this._tmp2.copy(this.dir).addScaledVector(this._north, eps).normalize();
    this._pN.copy(this._tmp2).multiplyScalar(this.terrain.height(this._tmp2));
    this._n.crossVectors(this._pE.sub(this._p0), this._pN.sub(this._p0));
    if (this._n.lengthSq() < 1e-10) this._n.copy(this.dir);
    else this._n.normalize();
    if (this._n.dot(this.dir) < 0) this._n.negate();

    this.group.position.copy(this._p0).addScaledVector(this._n, AIM_LIFT);
    this._x.crossVectors(this._east, this._n);
    if (this._x.lengthSq() < 1e-8) this._x.crossVectors(this._north, this._n);
    this._x.normalize();
    this._y.crossVectors(this._n, this._x).normalize();
    this._mat.makeBasis(this._x, this._y, this._n);
    this.group.quaternion.setFromRotationMatrix(this._mat);

    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.008);
    const op = inRange ? 0.55 + pulse * 0.4 : 0.22;
    this.mat.opacity = op;
    this.dotMat.opacity = op;
    this.group.scale.setScalar(inRange ? 0.95 + pulse * 0.12 : 0.85);
  }
}

/** Kroužící spirála v místě cíle kouzla. */
export class CastSpiral {
  constructor(planetGroup, terrain, dir, colorHex) {
    this.terrain = terrain;
    this.planetGroup = planetGroup;
    this.dir = dir.clone().normalize();
    this.t = 0;
    this.alive = true;

    this.mat = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    });
    const positions = new Float32Array(SPIRAL_SEGS * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.line = new THREE.Line(this.geo, this.mat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 5;
    planetGroup.add(this.line);

    this._east = new THREE.Vector3();
    this._north = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._center = new THREE.Vector3();
  }

  update(dt) {
    if (!this.alive) return;
    this.t += dt;
    tangentFrame(this.dir, this._east, this._north);
    const pos = this.geo.attributes.position;
    const turns = 2.6;
    const spin = this.t * 5.5;
    const lift = 0.08;
    const rMax = CONFIG.spellSpiralDiameter * 0.5;
    const h0 = this.terrain.height(this.dir);
    this._center.copy(this.dir).multiplyScalar(h0);

    for (let i = 0; i < SPIRAL_SEGS; i++) {
      const u = i / (SPIRAL_SEGS - 1);
      const a = u * Math.PI * 2 * turns + spin;
      const r = 0.05 + u * (rMax - 0.05);
      this._tmp.copy(this._center)
        .addScaledVector(this._east, Math.cos(a) * r)
        .addScaledVector(this._north, Math.sin(a) * r)
        .normalize();
      const h = this.terrain.height(this._tmp) + lift;
      pos.setXYZ(i, this._tmp.x * h, this._tmp.y * h, this._tmp.z * h);
    }
    pos.needsUpdate = true;
    this.geo.computeBoundingSphere();
    this.mat.opacity = 0.5 + 0.4 * (0.5 + 0.5 * Math.sin(this.t * 8));
  }

  dispose() {
    this.alive = false;
    this.planetGroup.remove(this.line);
    this.geo.dispose();
    this.mat.dispose();
  }
}
