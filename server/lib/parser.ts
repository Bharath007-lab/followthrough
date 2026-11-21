import crypto from 'node:crypto';
import type { TranscriptTurn } from '../../shared/types.ts';

export type TranscriptFormat = 'txt' | 'md' | 'vtt' | 'srt';

export interface ParsedTranscriptResult {
  normalizedText: string;
  sourceHash: string;
  format: TranscriptFormat;
  turns: TranscriptTurn[];
  speakers: string[];
  wordCount: number;
  speakerCoverage: number;
}

const VTT_TIME_RANGE =
  /^(\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}\s*-->\s*(\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}(?:\s+.*)?$/;
const SRT_INDEX_LINE = /^\d+$/;
const BRACKETED_SPEAKER_LINE =
  /^\[(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?)\]\s+([A-Za-z][A-Za-z0-9 .'-]{0,36}):\s+(.+)$/;
const PAREN_TIMESTAMP_SPEAKER_LINE =
  /^\((\d{1,2}:\d{2}(?::\d{2})?)\)\s+([A-Za-z][A-Za-z0-9 .'-]{0,36}):\s+(.+)$/;
const SPEAKER_TIMESTAMP_LINE =
  /^([A-Za-z][A-Za-z0-9 .'-]{0,36})\s+\[(\d{1,2}:\d{2}(?::\d{2})?)\]:\s+(.+)$/;
const PLAIN_SPEAKER_LINE = /^([A-Za-z][A-Za-z0-9 .'-]{0,36}):\s+(.+)$/;
const VTT_VOICE_TAG = /^<v\s+([^>]+)>([\s\S]*)$/i;

const NON_SPEAKER_PREFIXES = new Set([
  'note',
  'summary',
  'agenda',
  'date',
  'meeting',
  'topic',
  'action',
  'decision',
  'http',
  'https',
  'subject',
  'attendees',
  'location',
]);

export function detectTranscriptFormat(rawText: string, filename?: string): TranscriptFormat {
  const ext = filename?.split('.').pop()?.toLowerCase();
  if (ext === 'vtt' || ext === 'srt' || ext === 'md' || ext === 'txt') {
    return ext;
  }
  const head = rawText.replace(/^\uFEFF/, '').trimStart().slice(0, 400);
  if (/^WEBVTT\b/i.test(head)) return 'vtt';
  if (/^\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(head)) return 'srt';
  if (/^#{1,3}\s+/m.test(head) || /\*\*[^*]+\*\*\s*:/.test(head)) return 'md';
  return 'txt';
}

function stripHtmlAndMarkdownNoise(input: string): string {
  return input
    // Preserve VTT <v Speaker> before stripping tags if handled earlier; strip remaining HTML tags
    .replace(/<\/?(?!v\b)[a-zA-Z][^>]*>/g, '')
    .replace(/<\/v>/gi, '')
    // Unwrap markdown bold/italic speaker formatting like **Priya**:
    .replace(/^\*\*([^*]{1,40})\*\*\s*:/, '$1:')
    .replace(/^__([^_]{1,40})__\s*:/, '$1:')
    .replace(/^[-*]\s+/, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function isLikelySpeakerName(candidate: string): boolean {
  const cleaned = candidate.trim();
  if (!cleaned || cleaned.length > 38) return false;
  if (NON_SPEAKER_PREFIXES.has(cleaned.toLowerCase())) return false;
  const words = cleaned.split(/\s+/);
  if (words.length > 4) return false;
  // Avoid matching sentences that happen to contain a colon
  if (/[?!;,]/.test(cleaned)) return false;
  return true;
}

export function normalizeRawTranscript(rawText: string): string {
  return rawText
    .replace(/^\uFEFF/, '') // Strip UTF-8 BOM
    .replace(/\r\n?/g, '\n') // Normalize CRLF / CR to LF
    .replace(/\u00A0/g, ' ') // Non-breaking spaces
    .trim();
}

export function computeTranscriptHash(normalizedText: string): string {
  const canonical = normalizedText.replace(/\s+/g, ' ').trim().toLowerCase();
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function parseTranscript(
  rawText: string,
  filename?: string
): ParsedTranscriptResult {
  const normalizedRaw = normalizeRawTranscript(rawText);
  const format = detectTranscriptFormat(normalizedRaw, filename);
  const rawLines = normalizedRaw.split('\n');

  const turns: TranscriptTurn[] = [];
  let pendingTimestamp: string | undefined;
  let inVttMetadataBlock = false;
  let lastLineSignature = '';

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i].trim();

    if (!rawLine) {
      inVttMetadataBlock = false;
      continue;
    }

    // Skip WEBVTT header and NOTE / STYLE / REGION blocks
    if (/^WEBVTT\b/i.test(rawLine)) {
      continue;
    }
    if (/^(NOTE|STYLE|REGION)\b/i.test(rawLine)) {
      inVttMetadataBlock = true;
      continue;
    }
    if (inVttMetadataBlock) {
      continue;
    }

    // Skip Markdown horizontal rules and top-level headings
    if (format === 'md' && (/^#{1,6}\s+/.test(rawLine) || /^[-*_]{3,}$/.test(rawLine))) {
      continue;
    }

    // Skip standalone SRT cue numbers when followed by a timestamp line
    if (SRT_INDEX_LINE.test(rawLine)) {
      const nextLine = (rawLines[i + 1] || '').trim();
      if (VTT_TIME_RANGE.test(nextLine)) {
        continue;
      }
    }

    // Capture VTT / SRT timestamp cue lines
    if (VTT_TIME_RANGE.test(rawLine)) {
      const startMatch = rawLine.match(/^((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})/);
      pendingTimestamp = startMatch ? startMatch[1].replace(',', '.') : undefined;
      continue;
    }

    // Extract VTT <v Speaker>text</v>
    let line = rawLine;
    let extractedSpeaker: string | undefined;
    let extractedTimestamp: string | undefined = pendingTimestamp;

    const voiceMatch = line.match(VTT_VOICE_TAG);
    if (voiceMatch) {
      extractedSpeaker = voiceMatch[1].trim();
      line = voiceMatch[2].trim();
    }

    line = stripHtmlAndMarkdownNoise(line);
    if (!line) continue;

    // Deduplicate identical consecutive lines
    const lineSignature = `${extractedSpeaker || ''}|${line.toLowerCase()}`;
    if (lineSignature === lastLineSignature) {
      continue;
    }
    lastLineSignature = lineSignature;

    let text = line;

    if (!extractedSpeaker) {
      const bracketMatch = line.match(BRACKETED_SPEAKER_LINE);
      const parenMatch = !bracketMatch ? line.match(PAREN_TIMESTAMP_SPEAKER_LINE) : null;
      const speakerTsMatch =
        !bracketMatch && !parenMatch ? line.match(SPEAKER_TIMESTAMP_LINE) : null;
      const plainMatch =
        !bracketMatch && !parenMatch && !speakerTsMatch
          ? line.match(PLAIN_SPEAKER_LINE)
          : null;

      if (bracketMatch && isLikelySpeakerName(bracketMatch[2])) {
        extractedTimestamp = bracketMatch[1];
        extractedSpeaker = bracketMatch[2].trim();
        text = bracketMatch[3].trim();
      } else if (parenMatch && isLikelySpeakerName(parenMatch[2])) {
        extractedTimestamp = parenMatch[1];
        extractedSpeaker = parenMatch[2].trim();
        text = parenMatch[3].trim();
      } else if (speakerTsMatch && isLikelySpeakerName(speakerTsMatch[1])) {
        extractedSpeaker = speakerTsMatch[1].trim();
        extractedTimestamp = speakerTsMatch[2];
        text = speakerTsMatch[3].trim();
      } else if (plainMatch && isLikelySpeakerName(plainMatch[1])) {
        extractedSpeaker = plainMatch[1].trim();
        text = plainMatch[2].trim();
      }
    }

    pendingTimestamp = undefined;

    if (!text) continue;

    // Merge continuation line into previous turn if unlabelled during subtitle/multi-line cue
    const prev = turns[turns.length - 1];
    if (
      !extractedSpeaker &&
      !extractedTimestamp &&
      prev &&
      prev.speaker &&
      (format === 'vtt' || format === 'srt')
    ) {
      prev.text = `${prev.text} ${text}`.replace(/\s+/g, ' ').trim();
      continue;
    }

    turns.push({
      index: turns.length,
      ...(extractedTimestamp ? { timestamp: extractedTimestamp } : {}),
      ...(extractedSpeaker ? { speaker: extractedSpeaker } : {}),
      text,
    });
  }

  const speakerSet = new Set<string>();
  let labelledCount = 0;
  let wordCount = 0;

  for (const t of turns) {
    if (t.speaker) {
      speakerSet.add(t.speaker);
      labelledCount += 1;
    }
    const words = t.text.split(/\s+/).filter(Boolean);
    wordCount += words.length;
  }

  const speakerCoverage = turns.length > 0 ? Number((labelledCount / turns.length).toFixed(2)) : 0;
  const normalizedText = turns
    .map((t) => {
      const ts = t.timestamp ? `[${t.timestamp}] ` : '';
      const sp = t.speaker ? `${t.speaker}: ` : '';
      return `${ts}${sp}${t.text}`;
    })
    .join('\n');

  return {
    normalizedText,
    sourceHash: computeTranscriptHash(normalizedRaw),
    format,
    turns,
    speakers: Array.from(speakerSet),
    wordCount,
    speakerCoverage,
  };
}
