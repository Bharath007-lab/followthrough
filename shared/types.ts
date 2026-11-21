import { z } from 'zod';

export type DecisionStatus = 'active' | 'superseded' | 'contested';
export type ActionItemStatus = 'proposed' | 'approved' | 'rejected' | 'in_progress' | 'done';
export type ActionItemPriority = 'low' | 'medium' | 'high';
export type OwnerSource = 'explicit' | 'inferred' | 'unassigned';
export type ConflictType =
  | 'direct_contradiction'
  | 'deadline_change'
  | 'owner_change'
  | 'scope_change'
  | 'duplicate_commitment'
  | 'dependency_conflict';
export type ConflictSeverity = 'low' | 'medium' | 'high';
export type ConflictResolution = 'open' | 'superseded' | 'kept_old' | 'contested';
export type ReminderKind = 'overdue' | 'due_soon' | 'upcoming' | 'completed';

export interface TranscriptTurn {
  index: number;
  timestamp?: string;
  speaker?: string;
  text: string;
}

export interface QualityCheckItem {
  id: string;
  label: string;
  status: 'pass' | 'warning' | 'block';
  detail: string;
}

export interface QualityReport {
  status: 'pass' | 'warning' | 'block';
  score: number;
  checks: QualityCheckItem[];
  warnings: string[];
  speakers: string[];
  wordCount: number;
  turnCount: number;
  speakerCoverage: number;
  detectedFormat: 'txt' | 'md' | 'vtt' | 'srt';
  injectionSignals: string[];
}

export interface EvidenceRecord {
  quote: string;
  speaker: string | null;
  turn_index: number;
  verified?: boolean;
  similarity?: number;
  matched_turn_index?: number | null;
}

export interface OpenQuestion {
  id: string;
  question: string;
  raised_by: string | null;
  status: 'open' | 'resolved';
  evidence: EvidenceRecord;
}

export interface MeetingRisk {
  id: string;
  category: 'dependency' | 'blocker' | 'delivery_risk' | 'uncertainty';
  description: string;
  severity: 'low' | 'medium' | 'high';
  evidence: EvidenceRecord;
}

export interface PersonRecord {
  id: string;
  name: string;
  role: string | null;
  aliases: string[];
  is_demo: boolean;
  created_at: string;
}

export interface MeetingRecord {
  id: string;
  title: string;
  meeting_date: string; // YYYY-MM-DD
  attendees: string[];
  source_hash: string;
  raw_text: string;
  quality_report: QualityReport;
  open_questions: OpenQuestion[];
  risks: MeetingRisk[];
  health_score: number;
  is_demo: boolean;
  created_at: string;
}

export interface StoredTurnRecord {
  id: string;
  meeting_id: string;
  idx: number;
  timestamp: string | null;
  speaker: string | null;
  text: string;
}

export interface DecisionRecord {
  id: string;
  meeting_id: string;
  topic: string;
  statement: string;
  decided_by: string | null;
  evidence: EvidenceRecord;
  status: DecisionStatus;
  superseded_by: string | null;
  confidence: number;
  is_demo: boolean;
  created_at: string;
  meeting_title?: string;
  meeting_date?: string;
}

export interface ActionItemRecord {
  id: string;
  meeting_id: string;
  decision_id: string | null;
  title: string;
  description: string;
  owner: string | null;
  owner_source: OwnerSource;
  deadline: string | null; // YYYY-MM-DD
  deadline_phrase: string | null;
  priority: ActionItemPriority;
  status: ActionItemStatus;
  external_id: string | null;
  external_url: string | null;
  tracker: 'internal' | 'github';
  evidence: EvidenceRecord;
  confidence: number;
  flags: string[];
  is_demo: boolean;
  created_at: string;
  meeting_title?: string;
  meeting_date?: string;
}

export interface ConflictRecord {
  id: string;
  new_ref: string;
  old_decision_id: string;
  type: ConflictType;
  severity: ConflictSeverity;
  reason: string;
  suggested_resolution: string;
  resolution: ConflictResolution;
  is_demo: boolean;
  created_at: string;
  new_decision?: DecisionRecord;
  old_decision?: DecisionRecord;
}

export interface ReminderRecord {
  id: string;
  action_item_id: string;
  kind: ReminderKind;
  message: string;
  source: 'manual_simulation' | 'cron';
  created_at: string;
  seen: boolean;
  action_item?: ActionItemRecord;
}

export interface AuditLogRecord {
  id: string;
  actor: string;
  event: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface DashboardMetrics {
  meetingsProcessed: number;
  activeDecisions: number;
  pendingApprovals: number;
  openTasks: number;
  overdueTasks: number;
  unresolvedConflicts: number;
  totalDecisions: number;
  verifiedEvidenceRate: number;
}

export interface DiscoveredModel {
  id: string;
  ownedBy?: string;
  created?: number;
  recommended: boolean;
  notes: string;
}

export interface LLMCallLog {
  id: string;
  timestamp: string;
  operation: string;
  model: string;
  status: 'success' | 'error';
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  repairAttempted: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface BluesMindsVerificationResult {
  verified: boolean;
  timestamp: string;
  baseUrl: string;
  configuredModel: string | null;
  actualModelUsed: string | null;
  latencyMs: number | null;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  steps: Array<{
    step: number;
    name: string;
    status: 'pass' | 'fail' | 'skipped';
    detail: string;
  }>;
  error?: string;
}

export interface IntegrationStatus {
  bluesminds: {
    configured: boolean;
    baseUrl: string;
    model: string | null;
    lastVerification: BluesMindsVerificationResult | null;
  };
  supabase: {
    configured: boolean;
    connected: boolean;
    storageMode: 'supabase' | 'local_fallback';
    error?: string;
  };
  github: {
    configured: boolean;
    repo: string | null;
  };
  cron: {
    configured: boolean;
  };
  appUrl: string | null;
}

export interface PersonDigest {
  person: string;
  role: string | null;
  generatedAt: string;
  openCommitments: ActionItemRecord[];
  upcomingDeadlines: ActionItemRecord[];
  overdueTasks: ActionItemRecord[];
  newAssignments: ActionItemRecord[];
  relevantDecisions: DecisionRecord[];
  conflictsRequiringAttention: ConflictRecord[];
  emailPreview: string;
  polishedWithAI?: boolean;
}

export interface SampleMeetingInfo {
  key: string;
  title: string;
  meeting_date: string;
  attendees: string[];
  category: 'nova_series' | 'edge_case';
  summary: string;
  format: 'txt' | 'md' | 'vtt' | 'srt';
  transcript: string;
}

// Zod schemas for AI structured extraction
export const EvidenceExtractionSchema = z.object({
  quote: z.string().min(1),
  speaker: z.string().nullable().default(null),
  turn_index: z.number().int().min(0).default(0),
});

export const ExtractedDecisionSchema = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  statement: z.string().min(1),
  decided_by: z.string().nullable().default(null),
  evidence: EvidenceExtractionSchema,
  confidence: z.number().min(0).max(1).default(0.8),
});

export const ExtractedActionItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  owner: z.string().nullable().default(null),
  owner_source: z.enum(['explicit', 'inferred', 'unassigned']).default('unassigned'),
  deadline_iso: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .catch(null),
  deadline_phrase: z.string().nullable().default(null),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  evidence: EvidenceExtractionSchema,
  confidence: z.number().min(0).max(1).default(0.8),
  quality_flags: z.array(z.string()).default([]),
});

export const ExtractedOpenQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  raised_by: z.string().nullable().default(null),
  status: z.enum(['open', 'resolved']).default('open'),
  evidence: EvidenceExtractionSchema,
});

export const ExtractedRiskSchema = z.object({
  id: z.string().min(1),
  category: z.enum(['dependency', 'blocker', 'delivery_risk', 'uncertainty']).default('delivery_risk'),
  description: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
  evidence: EvidenceExtractionSchema,
});

export const MeetingExtractionResponseSchema = z.object({
  decisions: z.array(ExtractedDecisionSchema).default([]),
  action_items: z.array(ExtractedActionItemSchema).default([]),
  open_questions: z.array(ExtractedOpenQuestionSchema).default([]),
  risks: z.array(ExtractedRiskSchema).default([]),
});

export type MeetingExtractionResponse = z.infer<typeof MeetingExtractionResponseSchema>;

export const ConflictDetectionItemSchema = z.object({
  new_decision_id: z.string().min(1),
  old_decision_id: z.string().min(1),
  type: z.enum([
    'direct_contradiction',
    'deadline_change',
    'owner_change',
    'scope_change',
    'duplicate_commitment',
    'dependency_conflict',
  ]),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
  reason: z.string().min(1),
  suggested_resolution: z.string().min(1),
});

export const ConflictDetectionResponseSchema = z.object({
  conflicts: z.array(ConflictDetectionItemSchema).default([]),
});

export type ConflictDetectionResponse = z.infer<typeof ConflictDetectionResponseSchema>;

export const MemoryAnswerSchema = z.object({
  answer: z.string().min(1),
  found_in_memory: z.boolean(),
  citations: z
    .array(
      z.object({
        meeting_date: z.string(),
        meeting_title: z.string(),
        speaker: z.string().nullable().default(null),
        quote: z.string(),
      })
    )
    .default([]),
});

export type MemoryAnswer = z.infer<typeof MemoryAnswerSchema>;
