// src/main/db/schema.js
// Opens (or creates) horatio.db and applies all schema migrations in order.

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const { app }  = require('electron');

// Store in Electron's userData directory — writable on all platforms, survives updates.
const DATA_DIR    = path.join(app.getPath('userData'), 'horatio-data');
const LEGACY_DIR  = path.join(__dirname, '..', '..', '..', 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // One-time migration: copy existing DB from the old app-relative location
  const legacyDb = path.join(LEGACY_DIR, 'horatio.db');
  if (fs.existsSync(legacyDb)) {
    fs.copyFileSync(legacyDb, path.join(DATA_DIR, 'horatio.db'));
    console.log('[DB] Migrated horatio.db → userData');
  }
}

const DB_PATH = path.join(DATA_DIR, 'horatio.db');

let _db = null;

function getDb() {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');   // concurrent reads + single writer
  _db.pragma('foreign_keys = ON');

  applyMigrations(_db);
  return _db;
}

// ── Migrations ─────────────────────────────────────────────────────────────
// Each migration is applied exactly once, tracked in the migrations table.

function applyMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id   INTEGER PRIMARY KEY,
      name TEXT    UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM migrations').all().map(r => r.name)
  );

  for (const [name, sql] of MIGRATIONS) {
    if (applied.has(name)) continue;
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(name);
    })();
    console.log(`[DB] Applied migration: ${name}`);
  }
}

// Ordered migration list — append new ones at the bottom, never edit existing.
const MIGRATIONS = [
  ['001_initial_schema', `
    CREATE TABLE IF NOT EXISTS thesis (
      id                 INTEGER PRIMARY KEY,
      title              TEXT    NOT NULL,
      statement          TEXT    NOT NULL DEFAULT '',
      research_questions TEXT    NOT NULL DEFAULT '[]',
      key_concepts       TEXT    NOT NULL DEFAULT '[]',
      discipline         TEXT,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sources (
      id               INTEGER PRIMARY KEY,
      url              TEXT    UNIQUE,
      title            TEXT,
      authors          TEXT    DEFAULT '[]',
      year             INTEGER,
      source_type      TEXT,
      abstract         TEXT,
      full_text        TEXT,
      summary          TEXT,
      relevance_score  REAL    DEFAULT 0.0,
      relevance_notes  TEXT,
      category         TEXT,
      tags             TEXT    DEFAULT '[]',
      status           TEXT    DEFAULT 'pending',
      vector_id        TEXT,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at     DATETIME
    );

    CREATE TABLE IF NOT EXISTS search_history (
      id             INTEGER PRIMARY KEY,
      query          TEXT    NOT NULL,
      results_count  INTEGER DEFAULT 0,
      sources_added  INTEGER DEFAULT 0,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id           INTEGER PRIMARY KEY,
      name         TEXT    UNIQUE NOT NULL,
      description  TEXT,
      source_count INTEGER DEFAULT 0
    );
  `],

  ['002_hallucination_columns', `
    ALTER TABLE sources ADD COLUMN hallucination_flags TEXT    DEFAULT '[]';
    ALTER TABLE sources ADD COLUMN guard_confidence    REAL    DEFAULT 1.0;
    ALTER TABLE sources ADD COLUMN requires_review     INTEGER DEFAULT 0;
    ALTER TABLE sources ADD COLUMN contradiction_flags TEXT    DEFAULT '[]';
  `],
];

module.exports = { getDb };
