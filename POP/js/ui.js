import { CONFIG } from "./config.js";
import { COMBAT } from "./combat.js";

export class UI {
  constructor(game) {
    this.game = game;
    this.modeEl = document.getElementById("mode");
    this.toastEl = document.getElementById("toast");
    this.toastTimer = 0;
    this.spellIds = Object.keys(CONFIG.spellLabels);
    this.vitRoot = document.getElementById("vitality");
    this.vitFill = document.getElementById("vit-fill");
    this.vitLabel = document.getElementById("vit-label");
    this.vitLives = document.getElementById("vit-lives");

    document.querySelectorAll(".spells button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.spell;
        this.setSpell(game.currentSpell === id ? null : id);
      });
    });
    this.refreshVitality();
  }

  setSpell(id) {
    const w = this.game.wizard;
    if (id && w && !w.canControl) {
      id = null;
    }
    this.game.currentSpell = id;
    document.querySelectorAll(".spells button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.spell === id);
    });
    document.body.classList.toggle("spell-aim", !!id);
    if (id) {
      this.modeEl.innerHTML = "Režim: <strong>Kouzlo — " + CONFIG.spellLabels[id] + "</strong>";
    } else {
      this.modeEl.innerHTML = "Režim: <strong>Chůze</strong>";
    }
  }

  refreshVitality() {
    const w = this.game.wizard;
    if (!this.vitRoot) return;
    if (!w) {
      this.vitRoot.classList.add("hidden");
      return;
    }
    this.vitRoot.classList.remove("hidden");
    const maxHp = COMBAT.maxHp;
    const hp = Math.max(0, Math.round(w.hp));
    const pct = Math.max(0, Math.min(1, w.hp / maxHp));
    this.vitFill.style.transform = `scaleX(${pct})`;
    this.vitLabel.textContent = hp + " / " + maxHp;
    const maxL = COMBAT.maxLives;
    let html = "";
    for (let i = 0; i < maxL; i++) {
      html += `<span class="${i < w.lives ? "" : "empty"}"></span>`;
    }
    this.vitLives.innerHTML = html;
  }

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("show");
    this.toastTimer = 2.2;
  }

  update(dt) {
    this.refreshVitality();
    if (this.toastTimer <= 0) return;
    this.toastTimer -= dt;
    if (this.toastTimer <= 0) this.toastEl.classList.remove("show");
  }
}
