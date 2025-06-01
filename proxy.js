const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors({
	origin: ['http://localhost:8080', 'https://abeceda-production.up.railway.app', 'https://elesovitost.github.io']
}));

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

    const matches = [...html.matchAll(/<img[^>]+src="([^"]+?)"[^>]*>/g)];

    const images = matches
      .map(m => m[1])
      .filter(src => src.startsWith('https'))
      .slice(0, 3);

    res.json({
      query: url,
      images
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Chyba při načítání obrázků");
  }
});

app.listen(process.env.PORT || 3000);

