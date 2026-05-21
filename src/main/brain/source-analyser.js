// brain/source-analyser.js
// Uses Ollama to generate a summary and score relevance against the thesis.
// Thesis context is injected into every prompt — never omitted.

const ollama       = require('./ollama-client');
const thesisManager = require('./thesis-manager');

class SourceAnalyser {
  // Returns { summary, relevanceScore, relevanceNotes, category, tags }
  async analyse(sourceText, model = 'llama3.1:8b') {
    const thesis  = thesisManager.getThesis();
    const context = thesisManager.buildThesisContext();

    // Truncate source to fit within model context (~8k tokens ≈ 32k chars)
    const truncated = sourceText.slice(0, 12000);

    const summary = await this._summarise(truncated, context, model);
    const scoring = await this._scoreRelevance(summary, thesis, model);

    return {
      summary,
      relevanceScore: scoring.relevance_score ?? 0,
      relevanceNotes: scoring.relevance_notes ?? '',
      category:       scoring.category        ?? 'Uncategorised',
      tags:           scoring.tags            ?? [],
    };
  }

  // ── Private ────────────────────────────────────────────────────────────

  async _summarise(sourceText, thesisContext, model) {
    const prompt = [
      'You are a doctoral research assistant.',
      thesisContext ? thesisContext + '\n' : '',
      'Summarise the following source in 150 words.',
      'Focus on the main argument, methodology, and findings.',
      'If the source is relevant to the thesis above, note exactly why.',
      '',
      'SOURCE:',
      sourceText,
      '',
      'Respond with only the summary, no preamble.',
    ].join('\n');

    return ollama.generate(prompt, model, { temperature: 0.1 });
  }

  async _scoreRelevance(summary, thesis, model) {
    if (!thesis) {
      return { relevance_score: 0, relevance_notes: 'No thesis set', category: 'Uncategorised', tags: [] };
    }

    const questions = (thesis.research_questions || []).join('\n  - ');
    const concepts  = (thesis.key_concepts       || []).join(', ');

    const prompt = [
      'You are a doctoral research assistant. Evaluate the relevance of this source to the thesis below.',
      '',
      `THESIS: ${thesis.statement || thesis.title}`,
      questions ? `RESEARCH QUESTIONS:\n  - ${questions}` : '',
      concepts  ? `KEY CONCEPTS: ${concepts}`             : '',
      '',
      `SOURCE SUMMARY: ${summary}`,
      '',
      'Respond in valid JSON only — no markdown fences, no preamble:',
      '{"relevance_score":0.0,"relevance_notes":"...","category":"...","tags":["tag1","tag2"]}',
    ].filter(Boolean).join('\n');

    const raw  = await ollama.generate(prompt, model, { temperature: 0.1 });
    return this._parseJson(raw, { relevance_score: 0, relevance_notes: raw, category: 'Uncategorised', tags: [] });
  }

  _parseJson(raw, fallback) {
    try {
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      return JSON.parse(clean);
    } catch {
      return fallback;
    }
  }
}

module.exports = new SourceAnalyser();
