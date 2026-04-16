// app.js — Alpine.js application logic
// Imported as a module from index.html

import { saveApiKey, loadApiKey, clearApiKey, saveQueue, loadQueue } from './crypto.js';

const POLL_INTERVAL_MS = 6000;  // 6s between status polls
const SIZE_BLOB_LIMIT = 400 * 1024 * 1024; // 400 MB — larger → Safari native downloader

// ── RD API helper ──────────────────────────────────────────────────────────────
async function rd(action, params, apiKey) {
  const res = await fetch('/api/rd', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RD-Auth': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `RD ${action} failed (${res.status})`);
  }
  return res.json();
}

// ── Alpine component ───────────────────────────────────────────────────────────
window.abbApp = function () {
  return {
    // State
    tab: 'search',        // 'search' | 'queue' | 'settings'
    searchQuery: '',
    results: [],
    queue: [],
    apiKey: '',
    apiKeySaved: false,
    apiKeyInput: '',
    isSearching: false,
    searchError: '',
    notification: '',

    // ── Lifecycle ──────────────────────────────────────────────────────────────
    async init() {
      this.queue = await loadQueue();
      const key = await loadApiKey();
      if (key) { this.apiKey = key; this.apiKeySaved = true; }
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(console.error);
      }
      // Resume any in-progress downloads
      this.queue.filter(i => i.status === 'downloading' || i.status === 'queued')
        .forEach(item => this.pollItem(item));
    },

    // ── Search ─────────────────────────────────────────────────────────────────
    async search() {
      if (!this.searchQuery.trim()) return;
      this.isSearching = true;
      this.searchError = '';
      this.results = [];
      try {
        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: this.searchQuery }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Search failed');
        this.results = data.results || [];
        if (!this.results.length) this.searchError = 'No results found.';
      } catch (err) {
        this.searchError = err.message;
      } finally {
        this.isSearching = false;
      }
    },

    // ── Send to RD ─────────────────────────────────────────────────────────────
    async sendToRD(book) {
      if (!this.apiKey) {
        this.notify('⚠️ Enter your RD API key in Settings first.');
        this.tab = 'settings';
        return;
      }

      const item = {
        id: crypto.randomUUID(),
        title: book.title,
        slug: book.slug,
        size: book.size,
        status: 'fetching_hash',
        rdId: null,
        links: [],
        error: null,
        progress: 0,
      };
      this.queue.unshift(item);
      await saveQueue(this.queue);
      this.tab = 'queue';

      try {
        // Step 1: Fetch hash from book's detail page
        this.updateItem(item.id, { status: 'fetching_hash' });
        const hashRes = await fetch('/api/hash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: book.slug }),
        });
        const hashData = await hashRes.json();
        if (!hashRes.ok || !hashData.hash) throw new Error(hashData.error || 'Hash not found');

        // Step 2: Add magnet to RD
        this.updateItem(item.id, { status: 'adding_magnet' });
        const added = await rd('addMagnet', { magnet: hashData.magnet }, this.apiKey);
        const rdId = added.id;
        this.updateItem(item.id, { rdId, status: 'selecting_files' });

        // Step 3: Wait briefly, get file list, select audio files
        await sleep(2000);
        const info = await rd('info', { id: rdId }, this.apiKey);
        const audioFiles = (info.files || []).filter(f =>
          /\.(mp3|m4b|m4a|ogg|flac|aac|opus)$/i.test(f.path)
        );
        const fileIds = audioFiles.length
          ? audioFiles.map(f => f.id)
          : 'all';
        await rd('selectFiles', { id: rdId, files: fileIds }, this.apiKey);

        // Step 4: Poll until downloaded
        this.updateItem(item.id, { status: 'queued' });
        this.pollItem(this.queue.find(i => i.id === item.id));

      } catch (err) {
        this.updateItem(item.id, { status: 'error', error: err.message });
        await saveQueue(this.queue);
      }
    },

    // ── Poll torrent status ────────────────────────────────────────────────────
    async pollItem(item) {
      if (!item || !item.rdId) return;
      const maxAttempts = 120; // 12 minutes max
      let attempts = 0;

      const tick = async () => {
        attempts++;
        if (attempts > maxAttempts) {
          this.updateItem(item.id, { status: 'error', error: 'Timed out waiting for RD' });
          await saveQueue(this.queue);
          return;
        }

        // Re-fetch current item from queue (may have been cleared)
        const current = this.queue.find(i => i.id === item.id);
        if (!current || current.status === 'error' || current.status === 'ready') return;

        try {
          const info = await rd('info', { id: item.rdId }, this.apiKey);
          const status = info.status;
          const progress = info.progress || 0;

          if (status === 'downloaded') {
            // Unrestrict all links
            const directLinks = [];
            for (const link of (info.links || [])) {
              try {
                const unr = await rd('unrestrict', { link }, this.apiKey);
                if (unr.download) directLinks.push({ filename: unr.filename, url: unr.download, filesize: unr.filesize });
              } catch { /* skip failed links */ }
            }
            this.updateItem(item.id, { status: 'ready', links: directLinks, progress: 100 });
            await saveQueue(this.queue);
            this.notify(`✅ "${current.title}" ready to download!`);
          } else if (status === 'error' || status === 'virus' || status === 'dead') {
            this.updateItem(item.id, { status: 'error', error: `RD status: ${status}` });
            await saveQueue(this.queue);
          } else {
            const friendly = {
              magnet_conversion: 'Converting magnet…',
              waiting_files_selection: 'Waiting for files…',
              queued: 'Queued on RD…',
              downloading: `Downloading ${progress}%`,
              compressing: 'Compressing…',
              uploading: 'Uploading…',
            };
            this.updateItem(item.id, { status: status, statusLabel: friendly[status] || status, progress });
            setTimeout(tick, POLL_INTERVAL_MS);
          }
        } catch (err) {
          // Transient error — keep polling
          setTimeout(tick, POLL_INTERVAL_MS * 2);
        }
      };

      setTimeout(tick, POLL_INTERVAL_MS);
    },

    // ── Download ───────────────────────────────────────────────────────────────
    async download(link) {
      const { url, filename, filesize } = link;
      if (filesize && filesize > SIZE_BLOB_LIMIT) {
        // Large file: open in new tab → Safari native downloader
        window.open(url, '_blank');
        return;
      }
      // Small-ish file: fetch → Blob → <a download>
      try {
        this.notify('⬇️ Starting download…');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename || 'audiobook.m4b';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      } catch (err) {
        // Fallback to native
        this.notify('Blob download failed — opening in browser.');
        window.open(url, '_blank');
      }
    },

    // ── Settings ───────────────────────────────────────────────────────────────
    async saveKey() {
      const key = this.apiKeyInput.trim();
      if (!key) return;
      await saveApiKey(key);
      this.apiKey = key;
      this.apiKeySaved = true;
      this.apiKeyInput = '';
      this.notify('🔑 API key saved (encrypted locally).');
    },

    async clearKey() {
      await clearApiKey();
      this.apiKey = '';
      this.apiKeySaved = false;
      this.notify('API key cleared.');
    },

    clearQueue() {
      this.queue = this.queue.filter(i => i.status === 'downloading' || i.status === 'queued');
      saveQueue(this.queue);
    },

    // ── Helpers ────────────────────────────────────────────────────────────────
    updateItem(id, patch) {
      const idx = this.queue.findIndex(i => i.id === id);
      if (idx >= 0) Object.assign(this.queue[idx], patch);
    },

    notify(msg) {
      this.notification = msg;
      setTimeout(() => { if (this.notification === msg) this.notification = ''; }, 4000);
    },

    statusIcon(status) {
      return {
        fetching_hash: '🔍',
        adding_magnet: '🧲',
        selecting_files: '📁',
        magnet_conversion: '⚙️',
        waiting_files_selection: '⏳',
        queued: '⏳',
        downloading: '⬇️',
        compressing: '🗜️',
        uploading: '☁️',
        ready: '✅',
        error: '❌',
      }[status] || '⏳';
    },
  };
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
