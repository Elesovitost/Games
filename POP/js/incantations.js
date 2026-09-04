/** Hlášky při kouzlení — přiřazení ke kouzlům + zásoba. */
export const INCANTATION_DIR = "./audio/incantations/";

/** @type {Record<string, string>} spellId → soubor */
export const SPELL_INCANTATIONS = {
  lightning: "udelej_blesk_fac_fulgur.mp3",
  fireball: "hor_koule_arde_globus.mp3",
  earthquake: "zatres_zemi_muta_terram.mp3",
  tornado: "roztoc_vitr_rota_ventum.mp3",
  elevate: "vstan_zemi_surge_terra.mp3",
  depress: "propadni_se_pudo_rumpere_solum.mp3",
  iceball: "mrazem_tni_gelu_seca.mp3",
  invisibility: "chran_stine_protege_umbra.mp3",
  volcano: "vypukni_ohni_erumpe_ignis.mp3",
  immortality: "zmlkni_osude_tace_fatum.mp3",
  comet: "zahyn_vesmiru_peri_universum.mp3",
  hypnosis: "vezmi_dusi_sume_animam.mp3",
  demon: "prijd_demone_veni_daemon.mp3"
};

/** Nepřiřazené — budoucí kouzla / variace. */
export const INCANTATION_RESERVE = [
  "odhod_vsechno_pelle_omnia.mp3",
  "zarvi_rychle_intona_cito.mp3",
  "proklet_telo_maledic_corpus.mp3",
  "vstan_mrtvy_surge_mortuus.mp3"
];

export const INCANTATION_BG = "background1.mp3";
/** Podkres zaříkávání cizích kouzelníků (10 %). */
export const INCANTATION_BG_REMOTE = "background2.mp3";

export function incantationFileForSpell(spellId) {
  return SPELL_INCANTATIONS[spellId] ?? null;
}

export function allIncantationUrls() {
  const files = new Set([
    INCANTATION_BG,
    INCANTATION_BG_REMOTE,
    ...Object.values(SPELL_INCANTATIONS),
    ...INCANTATION_RESERVE
  ]);
  return [...files].map((f) => INCANTATION_DIR + f);
}
