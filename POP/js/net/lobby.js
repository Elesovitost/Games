import { loadProfile, saveProfile, WIZARD_COLORS, loadMpPrefs } from "./session.js";

const HINTS = {
  local: "Stejný prohlížeč, více oken — bez serveru.",
  network: "LAN / Wi‑Fi — všichni se připojí k IP PC s běžícím relay."
};

export class LobbyUI {
  constructor(game, session) {
    this.game = game;
    this.session = session;
    this.panel = document.getElementById("mp-panel");
    this.networkFields = document.getElementById("mp-network-fields");
    this.transportHint = document.getElementById("mp-transport-hint");
    this.rosterEl = document.getElementById("lobby-roster");
    this.codeEl = document.getElementById("lobby-code");
    this.statusEl = document.getElementById("lobby-status");
    this.startBtn = document.getElementById("lobby-start");
    this.nameInput = document.getElementById("lobby-name");
    this.colorSelect = document.getElementById("lobby-color");
    this.joinCodeInput = document.getElementById("lobby-join-code");
    this.hostInput = document.getElementById("lobby-host");

    const profile = loadProfile();
    const prefs = loadMpPrefs();
    this.nameInput.value = profile.name;
    this.hostInput.value = prefs.host;
    for (const c of WIZARD_COLORS) {
      const opt = document.createElement("option");
      opt.value = String(c.hex);
      opt.textContent = c.label;
      if (c.hex === profile.color) opt.selected = true;
      this.colorSelect.appendChild(opt);
    }

    document.querySelectorAll("[data-play-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.playMode;
        session.setMode(mode);
        this.#syncChrome();
      });
    });

    document.querySelectorAll("[data-mp-transport]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const transport = btn.dataset.mpTransport;
        session.setTransport(transport, this.hostInput.value).then(() => {
          this.#syncChrome();
          this.render(session.room);
        });
      });
    });

    this.hostInput.addEventListener("change", () => {
      if (session.mpTransport !== "network") return;
      session.setTransport("network", this.hostInput.value).then(() => {
        this.render(session.room);
      });
    });

    document.getElementById("lobby-create").addEventListener("click", async () => {
      if (session.mpTransport === "network") {
        await session.setTransport("network", this.hostInput.value);
      }
      const { name, color } = this.#profile();
      session.create(name, color);
    });

    document.getElementById("lobby-join").addEventListener("click", async () => {
      if (session.mpTransport === "network") {
        await session.setTransport("network", this.hostInput.value);
      }
      const { name, color } = this.#profile();
      const code = this.joinCodeInput.value.trim().toUpperCase();
      if (!code) {
        game.ui.toast("Zadej kód místnosti.");
        return;
      }
      session.join(code, name, color);
    });

    this.startBtn.addEventListener("click", () => session.startMatch());

    document.getElementById("lobby-leave").addEventListener("click", () => {
      session.leave();
      this.render(null);
      this.statusEl.textContent = "Opustil jsi místnost.";
    });

    const persist = () => {
      const { name, color } = this.#profile();
      saveProfile(name, color);
      session.updateProfile(name, color);
    };
    this.nameInput.addEventListener("change", persist);
    this.colorSelect.addEventListener("change", persist);

    this.#syncChrome();
    this.render(null);
  }

  #profile() {
    return {
      name: (this.nameInput.value || "Hráč").trim().slice(0, 18),
      color: Number(this.colorSelect.value) || WIZARD_COLORS[0].hex
    };
  }

  #syncChrome() {
    document.querySelectorAll("[data-play-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.playMode === this.session.mode);
    });

    const mp = this.session.mode === "mp";
    this.panel.classList.toggle("hidden", !mp);
    document.getElementById("game-panel").classList.toggle("dimmed", mp && !this.session.playing);

    const transport = this.session.mpTransport;
    document.querySelectorAll("[data-mp-transport]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mpTransport === transport);
    });
    this.networkFields.classList.toggle("hidden", transport !== "network");
    this.transportHint.textContent = HINTS[transport] || HINTS.local;
  }

  render(room) {
    this.#syncChrome();
    if (!room) {
      this.codeEl.textContent = "—";
      this.rosterEl.innerHTML = "";
      this.startBtn.disabled = true;
      this.startBtn.classList.add("hidden");
      if (this.session.mode === "mp") {
        const t = this.session.net.transport;
        const prefer = this.session.mpTransport;
        if (prefer === "local") {
          this.statusEl.textContent =
            t === "local"
              ? "Lokální MP připraveno — založ hru, druhé okno ať se připojí kódem."
              : "Připojuji lokální MP…";
        } else if (t === "ws") {
          this.statusEl.textContent = "Připojeno k relay — založ hru nebo se připoj kódem.";
        } else {
          this.statusEl.textContent = "Čekám na relay… zkontroluj IP a start-mp.bat.";
        }
      }
      return;
    }

    this.codeEl.textContent = room.code;
    const localId = this.session.localId;
    this.rosterEl.innerHTML = room.players
      .map((p) => {
        const host = p.id === room.hostId ? " · host" : "";
        const you = p.id === localId ? " (ty)" : "";
        const swatch = `<span class="swatch" style="background:#${(p.color >>> 0).toString(16).padStart(6, "0")}"></span>`;
        return `<li>${swatch}<span>${escapeHtml(p.name)}${you}${host}</span></li>`;
      })
      .join("");

    const isHost = room.hostId === localId;
    this.startBtn.classList.toggle("hidden", !isHost || room.phase === "playing");
    this.startBtn.disabled = !isHost || room.phase === "playing" || room.players.length < 1;

    if (room.phase === "playing") {
      this.statusEl.textContent = "Hra běží · kód " + room.code;
    } else if (isHost) {
      this.statusEl.textContent = "Jsi hostitel — až budou všichni, spusť hru.";
    } else {
      this.statusEl.textContent = "Čeká se na start od hostitele…";
    }
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
