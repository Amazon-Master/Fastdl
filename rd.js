// api/rd.js
// Unified Real-Debrid proxy. Forwards requests to RD API with Bearer auth.
// Client sends API key as "X-RD-Auth: Bearer <key>" header — never stored server-side.
//
// Supported actions (POST body: { action, ...params }):
//   addMagnet  { magnet }                 → POST /torrents/addMagnet
//   info       { id }                     → GET  /torrents/info/{id}
//   selectFiles{ id, files }              → POST /torrents/selectFiles/{id}
//   unrestrict { link }                   → POST /unrestrict/link
//   list                                  → GET  /torrents

const RD_BASE = 'https://api.real-debrid.com/rest/1.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-RD-Auth',
};

module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['x-rd-auth'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing X-RD-Auth: Bearer <key> header' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  const { action, ...params } = body || {};
  const headers = { Authorization: authHeader };

  try {
    let rdRes;
    switch (action) {
      case 'addMagnet': {
        if (!params.magnet) return res.status(400).json({ error: 'magnet required' });
        const form = new URLSearchParams({ magnet: params.magnet });
        rdRes = await fetch(`${RD_BASE}/torrents/addMagnet`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        });
        break;
      }
      case 'info': {
        if (!params.id) return res.status(400).json({ error: 'id required' });
        rdRes = await fetch(`${RD_BASE}/torrents/info/${params.id}`, { headers });
        break;
      }
      case 'selectFiles': {
        if (!params.id) return res.status(400).json({ error: 'id required' });
        const files = params.files || 'all';
        const form = new URLSearchParams({ files: Array.isArray(files) ? files.join(',') : files });
        rdRes = await fetch(`${RD_BASE}/torrents/selectFiles/${params.id}`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        });
        // RD returns 204 No Content on success
        if (rdRes.status === 204) return res.status(200).json({ success: true });
        break;
      }
      case 'unrestrict': {
        if (!params.link) return res.status(400).json({ error: 'link required' });
        const form = new URLSearchParams({ link: params.link });
        rdRes = await fetch(`${RD_BASE}/unrestrict/link`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        });
        break;
      }
      case 'list': {
        rdRes = await fetch(`${RD_BASE}/torrents`, { headers });
        break;
      }
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    const text = await rdRes.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    res.status(rdRes.ok ? 200 : rdRes.status).json(data);
  } catch (err) {
    console.error('RD proxy error:', err);
    res.status(500).json({ error: err.message });
  }
};
