import {
  loadProfile,
  saveProfile,
  hostForMode,
  internetHost,
  wakeInternetServer,
  normalizeNetMode
} from "./client.js";

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
    this.hostField = document.getElementById("lobby-host-field");
    this.codeInput = document.getElementById("lobby-join-code");
    this.modeLocalBtn = document.getElementById("lobby-mode-local");
    this.modeInternetBtn = document.getElementById("lobby-mode-internet");
    this.selectedColor = loadProfile().color;
    this.mode = normalizeNetMode(loadProfile().mode);
    this._wakeGen = 0;

    this.#fillProfile();
    this.#bind();
    this.#applyModeUi();
    this.render(null);
  }

  #fillProfile() {
    const p = loadProfile();
    if (this.nameInput) this.nameInput.value = p.name;
    if (this.hostInput) this.hostInput.value = p.host;
    this.selectedColor = p.color;
    this.mode = normalizeNetMode(p.mode);
  }

  #bind() {
    this.modeLocalBtn?.addEventListener("click", () => this.#setMode("local"));
    this.modeInternetBtn?.addEventListener("click", () => this.#setMode("internet"));

    document.getElementById("lobby-create")?.addEventListener("click", async () => {
      const host = this.#resolveHost();
      if (!host) {
        this.setStatus("Chybí netInternetHost v config.js (po deployi na Render).");
        return;
      }
      try {
        this.setStatus(this.mode === "internet" ? "Připojuji k internetovému serveru…" : "Zakládám…");
        await this.session.create(this.#name(), this.selectedColor, host);
      } catch {
        this.setStatus(
          this.mode === "internet"
            ? "Internetový server neodpověděl. Počkej na probuzení a zkus znovu."
            : "Server neběží. Spusť start-mp.bat (port 2567)."
        );
      }
    });

    document.getElementById("lobby-join")?.addEventListener("click", async () => {
      const host = this.#resolveHost();
      if (!host) {
        this.setStatus("Chybí netInternetHost v config.js (po deployi na Render).");
        return;
      }
      if (this.mode === "local") saveProfile({ host });
      const code = this.codeInput?.value?.trim() || "";
      try {
        this.setStatus(this.mode === "internet" ? "Připojuji k internetovému serveru…" : "Připojuji…");
        await this.session.join(host, this.#name(), this.selectedColor, code);
      } catch {
        this.setStatus(
          this.mode === "internet"
            ? "Nelze připojit. Server se možná ještě budí — zkus znovu."
            : "Nelze připojit. Zkontroluj IP a že host má server."
        );
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

  #resolveHost() {
    if (this.mode === "internet") return internetHost() || null;
    return hostForMode("local", this.hostInput?.value?.trim() || "localhost");
  }

  #setMode(mode) {
    const next = normalizeNetMode(mode);
    if (this.mode === next) {
      if (next === "internet") this.#wakeInternet();
      return;
    }
    this.mode = next;
    saveProfile({ mode: next });
    this.#applyModeUi();
    if (next === "internet") this.#wakeInternet();
    else this.setStatus("Lokální server (start-mp.bat).");
  }

  #applyModeUi() {
    const internet = this.mode === "internet";
    this.modeLocalBtn?.classList.toggle("active", !internet);
    this.modeInternetBtn?.classList.toggle("active", internet);
    this.modeLocalBtn?.setAttribute("aria-pressed", String(!internet));
    this.modeInternetBtn?.setAttribute("aria-pressed", String(internet));
    if (this.hostField) this.hostField.classList.toggle("hidden", internet);
  }

  /** Při výběru Internetu hned klepneme na HTTPS health → Render cold start. */
  #wakeInternet() {
    const host = internetHost();
    if (!host) {
      this.setStatus("Doplň CONFIG.netInternetHost po deployi na Render.");
      return;
    }
    const gen = ++this._wakeGen;
    this.setStatus("Budím internetový server… (až ~1 min při spánku)");
    wakeInternetServer().then((r) => {
      if (gen !== this._wakeGen || this.mode !== "internet") return;
      if (r.ok) this.setStatus("Internetový server připraven.");
      else if (r.reason === "missing") {
        this.setStatus("Doplň CONFIG.netInternetHost po deployi na Render.");
      } else {
        this.setStatus("Server se budí nebo není nasazený — zkus Založit / Připojit za chvíli.");
      }
    });
  }

  refreshProfile() {
    this.#fillProfile();
    this.#applyModeUi();
  }

  #name() {
    return (this.nameInput?.value || "Hráč").trim().slice(0, 18) || "Hráč";
  }

  show() {
    this.panel?.classList.remove("hidden");
    this.#fillProfile();
    this.#applyModeUi();
    if (this.mode === "internet") this.#wakeInternet();
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
