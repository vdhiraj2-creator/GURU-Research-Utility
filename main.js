require('dotenv').config();            // load .env before anything else
const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');

// ── CHROMIUM FLAGS ─────────────────────────────────────────────────
// Set before app.whenReady() — these must come first
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('log-level', '3');

// Allow AudioContext to play without requiring a user gesture on every context
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Real microphone — do not fake the UI or the device
// (fake-ui auto-accepts dialogs; we use the permission handler instead)
app.commandLine.appendSwitch('use-fake-device-for-media-stream', 'false');

// Speech / audio
app.commandLine.appendSwitch('enable-speech-input');
app.commandLine.appendSwitch('enable-speech-dispatcher');

// WebRTC — needed for getUserMedia on Linux
app.commandLine.appendSwitch('enable-features', 'WebRtcHideLocalIpsWithMdns');

// ── WINDOW ─────────────────────────────────────────────────────────
function createWindow() {
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        title: 'Horatio V2.0 — Doctoral Research Intelligence',
        backgroundColor: '#05070a',
        webPreferences: {
            nodeIntegration:  false,
            contextIsolation: true,
            webSecurity:      true,
            preload:          path.join(__dirname, 'preload.js'),
        }
    });

    // ── PERMISSIONS ────────────────────────────────────────────────
    // Use win.webContents.session (not session.defaultSession) —
    // remote HTTPS pages in Electron 28 use the window-specific session.
    const ses = win.webContents.session;

    ses.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowed = [
            'microphone', 'media', 'audioCapture',
            'mediaKeySystem'
        ];
        console.log('[Horatio] permission request:', permission,
            '→', allowed.includes(permission) ? 'GRANTED' : 'DENIED');
        callback(allowed.includes(permission));
    });

    ses.setPermissionCheckHandler((webContents, permission) => {
        const allowed = ['microphone', 'media', 'audioCapture', 'mediaKeySystem'];
        return allowed.includes(permission);
    });

    // ── AUDIO UNLOCK ───────────────────────────────────────────────
    // After the page loads, inject a small script that resumes the
    // AudioContext in the renderer — Electron 28 Chromium starts every
    // AudioContext suspended regardless of the autoplay-policy flag.
    win.webContents.on('did-finish-load', () => {
        // Ensure window audio is never muted
        win.webContents.setAudioMuted(false);

        win.webContents.executeJavaScript(`
            (function horatioUnlockAudio() {
                try {
                    const ctx = new (window.AudioContext || window.webkitAudioContext)();
                    ctx.resume().then(() => {
                        console.log('[Horatio] AudioContext unlocked, state:', ctx.state);
                        setTimeout(() => ctx.close(), 200);
                    });
                } catch(e) {
                    console.warn('[Horatio] AudioContext unlock skipped:', e.message);
                }
            })();
        `).catch(() => {});
    });

    // ── LOAD APP ───────────────────────────────────────────────────
    // Load local build first (works offline); fall back to hosted version
    const localIndex = path.join(__dirname, 'dist', 'web', 'index.html');
    const fs = require('fs');
    if (fs.existsSync(localIndex)) {
        win.loadFile(localIndex).catch(() => {
            win.loadURL('https://jarvisphd-80ecb.web.app');
        });
    } else {
        win.loadURL('https://jarvisphd-80ecb.web.app');
    }
    win.setMenuBarVisibility(false);

    // DevTools — closed for production
    // win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
    // MCP stdio server mode — spawned by Claude Desktop / Cursor, no window needed
    if (process.argv.includes('--mcp-server') || process.argv.includes('--mcp')) {
        require('./src/main/db/schema');        // initialise DB
        require('./src/main/mcp/mcp-client').startStdioServer();
        return;
    }

    // Keystore must be registered before createWindow so preload sendSync is handled
    require('./src/main/ipc/keystore-handlers');
    createWindow();
    // Brain IPC handlers — registered after window exists so emits reach the renderer
    require('./src/main/ipc/brain-handlers');
    // MCP IPC handlers — lets renderer AI call horatio_* tools via window.mcpAPI
    require('./src/main/ipc/mcp-handlers');
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
