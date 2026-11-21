import type {
  ActionItemRecord,
  AuditLogRecord,
  BluesMindsVerificationResult,
  ConflictRecord,
  DashboardMetrics,
  DecisionRecord,
  DiscoveredModel,
  IntegrationStatus,
  LLMCallLog,
  MeetingRecord,
  MemoryAnswer,
  PersonDigest,
  QualityReport,
  ReminderRecord,
  SampleMeetingInfo,
  StoredTurnRecord,
  TranscriptTurn,
} from '../../shared/types';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || res.statusText };
  }
  if (!res.ok) {
    const obj = (data || {}) as { error?: string; code?: string };
    throw new ApiError(
      obj.error || `Request failed with HTTP ${res.status}`,
      res.status,
      obj.code,
      data
    );
  }
  return data as T;
}

export interface DashboardPayload {
  metrics: DashboardMetrics;
  recentMeetings: MeetingRecord[];
  openConflicts: ConflictRecord[];
  pendingTasks: ActionItemRecord[];
  recentDecisions: DecisionRecord[];
  hasDemoData: boolean;
}

export interface MeetingListItem extends MeetingRecord {
  decisionCount: number;
  taskCount: number;
  conflictCount: number;
}

export interface MeetingDetailPayload {
  meeting: MeetingRecord;
  turns: StoredTurnRecord[];
  decisions: DecisionRecord[];
  actionItems: ActionItemRecord[];
  conflicts: ConflictRecord[];
}

export interface DecisionTimelineGroup {
  topic: string;
  items: DecisionRecord[];
}

export interface TaskWithPreview extends ActionItemRecord {
  githubPayloadPreview: {
    title: string;
    body: string;
    labels: string[];
  };
}

export interface DemoStreamEvent {
  type: 'stage' | 'complete' | 'error';
  stage?: string;
  status?: 'running' | 'done' | 'failed';
  message?: string;
  details?: string[];
  meetingId?: string;
  modelUsed?: string;
  code?: string;
  error?: string;
  summary?: {
    meetings: number;
    decisions: number;
    actionItems: number;
    conflicts: number;
  };
}

export const api = {
  getDashboard: () => requestJson<DashboardPayload>('/api/dashboard'),

  getStatus: () =>
    requestJson<{ status: IntegrationStatus; llmLogs: LLMCallLog[] }>('/api/status'),

  discoverModels: () =>
    requestJson<{
      baseUrl: string;
      models: DiscoveredModel[];
      recommendedModel: string | null;
    }>('/api/bluesminds/models'),

  verifyBluesMinds: async (model?: string): Promise<BluesMindsVerificationResult> => {
    const res = await fetch('/api/bluesminds/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(model ? { model } : {}),
    });
    return (await res.json()) as BluesMindsVerificationResult;
  },

  selectBluesMindsModel: (model: string) =>
    requestJson<{ model: string | null }>('/api/bluesminds/model', {
      method: 'POST',
      body: JSON.stringify({ model }),
    }),

  getSamples: () => requestJson<{ samples: SampleMeetingInfo[] }>('/api/samples'),

  preflightTranscript: (payload: {
    rawText: string;
    meetingDate: string;
    filename?: string;
    fileSizeBytes?: number;
  }) =>
    requestJson<{
      sourceHash: string;
      duplicateMeetingId: string | null;
      qualityReport: QualityReport;
      previewTurns: TranscriptTurn[];
    }>('/api/meetings/preflight', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  processMeeting: (payload: {
    title: string;
    meetingDate: string;
    attendees: string[];
    rawText: string;
    filename?: string;
    fileSizeBytes?: number;
    isDemo?: boolean;
  }) =>
    requestJson<{
      meeting: MeetingRecord;
      qualityReport: QualityReport;
      decisions: DecisionRecord[];
      actionItems: ActionItemRecord[];
      conflicts: ConflictRecord[];
      modelUsed: string;
      candidateCountCompared: number;
    }>('/api/meetings/process', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listMeetings: () => requestJson<{ meetings: MeetingListItem[] }>('/api/meetings'),

  getMeeting: (id: string) => requestJson<MeetingDetailPayload>(`/api/meetings/${id}`),

  listDecisions: () =>
    requestJson<{ decisions: DecisionRecord[]; timelines: DecisionTimelineGroup[] }>(
      '/api/decisions'
    ),

  listConflicts: () => requestJson<{ conflicts: ConflictRecord[] }>('/api/conflicts'),

  resolveConflict: (id: string, action: 'accept_new' | 'keep_old' | 'mark_contested') =>
    requestJson<{ conflict: ConflictRecord }>(`/api/conflicts/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  listTasks: (status?: string) =>
    requestJson<{
      tasks: TaskWithPreview[];
      githubConfigured: boolean;
      githubRepo: string | null;
    }>(status ? `/api/tasks?status=${encodeURIComponent(status)}` : '/api/tasks'),

  updateTask: (
    id: string,
    patch: Partial<{
      title: string;
      description: string;
      owner: string | null;
      deadline: string | null;
      priority: 'low' | 'medium' | 'high';
      status: 'proposed' | 'approved' | 'rejected' | 'in_progress' | 'done';
    }>
  ) =>
    requestJson<{ task: ActionItemRecord }>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  approveTask: (
    id: string,
    body: {
      title?: string;
      description?: string;
      owner?: string | null;
      deadline?: string | null;
      priority?: 'low' | 'medium' | 'high';
      postToGitHub?: boolean;
    }
  ) =>
    requestJson<{
      task: ActionItemRecord;
      github: {
        created: boolean;
        alreadyExisted: boolean;
        externalId: string | null;
        externalUrl: string | null;
        tracker: 'github' | 'internal';
        message: string;
      } | null;
    }>(`/api/tasks/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  rejectTask: (id: string) =>
    requestJson<{ task: ActionItemRecord }>(`/api/tasks/${id}/reject`, {
      method: 'POST',
    }),

  syncTaskGitHub: (id: string) =>
    requestJson<{
      task: ActionItemRecord;
      github: {
        created: boolean;
        alreadyExisted: boolean;
        externalId: string | null;
        externalUrl: string | null;
        tracker: 'github' | 'internal';
        message: string;
      };
    }>(`/api/tasks/${id}/sync-github`, { method: 'POST' }),

  getReminders: () =>
    requestJson<{
      reminders: ReminderRecord[];
      buckets: {
        overdue: ActionItemRecord[];
        due_soon: ActionItemRecord[];
        upcoming: ActionItemRecord[];
        completed: ActionItemRecord[];
      };
      cronConfigured: boolean;
    }>('/api/reminders'),

  simulateReminders: () =>
    requestJson<{
      created: ReminderRecord[];
      summary: { overdue: number; due_soon: number; upcoming: number; completed: number };
      label: string;
    }>('/api/reminders/simulate', { method: 'POST' }),

  markReminderSeen: (id: string, seen: boolean) =>
    requestJson<{ reminder: ReminderRecord }>(`/api/reminders/${id}/seen`, {
      method: 'POST',
      body: JSON.stringify({ seen }),
    }),

  getDigests: (person?: string) =>
    requestJson<{ digests: PersonDigest[] }>(
      person ? `/api/digests?person=${encodeURIComponent(person)}` : '/api/digests'
    ),

  polishDigest: (person: string) =>
    requestJson<{ digest: PersonDigest }>('/api/digests/polish', {
      method: 'POST',
      body: JSON.stringify({ person }),
    }),

  askMemory: (question: string) =>
    requestJson<MemoryAnswer & { modelUsed: string }>('/api/memory/ask', {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),

  resetDemo: () =>
    requestJson<{
      ok: boolean;
      deleted: {
        meetingsDeleted: number;
        decisionsDeleted: number;
        tasksDeleted: number;
        conflictsDeleted: number;
      };
    }>('/api/demo/reset', { method: 'POST' }),

  getAuditLogs: () => requestJson<{ logs: AuditLogRecord[] }>('/api/audit-logs'),

  async runFullDemoStream(onEvent: (event: DemoStreamEvent) => void): Promise<void> {
    const res = await fetch('/api/demo/run', { method: 'POST' });
    if (!res.body) {
      throw new Error('Streaming response body unavailable.');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          onEvent(JSON.parse(trimmed) as DemoStreamEvent);
        } catch {
          // Ignore partial line parse errors
        }
      }
    }
    if (buffer.trim()) {
      try {
        onEvent(JSON.parse(buffer.trim()) as DemoStreamEvent);
      } catch {
        // Ignore trailing noise
      }
    }
  },
};
