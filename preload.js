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
