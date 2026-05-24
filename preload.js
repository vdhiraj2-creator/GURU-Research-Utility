const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe, narrow IPC bridge to the renderer.
// The renderer calls window.brainAPI.* — never touches ipcRenderer directly.
contextBridge.exposeInMainWorld('brainAPI', {

  // ── Renderer → Main (invoke = awaitable request/response) ────────────
  setThesis:      (thesis)   => ipcRenderer.invoke('brain:set-thesis',      thesis),
  getThesis:      ()         => ipcRenderer.invoke('brain:get-thesis'),
  search:         (query)    => ipcRenderer.invoke('brain:search',           { query }),
  ingestUrl:      (url)      => ipcRenderer.invoke('brain:ingest-url',       { url }),
  ingestPdf:      (filePath) => ipcRenderer.invoke('brain:ingest-pdf',       { filePath }),
  semanticSearch: (query)    => ipcRenderer.invoke('brain:semantic-search',  { query }),
  getSources:     (filters)  => ipcRenderer.invoke('brain:get-sources',      filters || {}),
  getSource:      (id)       => ipcRenderer.invoke('brain:get-source',       { id }),
  deleteSource:   (id)       => ipcRenderer.invoke('brain:delete-source',    { id }),
  ollamaStatus:   ()         => ipcRenderer.invoke('brain:ollama-status'),

  // ── Main → Renderer (event subscriptions) ────────────────────────────
  // Returns a cleanup function — call it to unsubscribe.
  on(channel, callback) {
    const allowed = [
      'brain:source-processing',
      'brain:source-complete',
      'brain:source-failed',
      'brain:source-flagged',
      'brain:contradiction',
      'brain:search-complete',
      'brain:ollama-status',
      'brain:progress',
    ];
    if (!allowed.includes(channel)) return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});

// ── Encrypted key store ───────────────────────────────────────────────────────
// Load all encrypted API keys synchronously before page scripts run.
// Main process responds instantly (reads one JSON file), so sendSync is fine here.
const _secureKeys = ipcRenderer.sendSync('keys:bootstrap') || {};

contextBridge.exposeInMainWorld('keystoreAPI', {
  // Synchronous read from preloaded in-memory cache — safe to call anywhere.
  get: (key) => _secureKeys[key] ?? null,

  // Write: update cache immediately, persist encrypted to disk async.
  set: (key, value) => {
    _secureKeys[key] = value;
    ipcRenderer.invoke('keys:set', { key, value });
  },

  remove: (key) => {
    delete _secureKeys[key];
    ipcRenderer.invoke('keys:set', { key, value: null });
  },
});

// ── MCP tool bridge ───────────────────────────────────────────────────────────
// Exposes HoRatio's 9 horatio_* tools to the renderer's AI agent loop.
contextBridge.exposeInMainWorld('mcpAPI', {
  listTools: ()           => ipcRenderer.invoke('mcp:list-tools'),
  callTool:  (name, args) => ipcRenderer.invoke('mcp:call-tool', { name, args }),
});
