// brain/search-engine.js
// Web search via Tavily Search API.
// Falls back with a clear error if no API key is configured.

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

class SearchEngine {
  // Returns [{ url, title, description }], up to `count` results.
  async search(query, count = 10) {
    const key = process.env.TAVILY_API_KEY;
    if (!key) throw new Error('TAVILY_API_KEY not set in .env — Tavily Search unavailable.');

    const res = await fetch(TAVILY_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:      key,
        query,
        max_results:  Math.min(count, 20),
        search_depth: 'basic',   // 'advanced' costs more credits; basic is fine for ingestion
        include_answer:    false,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Tavily API error ${res.status}: ${body.slice(0, 200)}`);
    }

    const data    = await res.json();
    const results = (data.results || []).map(r => ({
      url:         r.url,
      title:       r.title   || '',
      description: r.content || '',
    }));

    console.log(`[SearchEngine] "${query}" → ${results.length} results`);
    return results;
  }
}

module.exports = new SearchEngine();
