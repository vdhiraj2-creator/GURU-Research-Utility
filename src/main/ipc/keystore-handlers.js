// src/main/ipc/keystore-handlers.js
// Encrypts sensitive API keys using Electron safeStorage (OS keychain-backed).
// Renderer calls window.keystoreAPI.get/set — preload bridges via IPC.
// Falls back gracefully if safeStorage is unavailable (Linux without secret service).

const { ipcMain, safeStorage, app } = require('electron');
const path = require('path');
const fs   = require('fs');

const STORE_PATH = path.join(app.getPath('userData'), 'keystore.enc');

function loadStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    const enc = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    const out = {};
    for (const [k, v] of Object.entries(enc)) {
      try { out[k] = safeStorage.decryptString(Buffer.from(v, 'base64')); }
      catch { /* skip corrupted entry */ }
    }
    return out;
  } catch { return {}; }
}

function saveStore(data) {
  const enc = {};
  for (const [k, v] of Object.entries(data)) {
    if (v) enc[k] = safeStorage.encryptString(v).toString('base64');
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(enc), { mode: 0o600 });
}

// Synchronous bootstrap — preload calls sendSync so keys are ready before page loads.
ipcMain.on('keys:bootstrap', (event) => {
  event.returnValue = safeStorage.isEncryptionAvailable() ? loadStore() : {};
});

// Async set / delete — renderer fires-and-forgets.
ipcMain.handle('keys:set', (_e, { key, value }) => {
  if (!safeStorage.isEncryptionAvailable()) return;
  const store = loadStore();
  if (value) store[key] = value;
  else delete store[key];
  saveStore(store);
});

console.log('[Keystore] IPC handlers registered');
