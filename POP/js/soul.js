import * as THREE from "./three.js";

const LIFE = 3.2;
const OPACITY = 0.45;
const RISE = 2.8;
/** Počkat, až tělo dopadne / doklouže. */
export const SOUL_DELAY = 1;

/**
 * Průhledný klon mesh, který vystoupá po normále povrchu a vybledne.
 * Stejná dušička u kouzelníka i zvířat.
 */
export function spawnSoul(planetGroup, mesh) {
  if (!planetGroup || !mesh) return null;
  const ghost = mesh.clone(true);
  const mats = [];
  ghost.traverse((ch) => {
    if (ch.isSprite || ch.isPoints || ch.isLight) {
      ch.visible = false;
      return;
    }
    if (!ch.isMesh || !ch.material) return;
    const srcList = Array.isArray(ch.material) ? ch.material : [ch.material];
    const next = srcList.map((m) => {
      const gm = new THREE.MeshBasicMaterial({
        color: m.color ? m.color.clone() : new THREE.Color(0xc8e8ff),
        transparent: true,
        opacity: OPACITY,
        depthWrite: false
      });
      mats.push(gm);
      return gm;
    });
    ch.material = next.length === 1 ? next[0] : next;
    ch.castShadow = false;
    ch.receiveShadow = false;
  });
  ghost.position.copy(mesh.position);
  ghost.quaternion.copy(mesh.quaternion);
  ghost.scale.copy(mesh.scale);
  ghost.visible = true;
  ghost.frustumCulled = false;
  planetGroup.add(ghost);
  return { mesh: ghost, mats, t: 0 };
}

export function updateSoul(soul, planetGroup, dir, dt) {
  if (!soul) return null;
  soul.t += dt;
  if (dir) soul.mesh.position.addScaledVector(dir, RISE * dt);
  const fade = Math.max(0, 1 - soul.t / LIFE);
  for (const m of soul.mats) m.opacity = OPACITY * fade;
  if (soul.t >= LIFE) return disposeSoul(soul, planetGroup);
  return soul;
}

export function disposeSoul(soul, planetGroup) {
  if (!soul) return null;
  planetGroup?.remove(soul.mesh);
  for (const m of soul.mats) m.dispose();
  return null;
}
