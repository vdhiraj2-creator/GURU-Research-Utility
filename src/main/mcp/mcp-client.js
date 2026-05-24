// src/main/mcp/mcp-client.js
// HoRatio MCP tool layer.
// Exposes 9 horatio_* tools to:
//   1. HoRatio's own AI (via IPC → mcp-handlers.js → here)
//   2. External MCP clients (Claude Desktop, Cursor) via stdio — start with --mcp-server

const orchestrator   = require('../brain/orchestrator');
const thesisManager  = require('../brain/thesis-manager');
const ollama         = require('../brain/ollama-client');
const { getDb }      = require('../db/schema');

// ── Tool implementations ─────────────────────────────────────────────────────

async function horatio_search_corpus({ query, limit = 10 }) {
  const results = await orchestrator.semanticSearch(query);
  return {
    found:   results.length,
    sources: results.slice(0, limit).map(s => ({
      id:        s.id,
      title:     s.title,
      url:       s.url,
      summary:   s.summary,
      relevance: s.relevance_score,
      category:  s.category,
      tags:      s.tags,
      score:     s._score,
    })),
  };
}

async function horatio_get_source({ id }) {
  const db  = getDb();
  const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  if (!row) return { found: false };
  return { found: true, source: orchestrator._deserialise(row) };
}

async function horatio_add_source({ url, filePath }) {
  if (filePath) {
    const added = await orchestrator.ingestPdf(filePath);
    return { added, type: 'pdf' };
  }
  if (!url) throw new Error('url or filePath is required');
  const added = await orchestrator.ingestUrl(url);
  return { added, type: 'url', url };
}

async function horatio_get_chapter({ chapter, section }) {
  const thesis = thesisManager.getThesis();
  if (!thesis) return { found: false, reason: 'No thesis configured' };
  const db    = getDb();
  const term  = section || chapter;
  const rows  = db.prepare(
    "SELECT * FROM sources WHERE category LIKE ? AND status='complete' ORDER BY relevance_score DESC LIMIT 20"
  ).all(`%${term}%`);
  return {
    thesis: {
      title:              thesis.title,
      statement:          thesis.statement,
      research_questions: thesis.research_questions,
      key_concepts:       thesis.key_concepts,
    },
    chapter,
    section: section || null,
    sources: rows.map(r => orchestrator._deserialise(r)),
  };
}

async function horatio_suggest_citations({ text, limit = 5 }) {
  const running = await ollama.isRunning();
  if (!running) {
    // Keyword fallback
    const db    = getDb();
    const words = (text.toLowerCase().match(/\b\w{4,}\b/g) || []).slice(0, 10);
    const rows  = db.prepare("SELECT * FROM sources WHERE status='complete' ORDER BY relevance_score DESC LIMIT 50").all();
    const scored = rows
      .map(r => ({ ...orchestrator._deserialise(r), _score: words.reduce((n, w) => n + (r.summary?.toLowerCase().includes(w) ? 1 : 0), 0) }))
      .filter(r => r._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, limit);
    return { method: 'keyword', suggestions: scored };
  }
  const hits = await orchestrator.semanticSearch(text);
  return {
    method:      'semantic',
    suggestions: hits.slice(0, limit).map(s => ({
      id:        s.id,
      title:     s.title,
      url:       s.url,
      summary:   s.summary,
      relevance: s.relevance_score,
      citation:  s.authors?.length ? `${s.authors.join(', ')} (${s.year || 'n.d.'})` : s.title,
    })),
  };
}

async function horatio_export_bibliography({ format = 'oscola', ids } = {}) {
  const db   = getDb();
  const rows = ids?.length
    ? db.prepare(`SELECT * FROM sources WHERE id IN (${ids.map(() => '?').join(',')}) AND status='complete'`).all(...ids)
    : db.prepare("SELECT * FROM sources WHERE status='complete' ORDER BY relevance_score DESC").all();

  const formatted = rows.map(r => orchestrator._deserialise(r)).map(s => {
    const authors = s.authors?.join(', ') || 'Unknown Author';
    const year    = s.year || 'n.d.';
    const title   = s.title || s.url;
    if (format === 'apa') return `${authors} (${year}). ${title}. ${s.url || ''}`.trim();
    if (format === 'mla') return `${authors}. "${title}." ${year}. ${s.url || ''}`.trim();
    return `${authors}, '${title}' (${year}) <${s.url || ''}>`.trim();  // OSCOLA
  });

  return { format, count: formatted.length, bibliography: formatted };
}

async function horatio_check_citations({ citations }) {
  const db      = getDb();
  const sources = db.prepare("SELECT * FROM sources WHERE status='complete'").all().map(r => orchestrator._deserialise(r));
  const results = citations.map(citation => {
    const lower = citation.toLowerCase();
    const match = sources.find(s =>
      s.title?.toLowerCase().includes(lower) ||
      s.authors?.some(a => lower.includes(a.toLowerCase()))
    );
    return { citation, found: !!match, source: match ? { id: match.id, title: match.title, url: match.url } : null };
  });
  return {
    checked:  citations.length,
    verified: results.filter(r => r.found).length,
    flagged:  results.filter(r => !r.found).length,
    results,
  };
}

async function horatio_get_status() {
  const running = await ollama.isRunning();
  const models  = running ? await ollama.listModels() : [];
  const db      = getDb();
  const counts  = db.prepare("SELECT status, COUNT(*) as count FROM sources GROUP BY status").all();
  const thesis  = thesisManager.getThesis();
  return {
    ollama:  { running, models },
    sources: Object.fromEntries(counts.map(r => [r.status, r.count])),
    thesis:  thesis ? { title: thesis.title, set: true } : { set: false },
  };
}

async function horatio_create_note({ title, content, tags = [] }) {
  const db   = getDb();
  const url  = `note:${Date.now()}`;
  const info = db.prepare(
    "INSERT INTO sources (url, title, full_text, summary, source_type, status, category, tags) VALUES (?,?,?,?,?,?,?,?)"
  ).run(url, title, content, content.slice(0, 500), 'note', 'complete', tags[0] || 'Notes', JSON.stringify(tags));
  return { created: true, id: info.lastInsertRowid, title, url };
}

// ── Registry ─────────────────────────────────────────────────────────────────

const TOOLS = {
  horatio_search_corpus,
  horatio_get_source,
  horatio_add_source,
  horatio_get_chapter,
  horatio_suggest_citations,
  horatio_export_bibliography,
  horatio_check_citations,
  horatio_get_status,
  horatio_create_note,
};

async function callTool(name, args = {}) {
  const fn = TOOLS[name];
  if (!fn) throw new Error(`Unknown MCP tool: ${name}`);
  return fn(args);
}

// ── MCP stdio server (external clients: Claude Desktop, Cursor, etc.) ────────
// Activated when main.js detects --mcp-server in process.argv.

let _serverStarted = false;

async function startStdioServer() {
  if (_serverStarted) return;
  _serverStarted = true;
  try {
    const { Server }                                        = await import('@modelcontextprotocol/sdk/server/index.js');
    const { StdioServerTransport }                          = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const { ListToolsRequestSchema, CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');

    const server = new Server(
      { name: 'horatio', version: '2.0.0' },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_SCHEMAS }));

    server.setRequestHandler(CallToolRequestSchema, async req => {
      const { name, arguments: args } = req.params;
      try {
        const result = await callTool(name, args || {});
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    });

    await server.connect(new StdioServerTransport());
    console.error('[MCP] HoRatio MCP server running on stdio');
  } catch (err) {
    console.error('[MCP] stdio server failed to start:', err.message);
  }
}

// ── Tool schemas (MCP protocol ListTools + internal tool definitions) ─────────

const TOOL_SCHEMAS = [
  {
    name:        'horatio_search_corpus',
    description: 'Semantic search across the HoRatio knowledge base. Returns sources ranked by similarity to the query.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, limit: { type: 'number', description: 'Max results (default 10)' } }, required: ['query'] },
  },
  {
    name:        'horatio_get_source',
    description: 'Retrieve a specific source by its database ID, including full text, summary, and metadata.',
    inputSchema: { type: 'object', properties: { id: { type: 'number', description: 'Source database ID' } }, required: ['id'] },
  },
  {
    name:        'horatio_add_source',
    description: 'Ingest a URL or local PDF into the HoRatio knowledge base. Triggers the full analysis and hallucination-guard pipeline.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'URL to ingest' }, filePath: { type: 'string', description: 'Local PDF path to ingest' } } },
  },
  {
    name:        'horatio_get_chapter',
    description: 'Retrieve thesis context and sources associated with a chapter or section name.',
    inputSchema: { type: 'object', properties: { chapter: { type: 'string', description: 'Chapter name or number' }, section: { type: 'string', description: 'Optional sub-section' } }, required: ['chapter'] },
  },
  {
    name:        'horatio_suggest_citations',
    description: 'Suggest relevant citations from the knowledge base for a passage of text. Uses semantic search when Ollama is running, keyword search as fallback.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Text passage needing citations' }, limit: { type: 'number', description: 'Max suggestions (default 5)' } }, required: ['text'] },
  },
  {
    name:        'horatio_export_bibliography',
    description: 'Export a formatted bibliography from the knowledge base in OSCOLA (default), APA, or MLA format.',
    inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['oscola', 'apa', 'mla'], description: 'Citation format' }, ids: { type: 'array', items: { type: 'number' }, description: 'Optional source IDs to include (all if omitted)' } } },
  },
  {
    name:        'horatio_check_citations',
    description: 'Check a list of citation strings against the knowledge base. Flags any not found in indexed sources.',
    inputSchema: { type: 'object', properties: { citations: { type: 'array', items: { type: 'string' }, description: 'Citation strings to verify' } }, required: ['citations'] },
  },
  {
    name:        'horatio_get_status',
    description: 'Get current HoRatio status: Ollama connectivity, source counts by processing state, and thesis configuration.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name:        'horatio_create_note',
    description: 'Create a research note in the HoRatio knowledge base, tagged for later retrieval.',
    inputSchema: { type: 'object', properties: { title: { type: 'string', description: 'Note title' }, content: { type: 'string', description: 'Note content' }, tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorisation' } }, required: ['title', 'content'] },
  },
];

module.exports = { callTool, listTools: () => Object.keys(TOOLS), TOOL_SCHEMAS, startStdioServer };
