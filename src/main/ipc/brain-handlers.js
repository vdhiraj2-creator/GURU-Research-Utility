// src/main/ipc/brain-handlers.js
// Registers all ipcMain handlers for the brain layer.
// Required from main.js after app.whenReady() so BrowserWindow exists.

const { ipcMain, BrowserWindow } = require('electron');
const orchestrator   = require('../brain/orchestrator');
const thesisManager  = require('../brain/thesis-manager');
const ollama         = require('../brain/ollama-client');
const { getDb }      = require('../db/schema');

// Wire the orchestrator's event emitter to the focused window.
// Re-wires on every window focus so it always targets the live window.
function getWin() {
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
}

function ensureEmitter() {
  const win = getWin();
  if (win) orchestrator.setEmitter(win);
  return win;
}

// ── Invoke handlers (renderer awaits a response) ─────────────────────────

ipcMain.handle('brain:set-thesis', async (_e, thesis) => {
  try {
    thesisManager.setThesis(thesis);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('brain:get-thesis', async () => {
  try {
    return { ok: true, thesis: thesisManager.getThesis() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('brain:search', async (_e, { query }) => {
  ensureEmitter();
  try {
    const result = await orchestrator.searchAndIngest(query);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('brain:ingest-url', async (_e, { url }) => {
  ensureEmitter();
  try {
    const added = await orchestrator.ingestUrl(url);
    return { ok: true, added };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('brain:ingest-pdf', async (_e, { filePath }) => {
  ensureEmitter();
  try {
    const added = await orchestrator.ingestPdf(filePath);
    return { ok: true, added };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('brain:semantic-search', async (_e, { query }) => {
  try {
    const results = await orchestrator.semanticSearch(query);
    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('brain:get-sources', async (_e, filters) => {
  try {
    const sources = orchestrator.getSources(filters);
    return { ok: true, sources };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('brain:get-source', async (_e, { id }) => {
  try {
    const db  = getDb();
    const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
    return { ok: true, source: row ? orchestrator._deserialise(row) : null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('brain:delete-source', async (_e, { id }) => {
  try {
    await orchestrator.deleteSource(id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('brain:ollama-status', async () => {
  const running = await ollama.isRunning();
  const models  = running ? await ollama.listModels() : [];
  getWin()?.webContents.send('brain:ollama-status', { running, models });
  return { ok: true, running, models };
});

console.log('[Brain] IPC handlers registered');
