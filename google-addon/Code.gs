// ============================================================
// JARVIS PhD ENGINE — Google Workspace Add-on
// Docs + Sheets sidebar connecting to the shared Firestore vault
// ============================================================

const FIREBASE_PROJECT = 'jarvisphd-80ecb';
const FIREBASE_API_KEY = 'AIzaSyDvhnELWOnfaVBAT-jQTswysebjaHffxKc';
const GEMINI_MODEL     = 'gemini-2.5-flash';

// ============================================================
// ENTRY POINTS
// ============================================================
function onOpen(e) {
  const ui = _getUi();
  if (!ui) return;
  ui.createAddonMenu()
    .addItem('Open Horatio', 'showSidebar')
    .addToUi();
}

function buildHomepage(e) {
  return _buildCard('Horatio — Research Intelligence', [
    CardService.newTextParagraph().setText('Open the sidebar to access your research vault, OSCOLA tools, and AI supervisor from any Google Doc or Sheet.'),
    CardService.newTextButton()
      .setText('Open Horatio Sidebar')
      .setOnClickAction(CardService.newAction().setFunctionName('showSidebar'))
  ]);
}

function onFileScopeGranted(e) {
  showSidebar();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Horatio — Research Intelligence')
    .setWidth(320);
  _getUi().showSidebar(html);
}

// ============================================================
// SHA-256 HASH  (mirrors Jarvis web app passphrase → nodeHash)
// ============================================================
function deriveNodeHash(passphrase) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    passphrase,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

// ============================================================
// FIRESTORE REST  (no auth — hash-routed, matches firestore.rules)
// ============================================================
function _fsUrl(hash, collection, docId) {
  const base = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;
  const path = `jarvis_nodes/${hash}/${collection}${docId ? '/' + docId : ''}`;
  return `${base}/${path}?key=${FIREBASE_API_KEY}`;
}

function _toFs(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    fields[k] = { stringValue: String(v) };
  }
  return { fields };
}

function _fromFs(doc) {
  const f = doc.fields || {};
  const out = {};
  for (const [k, v] of Object.entries(f)) {
    out[k] = v.stringValue ?? v.integerValue ?? v.booleanValue ?? '';
  }
  return out;
}

function fsWrite(hash, collection, docId, data) {
  const url  = _fsUrl(hash, collection, docId);
  const opts = {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify(_toFs(data)),
    muteHttpExceptions: true
  };
  const resp = UrlFetchApp.fetch(url, opts);
  if (resp.getResponseCode() >= 400) {
    throw new Error('Firestore write failed: ' + resp.getContentText());
  }
}

function fsDelete(hash, collection, docId) {
  const url  = _fsUrl(hash, collection, docId);
  UrlFetchApp.fetch(url, { method: 'delete', muteHttpExceptions: true });
}

function fsReadAll(hash, collection) {
  const url  = _fsUrl(hash, collection, null);
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() >= 400) return [];
  const data = JSON.parse(resp.getContentText());
  return (data.documents || []).map(_fromFs);
}

// ============================================================
// VAULT OPERATIONS  (called from Sidebar.html via google.script.run)
// ============================================================
function pushToVault(passphrase, geminiKey, title, content) {
  if (!passphrase) throw new Error('Sync passphrase required — set it in the sidebar.');
  const hash  = deriveNodeHash(passphrase);
  const docId = 'gdoc-' + Date.now();
  fsWrite(hash, 'vault', docId, {
    id:        docId,
    title:     title || content.slice(0, 60).replace(/\n/g, ' '),
    content:   content,
    source:    'google-docs',
    session:   'google-docs',
    sessionId: docId,
    date:      new Date().toISOString(),
    type:      'document'
  });
  return { ok: true, id: docId, title: title || content.slice(0, 60) };
}

function pullVault(passphrase) {
  if (!passphrase) throw new Error('Sync passphrase required.');
  const hash    = deriveNodeHash(passphrase);
  const entries = fsReadAll(hash, 'vault');
  // Return last 20, newest first
  return entries
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 20)
    .map(e => ({ id: e.id, title: e.title || '(untitled)', preview: (e.content || '').slice(0, 150), date: e.date }));
}

function deleteVaultEntry(passphrase, docId) {
  if (!passphrase) throw new Error('Sync passphrase required.');
  const hash = deriveNodeHash(passphrase);
  fsDelete(hash, 'vault', docId);
  return { ok: true };
}

// ============================================================
// DOCUMENT HELPERS
// ============================================================
function getSelectedText() {
  try {
    const doc       = DocumentApp.getActiveDocument();
    const selection = doc.getSelection();
    if (!selection) return '';
    return selection.getRangeElements()
      .map(re => re.getElement().asText().getText())
      .join('\n');
  } catch(e) {
    // Sheets — return active cell value
    try {
      return SpreadsheetApp.getActiveSpreadsheet().getActiveCell().getValue().toString();
    } catch(_) { return ''; }
  }
}

function getDocumentBody() {
  try {
    return DocumentApp.getActiveDocument().getBody().getText();
  } catch(e) {
    try {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
      const range = sheet.getDataRange();
      return range.getValues().map(row => row.join('\t')).join('\n');
    } catch(_) { return ''; }
  }
}

function getDocumentTitle() {
  try { return DocumentApp.getActiveDocument().getName(); }
  catch(e) {
    try { return SpreadsheetApp.getActiveSpreadsheet().getName(); }
    catch(_) { return 'Document'; }
  }
}

function insertTextAtCursor(text) {
  try {
    const doc    = DocumentApp.getActiveDocument();
    const cursor = doc.getCursor();
    if (cursor) { cursor.insertText(text); return; }
    doc.getBody().appendParagraph(text);
  } catch(e) {
    try {
      SpreadsheetApp.getActiveSpreadsheet().getActiveCell().setValue(text);
    } catch(_) {}
  }
}

function appendFootnote(citationText) {
  try {
    const doc       = DocumentApp.getActiveDocument();
    const selection = doc.getSelection();
    if (selection) {
      const el = selection.getRangeElements()[0].getElement();
      el.asText().appendText(''); // ensure cursor at end of selection
    }
    const cursor = doc.getCursor();
    if (cursor) {
      cursor.insertFootnote(citationText);
      return true;
    }
  } catch(e) {}
  return false;
}

// ============================================================
// GEMINI AI CALLS  (called from sidebar with user's own key)
// ============================================================
function callGemini(geminiKey, prompt, vaultContext) {
  if (!geminiKey) throw new Error('Gemini API key required — add it in Config.');
  const model   = GEMINI_MODEL;
  const url     = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
  const system  = vaultContext
    ? `You are Horatio, a doctoral-level AI research supervisor specialising in UK law and legal theory.\n\nRelevant vault research:\n${vaultContext}\n\n---\n`
    : 'You are Horatio, a doctoral-level AI research supervisor specialising in UK law and legal theory.\n\n';
  const payload = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: system + prompt }] }],
    generationConfig: { temperature: 0.7 }
  });
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload,
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 400) {
    const err = JSON.parse(resp.getContentText());
    throw new Error(err.error?.message || 'Gemini API error');
  }
  const data = JSON.parse(resp.getContentText());
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function formatOscola(geminiKey, rawRef) {
  return callGemini(geminiKey,
    `Convert this reference to perfect OSCOLA 4th edition format. Output ONLY the formatted citation.\n\nInput: ${rawRef}`,
    null
  );
}

function analyseSelection(geminiKey, text, passphrase) {
  let ctx = '';
  if (passphrase) {
    try {
      const hash    = deriveNodeHash(passphrase);
      const entries = fsReadAll(hash, 'vault');
      ctx = entries.slice(0, 5).map(e => `[${e.title}]\n${(e.content||'').slice(0,400)}`).join('\n---\n');
    } catch(e) {}
  }
  return callGemini(geminiKey,
    `Critically analyse this text from a doctoral law perspective. Identify strengths, weaknesses, unsupported claims, and suggest improvements:\n\n${text}`,
    ctx
  );
}

function suggestEdits(geminiKey, text) {
  return callGemini(geminiKey,
    `You are a doctoral supervisor editing legal writing. Improve for clarity, precision, and academic rigour. Return ONLY the revised text.\n\n${text}`,
    null
  );
}

function generateOscolaFootnote(geminiKey, shortRef) {
  return callGemini(geminiKey,
    `Generate a complete OSCOLA 4th edition footnote for this citation. Return ONLY the footnote text.\n\nCitation: ${shortRef}`,
    null
  );
}

// ============================================================
// SHEETS-SPECIFIC: push selected range as structured vault entry
// ============================================================
function pushSheetRangeToVault(passphrase, geminiKey, rangeNotation) {
  const sheet  = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const range  = rangeNotation
    ? sheet.getRange(rangeNotation)
    : sheet.getActiveRange() || sheet.getDataRange();
  const values = range.getValues();
  const headers = values[0].map(String);
  const rows    = values.slice(1).map(row =>
    headers.map((h, i) => `${h}: ${row[i]}`).join(' | ')
  );
  const content = `Sheet: ${sheet.getName()}\n\n${rows.join('\n')}`;
  const title   = `${SpreadsheetApp.getActiveSpreadsheet().getName()} — ${sheet.getName()} (${range.getA1Notation()})`;
  return pushToVault(passphrase, geminiKey, title, content);
}

function analyseSheetWithVault(geminiKey, passphrase) {
  const sheet  = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const values = sheet.getDataRange().getValues();
  const text   = values.map(row => row.join('\t')).join('\n');
  return analyseSelection(geminiKey, `Spreadsheet data:\n${text}`, passphrase);
}

// ============================================================
// HELPERS
// ============================================================
function _getUi() {
  try { return DocumentApp.getUi(); } catch(e) {}
  try { return SpreadsheetApp.getUi(); } catch(e) {}
  return null;
}

function _buildCard(title, widgets) {
  const section = CardService.newCardSection();
  widgets.forEach(w => section.addWidget(w));
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle(title))
    .addSection(section)
    .build();
}

// User property helpers (persist key/passphrase per user, not per doc)
function saveUserProps(geminiKey, passphrase) {
  const props = PropertiesService.getUserProperties();
  if (geminiKey)  props.setProperty('JARVIS_GEMINI_KEY',  geminiKey);
  if (passphrase) props.setProperty('JARVIS_PASSPHRASE',  passphrase);
}

function loadUserProps() {
  const props = PropertiesService.getUserProperties();
  return {
    geminiKey:  props.getProperty('JARVIS_GEMINI_KEY')  || '',
    passphrase: props.getProperty('JARVIS_PASSPHRASE')  || ''
  };
}
