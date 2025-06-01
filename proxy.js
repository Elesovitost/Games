app.get('/images', async (req, res) => {
  const word = req.query.q;
  if (!word) return res.status(400).send("Missing 'q'");

  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(word)}&form=HDRSC2&setlang=cs&cc=CZ`;

  try {
    console.log("🔍 Bing dotaz:", url);

    const html = await fetch(url, {
      headers: {
        "Accept-Language": "cs-CZ,cs;q=0.9"
      }
    }).then(r => r.text());

    // Najdi všechny výskyty atributu m="...JSON..."
    const matches = [...html.matchAll(/<a[^>]+class="[^"]*iusc[^"]*"[^>]+m="([^"]+?)"/g)];

    const images = matches
      .map(m => {
        try {
          const json = JSON.parse(m[1].replace(/&quot;/g, '"'));
          return json.murl;
        } catch {
          return null;
        }
      })
      .filter(url => url && url.startsWith('http'))
      .slice(0, 3);

    res.json({
      query: url,
      images
    });

  } catch (err) {
    console.error("❌ Chyba při zpracování obrázků:", err);
    res.status(500).send("Chyba při načítání obrázků");
  }
});
