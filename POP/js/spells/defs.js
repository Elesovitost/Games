export const SPELLS = {
  elevate: {
    id: "elevate",
    range: 14,
    castTime: 3,
    cooldown: 120,
    color: 0x6dff9a,
    hint: "Klikni v dosahu — vyroste kopec."
  },
  depress: {
    id: "depress",
    range: 14,
    castTime: 3,
    cooldown: 120,
    color: 0x6aa8ff,
    hint: "Klikni v dosahu — vznikne prohlubeň."
  },
  lightning: {
    id: "lightning",
    range: 16,
    castTime: 2,
    cooldown: 100,
    burnRadius: 1,
    damageRadius: 4,
    damageCenter: 45,
    damageEdge: 5,
    color: 0xc8f0ff,
    hint: "Klikni v dosahu — blesk spálí zem."
  },
  demon: {
    id: "demon",
    range: 16,
    castTime: 1,
    cooldown: 600,
    life: 5,
    catchRadius: 1,
    speedMul: 1.3,
    damage: 101,
    color: 0xff2208,
    hint: "1 s kouzlení — démon 5 s honí nejbližší živou bytost. Na 1 m ji chytí a vmorfuje se do ní (−101)."
  },
  fireball: {
    id: "fireball",
    range: 18,
    castTime: 1,
    cooldown: 60,
    burnRadius: 1,
    damageRadius: 4,
    damageCenter: 30,
    damageEdge: 5,
    speed: 26,
    /** Poloměr koule ≈ 15 cm → průměr 30 cm */
    radius: 0.15,
    color: 0xff7a28,
    hint: "Klikni v dosahu — ohnivá koule letí po oblouku planety (kopec ji zastaví)."
  },
  iceball: {
    id: "iceball",
    range: 27.5,
    castTime: 2,
    cooldown: 80,
    diameter: 3,
    travel: 50,
    speed: 16,
    contactDamage: 45,
    color: 0xeef6ff,
    hint: "Klikni směr — ledová koule se 50 m kutálí."
  },
  tornado: {
    id: "tornado",
    range: 16,
    castTime: 1.5,
    cooldown: 240,
    pullRadius: 10,
    innerRadius: 3,
    captureRadius: 0.6,
    pullSpeed: 3,
    fallDamage: 40,
    life: 18,
    color: 0xb8c4d4,
    hint: "Do 10 m vtahuje 3 m/s, chůze lineárně k nule ve 3 m."
  },
  volcano: {
    id: "volcano",
    range: 16,
    /** 3 s kouzlení, pak roste kopec — wizard může odejít */
    castPrepTime: 3,
    cooldown: 480,
    morphDuration: 3,
    color: 0xff3a18,

    /**
     * Tvar hory: pata 14 m, okraj kráteru 7 m nad patou → svah 43° pod
     * okrajem, 7° u paty (střední 33°), po celé délce konkávní.
     */
    coneRadius: 14,
    coneHeight: 7,
    /** >1 = konkávní svahy: nejstrmější pod okrajem, u paty splývají */
    flankPow: 1.4,
    craterRadius: 3.4,
    craterDepth: 2.4,
    craterFloorRadius: 1.6,
    /** Rovnoměrné snížení celého okraje — láva přeteče do všech stran */
    rimBreach: 0.7,
    /** Jemné zářezy (dřív silně směrové) — jen mírná nepravidelnost */
    notchDrop: 0.28,
    secondaryNotchDrop: 0.28,

    /** Láva — simulace výškového pole (m, m³, s) */
    lavaRadius: 76,
    /** Kratší a hustší výlev — kráter se rychle naplní a přeteče */
    eruptTime: 5,
    eruptRate: 62,
    /** Ztuhlá vrstva, která už nikdy neodteče — láva se šíří, neodtéká */
    lavaCrust: 0.06,
    /** Kritický spád hladiny (mez tekutosti) — nižší = dřív teče i mírným spádem */
    lavaYield: 0.018,
    /** Tekutost — vyšší = rychlejší tok po spádu */
    lavaMobility: 320,
    /** Chladnutí ležící lávy na kůru (s) */
    lavaHeatTime: 7,
    /** Tuhnutí do trvalé spáleniny po konci výlevu (s) */
    lavaFreezeTime: 6,
    lavaDps: 20,
    /** Magický strom — DPS horké lávy */
    treeLavaDps: 40,
    hint: "3 s kouzlení, pak sopka — láva se rychle vyvalí kolem, 20 HP/s. Zůstane spáleniště."
  },
  comet: {
    id: "comet",
    range: 18,
    castTime: 2,
    cooldown: 480,
    /** Od objevení v obrazovce do impaktu (s). */
    flightTime: 0.8,
    /** Průměr tělesa (m). */
    diameter: 5,
    /**
     * Přímý přílet začíná daleko na paprsku horní části obrazovky. Díky
     * perspektivě se těleso objeví jako tečka a plynule rychle naroste.
     */
    approachCameraDist: 220,
    approachNdcY: 0.94,
    approachHeight: 110,
    /** 0 = dráha z horní části obrazovky, 1 = čistě shora po normále. */
    approachVerticalBlend: 0.1,
    /** Okamžitá deprese a zóna odpaření v místě dopadu. */
    craterRadius: 5,
    craterDepth: 2.8,
    /** Zčernalá zem a damage radius (m). */
    scorchRadius: 10,
    damageRadius: 10,
    damageCenter: 200,
    damageEdge: 50,
    /** Mlha nad kráterem: krátké naběhnutí, hned rozplynutí (s). */
    dustHold: 0.2,
    dustFade: 2.7,
    color: 0xff8a2a,
    hint: "2 s kouzlení, 0,8 s přímý pád. Do 5 m vše zmizí, do 10 m damage 200→50 a hoří."
  },
  immortality: {
    id: "immortality",
    selfCast: true,
    range: 0,
    castTime: 0.1,
    cooldown: 180,
    holdTime: 5,
    /** 2× rychlost chůze */
    speed: 10,
    travel: 100,
    /** Poloměr koule kolem kouzelníka (m) */
    radius: 1.18,
    color: 0xffe08a,
    hint: "0,1 s kouzlení, 5 s nesmrtelnost. Klik = kutálení 2× chůze; po 100 m nebo čase koule praskne."
  },
  tree: {
    id: "tree",
    range: 16,
    /** Hod kuličky — žádné kouzlení / zaříkávání */
    castTime: 0.55,
    throwCast: true,
    cooldown: 10,
    growthTime: 20,
    maxHeight: 10,
    color: 0xe8c44a,
    hint: "Hod žlutou kuličku — na místě vyroste strom (20 s, 15 m). Po smrti stromu znovu."
  },
  hypnosis: {
    id: "hypnosis",
    range: 14,
    castTime: 2,
    cooldown: 180,
    radius: 8,
    holdTime: 20,
    color: 0xd080ff,
    hint: "Klikni v dosahu — hypnóza. Zvířata v 8 m jdou za tebou (max 20 s)."
  },
  watcher: {
    id: "watcher",
    range: 25,
    castTime: 3,
    cooldown: 180,
    radius: 35,
    maxCount: 5,
    color: 0xe8e0d0,
    hint: "Klikni v dosahu — Hlídač (max 5). FOV 35 m + alarm při cizím wizardovi. Do smrti majitele."
  },
  invisibility: {
    id: "invisibility",
    /** Klik na ikonu = rovnou cast (bez míření) */
    selfCast: true,
    range: 0,
    castTime: 3,
    cooldown: 240,
    holdTime: 10,
    /** Lokální hráč vidí sebe na 50 % */
    localOpacity: 0.5,
    /** Ostatní v MP nevidí vůbec */
    remoteOpacity: 0,
    color: 0xc8b8e8,
    hint: "Klikni — 3 s kouzlení, pak 10 s neviditelnost. Kouzlení zruší efekt."
  },
  earthquake: {
    id: "earthquake",
    range: 18,
    castTime: 3,
    cooldown: 300,
    effectRadius: 18,
    duration: 5,
    /** Wizard v zóně — HP/s (kutálení sem a tam) */
    dps: 10,
    /** Jedna otočka, posun od epicentra */
    fallRotations: 1,
    fallDistance: 3,
    color: 0xc4a060,
    hint: "Klikni v dosahu — 18 m zóny, 5 s. V zóně 10 HP/s a kutálení sem a tam, dokud nevyjdeš."
  }
};
