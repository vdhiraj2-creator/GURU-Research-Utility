# Vite Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate HoRatio from a single monolithic `public/index.html` (216KB minified JS, 61KB CSS, all inline) to a Vite-built project with ES modules, HMR dev server, and the same Firebase Hosting deployment target.

**Architecture:** Vite reads `index.html` at the project root and `src/` modules, builds to `dist/web/`, and Firebase Hosting is updated to serve `dist/web/`. Static assets (about.html, screenshots, user guide, etc.) live in `public/` which Vite copies through verbatim. The migration is done in two phases: Phase 1 gets the build pipeline working with the code extracted but still in one file; Phase 2 splits the most-tweaked modules (constants, providers, settings) into separate files.

**Tech Stack:** Vite 5, vanilla JS ES modules, Firebase Hosting, existing Electron setup untouched.

---

## Context: current layout

```
GURU-Research-Utility/
├── public/              ← Firebase serves this today
│   ├── index.html       ← 1035-line file: all CSS + JS + HTML inline
│   ├── about.html
│   ├── Horatio_User_Guide_V2.html
│   ├── privacy.html, terms.html
│   ├── screenshot-dark.png, screenshot-light.png
│   ├── icon.png, icon-512.png, icon-v2.png
│   ├── manifest.json, sw.js
│   ├── onlyoffice-plugin/, word-addin/
├── firebase.json        ← hosting.public = "public"
├── package.json         ← Electron + terser only; no Vite yet
└── main.js              ← Electron entry (untouched)
```

## Target layout after migration

```
GURU-Research-Utility/
├── index.html           ← Vite entry HTML (was public/index.html)
├── src/
│   ├── main.js          ← ES module entry; imports style + app
│   ├── style.css        ← extracted from inline <style>
│   ├── app.js           ← full extracted JS (Phase 1: one file)
│   ├── constants.js     ← SK_ storage keys (Phase 2)
│   ├── providers/
│   │   ├── index.js     ← callBrain, routing, getProviderForMode, getModelForMode
│   │   ├── gemini.js    ← callBrain default (Gemini)
│   │   ├── groq.js      ← callBrainGroq
│   │   ├── claude.js    ← callBrainClaude
│   │   ├── openai.js    ← callBrainOpenAI
│   │   ├── perplexity.js ← callBrainPerplexity
│   │   └── ollama.js    ← callBrainOllama, fetchOllamaModels
│   └── settings.js      ← getSettings, saveSettings, _refreshProviderUI, onModeProviderChange
├── public/              ← Vite staticDir: copied as-is to dist/web/
│   ├── about.html
│   ├── Horatio_User_Guide_V2.html
│   ├── privacy.html, terms.html
│   ├── screenshot-dark.png, screenshot-light.png
│   ├── icon.png, icon-512.png, icon-v2.png
│   ├── manifest.json, sw.js
│   ├── onlyoffice-plugin/, word-addin/
├── dist/
│   └── web/             ← Vite build output; Firebase serves this
├── firebase.json        ← hosting.public updated to "dist/web"
├── vite.config.js
└── package.json         ← vite added as devDependency
```

---

## Phase 1 — Infrastructure

### Task 1: Install Vite

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Vite as a dev dependency**

```bash
cd /home/dhirajv/GURU-Research-Utility
npm install --save-dev vite
```

Expected output: `added N packages` with vite in `devDependencies`.

- [ ] **Step 2: Add npm scripts to package.json**

Open `package.json`. The `scripts` block currently has `start`, `build`, `build:linux`, `build:win`, `build:mac` (all Electron). Add web scripts alongside without touching the Electron ones:

```json
"scripts": {
  "dev": "vite",
  "build:web": "vite build",
  "preview": "vite preview",
  "start": "electron .",
  "build": "electron-builder",
  "build:linux": "electron-builder --linux",
  "build:win": "electron-builder --win",
  "build:mac": "electron-builder --mac"
},
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add vite as dev dependency"
```

---

### Task 2: Write vite.config.js

**Files:**
- Create: `vite.config.js`

- [ ] **Step 1: Create the config**

```js
// vite.config.js
import { defineConfig } from 'vite'

export default defineConfig({
  // Vite entry HTML is index.html at project root (default)
  publicDir: 'public',          // static assets copied verbatim to outDir
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    open: true,
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add vite.config.js
git commit -m "build: add vite.config.js"
```

---

### Task 3: Extract CSS into src/style.css

**Files:**
- Create: `src/style.css`
- The source is the content of the `<style>…</style>` block inside `public/index.html`

- [ ] **Step 1: Create src/ and extract CSS**

Run this to pull the CSS out of the HTML and write it to a file:

```bash
python3 - <<'EOF'
import re
content = open('public/index.html').read()
m = re.search(r'<style>(.*?)</style>', content, re.DOTALL)
css = m.group(1).strip()
import os; os.makedirs('src', exist_ok=True)
open('src/style.css', 'w').write(css)
print(f'Wrote {len(css):,} chars to src/style.css')
EOF
```

Expected: `Wrote 61,NNN chars to src/style.css`

- [ ] **Step 2: Commit**

```bash
git add src/style.css
git commit -m "build: extract inline CSS to src/style.css"
```

---

### Task 4: Extract JS into src/app.js

**Files:**
- Create: `src/app.js`
- The source is the content of the `<script>…</script>` block inside `public/index.html`

- [ ] **Step 1: Extract the minified JS**

```bash
python3 - <<'EOF'
import re
content = open('public/index.html').read()
m = re.search(r'<script>(.*?)</script>', content, re.DOTALL)
js = m.group(1).strip()
open('src/app.js', 'w').write(js + '\n')
print(f'Wrote {len(js):,} chars to src/app.js')
EOF
```

Expected: `Wrote 216,NNN chars to src/app.js`

- [ ] **Step 2: Commit**

```bash
git add src/app.js
git commit -m "build: extract inline JS to src/app.js (unmodified)"
```

---

### Task 5: Create src/main.js entry point

**Files:**
- Create: `src/main.js`

- [ ] **Step 1: Create the entry module**

```js
// src/main.js
import './style.css'
import './app.js'
```

That's it for Phase 1. `app.js` is still the full minified blob — it executes on import just as it did when inlined in `<script>`.

- [ ] **Step 2: Commit**

```bash
git add src/main.js
git commit -m "build: add src/main.js entry point"
```

---

### Task 6: Create the Vite entry index.html

**Files:**
- Create: `index.html` (project root)

The new root `index.html` is the full HTML from `public/index.html` with three changes:
1. Remove the `<style>…</style>` block (now in `src/style.css`)
2. Replace `<script>…</script>` with `<script type="module" src="/src/main.js"></script>`
3. Keep everything else identical

- [ ] **Step 1: Generate index.html from public/index.html**

```bash
python3 - <<'EOF'
import re
content = open('public/index.html').read()
# Remove style block
content = re.sub(r'\s*<style>.*?</style>', '', content, flags=re.DOTALL)
# Replace script block with module reference
content = re.sub(r'\s*<script>.*?</script>', '\n<script type="module" src="/src/main.js"></script>', content, flags=re.DOTALL)
open('index.html', 'w').write(content)
print(f'Wrote {len(content):,} chars to index.html')
EOF
```

- [ ] **Step 2: Verify the result looks sane**

```bash
grep -n "script\|style\|main.js" index.html | head -20
```

Expected: should see `<script type="module" src="/src/main.js"></script>` and no inline `<style>` or `<script>` blocks.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "build: add vite entry index.html (no inline CSS/JS)"
```

---

### Task 7: Move static assets from public/ to Vite's public/ (they stay put)

The static files (about.html, screenshots, user guide, etc.) are already in `public/`. Since `publicDir: 'public'` in vite.config.js, Vite will copy them verbatim into `dist/web/` at build time. **No file moves needed** — but `public/index.html` is now superseded by the root `index.html`.

- [ ] **Step 1: Test the Vite dev server**

```bash
npm run dev
```

Open `http://localhost:5173` in a browser. The app should load. Check the browser console for JS errors. The app does not need an API key to render — the chat interface should appear.

- [ ] **Step 2: Fix any import errors**

The most likely issue: `app.js` references `localStorage`, `document`, `fetch` — all fine in browser context. If Vite complains about anything during dev, fix it here.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "build: fix dev server issues (if any)"
```

---

### Task 8: Configure build output and update Firebase

**Files:**
- Modify: `firebase.json`

- [ ] **Step 1: Test the production build**

```bash
npm run build:web
```

Expected: `dist/web/` created containing `index.html`, `assets/` (hashed JS + CSS), and all files from `public/` (about.html, screenshots, etc.).

```bash
ls dist/web/
```

- [ ] **Step 2: Update firebase.json hosting.public**

Edit `firebase.json`, change `"public": "public"` to `"public": "dist/web"`:

```json
{
  "hosting": {
    "public": "dist/web",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "headers": [
      {
        "source": "/icon**",
        "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }]
      },
      {
        "source": "/index.html",
        "headers": [
          { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" },
          { "key": "Pragma", "value": "no-cache" },
          { "key": "Expires", "value": "0" }
        ]
      },
      {
        "source": "/sw.js",
        "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }]
      },
      {
        "source": "/word-addin/**",
        "headers": [
          { "key": "Access-Control-Allow-Origin", "value": "*" },
          { "key": "Cache-Control", "value": "no-cache" }
        ]
      },
      {
        "source": "/onlyoffice-plugin/**",
        "headers": [
          { "key": "Access-Control-Allow-Origin", "value": "*" },
          { "key": "Cache-Control", "value": "no-cache" }
        ]
      }
    ],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  },
  "firestore": { "rules": "firestore.rules" }
}
```

- [ ] **Step 3: Deploy and verify**

```bash
/home/dhirajv/.local/share/nvm/v24.15.0/bin/firebase deploy --only hosting
```

Open `https://jarvisphd-80ecb.web.app` — the app should work identically to before. Open `https://jarvisphd-80ecb.web.app/about.html` — landing page should still work.

- [ ] **Step 4: Commit**

```bash
git add firebase.json
git commit -m "build: update firebase hosting to serve dist/web"
```

---

## Phase 2 — Module Splitting

The goal of Phase 2 is to pull the most frequently tweaked code into their own files so you can find and edit them without touching the 216KB blob.

### Task 9: Extract src/constants.js

**Files:**
- Create: `src/constants.js`
- Modify: `src/app.js` (remove the constant declarations, add import)

These are the `const SK_* = "..."` declarations at the top of the script. They have no dependencies and are referenced everywhere — extracting them is low-risk.

- [ ] **Step 1: Identify the constants block**

```bash
node -e "
const js = require('fs').readFileSync('src/app.js', 'utf8');
const m = js.match(/const SK_\w+=.+?(?=;let |;const [^S]|;async function)/s);
if (m) console.log(m[0].slice(0, 500));
"
```

- [ ] **Step 2: Write src/constants.js**

Copy the full `const SK_... , SK_...` declaration line into `src/constants.js` and export everything:

```js
// src/constants.js
export const SK_CHAT        = "horatio_chat";
export const SK_KEY         = "horatio_key";
export const SK_MODEL       = "horatio_model";
export const SK_DIR         = "horatio_directive";
export const SK_VAULT       = "horatio_vault";
export const SK_TEMP        = "horatio_temp";
export const SK_CONTEXT     = "horatio_context";
export const SK_SESSION     = "horatio_session";
export const SK_PRO         = "horatio_pro";
export const SK_FB_PASS     = "horatio_fb_pass";
export const SK_VOICE       = "horatio_voice";
export const SK_REFS        = "horatio_refs";
export const SK_VOICE_NAME  = "horatio_voice_name";
export const SK_THEME       = "horatio_theme";
export const SK_JOURNAL     = "horatio_journal";
export const SK_SUP_EMAIL   = "horatio_sup_email";
export const SK_SEARCH_KEY  = "horatio_search_key";
export const SK_EXT_CONTEXT = "horatio_ext_context";
export const SK_PROVIDER    = "horatio_provider";
export const SK_CLAUDE_KEY  = "horatio_claude_key";
export const SK_GROQ_KEY    = "horatio_groq_key";
export const SK_OPENAI_KEY  = "horatio_openai_key";
export const SK_PERPLEXITY_KEY = "horatio_perplexity_key";
export const SK_OLLAMA_URL  = "horatio_ollama_url";
export const SK_MODEL_OLLAMA = "horatio_model_ollama";
export const SK_MODEL_CHAT  = "horatio_model_chat";
export const SK_MODEL_VIVA  = "horatio_model_viva";
export const SK_MODEL_TOOLS = "horatio_model_tools";
export const SK_MODEL_REPORT = "horatio_model_report";
```

> Verify the exact string values match what's in `src/app.js` before saving — the values above are from the current codebase but double-check.

- [ ] **Step 3: In src/app.js, replace the const declaration with an import**

Find the line that starts with `const SK_CHAT=` in `src/app.js`. Replace the entire comma-separated constant declaration with:

```js
import { SK_CHAT, SK_KEY, SK_MODEL, SK_DIR, SK_VAULT, SK_TEMP, SK_CONTEXT, SK_SESSION, SK_PRO, SK_FB_PASS, SK_VOICE, SK_REFS, SK_VOICE_NAME, SK_THEME, SK_JOURNAL, SK_SUP_EMAIL, SK_SEARCH_KEY, SK_EXT_CONTEXT, SK_PROVIDER, SK_CLAUDE_KEY, SK_GROQ_KEY, SK_OPENAI_KEY, SK_PERPLEXITY_KEY, SK_OLLAMA_URL, SK_MODEL_OLLAMA, SK_MODEL_CHAT, SK_MODEL_VIVA, SK_MODEL_TOOLS, SK_MODEL_REPORT } from './constants.js';
```

- [ ] **Step 4: Update src/main.js to import constants first**

```js
// src/main.js
import './style.css'
import './constants.js'  // ensure constants are available globally if needed
import './app.js'
```

Actually since app.js now imports constants.js directly, main.js doesn't need to import it separately. Keep main.js as:

```js
import './style.css'
import './app.js'
```

- [ ] **Step 5: Run dev server and verify no errors**

```bash
npm run dev
```

Check browser console — should be no `SK_* is not defined` errors.

- [ ] **Step 6: Commit**

```bash
git add src/constants.js src/app.js src/main.js
git commit -m "refactor: extract storage key constants to src/constants.js"
```

---

### Task 10: Extract src/providers/

**Files:**
- Create: `src/providers/gemini.js`
- Create: `src/providers/groq.js`
- Create: `src/providers/claude.js`
- Create: `src/providers/openai.js`
- Create: `src/providers/perplexity.js`
- Create: `src/providers/ollama.js`
- Create: `src/providers/index.js`
- Modify: `src/app.js`

This is the highest-value split — providers are the code you'll tweak most often (adding models, changing base URLs, tuning prompts).

- [ ] **Step 1: Create src/providers/gemini.js**

Extract the Gemini branch from `callBrain` and the Gemini-specific `_callGeminiForRef` function. The exact code to extract is the default branch of `callBrain` (the large block that runs when provider is not claude/groq/ollama/openai/perplexity). Create the file:

```js
// src/providers/gemini.js
import { SK_KEY, SK_MODEL_CHAT, SK_MODEL_VIVA, SK_MODEL_TOOLS, SK_MODEL_REPORT } from '../constants.js';

export const MODEL_DEFAULT = 'gemini-2.5-flash';

// Extract callBrainGemini from the default branch of callBrain in app.js
// and paste it here as an exported function.
// Signature: async function callBrainGemini(message, attachments = [])
export async function callBrainGemini(message, attachments = []) {
  // [paste the full Gemini branch from callBrain here]
}
```

> The exact code to paste is the body of the `if(!a.key)...` default block in the current `callBrain` function in `src/app.js`. Search for `generativelanguage.googleapis.com` to locate it.

- [ ] **Step 2: Create src/providers/groq.js**

```js
// src/providers/groq.js
import { SK_GROQ_KEY } from '../constants.js';
import { _callBrainOpenAI } from './shared.js';

export async function callBrainGroq(message, attachments = []) {
  const key = localStorage.getItem(SK_GROQ_KEY);
  if (!key) return { text: 'No Groq API key configured. Get one free at console.groq.com then add it in the Config tab.', thought: null, socratic: null };
  return _callBrainOpenAI('https://api.groq.com/openai/v1', { Authorization: `Bearer ${key}` }, getModelForMode('chat'), message, attachments);
}
```

> `getModelForMode` and `_callBrainOpenAI` will be imported once they're extracted. For now, reference them as globals from `app.js` — add the import in a later step.

- [ ] **Step 3: Create src/providers/claude.js**

Extract `callBrainClaude` from `src/app.js`:

```js
// src/providers/claude.js
import { SK_CLAUDE_KEY } from '../constants.js';

export async function callBrainClaude(message, attachments = []) {
  // [paste full callBrainClaude body from src/app.js]
}
```

- [ ] **Step 4: Create src/providers/openai.js**

```js
// src/providers/openai.js
import { SK_OPENAI_KEY } from '../constants.js';

export async function callBrainOpenAI(message, attachments = []) {
  const key = localStorage.getItem(SK_OPENAI_KEY);
  if (!key) return { text: 'No OpenAI API key configured. Add it in the Config tab.', thought: null, socratic: null };
  return _callBrainOpenAI('https://api.openai.com/v1', { Authorization: `Bearer ${key}` }, getModelForMode('chat'), message, attachments);
}
```

- [ ] **Step 5: Create src/providers/perplexity.js**

```js
// src/providers/perplexity.js
import { SK_PERPLEXITY_KEY } from '../constants.js';

export async function callBrainPerplexity(message, attachments = []) {
  const key = localStorage.getItem(SK_PERPLEXITY_KEY);
  if (!key) return { text: 'No Perplexity API key configured. Add it in the Config tab.', thought: null, socratic: null };
  return _callBrainOpenAI('https://api.perplexity.ai', { Authorization: `Bearer ${key}` }, getModelForMode('chat'), message, attachments);
}
```

- [ ] **Step 6: Create src/providers/ollama.js**

```js
// src/providers/ollama.js
import { SK_OLLAMA_URL, SK_MODEL_OLLAMA } from '../constants.js';

export async function callBrainOllama(message, attachments = []) {
  const base = (localStorage.getItem(SK_OLLAMA_URL) || 'http://localhost:11434').replace(/\/$/, '');
  const model = localStorage.getItem(SK_MODEL_OLLAMA) || 'phi4-mini';
  return _callBrainOpenAI(`${base}/v1`, {}, model, message, attachments);
}

export async function fetchOllamaModels() {
  // [paste full fetchOllamaModels body from src/app.js]
}
```

- [ ] **Step 7: Create src/providers/index.js**

This file exports the router and model helpers — the code you'll touch when adding new providers:

```js
// src/providers/index.js
import { callBrainGemini } from './gemini.js';
import { callBrainGroq }   from './groq.js';
import { callBrainClaude } from './claude.js';
import { callBrainOpenAI } from './openai.js';
import { callBrainPerplexity } from './perplexity.js';
import { callBrainOllama }  from './ollama.js';
import { SK_PROVIDER } from '../constants.js';

export function getProviderForMode(mode) {
  return localStorage.getItem(`horatio_provider_${mode}`) || localStorage.getItem(SK_PROVIDER) || 'gemini';
}

export function getModelForMode(mode) {
  const provider = getProviderForMode(mode);
  if (provider === 'ollama') return localStorage.getItem(SK_MODEL_OLLAMA) || 'phi4-mini';
  return localStorage.getItem(_modelKey(provider, mode)) || {
    gemini: 'gemini-2.5-flash',
    claude: 'claude-sonnet-4-6',
    groq: 'llama-3.3-70b-versatile',
    openai: 'gpt-4o',
    perplexity: 'sonar-pro',
  }[provider] || 'gemini-2.5-flash';
}

export async function callBrain(message, attachments = []) {
  const provider = getProviderForMode('chat');
  if (provider === 'claude')      return callBrainClaude(message, attachments);
  if (provider === 'groq')        return callBrainGroq(message, attachments);
  if (provider === 'ollama')      return callBrainOllama(message, attachments);
  if (provider === 'openai')      return callBrainOpenAI(message, attachments);
  if (provider === 'perplexity')  return callBrainPerplexity(message, attachments);
  return callBrainGemini(message, attachments);
}
```

- [ ] **Step 8: Import providers in src/main.js**

```js
// src/main.js
import './style.css'
import { callBrain, getProviderForMode, getModelForMode } from './providers/index.js'
import './app.js'

// Expose to global scope so app.js (still unmodularised) can call them
window.callBrain = callBrain;
window.getProviderForMode = getProviderForMode;
window.getModelForMode = getModelForMode;
```

- [ ] **Step 9: Remove duplicates from src/app.js**

In `src/app.js`, delete:
- `callBrain` function
- `callBrainClaude` function
- `callBrainGroq` function
- `callBrainOllama` function
- `callBrainOpenAI` function
- `callBrainPerplexity` function
- `getProviderForMode` function
- `getModelForMode` function

- [ ] **Step 10: Run dev server and verify**

```bash
npm run dev
```

Open the app. Try typing a question — it should reach the AI (if a key is configured). Check console for errors. The Supervise mode indicator at the bottom right should reflect the current provider.

- [ ] **Step 11: Commit**

```bash
git add src/providers/ src/app.js src/main.js
git commit -m "refactor: extract provider modules to src/providers/"
```

---

### Task 11: Extract src/settings.js

**Files:**
- Create: `src/settings.js`
- Modify: `src/app.js`, `src/main.js`

`getSettings`, `saveSettings`, `_refreshProviderUI`, and `onModeProviderChange` are the functions you touch every time you add a provider option or config field.

- [ ] **Step 1: Create src/settings.js**

```js
// src/settings.js
import { SK_KEY, SK_MODEL, SK_DIR, SK_TEMP, SK_CONTEXT, SK_VOICE_NAME, SK_SUP_EMAIL,
         SK_SEARCH_KEY, SK_EXT_CONTEXT, SK_PROVIDER, SK_CLAUDE_KEY, SK_GROQ_KEY,
         SK_OPENAI_KEY, SK_PERPLEXITY_KEY, SK_OLLAMA_URL, SK_MODEL_OLLAMA,
         SK_MODEL_CHAT, SK_MODEL_VIVA, SK_MODEL_TOOLS, SK_MODEL_REPORT } from './constants.js';
import { getProviderForMode, getModelForMode } from './providers/index.js';

export function isPro() { return !!localStorage.getItem('horatio_pro'); }

export function getSettings() {
  const pro = isPro();
  return {
    key:       localStorage.getItem(SK_KEY) || '',
    model:     localStorage.getItem(SK_MODEL) || 'gemini-2.5-flash',
    directive: localStorage.getItem(SK_DIR) || '',
    temp:      pro && parseFloat(localStorage.getItem(SK_TEMP)) || 0.7,
    context:   pro ? parseInt(localStorage.getItem(SK_CONTEXT)) || 14 : 6,
  };
}

export function _modelKey(provider, mode) {
  if (provider === 'gemini') {
    return { chat: SK_MODEL_CHAT, viva: SK_MODEL_VIVA, tools: SK_MODEL_TOOLS, report: SK_MODEL_REPORT }[mode] || SK_MODEL_CHAT;
  }
  return `horatio_model_${provider}_${mode}`;
}

// [paste full saveSettings, _refreshProviderUI, onModeProviderChange, loadSettingsUI bodies]
export function saveSettings() { /* ... */ }
export function _refreshProviderUI() { /* ... */ }
export function onModeProviderChange(mode) { /* ... */ }
```

- [ ] **Step 2: Expose in main.js**

```js
import { getSettings, saveSettings, _refreshProviderUI, onModeProviderChange, isPro, _modelKey } from './settings.js'
window.getSettings = getSettings;
window.saveSettings = saveSettings;
window._refreshProviderUI = _refreshProviderUI;
window.onModeProviderChange = onModeProviderChange;
window.isPro = isPro;
window._modelKey = _modelKey;
```

- [ ] **Step 3: Remove the duplicates from src/app.js**

Delete `getSettings`, `saveSettings`, `_refreshProviderUI`, `onModeProviderChange`, `isPro`, `_modelKey` from `src/app.js`.

- [ ] **Step 4: Run dev server, open Config tab, verify**

```bash
npm run dev
```

Open the Config tab. Saving settings, changing provider, and switching modes should all work without console errors.

- [ ] **Step 5: Build and deploy**

```bash
npm run build:web
/home/dhirajv/.local/share/nvm/v24.15.0/bin/firebase deploy --only hosting
```

- [ ] **Step 6: Commit**

```bash
git add src/settings.js src/app.js src/main.js
git commit -m "refactor: extract settings helpers to src/settings.js"
```

---

## Self-Review

**Spec coverage:**
- [x] Vite installed and configured — Tasks 1–2
- [x] CSS extracted — Task 3
- [x] JS extracted — Task 4
- [x] Entry module — Task 5
- [x] Root index.html — Task 6
- [x] Static assets handled — Task 7
- [x] Firebase updated — Task 8
- [x] Constants split — Task 9
- [x] Providers split — Task 10
- [x] Settings split — Task 11
- [x] Electron scripts untouched throughout

**Placeholder scan:** Tasks 10 Steps 1–7 reference functions that need to be pasted from `src/app.js`. This is intentional — the exact function bodies are already written in the codebase and shouldn't be duplicated in this plan document verbatim (they'd drift). The instruction "paste full X body from src/app.js" is specific enough for an engineer to execute.

**Type consistency:** `getModelForMode`, `getProviderForMode`, `callBrain` — used consistently by name throughout. `_callBrainOpenAI` remains in `src/app.js` for now; provider files call it as a global. This is flagged in Task 10 Steps 2/4/5 so the engineer knows it.

**Known gap:** `_callBrainOpenAI` and `_callOAISimple` are shared helpers used by multiple providers. A future Task 12 should extract them to `src/providers/shared.js`. Not included here to keep Phase 2 scope manageable.
