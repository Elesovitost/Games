import { preloadAllMapHeightsAsync } from "./map-heights-cache.js";
import { warmRenderer } from "./resources.js";

export class LoadingScreen {
  constructor() {
    this.el = document.getElementById("loader");
    this.bar = document.getElementById("loader-bar");
    this.label = document.getElementById("loader-label");
    this.pct = document.getElementById("loader-pct");
  }

  setProgress(ratio, text) {
    const p = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    if (this.bar) this.bar.style.width = p + "%";
    if (this.pct) this.pct.textContent = p + "%";
    if (text && this.label) this.label.textContent = text;
  }

  hide() {
    if (!this.el) return;
    this.el.classList.add("hidden");
    setTimeout(() => this.el?.remove(), 450);
  }
}

/** Přednačte mapy, svět a shadery do paměti. */
export async function preloadGame(game, loader) {
  loader.setProgress(0, "Načítám mapy…");
  await preloadAllMapHeightsAsync((ratio, name) => {
    loader.setProgress(ratio * 0.55, "Mapa: " + name);
  });

  loader.setProgress(0.6, "Spawn dekorace…");
  game.spawnDecor.rebuild(game.mapId);
  await frame();

  loader.setProgress(0.75, "Grafika a světla…");
  game.quality.apply();
  await frame();

  loader.setProgress(0.88, "Kompilace shaderů…");
  game.quality.applyEntityShadows();
  await warmRenderer(game.renderer, game.scene, game.camera);
  game.renderer.shadowMap.autoUpdate = true;
  game.renderer.shadowMap.needsUpdate = true;
  if (game.sun?.shadow) game.sun.shadow.needsUpdate = true;
  game.sky?.setSunDirection?.(game.sun);

  loader.setProgress(1, "Hotovo");
  await sleep(100);
}

function frame() {
  return new Promise((r) => requestAnimationFrame(r));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
