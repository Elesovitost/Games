import { WIZARD_COLORS, loadProfile, saveProfile } from "./client.js";

export class LobbyUI {
  constructor(game, session) {
    this.game = game;
    this.session = session;
    this.panel = document.getElementById("mp-panel");
    this.statusEl = document.getElementById("lobby-status");
    this.codeEl = document.getElementById("lobby-code");
    this.rosterEl = document.getElementById("lobby-roster");
    this.startBtn = document.getElementById("lobby-start");
    this.nameInput = document.getElementById("lobby-name");
    this.hostInput = document.getElementById("lobby-host");
    this.codeInput = document.getElementById("lobby-join-code");
    this.selectedColor = loadProfile().color;

    this.#fillProfile();
    this.#bind();
    this.render(null);
  }

  #fillProfile() {
    const p = loadProfile();
    if (this.nameInput) this.nameInput.value = p.name;
    if (this.hostInput) this.hostInput.value = p.host;
    this.selectedColor = p.color;
  }

  #bind() {
    document.getElementById("lobby-create")?.addEventListener("click", async () => {
      try {
        this.setStatus("Zakládám…");
        await this.session.create(this.#name(), this.selectedColor);
      } catch {
        this.setStatus("Server neběží. Spusť start-mp.bat (port 2567).");
      }
    });

    document.getElementById("lobby-join")?.addEventListener("click", async () => {
      const host = this.hostInput?.value?.trim() || "localhost";
      saveProfile({ host });
      const code = this.codeInput?.value?.trim() || "";
      try {
        this.setStatus("Připojuji…");
        await this.session.join(host, this.#name(), this.selectedColor, code);
      } catch {
        this.setStatus("Nelze připojit. Zkontroluj IP a že host má server.");
      }
    });

    document.getElementById("lobby-leave")?.addEventListener("click", () => {
      this.session.leave();
      this.render(null);
      this.game.enterSolo?.();
      this.setStatus("Odpojeno.");
    });

    this.startBtn?.addEventListener("click", () => this.session.startMatch());

    document.getElementById("mp-close")?.addEventListener("click", () => this.hide());

    this.hostInput?.addEventListener("change", () => {
      saveProfile({ host: this.hostInput.value.trim() });
    });
    this.nameInput?.addEventListener("change", () => {
      saveProfile({ name: this.#name() });
    });
  }

  refreshProfile() {
    this.#fillProfile();
  }

  #name() {
    return (this.nameInput?.value || "Hráč").trim().slice(0, 18) || "Hráč";
  }

  show() {
    this.panel?.classList.remove("hidden");
    this.#fillProfile();
  }

  hide() {
    this.panel?.classList.add("hidden");
  }

  setStatus(text) {
    if (this.statusEl) this.statusEl.textContent = text || "";
  }

  render(room) {
    if (!room) {
      if (this.codeEl) this.codeEl.textContent = "—";
      if (this.rosterEl) this.rosterEl.innerHTML = "";
      if (this.startBtn) {
        this.startBtn.classList.add("hidden");
        this.startBtn.disabled = true;
      }
      return;
    }

    if (this.codeEl) this.codeEl.textContent = room.code || "—";
    if (this.rosterEl) {
      this.rosterEl.innerHTML = "";
      for (const p of room.players || []) {
        const li = document.createElement("li");
        const sw = document.createElement("span");
        sw.className = "roster-swatch";
        sw.style.background = "#" + Number(p.color).toString(16).padStart(6, "0");
        li.appendChild(sw);
        li.appendChild(document.createTextNode(p.name + (p.id === room.hostId ? " (host)" : "")));
        this.rosterEl.appendChild(li);
      }
    }
    if (this.startBtn) {
      const show = this.session.isHost && room.phase !== "playing";
      this.startBtn.classList.toggle("hidden", !show);
      this.startBtn.disabled = !show || (room.players?.length || 0) < 1;
    }
  }
}
