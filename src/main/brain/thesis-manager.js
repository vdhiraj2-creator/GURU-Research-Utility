// brain/thesis-manager.js
// Persists the researcher's thesis in SQLite and builds context strings
// that are injected into every Ollama prompt.

const { getDb } = require('../db/schema');

class ThesisManager {
  // Upsert the thesis record. Called from IPC handler when UI saves Thesis Brain.
  setThesis({ title, statement, researchQuestions = [], keyConcepts = [], discipline = '' } = {}) {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM thesis LIMIT 1').get();

    if (existing) {
      db.prepare(`
        UPDATE thesis SET
          title              = ?,
          statement          = ?,
          research_questions = ?,
          key_concepts       = ?,
          discipline         = ?,
          updated_at         = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        title || '',
        statement || '',
        JSON.stringify(researchQuestions),
        JSON.stringify(keyConcepts),
        discipline || '',
        existing.id
      );
    } else {
      db.prepare(`
        INSERT INTO thesis (title, statement, research_questions, key_concepts, discipline)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        title || '',
        statement || '',
        JSON.stringify(researchQuestions),
        JSON.stringify(keyConcepts),
        discipline || ''
      );
    }
    console.log('[ThesisManager] Thesis saved:', title);
  }

  // Retrieve the current thesis object (or null if not set).
  getThesis() {
    const db = getDb();
    const row = db.prepare('SELECT * FROM thesis ORDER BY id LIMIT 1').get();
    if (!row) return null;
    return {
      ...row,
      research_questions: this._parse(row.research_questions, []),
      key_concepts:       this._parse(row.key_concepts,       []),
    };
  }

  // Returns a formatted string ready to prepend to any Ollama prompt.
  buildThesisContext() {
    const t = this.getThesis();
    if (!t || !t.title) return '';

    const lines = [
      'THESIS CONTEXT:',
      `Title: ${t.title}`,
    ];
    if (t.discipline)                              lines.push(`Discipline: ${t.discipline}`);
    if (t.statement)                               lines.push(`Central Argument: ${t.statement}`);
    if (t.research_questions.length)               lines.push(`Research Questions:\n${t.research_questions.map(q => `  - ${q}`).join('\n')}`);
    if (t.key_concepts.length)                     lines.push(`Key Concepts: ${t.key_concepts.join(', ')}`);

    return lines.join('\n');
  }

  _parse(json, fallback) {
    try { return JSON.parse(json) || fallback; } catch { return fallback; }
  }
}

module.exports = new ThesisManager();
