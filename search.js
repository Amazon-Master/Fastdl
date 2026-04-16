// api/search.js
// Step 1: Search ABB for book list (titles + page slugs + sizes)
// Step 2 (lazy, on demand): /api/hash fetches individual pages for info hash
const cheerio = require('cheerio');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-RD-Auth',
};

module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  const { query } = body || {};
  if (!query) return res.status(400).json({ error: 'query required' });

  try {
    const url = `https://audiobookbay.lu/?s=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ABB-RD-PWA/1.0)' },
    });
    if (!response.ok) throw new Error(`ABB returned ${response.status}`);
    const html = await response.text();
    const $ = cheerio.load(html);

    const results = [];
    $('div.post').each((_, el) => {
      const titleEl = $(el).find('p.title a, h2 a').first();
      const title = titleEl.text().trim();
      const href = titleEl.attr('href') || '';
      // Extract slug from URL like https://audiobookbay.lu/some-book-title/
      const slug = href.replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '');

      // Try to grab size from post info text
      const postText = $(el).find('.postInfo, .post-info, p').text();
      const sizeMatch = postText.match(/(\d+(?:\.\d+)?\s*(?:GB|MB))/i);
      const size = sizeMatch ? sizeMatch[1] : 'Unknown';

      // Try to grab author/narrator from subtitle
      const subtitle = $(el).find('p.title').next('p').text().trim()
        || $(el).find('.postInfo').text().match(/by ([^|]+)/i)?.[1]?.trim() || '';

      if (title && slug) {
        results.push({ title, slug, size, subtitle });
      }
    });

    res.status(200).json({ results, count: results.length });
  } catch (err) {
    console.error('ABB search error:', err);
    res.status(500).json({ error: err.message });
  }
};
