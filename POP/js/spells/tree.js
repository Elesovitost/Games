import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { slerpDirection } from "../utils.js";
import { surfaceDist } from "./fx-common.js";
import { MagicTree } from "../magic-tree.js";

const _world = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();

function makeSeedBall() {
  const group = new THREE.Group();
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 10, 8),
    new THREE.MeshBasicMaterial({
      color: 0xfff0a0,
      transparent: true,
      opacity: 0.42,
      depthWrite: false
    })
  );
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 10, 8),
    new THREE.MeshStandardMaterial({
      color: 0xffe566,
      emissive: 0xffcc33,
      emissiveIntensity: 1.35,
      roughness: 0.28,
      metalness: 0.08
    })
  );
  core.castShadow = false;
  const light = new THREE.PointLight(0xffe566, 1.6, 3.5, 2);
  light.castShadow = false;
  group.add(glow, core, light);
  group.userData = { glow, core, light };
  group.frustumCulled = false;
  return group;
}

function seedWorldPos(ball, planetGroup, out) {
  ball.getWorldPosition(out);
  planetGroup.worldToLocal(out);
  return out;
}

function attachToHand(sys, wizard, ball) {
  const parts = wizard?.mesh?.userData?.parts;
  const hand = parts?.rightFore ?? parts?.rightArm;
  if (hand) {
    ball.position.set(0, -0.26, 0.05);
    hand.add(ball);
    return true;
  }
  const lift = CONFIG.wizardHeightM * 0.72;
  ball.position.copy(wizard.mesh.position).addScaledVector(wizard.dir, lift);
  sys.planetGroup.add(ball);
  return false;
}

export function beginTreeSeed(sys, targetDir) {
  const w = sys.wizard;
  if (!w) return null;
  const ball = makeSeedBall();
  const inHand = attachToHand(sys, w, ball);
  const p = {
    kind: "treeseed",
    ball,
    held: true,
    inHand,
    target: targetDir.clone().normalize(),
    color: w.color,
    casterId: sys._castOwnerId,
    life: 10,
    flightT: 0,
    flightTime: 0.8,
    peak: 2.2,
    from: new THREE.Vector3(),
    fromDir: new THREE.Vector3(),
    sinking: false,
    sinkT: 0,
    planted: false
  };
  sys.projectiles.push(p);
  return p;
}

export function releaseTreeSeed(sys, p) {
  if (!p || !p.held || !p.ball) return;
  seedWorldPos(p.ball, sys.planetGroup, _world);
  if (p.ball.parent) p.ball.parent.remove(p.ball);
  sys.planetGroup.add(p.ball);
  p.ball.position.copy(_world);
  p.held = false;
  p.from.copy(_world);
  p.fromDir.copy(_world).normalize();
  const dist = surfaceDist(p.fromDir, p.target);
  p.flightTime = THREE.MathUtils.clamp(0.42 + dist * 0.03, 0.48, 1.28);
  p.peak = THREE.MathUtils.clamp(1.35 + dist * 0.13, 1.5, 4.6);
  p.flightT = 0;
}

function startSink(p) {
  p.sinking = true;
  p.sinkT = 0;
}

function disposeSeed(sys, p) {
  if (!p.ball) return;
  if (p.ball.parent) p.ball.parent.remove(p.ball);
  p.ball.traverse((ch) => {
    if (ch.isMesh) {
      ch.geometry?.dispose?.();
      ch.material?.dispose?.();
    }
    if (ch.isLight) ch.dispose();
  });
  p.ball = null;
}

function spawnGrownTree(sys, dir, color, ownerId) {
  if (!sys.magicTrees) sys.magicTrees = [];
  try {
    const tree = new MagicTree(sys.planetGroup, sys.terrain, dir, color, { ownerId });
    sys.magicTrees.push(tree);
    sys.trees?.placements?.push(tree.placement);
    return tree;
  } catch (err) {
    console.error("Strom se nepodařilo zasadit:", err);
    return null;
  }
}

/** @returns {boolean} keep projectile */
export function updateTreeSeed(sys, p, dt) {
  if (!p.ball) return false;
  if (p.held) {
    const casters = sys.getWizards?.() || (sys.wizard ? [sys.wizard] : []);
    const caster = casters.find((w) => w.id === p.casterId);
    if (caster?.dead) {
      disposeSeed(sys, p);
      return false;
    }
    return true;
  }

  if (p.sinking) {
    p.sinkT += dt;
    const u = Math.min(1, p.sinkT / 0.42);
    const ease = u * u;
    const h = sys.terrain.height(p.target);
    _aim.copy(p.target).multiplyScalar(h - ease * 0.55);
    p.ball.position.copy(_aim);
    const s = 1 - ease;
    p.ball.scale.setScalar(s);
    const light = p.ball.userData.light;
    if (light) light.intensity = 1.6 * (1 - ease);
    if (u >= 1) {
      if (!p.planted) spawnGrownTree(sys, p.target, p.color, p.casterId);
      p.planted = true;
      disposeSeed(sys, p);
      return false;
    }
    return true;
  }

  p.flightT += dt;
  const u = Math.min(1, p.flightT / Math.max(0.05, p.flightTime));
  slerpDirection(_dir, p.fromDir, p.target, u);
  const ground = sys.terrain.height(_dir);
  const fromH = p.from.length();
  const startLift = Math.max(0, fromH - sys.terrain.height(p.fromDir));
  const arc = 4 * p.peak * u * (1 - u);
  const lift = startLift * (1 - u) + arc;
  p.ball.position.copy(_dir).multiplyScalar(ground + lift);
  p.ball.rotation.y += dt * 6;
  p.ball.rotation.x += dt * 3.2;

  if (u >= 1) startSink(p);
  return true;
}

export function disposeTreeSeed(sys, p) {
  disposeSeed(sys, p);
}

export function updateMagicTrees(sys, dt) {
  const list = sys.magicTrees;
  if (!list?.length) return;
  const wizards = sys.getWizards?.() || (sys.wizard ? [sys.wizard] : []);
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i];
    if (t.disposed || t.placement?.gone) {
      if (!t.disposed) t.dispose();
      list.splice(i, 1);
      continue;
    }
    if (t.ownerId) {
      const w = wizards.find((wiz) => wiz.id === t.ownerId);
      if (w) t.setColor(w.color);
    } else if (sys.wizard) {
      t.setColor(sys.wizard.color);
    }
    t.update(dt);
  }
}

export function disposeMagicTrees(sys) {
  if (!sys.magicTrees) return;
  for (const t of sys.magicTrees) t.dispose();
  sys.magicTrees.length = 0;
  if (sys.trees?.placements) {
    const keep = sys.trees.placements.filter((p) => !p.magic);
    sys.trees.placements.length = 0;
    sys.trees.placements.push(...keep);
  }
}
