// brain/vector-store.js
// Semantic search via LanceDB (local, no server).
// Falls back to cosine similarity in memory if LanceDB is unavailable —
// this makes the rest of the brain fully operational even without native bindings.

const path = require('path');
const fs   = require('fs');

const VECTORS_DIR = path.join(__dirname, '..', '..', '..', 'data', 'vectors');
if (!fs.existsSync(VECTORS_DIR)) fs.mkdirSync(VECTORS_DIR, { recursive: true });

class VectorStore {
  constructor() {
    this._db       = null;   // LanceDB connection (lazy)
    this._table    = null;   // LanceDB table handle
    this._fallback = [];     // in-memory fallback [ { id, source_id, text, vector } ]
    this._useFallback = false;
  }

  async _connect() {
    if (this._table || this._useFallback) return;
    try {
      const lancedb = require('@lancedb/lancedb');
      this._db      = await lancedb.connect(VECTORS_DIR);
      const tables  = await this._db.tableNames();

      if (tables.includes('source_embeddings')) {
        this._table = await this._db.openTable('source_embeddings');
      } else {
        // Create with a dummy row so the schema is defined; removed immediately.
        this._table = await this._db.createTable('source_embeddings', [
          { id: '__init__', source_id: 0, text: '', vector: Array(384).fill(0) },
        ]);
        await this._table.delete('id = "__init__"');
      }
    } catch (err) {
      console.warn(`[VectorStore] LanceDB unavailable — using in-memory fallback: ${err.message}`);
      this._useFallback = true;
    }
  }

  // Add a source embedding. Call after Ollama embed().
  async addSource(id, sourceId, text, vector) {
    await this._connect();

    if (this._useFallback) {
      // Replace if id already exists
      this._fallback = this._fallback.filter(r => r.id !== id);
      this._fallback.push({ id, source_id: sourceId, text, vector });
      return;
    }

    try {
      // Delete existing entry for this source before re-adding
      await this._table.delete(`id = "${id}"`);
    } catch { /* first insert — nothing to delete */ }

    await this._table.add([{ id, source_id: sourceId, text, vector }]);
  }

  // Semantic search: returns [{ source_id, score }] ordered by similarity descending.
  async search(queryVector, limit = 10) {
    await this._connect();

    if (this._useFallback) {
      return this._cosineFallback(queryVector, limit);
    }

    try {
      const rows = await this._table
        .search(queryVector)
        .limit(limit)
        .toArray();

      return rows.map(r => ({ source_id: r.source_id, score: 1 - (r._distance ?? 0) }));
    } catch (err) {
      console.warn('[VectorStore] LanceDB search failed, falling back:', err.message);
      return this._cosineFallback(queryVector, limit);
    }
  }

  // Delete all vectors for a source_id (called when a source is removed).
  async deleteSource(sourceId) {
    await this._connect();

    if (this._useFallback) {
      this._fallback = this._fallback.filter(r => r.source_id !== sourceId);
      return;
    }

    try {
      await this._table.delete(`source_id = ${sourceId}`);
    } catch (err) {
      console.warn('[VectorStore] delete failed:', err.message);
    }
  }

  // ── Fallback cosine similarity ────────────────────────────────────────

  _cosineFallback(queryVector, limit) {
    const scored = this._fallback.map(r => ({
      source_id: r.source_id,
      score:     this._cosine(queryVector, r.vector),
    }));
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  _cosine(a, b) {
    if (!a?.length || a.length !== b?.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na  += a[i] * a[i];
      nb  += b[i] * b[i];
    }
    return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  }
}

module.exports = new VectorStore();
