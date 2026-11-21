import type { DecisionRecord } from '../../shared/types.ts';

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'that',
  'with',
  'this',
  'from',
  'will',
  'have',
  'been',
  'were',
  'are',
  'our',
  'team',
  'product',
  'meeting',
  'decided',
  'decision',
]);

function extractTerms(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9$\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * Deterministically selects up to `limit` (default 15) most relevant historical decisions
 * so the LLM never receives the entire historical database.
 */
export function retrieveConflictCandidates(
  newDecisions: Array<{ topic: string; statement: string; decided_by: string | null }>,
  historicalDecisions: DecisionRecord[],
  limit = 15
): DecisionRecord[] {
  if (historicalDecisions.length === 0 || newDecisions.length === 0) {
    return [];
  }

  const queryTerms = new Set<string>();
  const queryTopics = new Set<string>();

  for (const nd of newDecisions) {
    queryTopics.add(nd.topic.toLowerCase().trim());
    for (const t of extractTerms(`${nd.topic} ${nd.statement} ${nd.decided_by || ''}`)) {
      queryTerms.add(t);
    }
  }

  const scored = historicalDecisions.map((hist) => {
    let score = 0;
    const histTopic = hist.topic.toLowerCase().trim();
    const histTerms = extractTerms(`${hist.topic} ${hist.statement} ${hist.decided_by || ''}`);

    // Strong boost for exact or partial topic match
    for (const qt of queryTopics) {
      if (qt === histTopic) {
        score += 10;
      } else if (qt.includes(histTopic) || histTopic.includes(qt)) {
        score += 6;
      }
    }

    // Token overlap
    for (const t of histTerms) {
      if (queryTerms.has(t)) {
        score += 2;
      }
    }

    // Prioritize currently active decisions slightly over superseded ones, while keeping history reachable
    if (hist.status === 'active') {
      score += 1.5;
    } else if (hist.status === 'contested') {
      score += 1;
    }

    return { hist, score };
  });

  // Keep relevant candidates; if everything scored 0 on a small org DB, fall back to latest active decisions
  const matched = scored
    .filter((s) => s.score >= 2)
    .sort((a, b) => b.score - a.score || b.hist.created_at.localeCompare(a.hist.created_at))
    .slice(0, limit)
    .map((s) => s.hist);

  if (matched.length > 0) {
    return matched;
  }

  return historicalDecisions
    .filter((d) => d.status === 'active' || d.status === 'contested')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, Math.min(limit, 8));
}
