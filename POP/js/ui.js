import { CONFIG } from "./config.js";

export class UI {
  constructor(game) {
    this.game = game;
    this.modeEl = document.getElementById("mode");
    this.toastEl = document.getElementById("toast");
    this.toastTimer = 0;
    this.spellIds = Object.keys(CONFIG.spellLabels);

    document.querySelectorAll(".spells button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.spell;
        this.setSpell(game.currentSpell === id ? null : id);
      });
    });
  }

  setSpell(id) {
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

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("show");
    this.toastTimer = 2.2;
  }

  update(dt) {
    if (this.toastTimer <= 0) return;
    this.toastTimer -= dt;
    if (this.toastTimer <= 0) this.toastEl.classList.remove("show");
  }
}
