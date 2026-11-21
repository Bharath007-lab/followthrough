import type { EvidenceRecord, TranscriptTurn } from '../../shared/types.ts';

export const EVIDENCE_VERIFICATION_THRESHOLD = 0.85;

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"'`’‘]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  return normalizeForMatch(text).split(' ').filter((w) => w.length > 0);
}

/**
 * Computes token containment + Dice similarity between a quote and a candidate turn.
 */
export function computeQuoteSimilarity(quote: string, candidateText: string): number {
  const normQuote = normalizeForMatch(quote);
  const normCandidate = normalizeForMatch(candidateText);
  if (!normQuote || !normCandidate) return 0;

  // Exact normalized substring containment inside a turn
  if (normCandidate.includes(normQuote)) {
    return 1;
  }

  const qTokens = tokenize(normQuote);
  const cTokens = tokenize(normCandidate);
  if (qTokens.length === 0 || cTokens.length === 0) return 0;

  // Sliding window token overlap so a shorter quote inside a longer turn scores high
  const cSet = new Set(cTokens);
  let matched = 0;
  for (const qt of qTokens) {
    if (cSet.has(qt)) matched += 1;
  }
  const containment = matched / qTokens.length;

  // Bigram overlap for order fidelity
  if (qTokens.length >= 2 && cTokens.length >= 2) {
    const cBigrams = new Set<string>();
    for (let i = 0; i < cTokens.length - 1; i++) {
      cBigrams.add(`${cTokens[i]} ${cTokens[i + 1]}`);
    }
    let bigramMatches = 0;
    for (let i = 0; i < qTokens.length - 1; i++) {
      if (cBigrams.has(`${qTokens[i]} ${qTokens[i + 1]}`)) {
        bigramMatches += 1;
      }
    }
    const bigramScore = bigramMatches / (qTokens.length - 1);
    return Number((containment * 0.55 + bigramScore * 0.45).toFixed(3));
  }

  return Number(containment.toFixed(3));
}

export function verifyEvidenceAgainstTurns(
  evidence: EvidenceRecord,
  turns: TranscriptTurn[]
): EvidenceRecord {
  if (!evidence.quote || turns.length === 0) {
    return {
      ...evidence,
      verified: false,
      similarity: 0,
      matched_turn_index: null,
    };
  }

  let bestScore = 0;
  let bestTurn: TranscriptTurn | null = null;

  // Check claimed turn_index first for tie-breaking advantage
  const claimedTurn = turns.find((t) => t.index === evidence.turn_index);
  if (claimedTurn) {
    const directScore = computeQuoteSimilarity(evidence.quote, claimedTurn.text);
    bestScore = directScore;
    bestTurn = claimedTurn;
  }

  if (bestScore < 1) {
    for (const turn of turns) {
      const score = computeQuoteSimilarity(evidence.quote, turn.text);
      if (score > bestScore) {
        bestScore = score;
        bestTurn = turn;
      }
      if (bestScore === 1) break;
    }
  }

  // Also check adjacent two-turn window if quote spanned two lines
  if (bestScore < EVIDENCE_VERIFICATION_THRESHOLD) {
    for (let i = 0; i < turns.length - 1; i++) {
      const combined = `${turns[i].text} ${turns[i + 1].text}`;
      const score = computeQuoteSimilarity(evidence.quote, combined);
      if (score > bestScore) {
        bestScore = score;
        bestTurn = turns[i];
      }
    }
  }

  const verified = bestScore >= EVIDENCE_VERIFICATION_THRESHOLD;
  return {
    quote: evidence.quote,
    speaker: bestTurn?.speaker ?? evidence.speaker ?? null,
    turn_index: bestTurn ? bestTurn.index : evidence.turn_index,
    verified,
    similarity: Number(bestScore.toFixed(3)),
    matched_turn_index: bestTurn ? bestTurn.index : null,
  };
}

const VAGUE_PATTERNS = [
  /\b(someone|somebody|anyone)\s+(?:should|could|might|needs to)\b/i,
  /\b(look into|think about|explore|maybe|probably|sometime|eventually|touch base)\b/i,
  /\b(we should probably|we might want to|figure out later)\b/i,
];

const PASSIVE_PATTERNS = [
  /\b(needs to be|should be|must be|will be)\s+[a-z]+(?:ed|en|done|handled|fixed|updated)\b/i,
  /\b(it was mentioned|ought to be)\b/i,
];

export function evaluateCommitmentQualityFlags(params: {
  title: string;
  description: string;
  owner: string | null;
  ownerSource: 'explicit' | 'inferred' | 'unassigned';
  deadline: string | null;
  confidence: number;
  evidence: EvidenceRecord;
  existingFlags?: string[];
  isDuplicate?: boolean;
}): string[] {
  const flags = new Set<string>(params.existingFlags || []);
  const combinedText = `${params.title} ${params.description} ${params.evidence.quote}`;

  if (!params.owner || params.ownerSource === 'unassigned') {
    flags.add('missing_owner');
  }
  if (params.ownerSource === 'inferred') {
    flags.add('inferred_owner_needs_review');
  }
  if (!params.deadline) {
    flags.add('missing_deadline');
  }
  if (params.confidence < 0.75) {
    flags.add('low_confidence');
  }
  if (params.evidence.verified === false) {
    flags.add('unverified_evidence');
  }
  if (VAGUE_PATTERNS.some((rx) => rx.test(combinedText))) {
    flags.add('vague_commitment');
  }
  if (PASSIVE_PATTERNS.some((rx) => rx.test(combinedText))) {
    flags.add('passive_wording');
  }
  if (
    /\b(someone|team|engineering|marketing|we all|either\s+\w+\s+or\s+\w+)\b/i.test(
      params.owner || ''
    )
  ) {
    flags.add('ambiguous_responsibility');
  }
  if (params.isDuplicate) {
    flags.add('duplicate_commitment');
  }

  return Array.from(flags);
}

/**
 * Deterministic token Jaccard similarity for duplicate commitment detection.
 */
export function computeTextJaccard(a: string, b: string): number {
  const stopWords = new Set([
    'the',
    'a',
    'an',
    'to',
    'for',
    'of',
    'on',
    'in',
    'by',
    'and',
    'or',
    'with',
    'is',
    'will',
    'be',
  ]);
  const setA = new Set(tokenize(a).filter((w) => w.length > 2 && !stopWords.has(w)));
  const setB = new Set(tokenize(b).filter((w) => w.length > 2 && !stopWords.has(w)));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const tok of setA) {
    if (setB.has(tok)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? Number((intersection / union).toFixed(3)) : 0;
}
