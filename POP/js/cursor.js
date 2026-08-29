import * as THREE from "./three.js";
import { SPELLS, inSpellRange, spellRange } from "./spells.js";
import { tangentFrame, tmp } from "./utils.js";
import { CONFIG } from "./config.js";
import { createSurfaceRingMesh, drapeRing, sampleGround } from "./surface.js";

function makeGlowDot(color, size = 0.14) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(size * 0.45, 12, 10),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      fog: false
    })
  );
  g.add(core);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(size, 12, 10),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      fog: false
    })
  );
  g.add(halo);
  const ring = createSurfaceRingMesh(
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false
    }),
    28
  );
  g.add(ring);
  const light = new THREE.PointLight(color, 0.85, 4.5);
  g.add(light);
  g.userData = { core, halo, ring, light, size, color };
  g.renderOrder = 7;
  g.raycast = () => {};
  return g;
}

export class Pointer {
  constructor(game) {
    this.game = game;
    this.clientX = window.innerWidth * 0.5;
    this.clientY = window.innerHeight * 0.5;
    this.overUi = false;
    this.hand = document.getElementById("hand-cursor");
    this.hitLocal = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.east = new THREE.Vector3();
    this.north = new THREE.Vector3();
    this.hasHit = false;
    this.inRange = true;

    this.hover = makeGlowDot(0xffe08a, 0.16);
    this.walkMark = makeGlowDot(0x7ec8ff, 0.2);
    this.reticle = this.#createReticle();
    this.rangeRing = this.#createRangeRing();
    game.planetGroup.add(this.hover);
    game.planetGroup.add(this.walkMark);
    game.planetGroup.add(this.reticle);
    game.planetGroup.add(this.rangeRing);
    this.hover.visible = false;
    this.walkMark.visible = false;
    this.reticle.visible = false;
    this.rangeRing.visible = false;

    window.addEventListener("pointermove", (e) => {
      this.clientX = e.clientX;
      this.clientY = e.clientY;
      this.overUi = !!e.target.closest("#ui, #mp-panel, #toast");
      this.#placeHand();
    });
    for (const id of ["ui", "mp-panel"]) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener("pointerenter", () => {
        this.overUi = true;
        this.#placeHand();
      });
      el.addEventListener("pointerleave", () => {
        this.overUi = false;
        this.#placeHand();
      });
    }
  }

  #createReticle() {
    const g = new THREE.Group();
    const mk = (color, opacity) => createSurfaceRingMesh(
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false
      }),
      40
    );
    g.userData.outer = mk(0xffe29a, 0.85);
    g.userData.mid = mk(0xffffff, 0.7);
    g.userData.inner = mk(0xffe29a, 0.95);
    g.add(g.userData.outer, g.userData.mid, g.userData.inner);
    g.userData.cross = [];
    for (let i = 0; i < 4; i++) {
      const bar = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 6, 5),
        new THREE.MeshBasicMaterial({
          color: 0xffe29a,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          fog: false
        })
      );
      bar.userData.ang = (i / 4) * Math.PI * 2;
      bar.raycast = () => {};
      g.add(bar);
      g.userData.cross.push(bar);
    }
    g.renderOrder = 8;
    g.raycast = () => {};
    return g;
  }

  #createRangeRing() {
    const mesh = createSurfaceRingMesh(
      new THREE.MeshBasicMaterial({
        color: 0xffe29a,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false
      }),
      96
    );
    mesh.renderOrder = 5;
    return mesh;
  }

  #placeHand() {
    const spell = this.game.currentSpell;
    const showHand = !spell && !this.overUi;
    this.hand.classList.toggle("hidden", !showHand);
    if (showHand) {
      this.hand.style.transform = `translate(${this.clientX}px, ${this.clientY}px)`;
    }
  }

  #setReticleColor(color) {
    const c = new THREE.Color(color);
    this.reticle.userData.outer.material.color.copy(c);
    this.reticle.userData.inner.material.color.copy(c);
    this.reticle.userData.mid.material.color.set(0xffffff);
    for (const bar of this.reticle.userData.cross) bar.material.color.copy(c);
  }

  #rayHit() {
    const rect = this.game.canvas.getBoundingClientRect();
    this.game.pointer.x = ((this.clientX - rect.left) / rect.width) * 2 - 1;
    this.game.pointer.y = -((this.clientY - rect.top) / rect.height) * 2 + 1;
    this.game.raycaster.setFromCamera(this.game.pointer, this.game.camera);
    this.game.raycaster.firstHitOnly = true;
    const hits = this.game.raycaster.intersectObject(this.game.terrain.mesh, false);
    this.game.raycaster.firstHitOnly = false;
    if (!hits.length) {
      this.hasHit = false;
      return null;
    }
    this.hitLocal.copy(this.game.planetGroup.worldToLocal(hits[0].point.clone()));
    this.hasHit = true;
    return this.hitLocal;
  }

  #frame(local) {
    this.up.copy(local).normalize();
    tangentFrame(this.up, this.east, this.north);
    return this.game.terrain.height(this.up);
  }

  #placeDot(mark, local, lift, elapsed, speed, amp) {
    const terrain = this.game.terrain;
    const h = this.#frame(local);
    const pulse = 1 + Math.sin(elapsed * speed) * amp;
    const size = mark.userData.size * pulse;
    mark.userData.core.position.copy(this.up).multiplyScalar(h + lift + size * 0.2);
    mark.userData.halo.position.copy(mark.userData.core.position);
    mark.userData.light.position.copy(this.up).multiplyScalar(h + lift + 0.35);
    drapeRing(
      mark.userData.ring.geometry,
      terrain,
      this.up,
      this.east,
      this.north,
      size * 0.7,
      size * 1.2,
      lift
    );
    mark.userData.core.scale.setScalar(pulse);
    mark.userData.halo.scale.setScalar(pulse);
    const a = 0.55 + Math.sin(elapsed * speed) * 0.3;
    mark.userData.core.material.opacity = 0.75 + Math.sin(elapsed * speed) * 0.2;
    mark.userData.halo.material.opacity = 0.18 + Math.sin(elapsed * speed + 0.8) * 0.12;
    mark.userData.ring.material.opacity = a;
    mark.userData.light.intensity = 0.55 + Math.sin(elapsed * speed) * 0.4;
  }

  #placeReticle(local, elapsed) {
    const terrain = this.game.terrain;
    const h = this.#frame(local);
    const pulse = 0.85 + Math.sin(elapsed * 5.5) * 0.18;
    const breath = 1 + Math.sin(elapsed * 3.2) * 0.08;
    drapeRing(this.reticle.userData.outer.geometry, terrain, this.up, this.east, this.north, 0.55 * pulse, 0.78 * pulse, 0.08);
    drapeRing(this.reticle.userData.mid.geometry, terrain, this.up, this.east, this.north, 0.32 * pulse, 0.45 * pulse, 0.09);
    drapeRing(this.reticle.userData.inner.geometry, terrain, this.up, this.east, this.north, 0.05 * breath, 0.16 * breath, 0.1);
    const base = this.inRange ? 0.45 : 0.22;
    this.reticle.userData.outer.material.opacity = base + Math.sin(elapsed * 5.5) * 0.35;
    this.reticle.userData.mid.material.opacity = (this.inRange ? 0.35 : 0.15) + Math.sin(elapsed * 5.5 + 1) * 0.25;
    const spin = elapsed * 0.6;
    for (const bar of this.reticle.userData.cross) {
      const a = bar.userData.ang + spin;
      sampleGround(terrain, this.up, this.east, this.north, Math.cos(a) * 0.95 * pulse, Math.sin(a) * 0.95 * pulse, 0.1, tmp.center);
      bar.position.copy(tmp.center);
      bar.material.opacity = this.inRange ? 0.9 : 0.35;
    }
  }

  #placeRangeRing(spellId, elapsed) {
    const wizard = this.game.wizard;
    if (!wizard) {
      this.rangeRing.visible = false;
      return;
    }
    const spell = SPELLS[spellId];
    const range = spellRange(spellId);
    this.up.copy(wizard.dir).normalize();
    tangentFrame(this.up, this.east, this.north);
    const h = this.game.terrain.height(this.up);
    // Stejné jednotky jako surfaceDistance: oblouk ≈ range → tečný poloměr.
    const ang = Math.min(range / Math.max(h, 1), Math.PI * 0.45);
    const r = CONFIG.planetR * Math.tan(ang);
    const pulse = 1 + Math.sin(elapsed * 2.4) * 0.01;
    const rr = r * pulse;
    const half = Math.max(0.08, rr * 0.006);
    drapeRing(
      this.rangeRing.geometry,
      this.game.terrain,
      this.up,
      this.east,
      this.north,
      rr - half,
      rr + half,
      0.14
    );
    const col = spell?.color ?? 0xffe29a;
    this.rangeRing.material.color.setHex(col);
    this.rangeRing.material.opacity = 0.55 + Math.sin(elapsed * 2.4) * 0.15;
    this.rangeRing.visible = true;
  }

  setWalkTarget(localPos) {
    this.walkMark.userData.anchor = localPos.clone();
    this.walkMark.visible = true;
  }

  clearWalkTarget() {
    this.walkMark.visible = false;
    this.walkMark.userData.anchor = null;
  }

  update(elapsed) {
    this.#placeHand();

    if (this.walkMark.visible && this.game.wizard && !this.game.wizard.move.active) {
      this.clearWalkTarget();
    }
    if (this.walkMark.visible && this.walkMark.userData.anchor) {
      this.#placeDot(this.walkMark, this.walkMark.userData.anchor, 0.07, elapsed, 3.4, 0.12);
    }

    const spell = this.game.currentSpell;
    const hit = this.overUi ? null : this.#rayHit();

    if (spell) {
      this.hover.visible = false;
      this.#placeRangeRing(spell, elapsed);
      if (!hit) {
        this.reticle.visible = false;
        return;
      }
      const spellDef = SPELLS[spell];
      this.inRange = inSpellRange(this.game, this.game.wizard, hit, spell);
      if (spellDef) {
        this.#setReticleColor(this.inRange ? spellDef.color : 0x884444);
      }
      this.#placeReticle(hit, elapsed);
      this.reticle.visible = true;
      return;
    }

    this.rangeRing.visible = false;
    this.reticle.visible = false;
    if (!hit) {
      this.hover.visible = false;
      return;
    }
    this.hover.visible = true;
    this.#placeDot(this.hover, hit, 0.06, elapsed, 4.2, 0.08);
  }
}
