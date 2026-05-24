// brain/orchestrator.js
// Wires all brain modules into the full processing pipeline.
// All public methods are async and emit progress events to the UI via IPC.

const { getDb }         = require('../db/schema');
const ollama            = require('./ollama-client');
const thesisManager     = require('./thesis-manager');
const searchEngine      = require('./search-engine');
const sourceFetcher     = require('./source-fetcher');
const sourceAnalyser    = require('./source-analyser');
const hallucinationGuard = require('./hallucination-guard');
const vectorStore       = require('./vector-store');

// Concurrency cap for parallel URL fetching (spec: max 3)
const MAX_CONCURRENT = 3;

class BrainOrchestrator {
  constructor() {
    this._emitter = null;   // set by IPC handler via setEmitter()
  }

  // IPC handler injects the BrowserWindow reference so we can push events.
  setEmitter(win) {
    this._emitter = win;
  }

  // ── Public API ─────────────────────────────────────────────────────────

  // Full pipeline: search → fetch → analyse → guard → store
  async searchAndIngest(query) {
    this._emit('brain:progress', { stage: 'searching', query });

    const results     = await searchEngine.search(query, 10);
    const db          = getDb();
    const searchEntry = db.prepare(
      'INSERT INTO search_history (query, results_count) VALUES (?, ?)'
    ).run(query, results.length);

    this._emit('brain:search-complete', { query, count: results.length });

    let sourcesAdded = 0;
    await this._runConcurrent(results, MAX_CONCURRENT, async ({ url, title }) => {
      try {
        const added = await this.ingestUrl(url, { suggestedTitle: title });
        if (added) sourcesAdded++;
      } catch (err) {
        this._emit('brain:source-failed', { url, error: err.message });
      }
    });

    // Update search history with final count
    db.prepare('UPDATE search_history SET sources_added = ? WHERE id = ?')
      .run(sourcesAdded, searchEntry.lastInsertRowid);

    return { query, results: results.length, added: sourcesAdded };
  }

  // Ingest a single URL through the full pipeline.
  // Returns true if the source was accepted and written to the DB.
  async ingestUrl(url, opts = {}) {
    const db = getDb();

    // Skip if already processed
    const existing = db.prepare("SELECT id, status FROM sources WHERE url = ?").get(url);
    if (existing?.status === 'complete') return false;

    // INSERT OR IGNORE then SELECT to get the real ID — avoids race where
    // a concurrent ingest on the same URL causes lastInsertRowid to return 0.
    if (!existing) {
      db.prepare(
        'INSERT OR IGNORE INTO sources (url, title, status) VALUES (?, ?, ?)'
      ).run(url, opts.suggestedTitle || url, 'pending');
    }
    const sourceId = db.prepare('SELECT id FROM sources WHERE url = ?').get(url)?.id;
    if (!sourceId) return false;

    this._emit('brain:source-processing', { sourceId, url, status: 'fetching' });
    db.prepare("UPDATE sources SET status='processing' WHERE id=?").run(sourceId);

    const fetched = await sourceFetcher.fetchUrl(url);
    return this._processContent(sourceId, url, fetched, { crossRef: true });
  }

  // Ingest a local PDF file.
  async ingestPdf(filePath) {
    const db      = getDb();
    const fetched = await sourceFetcher.fetchPdf(filePath);

    const existing = db.prepare("SELECT id, status FROM sources WHERE url = ?").get(filePath);
    if (existing?.status === 'complete') return false;

    if (!existing) {
      db.prepare(
        'INSERT OR IGNORE INTO sources (url, title, status) VALUES (?, ?, ?)'
      ).run(filePath, fetched.title, 'pending');
    }
    const sourceId = db.prepare('SELECT id FROM sources WHERE url = ?').get(filePath)?.id;
    if (!sourceId) return false;

    db.prepare("UPDATE sources SET status='processing' WHERE id=?").run(sourceId);
    this._emit('brain:source-processing', { sourceId, url: filePath, status: 'analysing' });

    return this._processContent(sourceId, filePath, fetched, { crossRef: true });
  }

  // Semantic search: embed query, find nearest vectors, return full source objects.
  async semanticSearch(query) {
    const embedding = await ollama.embed(query);
    const hits      = await vectorStore.search(embedding, 10);
    const db        = getDb();

    return hits
      .map(({ source_id, score }) => {
        const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(source_id);
        return row ? { ...this._deserialise(row), _score: score } : null;
      })
      .filter(Boolean);
  }

  // Return all sources with optional filters { category, status, minRelevance }.
  getSources(filters = {}) {
    const db     = getDb();
    const where  = ['1=1'];
    const params = [];

    if (filters.category)    { where.push('category = ?');        params.push(filters.category); }
    if (filters.status)      { where.push('status = ?');          params.push(filters.status); }
    if (filters.minRelevance){ where.push('relevance_score >= ?'); params.push(filters.minRelevance); }

    const rows = db.prepare(
      `SELECT * FROM sources WHERE ${where.join(' AND ')} ORDER BY relevance_score DESC, processed_at DESC`
    ).all(...params);

    return rows.map(r => this._deserialise(r));
  }

  // Return sources related to a given source_id via vector similarity.
  async getRelatedSources(sourceId) {
    const db  = getDb();
    const src = db.prepare('SELECT vector_id FROM sources WHERE id = ?').get(sourceId);
    if (!src?.vector_id) return [];

    const embedding = await ollama.embed(
      db.prepare('SELECT summary FROM sources WHERE id = ?').get(sourceId)?.summary || ''
    );
    const hits = await vectorStore.search(embedding, 6);
    return hits
      .filter(h => h.source_id !== sourceId)
      .map(({ source_id, score }) => {
        const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(source_id);
        return row ? { ...this._deserialise(row), _score: score } : null;
      })
      .filter(Boolean);
  }

  // Delete a source from both SQLite and the vector store.
  async deleteSource(sourceId) {
    const db = getDb();
    await vectorStore.deleteSource(sourceId);
    db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
  }

  // ── Private helpers ────────────────────────────────────────────────────

  // Shared pipeline: analyse → verify → [crossRef] → embed → write.
  // Called by both ingestUrl and ingestPdf so both paths run identical steps.
  async _processContent(sourceId, identifier, fetched, opts = {}) {
    const db = getDb();

    // Step 1 — Summarise + score relevance
    this._emit('brain:source-processing', { sourceId, url: identifier, status: 'analysing' });
    const analysis = await sourceAnalyser.analyse(fetched.text);

    // Step 2 — HallucinationGuard: verify summary against source text
    this._emit('brain:source-processing', { sourceId, url: identifier, status: 'verifying' });
    const guard = await hallucinationGuard.verify(analysis.summary, fetched.text);

    if (!guard.verified || guard.confidence < 0.7) {
      await hallucinationGuard.flagForReview(
        sourceId,
        guard.hallucinationFlags,
        `verified=${guard.verified} confidence=${guard.confidence.toFixed(2)}`,
        'flag'
      );
      this._emit('brain:source-flagged', {
        sourceId, url: identifier,
        flags:      guard.hallucinationFlags,
        confidence: guard.confidence,
        reason:     'Failed hallucination check',
      });
      return false;
    }

    // Step 3 — Cross-reference against existing knowledge base
    if (opts.crossRef) {
      const crossRef = await hallucinationGuard.crossReference(
        guard.verifiedSummary, sourceId
      );

      if (crossRef.contradictionDetected) {
        this._emit('brain:contradiction', {
          sourceId, url: identifier,
          contradictingSources: crossRef.contradictingSources,
          recommendation:       crossRef.recommendation,
        });
        if (crossRef.recommendation === 'reject') {
          await hallucinationGuard.flagForReview(sourceId, [], 'Contradiction detected', 'reject');
          return false;
        }
        db.prepare("UPDATE sources SET contradiction_flags=? WHERE id=?")
          .run(JSON.stringify(crossRef.contradictingSources), sourceId);
      }
    }

    // Step 4 — Embed the verified summary
    let vectorId = null;
    try {
      const embedding = await ollama.embed(guard.verifiedSummary);
      vectorId = `src_${sourceId}`;
      await vectorStore.addSource(vectorId, sourceId, guard.verifiedSummary, embedding);
    } catch (err) {
      console.warn('[Orchestrator] Embedding failed (non-fatal):', err.message);
    }

    // Step 5 — Write to SQLite
    db.prepare(`
      UPDATE sources SET
        title               = ?,
        summary             = ?,
        relevance_score     = ?,
        relevance_notes     = ?,
        category            = ?,
        tags                = ?,
        hallucination_flags = ?,
        guard_confidence    = ?,
        requires_review     = 0,
        vector_id           = ?,
        status              = 'complete',
        processed_at        = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      fetched.title || identifier,
      guard.verifiedSummary,
      analysis.relevanceScore,
      analysis.relevanceNotes,
      analysis.category,
      JSON.stringify(analysis.tags),
      JSON.stringify(guard.hallucinationFlags),
      guard.confidence,
      vectorId,
      sourceId
    );

    this._upsertCategory(db, analysis.category);

    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId);
    this._emit('brain:source-complete', { source: this._deserialise(source) });

    return true;
  }

  _upsertCategory(db, name) {
    if (!name) return;
    db.prepare(`
      INSERT INTO categories (name, source_count) VALUES (?, 1)
      ON CONFLICT(name) DO UPDATE SET source_count = source_count + 1
    `).run(name);
  }

  _emit(channel, data) {
    if (this._emitter && !this._emitter.isDestroyed()) {
      this._emitter.webContents.send(channel, data);
    }
  }

  deserialise(row) {
    if (!row) return null;
    return {
      ...row,
      authors:             this._tryParse(row.authors,             []),
      tags:                this._tryParse(row.tags,                []),
      hallucination_flags: this._tryParse(row.hallucination_flags, []),
      contradiction_flags: this._tryParse(row.contradiction_flags, []),
    };
  }

  // Keep underscore alias so existing callers (mcp-client, brain-handlers) don't break.
  _deserialise(row) { return this.deserialise(row); }

  _tryParse(json, fallback) {
    try { return JSON.parse(json) ?? fallback; } catch { return fallback; }
  }

  // Run tasks with bounded concurrency.
  async _runConcurrent(items, limit, fn) {
    const queue = [...items];
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (queue.length) {
        const item = queue.shift();
        if (item) await fn(item);
      }
    });
    await Promise.allSettled(workers);
  }
}

module.exports = new BrainOrchestrator();
