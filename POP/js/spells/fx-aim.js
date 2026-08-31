import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { tangentFrame, surfaceOffsetDir } from "../utils.js";

const RING_SEGS = 96;
const RING_LIFT = 0.16;
const AIM_LIFT = 0.16;
const AIM_GLYPH_LIFT = 0.82;
const SPIRAL_SEGS = 48;

function glyphMat(color, opacity = 0.92) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false
  });
}

function collectMats(root, out) {
  root.traverse((ch) => {
    if (ch.isMesh && ch.material) out.push(ch.material);
  });
}

/** 3D šipka — lokální +Z = kolmo od terénu nahoru. */
function arrowUpGlyph(color) {
  const g = new THREE.Group();
  const mat = glyphMat(color);
  const shaftLen = 0.34;
  const headH = 0.3;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, shaftLen, 8), mat);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = shaftLen * 0.5;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, headH, 4), mat);
  head.rotation.x = Math.PI / 2;
  head.position.z = shaftLen + headH * 0.5;
  g.add(shaft, head);
  return g;
}

/** 3D šipka špičkou dolů (−Z). */
function arrowDownGlyph(color) {
  const g = new THREE.Group();
  const mat = glyphMat(color);
  const shaftLen = 0.34;
  const headH = 0.3;
  const baseZ = 0.14;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, shaftLen, 8), mat);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = baseZ + shaftLen * 0.5;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, headH, 4), mat);
  head.rotation.x = -Math.PI / 2;
  head.position.z = baseZ - headH * 0.5;
  g.add(shaft, head);
  return g;
}

function lightningGlyph() {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(0.1, 0.54);
  s.lineTo(-0.14, 0.2);
  s.lineTo(0.02, 0.2);
  s.lineTo(-0.12, -0.04);
  s.lineTo(0.16, 0.36);
  s.lineTo(0.02, 0.36);
  s.lineTo(0.12, 0.54);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: false });
  geo.center();
  geo.rotateX(-Math.PI / 2);
  const bolt = new THREE.Mesh(geo, glyphMat(0xd8f0ff));
  bolt.rotation.z = Math.PI / 2;
  g.scale.setScalar(1.28);
  g.add(bolt);
  return g;
}

function tornadoGlyph() {
  const g = new THREE.Group();
  const buildSpiral = (phase, opacity) => {
    const turns = 2.4;
    const segs = 56;
    const h = 0.64;
    const r0 = 0.07;
    const r1 = 0.34;
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const a = t * Math.PI * 2 * turns + phase;
      const r = r0 + (r1 - r0) * t;
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0.06 + t * h));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, segs, 0.032, 7, false),
      glyphMat(0xb8c4d4, opacity)
    );
    g.add(tube);
  };
  buildSpiral(0, 0.88);
  buildSpiral(Math.PI * 0.55, 0.62);
  buildSpiral(Math.PI * 1.1, 0.45);
  return g;
}

function buildSpellGlyph(spellId) {
  const g = new THREE.Group();
  g.renderOrder = 6;

  if (spellId === "elevate") {
    g.add(arrowUpGlyph(0x6dff9a));
  } else if (spellId === "depress") {
    g.add(arrowDownGlyph(0x6aa8ff));
  } else if (spellId === "lightning") {
    g.add(lightningGlyph());
  } else if (spellId === "fireball") {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), glyphMat(0xff7a28));
    ball.position.z = 0.34;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), glyphMat(0xffe08a));
    core.position.z = 0.38;
    g.add(ball, core);
  } else if (spellId === "iceball") {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 12), glyphMat(0xd8ecff));
    ball.position.z = 0.36;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 8, 16), glyphMat(0xffffff, 0.75));
    ring.position.z = 0.36;
    g.add(ball, ring);
  } else if (spellId === "tornado") {
    g.add(tornadoGlyph());
  } else if (spellId === "volcano") {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.6, 10), glyphMat(0xff3a18));
    cone.rotation.x = Math.PI / 2;
    cone.position.z = 0.28;
    g.add(cone);
  }

  g.position.z = AIM_GLYPH_LIFT;
  return g;
}

/** Kruhová linie dosahu — kopíruje terén kolem kouzelníka. */
export class RangeRing {
  constructor(planetGroup, terrain) {
    this.terrain = terrain;
    this.radius = 20;
    this.visible = false;
    this._boundaryFn = null;

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
    this._bearing = new THREE.Vector3();
    this._center = new THREE.Vector3();
    this._radii = new Float32Array(RING_SEGS);
    this._smooth = new Float32Array(RING_SEGS);
  }

  show(boundaryFn) {
    this._boundaryFn = boundaryFn;
    this.visible = true;
    this.line.visible = true;
  }

  hide() {
    this.visible = false;
    this.line.visible = false;
    this._boundaryFn = null;
  }

  setBoundaryFn(boundaryFn) {
    this._boundaryFn = boundaryFn;
  }

  /** boundaryFn(angle, center, east, north) → dosah v metrech (stejná logika jako inRange). */
  update(centerDir, dirAtDist) {
    if (!this.visible || !this._boundaryFn) return;
    this._center.copy(centerDir).normalize();
    tangentFrame(this._center, this._east, this._north);
    const pos = this.geo.attributes.position;
    const radii = this._radii;
    const smooth = this._smooth;

    for (let i = 0; i < RING_SEGS; i++) {
      const a = (i / RING_SEGS) * Math.PI * 2;
      radii[i] = this._boundaryFn(a, this._center, this._east, this._north);
    }

    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < RING_SEGS; i++) {
        const im = (i - 1 + RING_SEGS) % RING_SEGS;
        const ip = (i + 1) % RING_SEGS;
        smooth[i] = radii[im] * 0.22 + radii[i] * 0.56 + radii[ip] * 0.22;
      }
      radii.set(smooth);
    }

    for (let i = 0; i < RING_SEGS; i++) {
      const a = (i / RING_SEGS) * Math.PI * 2;
      dirAtDist(this._center, this._east, this._north, a, radii[i], this._tmp);
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

    this.glyphRoot = new THREE.Group();
    this.glyphs = {};
    this._glyphMats = [];
    for (const id of ["elevate", "depress", "lightning", "fireball", "iceball", "tornado", "volcano"]) {
      const glyph = buildSpellGlyph(id);
      glyph.visible = false;
      this.glyphs[id] = glyph;
      this.glyphRoot.add(glyph);
      collectMats(glyph, this._glyphMats);
    }

    this.group.add(this.ring, this.crossH, this.crossV, this.dot, this.glyphRoot);
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
    this._xW = new THREE.Vector3();
    this._yW = new THREE.Vector3();
    this._nW = new THREE.Vector3();
    this._toCam = new THREE.Vector3();
    this._wPos = new THREE.Vector3();
    this.activeSpellId = null;
  }

  setSpell(spellId) {
    this.activeSpellId = spellId || null;
    for (const [id, glyph] of Object.entries(this.glyphs)) {
      glyph.visible = id === this.activeSpellId;
    }
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

  place(dir, inRange, camera = null) {
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

    for (const [id, glyph] of Object.entries(this.glyphs)) {
      if (id === "lightning" && camera && this.activeSpellId === "lightning") {
        this.group.updateWorldMatrix(true, false);
        glyph.getWorldPosition(this._wPos);
        this._nW.copy(this._n).transformDirection(this.group.matrixWorld);
        this._toCam.copy(camera.position).sub(this._wPos);
        this._toCam.addScaledVector(this._nW, -this._toCam.dot(this._nW));
        if (this._toCam.lengthSq() > 1e-8) {
          this._toCam.normalize();
          this._xW.copy(this._x).transformDirection(this.group.matrixWorld);
          this._yW.copy(this._y).transformDirection(this.group.matrixWorld);
          glyph.rotation.z = Math.atan2(
            this._toCam.dot(this._xW),
            this._toCam.dot(this._yW)
          );
        }
      } else {
        glyph.rotation.set(0, 0, 0);
      }
    }

    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.008);
    const bob = Math.sin(performance.now() * 0.005) * 0.06;
    const op = inRange ? 0.55 + pulse * 0.4 : 0.22;
    this.mat.opacity = op;
    this.dotMat.opacity = op;
    for (const m of this._glyphMats) {
      m.opacity = inRange ? 0.72 + pulse * 0.26 : 0.28;
    }
    this.glyphRoot.position.z = AIM_GLYPH_LIFT + bob;
    this.group.scale.setScalar(inRange ? 0.95 + pulse * 0.12 : 0.85);
  }
}

const FOOT_LIFT = 0.2;
const FOOT_SPACING = 0.2;
const FOOT_STAGGER = 0.14;
const FOOT_SCALE = 3;

const _footTmp = {
  east: new THREE.Vector3(),
  north: new THREE.Vector3(),
  p0: new THREE.Vector3(),
  pE: new THREE.Vector3(),
  pN: new THREE.Vector3()
};

function createFootGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.055, 0.02);
  s.lineTo(-0.062, 0.14);
  s.quadraticCurveTo(-0.04, 0.3, 0, 0.34);
  s.quadraticCurveTo(0.04, 0.3, 0.062, 0.14);
  s.lineTo(0.055, 0.02);
  s.lineTo(0.04, -0.01);
  s.lineTo(-0.04, -0.01);
  s.lineTo(-0.055, 0.02);
  const geo = new THREE.ShapeGeometry(s);
  geo.rotateX(-Math.PI / 2);
  geo.scale(FOOT_SCALE, FOOT_SCALE, FOOT_SCALE);
  return geo;
}

function placeFootOnSurface(terrain, footDir, lift, outPos, outNormal, outForward, fromDir) {
  const h = terrain.height(footDir);
  outPos.copy(footDir).multiplyScalar(h);

  tangentFrame(footDir, _footTmp.east, _footTmp.north);
  const eps = 0.04;
  _footTmp.p0.copy(outPos);
  _footTmp.pE.copy(footDir).addScaledVector(_footTmp.east, eps).normalize();
  _footTmp.pE.multiplyScalar(terrain.height(_footTmp.pE));
  _footTmp.pN.copy(footDir).addScaledVector(_footTmp.north, eps).normalize();
  _footTmp.pN.multiplyScalar(terrain.height(_footTmp.pN));

  outNormal.crossVectors(_footTmp.pE.sub(_footTmp.p0), _footTmp.pN.sub(_footTmp.p0));
  if (outNormal.lengthSq() < 1e-10) outNormal.copy(footDir);
  else outNormal.normalize();
  if (outNormal.dot(footDir) < 0) outNormal.negate();

  outPos.addScaledVector(outNormal, lift);

  outForward.copy(fromDir).addScaledVector(footDir, -footDir.dot(fromDir));
  if (outForward.lengthSq() < 1e-8) outForward.copy(_footTmp.east);
  else outForward.normalize();
}

/** Dvě pulzující stopy — cíl chůze, jen lokální hráč. */
export class WalkFootprints {
  constructor(planetGroup, terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.frustumCulled = false;

    this.mat = new THREE.MeshBasicMaterial({
      color: 0xffe566,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const footGeo = createFootGeometry();
    this.leftFoot = new THREE.Mesh(footGeo, this.mat);
    this.rightFoot = new THREE.Mesh(footGeo.clone(), this.mat);
    this.leftFoot.renderOrder = 4;
    this.rightFoot.renderOrder = 4;
    this.group.add(this.leftFoot, this.rightFoot);
    planetGroup.add(this.group);

    this.targetDir = new THREE.Vector3(0, 1, 0);
    this.fromDir = new THREE.Vector3(0, 1, 0);
    this.t = 0;
    this._east = new THREE.Vector3();
    this._north = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._footDir = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._basisX = new THREE.Vector3();
    this._basisY = new THREE.Vector3();
    this._mat4 = new THREE.Matrix4();
  }

  show(targetDir, fromDir) {
    this.targetDir.copy(targetDir).normalize();
    this.fromDir.copy(fromDir).normalize();
    this.group.visible = true;
    this.#layoutFeet();
  }

  hide() {
    this.group.visible = false;
  }

  #layoutFeet() {
    tangentFrame(this.targetDir, this._east, this._north);

    this._forward.copy(this.fromDir).addScaledVector(this.targetDir, -this.targetDir.dot(this.fromDir));
    if (this._forward.lengthSq() < 1e-8) this._forward.copy(this._east);
    else this._forward.normalize();

    this._right.crossVectors(this.targetDir, this._forward).normalize();
    if (this._right.lengthSq() < 1e-8) this._right.copy(this._east);

    const offsets = [
      { r: -FOOT_SPACING, f: -FOOT_STAGGER, mesh: this.leftFoot },
      { r: FOOT_SPACING, f: FOOT_STAGGER, mesh: this.rightFoot }
    ];

    for (const o of offsets) {
      const offE = o.r * this._right.dot(this._east) + o.f * this._forward.dot(this._east);
      const offN = o.r * this._right.dot(this._north) + o.f * this._forward.dot(this._north);
      const dist = Math.hypot(offE, offN);
      if (dist < 1e-4) this._footDir.copy(this.targetDir);
      else surfaceOffsetDir(this.targetDir, this._east, this._north, Math.atan2(offN, offE), dist, this._footDir);

      placeFootOnSurface(
        this.terrain,
        this._footDir,
        FOOT_LIFT,
        this._pos,
        this._normal,
        this._forward,
        this.fromDir
      );
      o.mesh.position.copy(this._pos);

      this._basisX.copy(this._forward);
      this._basisY.crossVectors(this._normal, this._basisX).normalize();
      this._basisX.crossVectors(this._basisY, this._normal).normalize();
      this._mat4.makeBasis(this._basisX, this._basisY, this._normal);
      o.mesh.quaternion.setFromRotationMatrix(this._mat4);
    }
  }

  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;
    this.#layoutFeet();
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 5.2);
    this.mat.opacity = 0.58 + pulse * 0.38;
    const scale = 1.02 + pulse * 0.12;
    this.leftFoot.scale.set(scale, scale, scale);
    this.rightFoot.scale.set(scale, scale, scale);
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
