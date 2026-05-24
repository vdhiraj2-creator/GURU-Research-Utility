// src/main/ipc/mcp-handlers.js
// IPC bridge: renderer → MCP tool layer.
// Mirrors brain-handlers.js — renderer calls window.mcpAPI.*, which proxies here.

const { ipcMain } = require('electron');
const mcp         = require('../mcp/mcp-client');

ipcMain.handle('mcp:list-tools', async () => {
  return { ok: true, tools: mcp.TOOL_SCHEMAS };
});

ipcMain.handle('mcp:call-tool', async (_e, { name, args }) => {
  try {
    const result = await mcp.callTool(name, args || {});
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

console.log('[MCP] IPC handlers registered');
