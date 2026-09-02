import * as THREE from "../three.js";
import { SPELLS } from "./defs.js";
import { spawnBurst } from "./fx-common.js";

export function applyImmortality(sys, wizard = sys.wizard) {
  const w = wizard ?? sys.wizard;
  const def = SPELLS.immortality;
  if (!w || w.dead || !def) return;
  w.beginImmortality({
    hold: def.holdTime,
    speed: def.speed,
    travel: def.travel,
    radius: def.radius
  });
}

export function attachImmortalBubble(wizard, radius) {
  const r = Math.max(0.4, radius);
  const group = new THREE.Group();
  group.position.set(0, r, 0);

  const shellMat = new THREE.MeshStandardMaterial({
    color: 0xfff4cc,
    emissive: 0xffc44a,
    emissiveIntensity: 0.22,
    roughness: 0.14,
    metalness: 0.08,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.FrontSide
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), shellMat);
  shell.castShadow = false;
  shell.receiveShadow = false;
  group.add(shell);
  group.userData.shellMat = shellMat;
  group.userData.geos = [shell.geometry];
  wizard.mesh.add(group);
  return group;
}

export function detachImmortalBubble(wizard, group) {
  if (!group) return;
  wizard.mesh.remove(group);
  for (const g of group.userData.geos || []) g.dispose();
  group.userData.shellMat?.dispose();
}

export function burstImmortalShell(sys, wizard) {
  if (!sys || !wizard) return;
  const dir = wizard.dir;
  const pos = wizard.mesh.position;
  spawnBurst(sys, pos, dir, 0xfff6d0, 0.4);
  spawnBurst(sys, pos, dir, 0xffc44a, 0.24);
}
