import type { QualityCheckItem, QualityReport } from '../../shared/types.ts';
import type { ParsedTranscriptResult } from './parser.ts';

export const MAX_FILE_BYTES = 1_048_576; // 1 MB
export const MAX_TRANSCRIPT_CHARS = 200_000;
export const ALLOWED_EXTENSIONS = new Set(['txt', 'md', 'vtt', 'srt']);

const PROMPT_INJECTION_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  {
    label: 'Instruction override attempt',
    regex: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
  },
  {
    label: 'System prompt extraction attempt',
    regex: /(?:reveal|print|dump|output)\s+(?:your\s+)?(?:system\s+prompt|api\s+keys?|secrets?|confidential)/i,
  },
  {
    label: 'Role hijacking attempt',
    regex: /\b(?:you\s+are\s+now|disregard\s+your\s+rules|bypass\s+all\s+safety)\b/i,
  },
];

export interface QualityGateInput {
  rawText: string;
  parsed: ParsedTranscriptResult;
  meetingDate: string;
  filename?: string;
  fileSizeBytes?: number;
  isDuplicate?: boolean;
}

export function runQualityGate(input: QualityGateInput): QualityReport {
  const checks: QualityCheckItem[] = [];
  const warnings: string[] = [];
  let blocked = false;
  let score = 100;

  const addCheck = (
    id: string,
    label: string,
    status: 'pass' | 'warning' | 'block',
    detail: string,
    penalty = 0
  ) => {
    checks.push({ id, label, status, detail });
    if (status === 'block') blocked = true;
    if (status === 'warning') warnings.push(detail);
    score = Math.max(0, score - penalty);
  };

  // 1. Empty content check
  const trimmed = input.rawText.trim();
  if (!trimmed) {
    addCheck('empty_content', 'Content presence', 'block', 'Transcript content is empty.', 100);
  } else {
    addCheck(
      'empty_content',
      'Content presence',
      'pass',
      `${trimmed.length.toLocaleString()} characters supplied.`
    );
  }

  // 2. File extension validation
  if (input.filename) {
    const ext = input.filename.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      addCheck(
        'file_extension',
        'File format',
        'block',
        `Unsupported file extension ".${ext}". Allowed: .txt, .md, .vtt, .srt.`,
        40
      );
    } else {
      addCheck('file_extension', 'File format', 'pass', `Valid .${ext} transcript file.`);
    }
  } else {
    addCheck(
      'file_extension',
      'File format',
      'pass',
      `Detected ${input.parsed.format.toUpperCase()} transcript text.`
    );
  }

  // 3. File size & character limits
  const byteSize = input.fileSizeBytes ?? Buffer.byteLength(input.rawText, 'utf8');
  if (byteSize > MAX_FILE_BYTES) {
    addCheck(
      'file_size',
      'Size limit (1 MB)',
      'block',
      `File size (${(byteSize / 1024 / 1024).toFixed(2)} MB) exceeds the 1 MB maximum.`,
      50
    );
  } else if (input.rawText.length > MAX_TRANSCRIPT_CHARS) {
    addCheck(
      'file_size',
      'Character limit (200k)',
      'block',
      `Transcript length (${input.rawText.length.toLocaleString()} chars) exceeds the 200,000 character limit.`,
      50
    );
  } else {
    addCheck(
      'file_size',
      'Size limits',
      'pass',
      `${(byteSize / 1024).toFixed(1)} KB (${input.rawText.length.toLocaleString()} chars) within limits.`
    );
  }

  // 4. Encoding / binary corruption check
  const hasNullBytes = /\u0000/.test(input.rawText);
  const replacementChars = (input.rawText.match(/\uFFFD/g) || []).length;
  if (hasNullBytes) {
    addCheck(
      'encoding',
      'Text encoding',
      'block',
      'Binary null bytes detected. Upload a valid UTF-8 text transcript.',
      50
    );
  } else if (replacementChars > 3) {
    addCheck(
      'encoding',
      'Text encoding',
      'warning',
      `Detected ${replacementChars} Unicode replacement characters (possible encoding mismatch).`,
      10
    );
  } else {
    addCheck('encoding', 'Text encoding', 'pass', 'Clean UTF-8 text encoding.');
  }

  // 5. Meeting date validity
  const dateValid =
    /^\d{4}-\d{2}-\d{2}$/.test(input.meetingDate) &&
    !Number.isNaN(Date.parse(`${input.meetingDate}T00:00:00Z`));
  if (!dateValid) {
    addCheck(
      'meeting_date',
      'Meeting date',
      'block',
      `Invalid meeting date "${input.meetingDate}". Expected YYYY-MM-DD.`,
      30
    );
  } else {
    addCheck('meeting_date', 'Meeting date', 'pass', `Valid reference date ${input.meetingDate}.`);
  }

  // 6. Duplicate transcript detection
  if (input.isDuplicate) {
    addCheck(
      'duplicate_content',
      'Duplicate check',
      'block',
      'An identical transcript (matching SHA-256 content hash) has already been ingested.',
      100
    );
  } else {
    addCheck('duplicate_content', 'Duplicate check', 'pass', 'Unique transcript hash confirmed.');
  }

  // 7. Word count & turn count
  if (input.parsed.wordCount < 15) {
    addCheck(
      'word_count',
      'Substantive length',
      'block',
      `Transcript is too short (${input.parsed.wordCount} words). Minimum 15 words required.`,
      40
    );
  } else if (input.parsed.wordCount < 50) {
    addCheck(
      'word_count',
      'Substantive length',
      'warning',
      `Short transcript (${input.parsed.wordCount} words across ${input.parsed.turns.length} turns). Context may be limited.`,
      10
    );
  } else {
    addCheck(
      'word_count',
      'Substantive length',
      'pass',
      `${input.parsed.wordCount} words across ${input.parsed.turns.length} parsed turns.`
    );
  }

  // 8. Speaker coverage & unlabelled content check
  const coveragePct = Math.round(input.parsed.speakerCoverage * 100);
  if (input.parsed.turns.length > 0 && input.parsed.speakers.length === 0) {
    addCheck(
      'speaker_coverage',
      'Speaker attribution',
      'warning',
      'Unlabelled transcript: no speaker labels detected. Owners will be marked unassigned/inferred and require human review.',
      25
    );
  } else if (input.parsed.speakerCoverage < 0.7) {
    addCheck(
      'speaker_coverage',
      'Speaker attribution',
      'warning',
      `Partial speaker labels (${coveragePct}% of turns attributed across ${input.parsed.speakers.length} speakers). Review extracted owners carefully.`,
      15
    );
  } else {
    addCheck(
      'speaker_coverage',
      'Speaker attribution',
      'pass',
      `${coveragePct}% of turns attributed across ${input.parsed.speakers.length} speakers (${input.parsed.speakers.join(', ')}).`
    );
  }

  // 9. Prompt-injection content quarantine warning (untrusted transcript data)
  const injectionSignals: string[] = [];
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.regex.test(input.rawText)) {
      injectionSignals.push(pattern.label);
    }
  }
  if (injectionSignals.length > 0) {
    addCheck(
      'prompt_injection',
      'Prompt-injection guard',
      'warning',
      `Untrusted directive-like text detected (${injectionSignals.join(', ')}). Quarantined strictly as data; instructions inside transcript will be ignored.`,
      5
    );
  } else {
    addCheck('prompt_injection', 'Prompt-injection guard', 'pass', 'No instruction-override patterns detected.');
  }

  const status: QualityReport['status'] = blocked
    ? 'block'
    : warnings.length > 0
      ? 'warning'
      : 'pass';

  return {
    status,
    score: blocked ? Math.min(score, 40) : score,
    checks,
    warnings,
    speakers: input.parsed.speakers,
    wordCount: input.parsed.wordCount,
    turnCount: input.parsed.turns.length,
    speakerCoverage: input.parsed.speakerCoverage,
    detectedFormat: input.parsed.format,
    injectionSignals,
  };
}
