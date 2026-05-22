# HoRatio Brain — Architecture Specification
## For use with Claude Code

---

## Overview

HoRatio is an Electron-based doctoral research assistant. This spec covers the agentic "brain" layer — a local AI system that knows the researcher's thesis, autonomously finds and reads sources from the web, and builds a structured, semantically searchable knowledge base over time.

The system must work **fully offline** for inference and storage, with web access only for source discovery and fetching.

---

## Core Principles

- **Thesis-aware** — every action is evaluated against the researcher's thesis statement and research questions
- **Asynchronous** — all LLM processing happens in the background; the UI never blocks
- **Cross-platform** — must run identically on Linux and Windows
- **No cloud dependency** — inference runs locally via Ollama; only web search uses external APIs
- **Persistent** — knowledge accumulates across sessions

---

## Tech Stack

| Layer | Technology |
|---|---|
| App framework | Electron + Node.js |
| UI | React (existing HoRatio frontend) |
| Local LLM | Ollama (REST API on localhost:11434) |
| Recommended model | Llama 3.1 8B Q4 or Mistral 7B Q4 |
| Structured storage | SQLite (via better-sqlite3) |
| Vector/semantic storage | LanceDB (local, no server required) |
| Web search | Brave Search API (free tier) |
| Web scraping | Playwright (headless Chromium) |
| PDF parsing | pdf-parse |
| IPC | Electron ipcMain / ipcRenderer |

---

## System Architecture

```
┌─────────────────────────────────────────┐
│           HoRatio Electron App           │
│                                         │
│  ┌─────────────┐    ┌─────────────────┐ │
│  │  React UI   │◄──►│   IPC Bridge    │ │
│  └─────────────┘    └────────┬────────┘ │
│                              │          │
│                    ┌─────────▼────────┐ │
│                    │   Brain Service  │ │
│                    │  (main process)  │ │
│                    └──┬──────┬────────┘ │
│                       │      │          │
│            ┌──────────▼─┐ ┌──▼───────┐ │
│            │  SQLite DB │ │ LanceDB  │ │
│            │ (metadata) │ │(vectors) │ │
│            └────────────┘ └──────────┘ │
└──────────────────┬──────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
┌───────▼──────┐    ┌─────────▼──────┐
│ Ollama Local │    │ Brave Search   │
│ LLM Server   │    │ API (web only) │
└──────────────┘    └────────────────┘
```

---

## Database Schema

### SQLite — `horatio.db`

#### `thesis` table
Stores the researcher's core thesis context. Only one active record.

```sql
CREATE TABLE thesis (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  statement TEXT NOT NULL,
  research_questions TEXT NOT NULL, -- JSON array
  key_concepts TEXT NOT NULL,       -- JSON array
  discipline TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### `sources` table
Every source HoRatio has ingested.

```sql
CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  url TEXT UNIQUE,
  title TEXT,
  authors TEXT,          -- JSON array
  year INTEGER,
  source_type TEXT,      -- 'journal', 'book', 'report', 'webpage', 'pdf'
  abstract TEXT,
  full_text TEXT,
  summary TEXT,          -- Ollama-generated summary
  relevance_score REAL,  -- 0.0 to 1.0, scored against thesis
  relevance_notes TEXT,  -- Ollama explanation of relevance
  category TEXT,         -- auto-assigned category
  tags TEXT,             -- JSON array
  status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'complete', 'failed'
  vector_id TEXT,        -- reference to LanceDB record
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME
);
```

#### `search_history` table
Tracks all searches HoRatio has performed.

```sql
CREATE TABLE search_history (
  id INTEGER PRIMARY KEY,
  query TEXT NOT NULL,
  results_count INTEGER,
  sources_added INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### `categories` table
Auto-generated or user-defined categories.

```sql
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  source_count INTEGER DEFAULT 0
);
```

---

### LanceDB — Vector Store

Table: `source_embeddings`

```javascript
{
  id: string,          // matches sources.vector_id
  source_id: number,   // matches sources.id
  text: string,        // chunked text for embedding
  vector: Float32Array // 384-dim embedding (nomic-embed-text)
}
```

Use `nomic-embed-text` via Ollama for embeddings:
```bash
ollama pull nomic-embed-text
```

---

## Brain Service — Core Modules

### 1. ThesisManager
Handles storing and retrieving the thesis context used in all prompts.

```javascript
// brain/thesis-manager.js
class ThesisManager {
  setThesis(title, statement, researchQuestions, keyConcepts)
  getThesis()
  buildThesisContext() // returns formatted string for LLM prompts
}
```

### 2. SearchEngine
Handles web search via Brave API and returns ranked URLs.

```javascript
// brain/search-engine.js
class SearchEngine {
  async search(query, count = 10)
  // Returns: [{ url, title, description }]
}
```

Brave Search API endpoint:
```
GET https://api.search.brave.com/res/v1/web/search?q={query}&count={count}
Headers: { 'X-Subscription-Token': BRAVE_API_KEY }
```

### 3. SourceFetcher
Fetches and extracts content from URLs and PDFs.

```javascript
// brain/source-fetcher.js
class SourceFetcher {
  async fetchUrl(url)    // uses Playwright, returns { title, text, metadata }
  async fetchPdf(path)   // uses pdf-parse, returns { title, text, metadata }
}
```

### 4. OllamaClient
Wrapper around the Ollama REST API.

```javascript
// brain/ollama-client.js
class OllamaClient {
  async generate(prompt, model = 'llama3.1:8b')
  async embed(text, model = 'nomic-embed-text')
  async isRunning()  // health check
}
```

Ollama base URL: `http://localhost:11434`

### 5. SourceAnalyser
Sends source content to Ollama for summarisation and relevance scoring.

```javascript
// brain/source-analyser.js
class SourceAnalyser {
  async analyse(sourceText, thesisContext)
  // Returns: { summary, relevanceScore, relevanceNotes, category, tags }
}
```

Prompts to use:

**Summary prompt:**
```
You are a doctoral research assistant. Summarise the following source in 150 words.
Focus on the main argument, methodology, and findings.

Source:
{sourceText}

Respond with only the summary, no preamble.
```

**Relevance prompt:**
```
You are a doctoral research assistant. Evaluate how relevant the following source is
to this thesis:

THESIS: {thesisStatement}
RESEARCH QUESTIONS: {researchQuestions}
KEY CONCEPTS: {keyConcepts}

SOURCE SUMMARY: {summary}

Respond in JSON only:
{
  "relevance_score": 0.0-1.0,
  "relevance_notes": "explanation of why this source is or isn't relevant",
  "category": "suggested category name",
  "tags": ["tag1", "tag2", "tag3"]
}
```

### 6. HallucinationGuard
Validates all LLM-generated output against the original source text before it enters the knowledge base. Every summary and claim must be traceable back to the fetched source — if it can't be verified, it is flagged or rejected.

```javascript
// brain/hallucination-guard.js
class HallucinationGuard {
  async verify(summary, sourceText)
  async crossReference(claim, sourceId, db)
  async flagForReview(sourceId, flags, db)
}
```

**How it works:**

After `SourceAnalyser` produces a summary, `HallucinationGuard` runs a second Ollama pass before anything is written to the database.

**Verification prompt:**
```
You are a strict academic fact-checker. Compare this summary against the original source text.

ORIGINAL SOURCE TEXT:
{sourceText}

GENERATED SUMMARY:
{summary}

Identify every claim in the summary that is NOT directly supported by the source text.
These are potential hallucinations.

Respond in JSON only:
{
  "verified": true/false,
  "confidence": 0.0-1.0,
  "hallucination_flags": ["claim that cannot be verified", ...],
  "verified_summary": "rewritten summary using only verifiable claims",
  "uncertainty_notes": ["anything unclear or ambiguous in the source"]
}
```

**Cross-reference prompt (run against existing knowledge base):**
```
You are an academic research assistant checking for contradictions.

NEW CLAIM: {claim}
SOURCE: {sourceTitle} ({sourceYear})

EXISTING KNOWLEDGE:
{relatedSources}

Does the new claim contradict any existing source in the knowledge base?
Respond in JSON only:
{
  "contradiction_detected": true/false,
  "contradicting_sources": ["source title and the contradiction"],
  "recommendation": "accept" | "flag" | "reject"
}
```

**Rules:**
- `verified: false` → source is flagged for human review, not added to knowledge base
- `confidence < 0.7` → source is flagged for human review
- `contradiction_detected: true` → user is notified before source is accepted
- `hallucination_flags` are always stored and surfaced in the UI
- Temperature must be set to `0.0` for all HallucinationGuard prompts — zero creativity, maximum conservatism
- The `verified_summary` replaces the original summary in the database, never the raw LLM output

**SQLite additions for hallucination tracking:**
```sql
ALTER TABLE sources ADD COLUMN hallucination_flags TEXT;     -- JSON array
ALTER TABLE sources ADD COLUMN guard_confidence REAL;        -- 0.0 to 1.0
ALTER TABLE sources ADD COLUMN requires_review INTEGER DEFAULT 0; -- boolean
ALTER TABLE sources ADD COLUMN contradiction_flags TEXT;     -- JSON array
```

**IPC events added:**
```javascript
'brain:source-flagged'   // { sourceId, flags, reason } — requires human review
'brain:contradiction'    // { newSourceId, contradictingSources } — user decides
```

---

### 7. VectorStore (renumbered from 6)
Handles LanceDB operations for semantic search.

```javascript
// brain/vector-store.js
class VectorStore {
  async addSource(sourceId, text, embedding)
  async search(queryEmbedding, limit = 10)
  // Returns: [{ source_id, score }]
}
```

### 8. BrainOrchestrator
The main coordinator — wires all modules together.

```javascript
// brain/orchestrator.js
class BrainOrchestrator {
  async ingestUrl(url)
  async ingestPdf(filePath)
  async searchAndIngest(query)
  async semanticSearch(query)
  async getRelatedSources(sourceId)
}
```

---

## Processing Pipeline

### Full pipeline for `searchAndIngest(query)`:

```
1. SearchEngine.search(query)
   → returns list of URLs

2. For each URL (parallel, max 3 concurrent):
   a. SourceFetcher.fetchUrl(url)
      → returns { title, text, metadata }
   
   b. OllamaClient.generate(summaryPrompt, temperature=0.1)
      → returns raw summary
   
   c. HallucinationGuard.verify(rawSummary, sourceText, temperature=0.0)
      → returns { verified, confidence, verifiedSummary, hallucinationFlags }
      → if verified=false or confidence<0.7: emit brain:source-flagged, skip URL
   
   d. OllamaClient.generate(relevancePrompt, temperature=0.1)
      → returns { relevanceScore, relevanceNotes, category, tags }
   
   e. HallucinationGuard.crossReference(verifiedSummary, existingDb, temperature=0.0)
      → if contradiction_detected: emit brain:contradiction, await user decision
   
   f. OllamaClient.embed(verifiedSummary)
      → returns vector embedding
   
   g. SQLite: INSERT into sources (using verifiedSummary, not raw summary)
   
   h. LanceDB: INSERT into source_embeddings

3. Emit progress events to UI via IPC
```

---

## IPC Events (Electron)

### Main → Renderer (events UI listens to):
```javascript
'brain:source-processing'   // { sourceId, url, status }
'brain:source-complete'     // { source } full source object
'brain:source-failed'       // { url, error }
'brain:search-complete'     // { query, count }
'brain:ollama-status'       // { running: boolean }
```

### Renderer → Main (commands UI sends):
```javascript
'brain:search'              // { query }
'brain:ingest-url'          // { url }
'brain:ingest-pdf'          // { filePath }
'brain:semantic-search'     // { query }
'brain:get-sources'         // { filters }
'brain:set-thesis'          // { thesis object }
'brain:get-thesis'          // {}
```

---

## File Structure

```
horatio/
├── src/
│   ├── main/
│   │   ├── brain/
│   │   │   ├── orchestrator.js
│   │   │   ├── thesis-manager.js
│   │   │   ├── search-engine.js
│   │   │   ├── source-fetcher.js
│   │   │   ├── source-analyser.js
│   │   │   ├── hallucination-guard.js
│   │   │   ├── ollama-client.js
│   │   │   └── vector-store.js
│   │   ├── db/
│   │   │   ├── schema.js
│   │   │   └── migrations/
│   │   └── ipc/
│   │       └── brain-handlers.js
│   └── renderer/
│       └── (existing React UI)
├── data/
│   ├── horatio.db     (SQLite)
│   └── vectors/       (LanceDB)
└── package.json
```

---

## npm Dependencies to Install

```bash
npm install better-sqlite3 @lancedb/lancedb pdf-parse playwright
npm install --save-dev electron-rebuild
```

Environment variables needed:
```
BRAVE_API_KEY=your_brave_search_api_key
OLLAMA_HOST=http://localhost:11434
```

---

## Ollama Setup

Ensure these models are pulled before running:
```bash
ollama pull llama3.1:8b
ollama pull nomic-embed-text
```

Ollama must be running as a background service:
```bash
ollama serve
```

---

## Claude Code Instructions

Use the following as your opening instruction to Claude Code:

---

**"I am building an agentic research brain for HoRatio, an Electron app for doctoral researchers. Follow the architecture spec exactly. Build one module at a time in this order:**

1. **OllamaClient** — wrapper around Ollama REST API with generate() and embed() methods and a health check
2. **Database schema** — set up SQLite with better-sqlite3 using the thesis, sources, search_history, and categories tables
3. **ThesisManager** — store/retrieve thesis and build context strings for prompts
4. **VectorStore** — LanceDB setup with addSource() and search() methods
5. **SourceFetcher** — fetch URLs with Playwright and PDFs with pdf-parse
6. **SearchEngine** — Brave Search API integration
7. **SourceAnalyser** — Ollama prompts for summarisation and relevance scoring
8. **HallucinationGuard** — verify all LLM output against source text before writing to database
9. **BrainOrchestrator** — wire all modules together with the full processing pipeline
10. **IPC handlers** — Electron ipcMain handlers for all brain commands
11. **UI integration** — connect existing React frontend to brain via IPC events

After each module, write a simple test before moving to the next. Keep all processing asynchronous and emit progress events via IPC. The thesis context must be injected into every Ollama prompt. HallucinationGuard must run on every LLM output before it touches the database — temperature 0.0, no exceptions."**

---

*HoRatio Brain Spec v1.1 — Generated May 2026*
