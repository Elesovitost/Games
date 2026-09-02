const PLANET_R = 80;

/**
 * Měřítko světa: 1 world unit = 1 metr.
 * Kouzelník ≈ 2 m. Poloměr planety = 80 m.
 */
export const CONFIG = {
  planetR: PLANET_R,
  /** Referenční výška kouzelníka (m) */
  wizardHeightM: 2,
  wizardMaxHp: 100,
  /** Regenerace HP ve spawn kruhu (HP/s) */
  spawnHealPerSec: 5,
  waterLevel: PLANET_R + 0.35,
  icoSubdiv: 6,
  waterSubdiv: 5,
  /** cos(60°) — render horní čtvrtiny směrem ke kameře */
  visibleCapDot: 0.5,
  heightGrid: 64,
  minR: PLANET_R * 0.72,
  maxR: PLANET_R * 1.42,
  camHeight: 21,
  camBack: 17,
  camLook: 13,
  /** Kolečko myši — 1 = výchozí pohled */
  camZoomMin: 0.42,
  camZoomMax: 2.6,
  focusDir: [1, 1, 1],
  rotSpeed: 0.18,
  wizardSpeed: 5,
  /** Max. zrychlení z kopce */
  wizardDownhillBoost: 1.28,
  /** Min. rychlost v extrémním stoupání */
  wizardUphillMin: 0.14,
  /** Min. výška nad hladinou, aby kouzelník nešel do vody / mokré pláže */
  wizardMinLand: 0.15,
  /** Rychlost v hluboké vodě (násobek) */
  wizardWaterSpeedMul: 0.32,
  /** Ztráta HP při potopené hlavě (HP/s) */
  wizardDrownHpPerSec: 20,
  /** Min. poloměr terénu — lze chodit i pod vodou */
  wizardMinTerrainR: PLANET_R * 0.72 + 0.08,
  /** Dojede na klik, když je blíž než tolik metrů po povrchu */
  wizardArrive: 0.55,
  /** GOD MODE — násobič rychlosti chůze (testování) */
  godModeSpeedMul: 10,
  spellDuration: 5,
  /** Poloměr morphu elevace/deprese (m) */
  spellRadius: 7.5,
  /** +1 m dosahu kouzla za každý 1 m nad referenční rovinou (planetR) */
  spellRangePerHeightM: 1,
  spellAmount: 4.2,
  /** Průměr cílové spirály (m) */
  spellSpiralDiameter: 1,
  shadowMapSize: 1024,
  shadowFrustumHalf: 128,
  /** Rozmazání okraje stínu (PCFSoft) — levnější než větší mapa */
  shadowSoftRadius: 3.5,
  pixelRatioMax: 1.35,
  resolutionScale: 0.92,
  landColor: [0.26, 0.52, 0.16],
  waterColor: [0.05, 0.18, 0.52],
  sandColor: [0.9, 0.76, 0.46],
  swampColor: [0.22, 0.08, 0.16],
  netPort: 2567,
  /** Interval odesílání pose v MP (s) — ~20 Hz */
  netPoseInterval: 0.05,
  /** Zpoždění interpolace vzdáleného hráče (s) — vyhlazuje skoky mezi snímky */
  netPoseInterpDelay: 0.08,
  /** Min. damage pro knockdown */
  wizardKnockMinDamage: 10,
  wizardKnockFallDur: 0.08,
  wizardKnockLieDur: 0.4,
  wizardKnockRiseDur: 0.82,
  wizardKnockSlideImpulse: 10,
  wizardKnockSlideFriction: 3.2,
  wizardKnockDistMin: 2,
  wizardKnockDistMax: 10,
  /** Sudy = 1 + (damage/maxHp) × extra; při plném zásahu */
  wizardKnockExtraRotationsMax: 7,
  wizardKnockRollRadius: 0.2,
  defaultMapSeed: 20260829,
  /** SFX: plná hlasitost do této vzdálenosti od pohledu kamery (m) */
  sfxRefDist: 8,
  /** SFX: každých tolik metrů hlasitost cca na polovinu */
  sfxHalfDist: 7,
  /** SFX: hard cutoff — dál už neslyšet (m) */
  sfxMaxDist: 110
};
