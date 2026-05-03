# Jarvis PhD Engine — Google Workspace Add-on Deployment

## One-time setup (5 minutes)

### 1. Create the Apps Script project

1. Go to https://script.google.com
2. Click **New project**
3. Rename it to **Jarvis PhD Engine**

### 2. Add the files

In the left panel, add these files:

**Code.gs** (replace the default empty file)
- Copy the full contents of `Code.gs`

**Sidebar.html** (click + → HTML)
- Name it `Sidebar`
- Copy the full contents of `Sidebar.html`

**appsscript.json** (Project Settings → Show "appsscript.json")
- Replace with the contents of `appsscript.json`

### 3. Deploy as Add-on

1. Click **Deploy → Test deployments → Install add-on**
2. Click **Manage → Install** on your own account
3. Open any Google Doc or Sheet → Extensions → Jarvis PhD Engine → Open Jarvis

### 4. Configure

In the sidebar Config tab:
- Enter your Gemini API key (AIza...)
- Enter your **Jarvis sync passphrase** — must be the SAME passphrase set in the Jarvis web app under Config → Cloud Sync

That's it. The add-on now reads and writes to the same Firestore vault as the Jarvis web/desktop app.

---

## What the add-on can do

### Ask tab
- **Ask Jarvis** — any research question, answered using your vault as context
- **Analyse Selection** — highlight text in the doc → Jarvis critiques it

### Vault tab
- **Push Selection to Vault** — highlight text → instantly appears in Jarvis web vault
- **Push Full Document** — entire doc added as vault entry
- **Refresh Vault** — browse all entries, insert them at cursor, or delete them

### Tools tab
- **OSCOLA Citation** — paste any raw reference → formatted OSCOLA output → insert at cursor or as footnote
- **Suggest Edits** — highlight text → Jarvis returns an improved version → replace with one click

---

## LibreOffice macro update

Two new macros are available in `oscola_highlighter.py`:

- **push_selection_to_vault** — highlight text in LibreOffice → syncs to shared vault
- **insert_vault_context** — inserts relevant vault entries as a research note at end of document

To activate vault sync, add `sync_passphrase` to `~/ReSearch_Suite/config.json`:
```json
{
  "key": "your-gemini-api-key",
  "engine": "gemini-2.5-flash",
  "sync_passphrase": "your-jarvis-sync-passphrase"
}
```

The passphrase must match what you use in Jarvis → Config → Cloud Sync.

---

## Architecture

```
Jarvis web app (browser)
    │
    ├── localStorage (offline)
    └── Firestore: jarvis_nodes/{SHA256(passphrase)}/vault ◄─────┐
                                                                   │
Google Docs add-on ──────────────── Firestore REST API ───────────┤
Google Sheets add-on ─────────────── Firestore REST API ──────────┤
LibreOffice macro ───────────────── Firestore REST API ───────────┘
```

All tools share one vault. Any entry added from Google Docs appears instantly in Jarvis and vice versa.
