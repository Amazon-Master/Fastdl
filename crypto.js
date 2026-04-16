// crypto.js — AES-GCM encryption for RD API key stored in IndexedDB
// Uses Web Crypto API. Key is derived from a user passphrase via PBKDF2.
// If no passphrase is used, a random device key is generated and stored as a CryptoKey
// (opaque — unreadable as raw bytes by JS) in IndexedDB.

const DB_NAME = 'abb-rd-store';
const DB_VERSION = 1;
const STORE = 'vault';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbDel(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Get or create a non-extractable AES-GCM device key stored in IndexedDB
async function getDeviceKey() {
  let key = await idbGet('deviceKey');
  if (!key) {
    key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false, // non-extractable
      ['encrypt', 'decrypt']
    );
    await idbSet('deviceKey', key);
  }
  return key;
}

export async function saveApiKey(plaintext) {
  const key = await getDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  await idbSet('apiKeyCipher', { iv: Array.from(iv), cipher: Array.from(new Uint8Array(cipher)) });
}

export async function loadApiKey() {
  const stored = await idbGet('apiKeyCipher');
  if (!stored) return null;
  const key = await getDeviceKey();
  const iv = new Uint8Array(stored.iv);
  const cipher = new Uint8Array(stored.cipher);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return new TextDecoder().decode(plain);
  } catch {
    return null; // Decryption failed (e.g., different device)
  }
}

export async function clearApiKey() {
  await idbDel('apiKeyCipher');
}

// Queue persistence (plaintext — not sensitive)
export async function saveQueue(queue) {
  await idbSet('queue', queue);
}

export async function loadQueue() {
  return (await idbGet('queue')) || [];
}
