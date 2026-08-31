/** Soubory, z nichž se bere nejnovější datum úpravy (HTTP Last-Modified). */
const SOURCES = [
  "../index.html",
  "../css/style.css",
  "./config.js",
  "./main.js",
  "./game-version.js",
  "./wizard.js",
  "./terrain.js",
  "./water.js",
  "./sky.js",
  "./trees.js",
  "./spells/system.js",
  "./spells/fireball.js",
  "./spells/iceball.js",
  "./spells/lightning.js",
  "./net/session.js",
  "./net/client.js",
  "./net/lobby.js"
];

function formatVersion(ms) {
  const d = new Date(ms);
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${day}.${month}. ${h}:${m}`;
}

/** Nejnovější Last-Modified ze zdrojáků (vyžaduje HTTP server, ne file://). */
export async function resolveGameVersion() {
  let latest = 0;
  await Promise.all(
    SOURCES.map(async (rel) => {
      try {
        const res = await fetch(new URL(rel, import.meta.url), {
          method: "HEAD",
          cache: "no-store"
        });
        const lm = res.headers.get("Last-Modified");
        if (lm) latest = Math.max(latest, Date.parse(lm));
      } catch {
        /* file:// nebo nedostupný soubor */
      }
    })
  );
  if (latest > 0) return formatVersion(latest);
  const htmlTime = Date.parse(document.lastModified);
  if (htmlTime) return formatVersion(htmlTime);
  return "—";
}

export function mountGameVersion(el) {
  if (!el) return;
  resolveGameVersion().then((v) => {
    el.textContent = v;
  });
}
