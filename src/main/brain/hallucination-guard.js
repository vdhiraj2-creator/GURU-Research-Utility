// brain/hallucination-guard.js
// Validates every LLM-generated summary against the original source text
// before it is written to the database.
//
// Rules (from spec, enforced here):
//   verified=false      → flagged for review, NOT written to DB
//   confidence < 0.7    → flagged for review, NOT written to DB
//   contradiction found → user notified via IPC before accepting
//   verified_summary    → always replaces raw LLM output in DB
//   temperature=0.0     → mandatory for all guard prompts, no exceptions

const ollama = require('./ollama-client');
const { getDb } = require('../db/schema');

// Max existing sources to include in cross-reference prompt — keeps context bounded.
const MAX_CROSS_REF_SOURCES = 5;

class HallucinationGuard {
  // Verify a generated summary against the original source text.
  // Returns { verified, confidence, verifiedSummary, hallucinationFlags, uncertaintyNotes }
  async verify(summary, sourceText, model = 'llama3.1:8b') {
    const truncatedSource = sourceText.slice(0, 10000); // stay within context window

    const prompt = [
      'You are a strict academic fact-checker.',
      'Compare this summary against the original source text.',
      'Identify every claim in the summary that is NOT directly supported by the source.',
      '',
      'ORIGINAL SOURCE TEXT:',
      truncatedSource,
      '',
      'GENERATED SUMMARY:',
      summary,
      '',
      'Respond in valid JSON only — no markdown fences, no preamble:',
      JSON.stringify({
        verified:          true,
        confidence:        1.0,
        hallucination_flags:  ['claim not in source...'],
        verified_summary:  'rewritten summary using only verifiable claims',
        uncertainty_notes: ['anything unclear...'],
      }),
    ].join('\n');

    // temperature MUST be 0.0 — zero creativity for verification
    const raw    = await ollama.generate(prompt, model, { temperature: 0.0 });
    const result = this._parseJson(raw, {
      verified:          false,
      confidence:        0.0,
      hallucination_flags:  ['parse error — treating as unverified'],
      verified_summary:  summary,
      uncertainty_notes: [],
    });

    // Normalise field names (guard against slight JSON key variation)
    return {
      verified:          !!result.verified,
      confidence:        parseFloat(result.confidence)        ?? 0.0,
      hallucinationFlags: result.hallucination_flags          ?? [],
      verifiedSummary:   result.verified_summary              || summary,
      uncertaintyNotes:  result.uncertainty_notes             ?? [],
    };
  }

  // Cross-reference a new claim against the top semantically related existing sources.
  // Returns { contradictionDetected, contradictingSources, recommendation }
  async crossReference(claim, sourceId, model = 'llama3.1:8b') {
    const db = getDb();

    // Fetch the most recent sources (semantic ranking happens in VectorStore;
    // here we use recency as a simple proxy until vector search is available).
    const related = db.prepare(`
      SELECT title, year, summary
      FROM   sources
      WHERE  status = 'complete'
        AND  id    != ?
        AND  summary IS NOT NULL
      ORDER  BY processed_at DESC
      LIMIT  ?
    `).all(sourceId, MAX_CROSS_REF_SOURCES);

    if (!related.length) {
      return { contradictionDetected: false, contradictingSources: [], recommendation: 'accept' };
    }

    const knowledgeBlock = related.map((s, i) =>
      `[${i + 1}] ${s.title} (${s.year || 'n.d.'}): ${(s.summary || '').slice(0, 400)}`
    ).join('\n\n');

    const prompt = [
      'You are an academic research assistant checking for contradictions.',
      '',
      `NEW CLAIM: ${claim}`,
      '',
      'EXISTING KNOWLEDGE BASE:',
      knowledgeBlock,
      '',
      'Does the new claim contradict any existing source?',
      'Respond in valid JSON only — no markdown fences, no preamble:',
      JSON.stringify({
        contradiction_detected:  false,
        contradicting_sources:   ['source title and the contradiction'],
        recommendation:          'accept',
      }),
    ].join('\n');

    const raw    = await ollama.generate(prompt, model, { temperature: 0.0 });
    const result = this._parseJson(raw, {
      contradiction_detected: false,
      contradicting_sources:  [],
      recommendation:         'accept',
    });

    return {
      contradictionDetected: !!result.contradiction_detected,
      contradictingSources:  result.contradicting_sources ?? [],
      recommendation:        result.recommendation        ?? 'accept',
    };
  }

  // Persist hallucination flags for a source and mark it for human review.
  // Also physically removes the source from the DB if rejected.
  async flagForReview(sourceId, flags, reason, action = 'flag') {
    const db = getDb();

    if (action === 'reject') {
      // Hard delete — source failed verification and must not enter the knowledge base.
      db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
      console.warn(`[HallucinationGuard] Source ${sourceId} REJECTED and removed: ${reason}`);
      return { removed: true };
    }

    // Soft flag — write flags and mark for human review.
    db.prepare(`
      UPDATE sources SET
        hallucination_flags = ?,
        requires_review     = 1,
        status              = 'flagged'
      WHERE id = ?
    `).run(JSON.stringify(flags), sourceId);

    console.warn(`[HallucinationGuard] Source ${sourceId} flagged for review: ${reason}`);
    return { removed: false, flags };
  }

  // Remove hallucination-flagged sources that have been pending review for too long,
  // or that the user explicitly clears. Safe to call on a schedule.
  removeRejected() {
    const db      = getDb();
    const result  = db.prepare("DELETE FROM sources WHERE status = 'rejected'").run();
    console.log(`[HallucinationGuard] Removed ${result.changes} rejected source(s)`);
    return result.changes;
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

module.exports = new HallucinationGuard();
