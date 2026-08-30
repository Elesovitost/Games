import { CONFIG } from "../config.js";

export const SPELLS = {
  elevate: {
    id: "elevate",
    range: 14,
    castTime: CONFIG.spellDuration,
    color: 0x6dff9a,
    hint: "Klikni v dosahu — vyroste kopec."
  },
  depress: {
    id: "depress",
    range: 14,
    castTime: CONFIG.spellDuration,
    color: 0x6aa8ff,
    hint: "Klikni v dosahu — vznikne prohlubeň."
  },
  lightning: {
    id: "lightning",
    range: 16,
    castTime: 2,
    burnRadius: 1,
    damageRadius: 2,
    damageCenter: 90,
    damageEdge: 10,
    color: 0xc8f0ff,
    hint: "Klikni v dosahu — blesk spálí zem."
  },
  fireball: {
    id: "fireball",
    range: 18,
    castTime: 1,
    burnRadius: 0.5,
    damageRadius: 2,
    damageCenter: 60,
    damageEdge: 10,
    speed: 40,
    radius: 0.35,
    color: 0xff7a28,
    hint: "Klikni v dosahu — ohnivá koule letí přímkou."
  },
  iceball: {
    id: "iceball",
    range: 27.5,
    castTime: 1,
    diameter: 3,
    travel: 50,
    speed: 16,
    contactDamage: 50,
    color: 0xeef6ff,
    hint: "Klikni směr — ledová koule se 50 m kutálí."
  }
};
