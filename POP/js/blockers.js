import { surfaceDist } from "./spells/fx-common.js";

/** Osobní poloměr kouzelníka (m) — kolem nohou, ne celá výška. */
export const WIZARD_BODY_R = 0.4;

/** Poloměr kolem kmene stromu (m). Vizual ~0.1–0.2; box je větší kvůli hratelnosti. */
export function treeTrunkRadius(p) {
  if (p?.blockR != null) return p.blockR;
  const h = p?.height ?? 4;
  return 0.4 + (h - 3) * 0.05;
}

/** Poloměr těla crittera podle size (0.25–1.25). */
export function critterBodyRadius(c) {
  if (c?.blockR != null) return c.blockR;
  return Math.max(0.22, 0.32 * (c?.size ?? 1));
}

/** Poloměr zavalitého longnecka. */
export function longneckBodyRadius(c) {
  if (c?.blockR != null) return c.blockR;
  return Math.max(0.42, 0.5 * (c?.size ?? 1));
}

/**
 * Neviditelné „boxy“ kolem kmenů a zvířat.
 * Jeden lookup pro scatter, spawn i pohyb (wizard / critter / longneck).
 */
export class Blockers {
  constructor() {
    this.trees = null;
    this.critters = null;
    this.longnecks = null;
  }

  /**
   * Je pozice volná pro těleso o poloměru `selfR`?
   * @param {THREE.Vector3} dir
   * @param {number} selfR
   * @param {{ ignore?: object, trees?: boolean, animals?: boolean }} [opts]
   */
  clear(dir, selfR, opts = {}) {
    if (!dir || selfR < 0) return true;
    const ignore = opts.ignore ?? null;
    const checkTrees = opts.trees !== false;
    const checkAnimals = opts.animals !== false;

    if (checkTrees && this.trees?.placements) {
      for (const p of this.trees.placements) {
        if (!p?.dir || p.gone || p === ignore) continue;
        const need = treeTrunkRadius(p) + selfR;
        if (surfaceDist(dir, p.dir) < need) return false;
      }
    }

    if (checkAnimals) {
      if (this.critters?.list) {
        for (const c of this.critters.list) {
          if (!c || c.dead || c === ignore) continue;
          const need = critterBodyRadius(c) + selfR;
          if (surfaceDist(dir, c.dir) < need) return false;
        }
      }
      if (this.longnecks?.list) {
        for (const c of this.longnecks.list) {
          if (!c || c.dead || c.gone || c === ignore) continue;
          const need = longneckBodyRadius(c) + selfR;
          if (surfaceDist(dir, c.dir) < need) return false;
        }
      }
    }
    return true;
  }

  /**
   * Nejbližší překážka v dosahu `searchR` (m), volitelně jen před `towardDir`.
   * @returns {{ dir: THREE.Vector3, r: number, dist: number } | null}
   */
  hitNear(fromDir, selfR, searchR = 3.2, towardDir = null) {
    if (!fromDir) return null;
    let best = null;
    let bestScore = Infinity;
    const consider = (pos, r) => {
      if (!pos) return;
      const need = r + selfR;
      const d = surfaceDist(fromDir, pos);
      if (d >= searchR) return;
      if (towardDir) {
        const latx = pos.x - fromDir.x * pos.dot(fromDir);
        const laty = pos.y - fromDir.y * pos.dot(fromDir);
        const latz = pos.z - fromDir.z * pos.dot(fromDir);
        const fwdx = towardDir.x - fromDir.x * towardDir.dot(fromDir);
        const fwdy = towardDir.y - fromDir.y * towardDir.dot(fromDir);
        const fwdz = towardDir.z - fromDir.z * towardDir.dot(fromDir);
        const latL = Math.hypot(latx, laty, latz);
        const fwdL = Math.hypot(fwdx, fwdy, fwdz);
        if (latL > 1e-6 && fwdL > 1e-6) {
          const side = (latx * fwdx + laty * fwdy + latz * fwdz) / (latL * fwdL);
          if (side < -0.2) return;
        }
      }
      const score = d - need * 0.35;
      if (score < bestScore) {
        bestScore = score;
        best = { dir: pos, r: need, dist: d };
      }
    };

    if (this.trees?.placements) {
      for (const p of this.trees.placements) {
        if (!p?.dir || p.gone) continue;
        consider(p.dir, treeTrunkRadius(p));
      }
    }
    if (this.critters?.list) {
      for (const c of this.critters.list) {
        if (!c || c.dead) continue;
        consider(c.dir, critterBodyRadius(c));
      }
    }
    if (this.longnecks?.list) {
      for (const c of this.longnecks.list) {
        if (!c || c.dead || c.gone) continue;
        consider(c.dir, longneckBodyRadius(c));
      }
    }
    return best;
  }

  /** Jen stromy — pro scatter / před spawny zvířat. */
  clearOfTrees(dir, selfR, existing = null) {
    if (existing?.length) {
      for (const p of existing) {
        if (!p?.dir) continue;
        const need = treeTrunkRadius(p) + selfR;
        if (surfaceDist(dir, p.dir) < need) return false;
      }
    }
    return this.clear(dir, selfR, { animals: false });
  }
}

/** Výchozí blockR při sázení stromu. */
export function makeTreeBlockR(height) {
  return 0.4 + ((height ?? 4) - 3) * 0.05;
}
