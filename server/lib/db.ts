import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  ActionItemRecord,
  ActionItemStatus,
  AuditLogRecord,
  ConflictRecord,
  ConflictResolution,
  DashboardMetrics,
  DecisionRecord,
  DecisionStatus,
  MeetingRecord,
  PersonRecord,
  ReminderRecord,
  StoredTurnRecord,
  TranscriptTurn,
} from '../../shared/types.ts';
import { classifyDeadlineUrgency } from './dates.ts';

export interface InsertMeetingInput {
  title: string;
  meeting_date: string;
  attendees: string[];
  source_hash: string;
  raw_text: string;
  quality_report: MeetingRecord['quality_report'];
  open_questions: MeetingRecord['open_questions'];
  risks: MeetingRecord['risks'];
  health_score: number;
  is_demo: boolean;
}

export interface InsertDecisionInput {
  meeting_id: string;
  topic: string;
  statement: string;
  decided_by: string | null;
  evidence: DecisionRecord['evidence'];
  status: DecisionStatus;
  superseded_by: string | null;
  confidence: number;
  is_demo: boolean;
}

export interface InsertActionItemInput {
  meeting_id: string;
  decision_id: string | null;
  title: string;
  description: string;
  owner: string | null;
  owner_source: ActionItemRecord['owner_source'];
  deadline: string | null;
  deadline_phrase: string | null;
  priority: ActionItemRecord['priority'];
  status: ActionItemStatus;
  external_id: string | null;
  external_url: string | null;
  tracker: 'internal' | 'github';
  evidence: ActionItemRecord['evidence'];
  confidence: number;
  flags: string[];
  is_demo: boolean;
}

export interface InsertConflictInput {
  new_ref: string;
  old_decision_id: string;
  type: ConflictRecord['type'];
  severity: ConflictRecord['severity'];
  reason: string;
  suggested_resolution: string;
  resolution: ConflictResolution;
  is_demo: boolean;
}

export interface InsertReminderInput {
  action_item_id: string;
  kind: ReminderRecord['kind'];
  message: string;
  source: ReminderRecord['source'];
}

export interface FollowthroughRepository {
  readonly mode: 'supabase' | 'local_fallback';
  checkConnection(): Promise<{ connected: boolean; error?: string }>;

  upsertPeople(
    people: Array<{ name: string; role?: string | null; aliases?: string[]; is_demo: boolean }>
  ): Promise<PersonRecord[]>;
  listPeople(): Promise<PersonRecord[]>;

  findMeetingByHash(sourceHash: string): Promise<MeetingRecord | null>;
  insertMeeting(input: InsertMeetingInput): Promise<MeetingRecord>;
  listMeetings(): Promise<MeetingRecord[]>;
  getMeetingById(id: string): Promise<MeetingRecord | null>;

  insertTurns(meetingId: string, turns: TranscriptTurn[]): Promise<StoredTurnRecord[]>;
  listTurnsByMeeting(meetingId: string): Promise<StoredTurnRecord[]>;

  insertDecisions(items: InsertDecisionInput[]): Promise<DecisionRecord[]>;
  listDecisions(meetingId?: string): Promise<DecisionRecord[]>;
  getDecisionById(id: string): Promise<DecisionRecord | null>;
  updateDecision(
    id: string,
    patch: Partial<Pick<DecisionRecord, 'status' | 'superseded_by'>>
  ): Promise<DecisionRecord | null>;

  insertActionItems(items: InsertActionItemInput[]): Promise<ActionItemRecord[]>;
  listActionItems(filters?: { meetingId?: string; status?: ActionItemStatus }): Promise<ActionItemRecord[]>;
  getActionItemById(id: string): Promise<ActionItemRecord | null>;
  updateActionItem(
    id: string,
    patch: Partial<
      Pick<
        ActionItemRecord,
        | 'title'
        | 'description'
        | 'owner'
        | 'owner_source'
        | 'deadline'
        | 'priority'
        | 'status'
        | 'external_id'
        | 'external_url'
        | 'tracker'
        | 'flags'
      >
    >
  ): Promise<ActionItemRecord | null>;

  insertConflicts(items: InsertConflictInput[]): Promise<ConflictRecord[]>;
  listConflicts(meetingId?: string): Promise<ConflictRecord[]>;
  getConflictById(id: string): Promise<ConflictRecord | null>;
  updateConflict(
    id: string,
    patch: Partial<Pick<ConflictRecord, 'resolution'>>
  ): Promise<ConflictRecord | null>;

  insertReminders(items: InsertReminderInput[]): Promise<ReminderRecord[]>;
  listReminders(): Promise<ReminderRecord[]>;
  markReminderSeen(id: string, seen: boolean): Promise<ReminderRecord | null>;

  addAuditLog(actor: string, event: string, payload: Record<string, unknown>): Promise<AuditLogRecord>;
  listAuditLogs(limit?: number): Promise<AuditLogRecord[]>;

  resetDemoData(): Promise<{
    meetingsDeleted: number;
    decisionsDeleted: number;
    tasksDeleted: number;
    conflictsDeleted: number;
  }>;

  getDashboardMetrics(): Promise<DashboardMetrics>;
}

// ============================================================================
// 1. Supabase PostgreSQL Repository (Primary Production Implementation)
// ============================================================================
class SupabaseRepository implements FollowthroughRepository {
  readonly mode = 'supabase' as const;
  private client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async checkConnection(): Promise<{ connected: boolean; error?: string }> {
    try {
      const { error } = await this.client.from('meetings').select('id', { head: true, count: 'exact' });
      if (error) {
        return {
          connected: false,
          error: `Supabase query failed: ${error.message}. Ensure supabase/schema.sql has been executed.`,
        };
      }
      return { connected: true };
    } catch (err) {
      return { connected: false, error: (err as Error).message };
    }
  }

  async upsertPeople(
    people: Array<{ name: string; role?: string | null; aliases?: string[]; is_demo: boolean }>
  ): Promise<PersonRecord[]> {
    if (people.length === 0) return [];
    const deduped = new Map<string, { name: string; role: string | null; aliases: string[]; is_demo: boolean }>();
    for (const p of people) {
      const name = p.name.trim();
      if (!name) continue;
      if (!deduped.has(name.toLowerCase())) {
        deduped.set(name.toLowerCase(), {
          name,
          role: p.role ?? null,
          aliases: p.aliases ?? [],
          is_demo: p.is_demo,
        });
      }
    }
    const rows = Array.from(deduped.values());
    if (rows.length === 0) return [];

    const { data, error } = await this.client
      .from('people')
      .upsert(rows, { onConflict: 'name', ignoreDuplicates: false })
      .select();

    if (error) throw new Error(`Supabase upsertPeople error: ${error.message}`);
    return (data || []) as PersonRecord[];
  }

  async listPeople(): Promise<PersonRecord[]> {
    const { data, error } = await this.client
      .from('people')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw new Error(`Supabase listPeople error: ${error.message}`);
    return (data || []) as PersonRecord[];
  }

  async findMeetingByHash(sourceHash: string): Promise<MeetingRecord | null> {
    const { data, error } = await this.client
      .from('meetings')
      .select('*')
      .eq('source_hash', sourceHash)
      .maybeSingle();
    if (error) throw new Error(`Supabase findMeetingByHash error: ${error.message}`);
    return (data as MeetingRecord) || null;
  }

  async insertMeeting(input: InsertMeetingInput): Promise<MeetingRecord> {
    const { data, error } = await this.client
      .from('meetings')
      .insert(input)
      .select()
      .single();
    if (error) throw new Error(`Supabase insertMeeting error: ${error.message}`);
    return data as MeetingRecord;
  }

  async listMeetings(): Promise<MeetingRecord[]> {
    const { data, error } = await this.client
      .from('meetings')
      .select('*')
      .order('meeting_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Supabase listMeetings error: ${error.message}`);
    return (data || []) as MeetingRecord[];
  }

  async getMeetingById(id: string): Promise<MeetingRecord | null> {
    const { data, error } = await this.client
      .from('meetings')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Supabase getMeetingById error: ${error.message}`);
    return (data as MeetingRecord) || null;
  }

  async insertTurns(meetingId: string, turns: TranscriptTurn[]): Promise<StoredTurnRecord[]> {
    if (turns.length === 0) return [];
    const payload = turns.map((t) => ({
      meeting_id: meetingId,
      idx: t.index,
      timestamp: t.timestamp ?? null,
      speaker: t.speaker ?? null,
      text: t.text,
    }));
    const { data, error } = await this.client.from('turns').insert(payload).select();
    if (error) throw new Error(`Supabase insertTurns error: ${error.message}`);
    return (data || []) as StoredTurnRecord[];
  }

  async listTurnsByMeeting(meetingId: string): Promise<StoredTurnRecord[]> {
    const { data, error } = await this.client
      .from('turns')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('idx', { ascending: true });
    if (error) throw new Error(`Supabase listTurnsByMeeting error: ${error.message}`);
    return (data || []) as StoredTurnRecord[];
  }

  async insertDecisions(items: InsertDecisionInput[]): Promise<DecisionRecord[]> {
    if (items.length === 0) return [];
    const { data, error } = await this.client.from('decisions').insert(items).select();
    if (error) throw new Error(`Supabase insertDecisions error: ${error.message}`);
    return (data || []) as DecisionRecord[];
  }

  async listDecisions(meetingId?: string): Promise<DecisionRecord[]> {
    let query = this.client
      .from('decisions')
      .select('*, meetings(title, meeting_date)')
      .order('created_at', { ascending: false });
    if (meetingId) {
      query = query.eq('meeting_id', meetingId);
    }
    const { data, error } = await query;
    if (error) throw new Error(`Supabase listDecisions error: ${error.message}`);
    return (data || []).map((row) => {
      const m = (row as { meetings?: { title?: string; meeting_date?: string } }).meetings;
      const copy = { ...(row as Record<string, unknown>) };
      delete copy.meetings;
      return {
        ...(copy as unknown as DecisionRecord),
        meeting_title: m?.title,
        meeting_date: m?.meeting_date,
      };
    });
  }

  async getDecisionById(id: string): Promise<DecisionRecord | null> {
    const { data, error } = await this.client
      .from('decisions')
      .select('*, meetings(title, meeting_date)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Supabase getDecisionById error: ${error.message}`);
    if (!data) return null;
    const m = (data as { meetings?: { title?: string; meeting_date?: string } }).meetings;
    const copy = { ...(data as Record<string, unknown>) };
    delete copy.meetings;
    return {
      ...(copy as unknown as DecisionRecord),
      meeting_title: m?.title,
      meeting_date: m?.meeting_date,
    };
  }

  async updateDecision(
    id: string,
    patch: Partial<Pick<DecisionRecord, 'status' | 'superseded_by'>>
  ): Promise<DecisionRecord | null> {
    const { data, error } = await this.client
      .from('decisions')
      .update(patch)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase updateDecision error: ${error.message}`);
    return (data as DecisionRecord) || null;
  }

  async insertActionItems(items: InsertActionItemInput[]): Promise<ActionItemRecord[]> {
    if (items.length === 0) return [];
    const { data, error } = await this.client.from('action_items').insert(items).select();
    if (error) throw new Error(`Supabase insertActionItems error: ${error.message}`);
    return (data || []) as ActionItemRecord[];
  }

  async listActionItems(filters?: {
    meetingId?: string;
    status?: ActionItemStatus;
  }): Promise<ActionItemRecord[]> {
    let query = this.client
      .from('action_items')
      .select('*, meetings(title, meeting_date)')
      .order('created_at', { ascending: false });
    if (filters?.meetingId) query = query.eq('meeting_id', filters.meetingId);
    if (filters?.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    if (error) throw new Error(`Supabase listActionItems error: ${error.message}`);
    return (data || []).map((row) => {
      const m = (row as { meetings?: { title?: string; meeting_date?: string } }).meetings;
      const copy = { ...(row as Record<string, unknown>) };
      delete copy.meetings;
      return {
        ...(copy as unknown as ActionItemRecord),
        meeting_title: m?.title,
        meeting_date: m?.meeting_date,
      };
    });
  }

  async getActionItemById(id: string): Promise<ActionItemRecord | null> {
    const { data, error } = await this.client
      .from('action_items')
      .select('*, meetings(title, meeting_date)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Supabase getActionItemById error: ${error.message}`);
    if (!data) return null;
    const m = (data as { meetings?: { title?: string; meeting_date?: string } }).meetings;
    const copy = { ...(data as Record<string, unknown>) };
    delete copy.meetings;
    return {
      ...(copy as unknown as ActionItemRecord),
      meeting_title: m?.title,
      meeting_date: m?.meeting_date,
    };
  }

  async updateActionItem(
    id: string,
    patch: Partial<ActionItemRecord>
  ): Promise<ActionItemRecord | null> {
    const { data, error } = await this.client
      .from('action_items')
      .update(patch)
      .eq('id', id)
      .select('*, meetings(title, meeting_date)')
      .maybeSingle();
    if (error) throw new Error(`Supabase updateActionItem error: ${error.message}`);
    if (!data) return null;
    const m = (data as { meetings?: { title?: string; meeting_date?: string } }).meetings;
    const copy = { ...(data as Record<string, unknown>) };
    delete copy.meetings;
    return {
      ...(copy as unknown as ActionItemRecord),
      meeting_title: m?.title,
      meeting_date: m?.meeting_date,
    };
  }

  async insertConflicts(items: InsertConflictInput[]): Promise<ConflictRecord[]> {
    if (items.length === 0) return [];
    const { data, error } = await this.client
      .from('conflicts')
      .upsert(items, { onConflict: 'new_ref,old_decision_id', ignoreDuplicates: true })
      .select();
    if (error) throw new Error(`Supabase insertConflicts error: ${error.message}`);
    return (data || []) as ConflictRecord[];
  }

  async listConflicts(meetingId?: string): Promise<ConflictRecord[]> {
    const [conflictsRes, decisions] = await Promise.all([
      this.client.from('conflicts').select('*').order('created_at', { ascending: false }),
      this.listDecisions(),
    ]);
    if (conflictsRes.error) {
      throw new Error(`Supabase listConflicts error: ${conflictsRes.error.message}`);
    }
    const decisionMap = new Map(decisions.map((d) => [d.id, d]));
    const enriched = ((conflictsRes.data || []) as ConflictRecord[]).map((c) => ({
      ...c,
      new_decision: decisionMap.get(c.new_ref),
      old_decision: decisionMap.get(c.old_decision_id),
    }));
    if (meetingId) {
      return enriched.filter(
        (c) => c.new_decision?.meeting_id === meetingId || c.old_decision?.meeting_id === meetingId
      );
    }
    return enriched;
  }

  async getConflictById(id: string): Promise<ConflictRecord | null> {
    const all = await this.listConflicts();
    return all.find((c) => c.id === id) || null;
  }

  async updateConflict(
    id: string,
    patch: Partial<Pick<ConflictRecord, 'resolution'>>
  ): Promise<ConflictRecord | null> {
    const { data, error } = await this.client
      .from('conflicts')
      .update(patch)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase updateConflict error: ${error.message}`);
    return (data as ConflictRecord) || null;
  }

  async insertReminders(items: InsertReminderInput[]): Promise<ReminderRecord[]> {
    if (items.length === 0) return [];
    const { data, error } = await this.client.from('reminders').insert(items).select();
    if (error) throw new Error(`Supabase insertReminders error: ${error.message}`);
    return (data || []) as ReminderRecord[];
  }

  async listReminders(): Promise<ReminderRecord[]> {
    const [remRes, tasks] = await Promise.all([
      this.client.from('reminders').select('*').order('created_at', { ascending: false }).limit(100),
      this.listActionItems(),
    ]);
    if (remRes.error) throw new Error(`Supabase listReminders error: ${remRes.error.message}`);
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    return ((remRes.data || []) as ReminderRecord[]).map((r) => ({
      ...r,
      action_item: taskMap.get(r.action_item_id),
    }));
  }

  async markReminderSeen(id: string, seen: boolean): Promise<ReminderRecord | null> {
    const { data, error } = await this.client
      .from('reminders')
      .update({ seen })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase markReminderSeen error: ${error.message}`);
    return (data as ReminderRecord) || null;
  }

  async addAuditLog(
    actor: string,
    event: string,
    payload: Record<string, unknown>
  ): Promise<AuditLogRecord> {
    const { data, error } = await this.client
      .from('audit_log')
      .insert({ actor, event, payload })
      .select()
      .single();
    if (error) throw new Error(`Supabase addAuditLog error: ${error.message}`);
    return data as AuditLogRecord;
  }

  async listAuditLogs(limit = 50): Promise<AuditLogRecord[]> {
    const { data, error } = await this.client
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Supabase listAuditLogs error: ${error.message}`);
    return (data || []) as AuditLogRecord[];
  }

  async resetDemoData(): Promise<{
    meetingsDeleted: number;
    decisionsDeleted: number;
    tasksDeleted: number;
    conflictsDeleted: number;
  }> {
    // Strictly delete ONLY is_demo = true records; non-demo user records remain untouched.
    const { data: demoConflicts } = await this.client
      .from('conflicts')
      .delete()
      .eq('is_demo', true)
      .select('id');
    const { data: demoTasks } = await this.client
      .from('action_items')
      .delete()
      .eq('is_demo', true)
      .select('id');
    const { data: demoDecisions } = await this.client
      .from('decisions')
      .delete()
      .eq('is_demo', true)
      .select('id');
    const { data: demoMeetings } = await this.client
      .from('meetings')
      .delete()
      .eq('is_demo', true)
      .select('id');
    await this.client.from('people').delete().eq('is_demo', true);

    return {
      meetingsDeleted: demoMeetings?.length || 0,
      decisionsDeleted: demoDecisions?.length || 0,
      tasksDeleted: demoTasks?.length || 0,
      conflictsDeleted: demoConflicts?.length || 0,
    };
  }

  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const [meetings, decisions, tasks, conflicts] = await Promise.all([
      this.listMeetings(),
      this.listDecisions(),
      this.listActionItems(),
      this.listConflicts(),
    ]);
    return computeMetrics(meetings, decisions, tasks, conflicts);
  }
}

// ============================================================================
// 2. Server-Side Local Fallback Repository (Active ONLY when Supabase env vars unset)
// ============================================================================
interface LocalStoreShape {
  people: PersonRecord[];
  meetings: MeetingRecord[];
  turns: StoredTurnRecord[];
  decisions: DecisionRecord[];
  action_items: ActionItemRecord[];
  conflicts: ConflictRecord[];
  reminders: ReminderRecord[];
  audit_log: AuditLogRecord[];
}

const EMPTY_STORE: LocalStoreShape = {
  people: [],
  meetings: [],
  turns: [],
  decisions: [],
  action_items: [],
  conflicts: [],
  reminders: [],
  audit_log: [],
};

export class LocalFallbackRepository implements FollowthroughRepository {
  readonly mode = 'local_fallback' as const;
  private filePath: string;
  private store: LocalStoreShape;

  constructor(customPath?: string) {
    const dataDir = path.resolve(process.cwd(), '.data');
    this.filePath = customPath || path.join(dataDir, 'followthrough-store.json');
    this.store = this.load();
  }

  private load(): LocalStoreShape {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<LocalStoreShape>;
        return {
          people: parsed.people || [],
          meetings: parsed.meetings || [],
          turns: parsed.turns || [],
          decisions: parsed.decisions || [],
          action_items: parsed.action_items || [],
          conflicts: parsed.conflicts || [],
          reminders: parsed.reminders || [],
          audit_log: parsed.audit_log || [],
        };
      }
    } catch {
      // Fallback to clean empty store if unreadable
    }
    return structuredClone(EMPTY_STORE);
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.store, null, 2), 'utf8');
    } catch (err) {
      console.error('[Followthrough] Failed to persist local server fallback store:', (err as Error).message);
    }
  }

  async checkConnection(): Promise<{ connected: boolean; error?: string }> {
    return {
      connected: false,
      error:
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured. Running on server-side local fallback storage until Supabase secrets are set.',
    };
  }

  async upsertPeople(
    people: Array<{ name: string; role?: string | null; aliases?: string[]; is_demo: boolean }>
  ): Promise<PersonRecord[]> {
    const now = new Date().toISOString();
    const touched: PersonRecord[] = [];
    for (const p of people) {
      const cleanName = p.name.trim();
      if (!cleanName) continue;
      const existing = this.store.people.find(
        (x) => x.name.toLowerCase() === cleanName.toLowerCase()
      );
      if (existing) {
        if (p.role && !existing.role) existing.role = p.role;
        if (p.aliases?.length) {
          existing.aliases = Array.from(new Set([...existing.aliases, ...p.aliases]));
        }
        touched.push(existing);
      } else {
        const created: PersonRecord = {
          id: crypto.randomUUID(),
          name: cleanName,
          role: p.role ?? null,
          aliases: p.aliases ?? [],
          is_demo: p.is_demo,
          created_at: now,
        };
        this.store.people.push(created);
        touched.push(created);
      }
    }
    this.persist();
    return touched;
  }

  async listPeople(): Promise<PersonRecord[]> {
    return [...this.store.people].sort((a, b) => a.name.localeCompare(b.name));
  }

  async findMeetingByHash(sourceHash: string): Promise<MeetingRecord | null> {
    return this.store.meetings.find((m) => m.source_hash === sourceHash) || null;
  }

  async insertMeeting(input: InsertMeetingInput): Promise<MeetingRecord> {
    if (this.store.meetings.some((m) => m.source_hash === input.source_hash)) {
      throw new Error('Duplicate meeting transcript hash.');
    }
    const created: MeetingRecord = {
      ...input,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    this.store.meetings.push(created);
    this.persist();
    return created;
  }

  async listMeetings(): Promise<MeetingRecord[]> {
    return [...this.store.meetings].sort(
      (a, b) =>
        b.meeting_date.localeCompare(a.meeting_date) ||
        b.created_at.localeCompare(a.created_at)
    );
  }

  async getMeetingById(id: string): Promise<MeetingRecord | null> {
    return this.store.meetings.find((m) => m.id === id) || null;
  }

  async insertTurns(meetingId: string, turns: TranscriptTurn[]): Promise<StoredTurnRecord[]> {
    const created: StoredTurnRecord[] = turns.map((t) => ({
      id: crypto.randomUUID(),
      meeting_id: meetingId,
      idx: t.index,
      timestamp: t.timestamp ?? null,
      speaker: t.speaker ?? null,
      text: t.text,
    }));
    this.store.turns.push(...created);
    this.persist();
    return created;
  }

  async listTurnsByMeeting(meetingId: string): Promise<StoredTurnRecord[]> {
    return this.store.turns
      .filter((t) => t.meeting_id === meetingId)
      .sort((a, b) => a.idx - b.idx);
  }

  async insertDecisions(items: InsertDecisionInput[]): Promise<DecisionRecord[]> {
    const now = new Date().toISOString();
    const created: DecisionRecord[] = items.map((d) => ({
      ...d,
      id: crypto.randomUUID(),
      created_at: now,
    }));
    this.store.decisions.push(...created);
    this.persist();
    return created;
  }

  async listDecisions(meetingId?: string): Promise<DecisionRecord[]> {
    const meetingMap = new Map(this.store.meetings.map((m) => [m.id, m]));
    return this.store.decisions
      .filter((d) => (!meetingId ? true : d.meeting_id === meetingId))
      .map((d) => ({
        ...d,
        meeting_title: meetingMap.get(d.meeting_id)?.title,
        meeting_date: meetingMap.get(d.meeting_id)?.meeting_date,
      }))
      .sort(
        (a, b) =>
          (b.meeting_date || '').localeCompare(a.meeting_date || '') ||
          b.created_at.localeCompare(a.created_at)
      );
  }

  async getDecisionById(id: string): Promise<DecisionRecord | null> {
    const all = await this.listDecisions();
    return all.find((d) => d.id === id) || null;
  }

  async updateDecision(
    id: string,
    patch: Partial<Pick<DecisionRecord, 'status' | 'superseded_by'>>
  ): Promise<DecisionRecord | null> {
    const idx = this.store.decisions.findIndex((d) => d.id === id);
    if (idx === -1) return null;
    this.store.decisions[idx] = { ...this.store.decisions[idx], ...patch };
    this.persist();
    return this.getDecisionById(id);
  }

  async insertActionItems(items: InsertActionItemInput[]): Promise<ActionItemRecord[]> {
    const now = new Date().toISOString();
    const created: ActionItemRecord[] = items.map((a) => ({
      ...a,
      id: crypto.randomUUID(),
      created_at: now,
    }));
    this.store.action_items.push(...created);
    this.persist();
    return created;
  }

  async listActionItems(filters?: {
    meetingId?: string;
    status?: ActionItemStatus;
  }): Promise<ActionItemRecord[]> {
    const meetingMap = new Map(this.store.meetings.map((m) => [m.id, m]));
    return this.store.action_items
      .filter((a) => {
        if (filters?.meetingId && a.meeting_id !== filters.meetingId) return false;
        if (filters?.status && a.status !== filters.status) return false;
        return true;
      })
      .map((a) => ({
        ...a,
        meeting_title: meetingMap.get(a.meeting_id)?.title,
        meeting_date: meetingMap.get(a.meeting_id)?.meeting_date,
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async getActionItemById(id: string): Promise<ActionItemRecord | null> {
    const all = await this.listActionItems();
    return all.find((a) => a.id === id) || null;
  }

  async updateActionItem(
    id: string,
    patch: Partial<ActionItemRecord>
  ): Promise<ActionItemRecord | null> {
    const idx = this.store.action_items.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    this.store.action_items[idx] = { ...this.store.action_items[idx], ...patch };
    this.persist();
    return this.getActionItemById(id);
  }

  async insertConflicts(items: InsertConflictInput[]): Promise<ConflictRecord[]> {
    const now = new Date().toISOString();
    const created: ConflictRecord[] = [];
    for (const c of items) {
      const exists = this.store.conflicts.some(
        (x) => x.new_ref === c.new_ref && x.old_decision_id === c.old_decision_id
      );
      if (exists) continue;
      const rec: ConflictRecord = {
        ...c,
        id: crypto.randomUUID(),
        created_at: now,
      };
      this.store.conflicts.push(rec);
      created.push(rec);
    }
    this.persist();
    return created;
  }

  async listConflicts(meetingId?: string): Promise<ConflictRecord[]> {
    const decisions = await this.listDecisions();
    const decisionMap = new Map(decisions.map((d) => [d.id, d]));
    const enriched = this.store.conflicts
      .map((c) => ({
        ...c,
        new_decision: decisionMap.get(c.new_ref),
        old_decision: decisionMap.get(c.old_decision_id),
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (meetingId) {
      return enriched.filter(
        (c) => c.new_decision?.meeting_id === meetingId || c.old_decision?.meeting_id === meetingId
      );
    }
    return enriched;
  }

  async getConflictById(id: string): Promise<ConflictRecord | null> {
    const all = await this.listConflicts();
    return all.find((c) => c.id === id) || null;
  }

  async updateConflict(
    id: string,
    patch: Partial<Pick<ConflictRecord, 'resolution'>>
  ): Promise<ConflictRecord | null> {
    const idx = this.store.conflicts.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    this.store.conflicts[idx] = { ...this.store.conflicts[idx], ...patch };
    this.persist();
    return this.getConflictById(id);
  }

  async insertReminders(items: InsertReminderInput[]): Promise<ReminderRecord[]> {
    const now = new Date().toISOString();
    const created: ReminderRecord[] = items.map((r) => ({
      ...r,
      id: crypto.randomUUID(),
      created_at: now,
      seen: false,
    }));
    this.store.reminders.push(...created);
    this.persist();
    return created;
  }

  async listReminders(): Promise<ReminderRecord[]> {
    const tasks = await this.listActionItems();
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    return [...this.store.reminders]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 100)
      .map((r) => ({
        ...r,
        action_item: taskMap.get(r.action_item_id),
      }));
  }

  async markReminderSeen(id: string, seen: boolean): Promise<ReminderRecord | null> {
    const idx = this.store.reminders.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    this.store.reminders[idx].seen = seen;
    this.persist();
    return this.store.reminders[idx];
  }

  async addAuditLog(
    actor: string,
    event: string,
    payload: Record<string, unknown>
  ): Promise<AuditLogRecord> {
    const created: AuditLogRecord = {
      id: crypto.randomUUID(),
      actor,
      event,
      payload,
      created_at: new Date().toISOString(),
    };
    this.store.audit_log.unshift(created);
    if (this.store.audit_log.length > 300) {
      this.store.audit_log.length = 300;
    }
    this.persist();
    return created;
  }

  async listAuditLogs(limit = 50): Promise<AuditLogRecord[]> {
    return this.store.audit_log.slice(0, limit);
  }

  async resetDemoData(): Promise<{
    meetingsDeleted: number;
    decisionsDeleted: number;
    tasksDeleted: number;
    conflictsDeleted: number;
  }> {
    const demoMeetingIds = new Set(
      this.store.meetings.filter((m) => m.is_demo).map((m) => m.id)
    );
    const demoTaskIds = new Set(
      this.store.action_items.filter((t) => t.is_demo).map((t) => t.id)
    );

    const meetingsBefore = this.store.meetings.length;
    const decisionsBefore = this.store.decisions.length;
    const tasksBefore = this.store.action_items.length;
    const conflictsBefore = this.store.conflicts.length;

    // Strictly delete ONLY is_demo = true records
    this.store.conflicts = this.store.conflicts.filter((c) => !c.is_demo);
    this.store.reminders = this.store.reminders.filter((r) => !demoTaskIds.has(r.action_item_id));
    this.store.action_items = this.store.action_items.filter((t) => !t.is_demo);
    this.store.decisions = this.store.decisions.filter((d) => !d.is_demo);
    this.store.turns = this.store.turns.filter((t) => !demoMeetingIds.has(t.meeting_id));
    this.store.meetings = this.store.meetings.filter((m) => !m.is_demo);
    this.store.people = this.store.people.filter((p) => !p.is_demo);

    this.persist();

    return {
      meetingsDeleted: meetingsBefore - this.store.meetings.length,
      decisionsDeleted: decisionsBefore - this.store.decisions.length,
      tasksDeleted: tasksBefore - this.store.action_items.length,
      conflictsDeleted: conflictsBefore - this.store.conflicts.length,
    };
  }

  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const [meetings, decisions, tasks, conflicts] = await Promise.all([
      this.listMeetings(),
      this.listDecisions(),
      this.listActionItems(),
      this.listConflicts(),
    ]);
    return computeMetrics(meetings, decisions, tasks, conflicts);
  }
}

function computeMetrics(
  meetings: MeetingRecord[],
  decisions: DecisionRecord[],
  tasks: ActionItemRecord[],
  conflicts: ConflictRecord[]
): DashboardMetrics {
  const activeDecisions = decisions.filter((d) => d.status === 'active').length;
  const pendingApprovals = tasks.filter((t) => t.status === 'proposed').length;
  const openTasks = tasks.filter(
    (t) => t.status === 'approved' || t.status === 'in_progress'
  ).length;
  const overdueTasks = tasks.filter((t) => {
    if (t.status === 'done' || t.status === 'rejected') return false;
    return classifyDeadlineUrgency(t.deadline, t.status) === 'overdue';
  }).length;
  const unresolvedConflicts = conflicts.filter((c) => c.resolution === 'open').length;

  const allEvidence = [
    ...decisions.map((d) => d.evidence),
    ...tasks.map((t) => t.evidence),
  ];
  const verifiedCount = allEvidence.filter((e) => e?.verified === true).length;
  const verifiedEvidenceRate =
    allEvidence.length > 0 ? Math.round((verifiedCount / allEvidence.length) * 100) : 100;

  return {
    meetingsProcessed: meetings.length,
    activeDecisions,
    pendingApprovals,
    openTasks,
    overdueTasks,
    unresolvedConflicts,
    totalDecisions: decisions.length,
    verifiedEvidenceRate,
  };
}

let cachedRepo: FollowthroughRepository | null = null;

export function isSupabaseConfigured(): boolean {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return Boolean(url && key);
}

export function getRepository(): FollowthroughRepository {
  if (cachedRepo) return cachedRepo;

  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (url && key) {
    cachedRepo = new SupabaseRepository(url, key);
  } else {
    cachedRepo = new LocalFallbackRepository();
  }
  return cachedRepo;
}
