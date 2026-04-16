// api/hash.js
// Fetches individual ABB book page and extracts the info hash from torrent_infos table.
// Called lazily when user taps "Send to RD" to avoid hammering ABB on every search.
const cheerio = require('cheerio');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-RD-Auth',
};

module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const slug = req.method === 'POST' ? (req.body?.slug || req.body) : req.query.slug;
  if (!slug) return res.status(400).json({ error: 'slug required' });

  try {
    const url = `https://audiobookbay.lu/${slug}/`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ABB-RD-PWA/1.0)' },
    });
    if (!response.ok) throw new Error(`ABB page returned ${response.status}`);
    const html = await response.text();
    const $ = cheerio.load(html);

    // Primary: table.torrent_infos row where first td = "Info Hash:"
    let hash = null;
    $('table.torrent_infos tr, table tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 2 && cells.first().text().trim().toLowerCase().includes('info hash')) {
        hash = cells.eq(1).text().trim().toLowerCase().replace(/[^a-f0-9]/g, '');
      }
    });

    // Fallback: look for magnet link on the page
    if (!hash) {
      const magnet = $('a[href^="magnet:"]').first().attr('href') || '';
      const m = magnet.match(/xturn:btih:([a-f0-9]{40})/i) || magnet.match(/btih:([a-f0-9]{40})/i);
      if (m) hash = m[1].toLowerCase();
    }

    if (!hash) return res.status(404).json({ error: 'Hash not found on page', slug });

    const magnet = `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(slug)}`;
    res.status(200).json({ hash, magnet, slug });
  } catch (err) {
    console.error('Hash fetch error:', err);
    res.status(500).json({ error: err.message });
  }
};
