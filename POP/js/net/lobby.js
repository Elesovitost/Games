import { WIZARD_COLORS, loadProfile } from "./client.js";

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
    this.colorsEl = document.getElementById("lobby-colors");
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
    if (!this.colorsEl) return;
    this.colorsEl.innerHTML = "";
    for (const c of WIZARD_COLORS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "color-swatch" + (c.hex === this.selectedColor ? " active" : "");
      btn.style.background = "#" + c.hex.toString(16).padStart(6, "0");
      btn.title = c.label;
      btn.addEventListener("click", () => {
        this.selectedColor = c.hex;
        this.colorsEl.querySelectorAll(".color-swatch").forEach((el) => el.classList.remove("active"));
        btn.classList.add("active");
      });
      this.colorsEl.appendChild(btn);
    }
  }

  #bind() {
    document.querySelectorAll("[data-play-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.playMode;
        document.querySelectorAll("[data-play-mode]").forEach((b) => {
          b.classList.toggle("active", b.dataset.playMode === mode);
        });
        if (mode === "1p") {
          this.hide();
          if (this.session.isMp) this.session.leave();
          this.game.enterSolo?.();
        } else {
          this.show();
        }
      });
    });

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
      const code = this.codeInput?.value?.trim() || "";
      try {
        this.setStatus("Připojuji…");
        await this.session.join(host, this.#name(), this.selectedColor, code);
      } catch {
        this.setStatus("Nelze připojit. Zkontroluj IP a že host má spuštěný server (port 2567).");
      }
    });

    document.getElementById("lobby-leave")?.addEventListener("click", () => {
      this.session.leave();
      this.render(null);
      this.game.enterSolo?.();
      this.setStatus("Odpojeno.");
    });

    this.startBtn?.addEventListener("click", () => this.session.startMatch());

    document.getElementById("mp-close")?.addEventListener("click", () => {
      document.querySelector('[data-play-mode="1p"]')?.click();
    });
  }

  #name() {
    return (this.nameInput?.value || "Hráč").trim().slice(0, 18) || "Hráč";
  }

  show() {
    this.panel?.classList.remove("hidden");
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

    if (this.codeEl) this.codeEl.textContent = room.code;
    if (this.rosterEl) {
      this.rosterEl.innerHTML = "";
      for (const p of room.players) {
        const li = document.createElement("li");
        const sw = document.createElement("span");
        sw.className = "roster-swatch";
        sw.style.background = "#" + Number(p.color).toString(16).padStart(6, "0");
        li.appendChild(sw);
        li.appendChild(document.createTextNode(
          p.name + (p.id === room.hostId ? " (host)" : "") +
          (p.id === this.session.localId ? " — ty" : "")
        ));
        this.rosterEl.appendChild(li);
      }
    }

    const isHost = this.session.isHost;
    const canStart = isHost && room.phase === "lobby" && room.players.length >= 1;
    if (this.startBtn) {
      this.startBtn.classList.toggle("hidden", !isHost || room.phase === "playing");
      this.startBtn.disabled = !canStart;
      this.startBtn.textContent = room.players.length < 2
        ? "Spustit (solo v MP)"
        : "Spustit hru";
    }

    if (room.phase === "lobby") {
      this.setStatus(
        isHost
          ? "Pošli ostatním svou IP a kód " + room.code
          : "Čekám na start od hostitele…"
      );
    } else if (room.phase === "playing") {
      this.setStatus("Hra běží.");
    }
  }
}
