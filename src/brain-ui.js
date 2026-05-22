// src/brain-ui.js
// Brain tab UI — connects the HoRatio frontend to the brain IPC layer.
// All brainAPI calls are no-ops if window.brainAPI is undefined (web/PWA mode).

const _brain = () => window.brainAPI || null;

let _brainFilter     = 'all';
let _brainCatFilter  = '';
let _brainSources    = [];
let _brainListeners  = false;   // register IPC listeners only once

// ── Entry point ────────────────────────────────────────────────────────────
// Called by setTab('brain') via the openBrainTab global exposed below.

export function openBrainTab() {
  _registerListeners();
  _checkOllamaStatus();
  brainRefreshSources();
}

// ── Ollama status ──────────────────────────────────────────────────────────

async function _checkOllamaStatus() {
  const pill  = document.getElementById('brain-ollama-pill');
  const label = document.getElementById('brain-ollama-label');
  if (!pill) return;

  if (!_brain()) {
    pill.className = 'brain-ollama-pill brain-ollama-off';
    label.textContent = 'Ollama — desktop only';
    return;
  }

  try {
    const res = await _brain().ollamaStatus();
    if (res.running) {
      pill.className = 'brain-ollama-pill brain-ollama-on';
      label.textContent = `Ollama — ${res.models.length} model${res.models.length !== 1 ? 's' : ''}`;
      pill.title = res.models.join(', ') || 'running';
    } else {
      pill.className = 'brain-ollama-pill brain-ollama-off';
      label.textContent = 'Ollama — offline';
      pill.title = 'Run: ollama serve';
    }
  } catch {
    pill.className = 'brain-ollama-pill brain-ollama-off';
    label.textContent = 'Ollama — error';
  }
}

// ── IPC event listeners ────────────────────────────────────────────────────

function _registerListeners() {
  if (_brainListeners || !_brain()) return;
  _brainListeners = true;

  _brain().on('brain:source-processing', ({ sourceId, url, status }) => {
    _setProgress(true, `${status}: ${_shortUrl(url)}`);
  });

  _brain().on('brain:source-complete', ({ source }) => {
    // Upsert source into local list and re-render
    const idx = _brainSources.findIndex(s => s.id === source.id);
    if (idx >= 0) _brainSources[idx] = source;
    else _brainSources.unshift(source);
    _renderSources();
    _updateStats();
  });

  _brain().on('brain:source-failed', ({ url, error }) => {
    _addAlert('error', `Failed to ingest ${_shortUrl(url)}: ${error}`);
  });

  _brain().on('brain:source-flagged', ({ sourceId, url, flags, confidence }) => {
    const msg = `Source flagged for review — confidence ${(confidence * 100).toFixed(0)}%`
              + (flags?.length ? `: ${flags[0]}` : '');
    _addAlert('flag', msg, sourceId);
    brainRefreshSources();
  });

  _brain().on('brain:contradiction', ({ sourceId, contradictingSources, recommendation }) => {
    const detail = (contradictingSources || []).slice(0, 2).join(' · ');
    _addAlert('contradiction',
      `Contradiction detected (${recommendation}): ${detail}`,
      sourceId,
      recommendation === 'reject' ? null : () => brainRefreshSources()
    );
  });

  _brain().on('brain:search-complete', ({ query, count }) => {
    _setProgress(false);
    _addAlert('info', `Search complete — ${count} result${count !== 1 ? 's' : ''} for "${query}"`);
    brainRefreshSources();
  });

  _brain().on('brain:progress', ({ stage, query }) => {
    _setProgress(true, query ? `${stage}: ${query}` : stage);
  });
}

// ── Public actions ─────────────────────────────────────────────────────────

window.brainSearch = async function () {
  const q = document.getElementById('brain-search-input')?.value.trim();
  if (!q) return;
  if (!_brain()) return _noBrainAlert();
  _setProgress(true, `Searching: ${q}`);
  try {
    await _brain().search(q);
  } catch (e) {
    _setProgress(false);
    _addAlert('error', `Search failed: ${e.message}`);
  }
};

window.brainSemanticSearch = async function () {
  const q = document.getElementById('brain-semantic-input')?.value.trim();
  if (!q) return;
  if (!_brain()) return _noBrainAlert();
  _setProgress(true, 'Running semantic search…');
  try {
    const res = await _brain().semanticSearch(q);
    _setProgress(false);
    if (!res.ok) throw new Error(res.error);
    _brainSources = res.results;
    _renderSources();
    _addAlert('info', `Semantic search: ${res.results.length} result${res.results.length !== 1 ? 's' : ''} for "${q}"`);
  } catch (e) {
    _setProgress(false);
    _addAlert('error', `Semantic search failed: ${e.message}`);
  }
};

window.brainIngestUrl = async function () {
  const url = document.getElementById('brain-url-input')?.value.trim();
  if (!url) return;
  if (!_brain()) return _noBrainAlert();
  _setProgress(true, `Ingesting: ${_shortUrl(url)}`);
  try {
    const res = await _brain().ingestUrl(url);
    _setProgress(false);
    if (res.ok) {
      document.getElementById('brain-url-input').value = '';
      if (res.added) brainRefreshSources();
      else _addAlert('info', 'Source already in knowledge base.');
    } else {
      _addAlert('error', res.error || 'Ingest failed');
    }
  } catch (e) {
    _setProgress(false);
    _addAlert('error', `Ingest failed: ${e.message}`);
  }
};

window.brainRefreshSources = async function () {
  if (!_brain()) { _renderEmpty(); return; }
  try {
    const filters = _brainFilter === 'flagged' ? { status: 'flagged' } : {};
    const res = await _brain().getSources(filters);
    if (res.ok) {
      _brainSources = res.sources || [];
      _renderSources();
      _updateStats();
    }
  } catch { /* non-fatal — show empty state */ }
};

window.brainDeleteSource = async function (id) {
  if (!_brain()) return;
  if (!confirm('Remove this source from the knowledge base?')) return;
  await _brain().deleteSource(id);
  _brainSources = _brainSources.filter(s => s.id !== id);
  _renderSources();
  _updateStats();
};

window.setBrainFilter = function (filter, btn) {
  _brainFilter = filter;
  document.querySelectorAll('.brain-filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  brainRefreshSources();
};

window.brainFilterByCategory = function (val) {
  _brainCatFilter = val.toLowerCase();
  _renderSources();
};

// ── Rendering ──────────────────────────────────────────────────────────────

function _renderSources() {
  const el = document.getElementById('brain-sources-list');
  if (!el) return;

  let sources = _brainSources;
  if (_brainCatFilter) {
    sources = sources.filter(s =>
      (s.category || '').toLowerCase().includes(_brainCatFilter)
    );
  }

  if (!sources.length) { el.innerHTML = _emptyState(); return; }

  el.innerHTML = sources.map(s => _sourceCard(s)).join('');
}

function _sourceCard(s) {
  const score     = typeof s.relevance_score === 'number' ? s.relevance_score : 0;
  const scoreBar  = Math.round(score * 100);
  const scoreCol  = score >= 0.7 ? '#14b8a6' : score >= 0.4 ? '#f59e0b' : '#ef4444';
  const confidence = typeof s.guard_confidence === 'number' ? s.guard_confidence : 1;
  const isFlagged  = s.requires_review || s.status === 'flagged';
  const isContradicted = (s.contradiction_flags || []).length > 0;
  const flags      = s.hallucination_flags || [];

  const statusBadge = isFlagged
    ? `<span class="brain-badge brain-badge-flag">⚑ Review</span>`
    : isContradicted
    ? `<span class="brain-badge brain-badge-contradiction">⚡ Conflict</span>`
    : `<span class="brain-badge brain-badge-ok">✓ Verified</span>`;

  const flagsHtml = flags.length
    ? `<div class="brain-source-flags">${flags.map(f =>
        `<span class="brain-flag-chip">${_esc(f.slice(0, 80))}</span>`
      ).join('')}</div>`
    : '';

  const contHtml = isContradicted
    ? `<div class="brain-source-flags" style="border-color:rgba(245,158,11,0.3);">${
        (s.contradiction_flags || []).map(c =>
          `<span class="brain-flag-chip" style="background:rgba(245,158,11,0.08);border-color:rgba(245,158,11,0.3);color:#f59e0b;">⚡ ${_esc(c.slice(0, 80))}</span>`
        ).join('')
      }</div>`
    : '';

  return `
    <div class="brain-source-card${isFlagged ? ' brain-source-flagged' : ''}${isContradicted ? ' brain-source-contradicted' : ''}">
      <div class="brain-source-header">
        <div class="brain-source-title">
          ${s.url ? `<a href="${_esc(s.url)}" target="_blank" class="brain-source-link">${_esc(s.title || s.url)}</a>` : `<span>${_esc(s.title || 'Untitled')}</span>`}
        </div>
        <div class="brain-source-meta-right">
          ${statusBadge}
          <button class="brain-del-btn" onclick="brainDeleteSource(${s.id})" title="Remove">×</button>
        </div>
      </div>

      <div class="brain-source-meta">
        ${s.category ? `<span class="brain-cat-chip">${_esc(s.category)}</span>` : ''}
        ${s.year ? `<span class="brain-meta-item">${s.year}</span>` : ''}
        <span class="brain-meta-item">Confidence ${(confidence * 100).toFixed(0)}%</span>
        ${s.processed_at ? `<span class="brain-meta-item">${s.processed_at.slice(0, 10)}</span>` : ''}
      </div>

      <!-- Relevance bar -->
      <div class="brain-rel-row">
        <span class="brain-rel-label">Relevance</span>
        <div class="brain-rel-track">
          <div class="brain-rel-fill" style="width:${scoreBar}%;background:${scoreCol};"></div>
        </div>
        <span class="brain-rel-pct" style="color:${scoreCol}">${scoreBar}%</span>
      </div>

      ${s.summary ? `<div class="brain-source-summary">${_esc(s.summary)}</div>` : ''}
      ${s.relevance_notes ? `<div class="brain-source-notes">${_esc(s.relevance_notes)}</div>` : ''}
      ${flagsHtml}
      ${contHtml}
    </div>`;
}

function _emptyState() {
  if (!_brain()) {
    return `<div class="brain-empty">Brain runs in the desktop app — open HoRatio in Electron to use it.</div>`;
  }
  return `<div class="brain-empty">No sources yet.<br>Search the web or paste a URL above to build your knowledge base.</div>`;
}

function _renderEmpty() {
  const el = document.getElementById('brain-sources-list');
  if (el) el.innerHTML = _emptyState();
}

// ── Stats ──────────────────────────────────────────────────────────────────

function _updateStats() {
  const all      = _brainSources;
  const verified = all.filter(s => !s.requires_review && s.status !== 'flagged');
  const flagged  = all.filter(s => s.requires_review  || s.status === 'flagged');
  const scores   = all.map(s => s.relevance_score).filter(n => typeof n === 'number');
  const avg      = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  const s = id => document.getElementById(id);
  if (s('brain-stat-total'))   s('brain-stat-total').textContent   = all.length;
  if (s('brain-stat-verified'))s('brain-stat-verified').textContent = verified.length;
  if (s('brain-stat-flagged')) s('brain-stat-flagged').textContent  = flagged.length;
  if (s('brain-stat-avg'))     s('brain-stat-avg').textContent      = avg !== null ? `${(avg * 100).toFixed(0)}%` : '—';
}

// ── Alerts ─────────────────────────────────────────────────────────────────

function _addAlert(type, message, sourceId, onAccept) {
  const el = document.getElementById('brain-alerts');
  if (!el) return;

  const id    = `brain-alert-${Date.now()}`;
  const icons = { error: '✕', flag: '⚑', contradiction: '⚡', info: 'ℹ' };
  const cols  = { error: '#ef4444', flag: '#f59e0b', contradiction: '#f59e0b', info: '#60a5fa' };
  const col   = cols[type] || '#60a5fa';

  const acceptBtn = onAccept
    ? `<button onclick="(${onAccept.toString()})();document.getElementById('${id}').remove()" style="background:rgba(255,255,255,0.08);border:none;color:${col};font-family:'Space Mono',monospace;font-size:9px;cursor:pointer;padding:3px 8px;border-radius:4px;margin-left:0.5rem;">Accept</button>`
    : '';

  const div = document.createElement('div');
  div.id        = id;
  div.className = 'brain-alert';
  div.style.borderColor = col + '55';
  div.innerHTML = `
    <span style="color:${col};font-weight:700;margin-right:0.4rem;">${icons[type]}</span>
    <span style="flex:1;">${_esc(message)}</span>
    ${acceptBtn}
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:#475569;cursor:pointer;font-size:14px;padding:0 0 0 0.5rem;line-height:1;">×</button>
  `;
  el.prepend(div);

  // Auto-dismiss info alerts after 6 s
  if (type === 'info') setTimeout(() => div.remove(), 6000);
}

// ── Progress ───────────────────────────────────────────────────────────────

let _progressTimer = null;

function _setProgress(visible, label = '') {
  const wrap  = document.getElementById('brain-progress-wrap');
  const inner = document.getElementById('brain-progress-inner');
  const lbl   = document.getElementById('brain-progress-label');
  if (!wrap) return;

  clearTimeout(_progressTimer);
  if (visible) {
    wrap.style.display = 'block';
    if (lbl)   lbl.textContent = label;
    if (inner) inner.style.animation = 'brainPulse 1.4s ease-in-out infinite';
  } else {
    if (inner) inner.style.width = '100%';
    _progressTimer = setTimeout(() => { wrap.style.display = 'none'; }, 600);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function _shortUrl(url = '') {
  try { return new URL(url).hostname; } catch { return url.slice(0, 40); }
}

function _esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _noBrainAlert() {
  _addAlert('info', 'Brain features require the desktop (Electron) app.');
}

// ── Expose openBrainTab to window so app.js setTab() can call it ───────────
window.openBrainTab = openBrainTab;
