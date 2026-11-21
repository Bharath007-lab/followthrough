import { z } from 'zod';
import type {
  ActionItemRecord,
  ConflictRecord,
  DecisionRecord,
  PersonDigest,
  ReminderRecord,
} from '../../shared/types.ts';
import type { FollowthroughRepository, InsertReminderInput } from './db.ts';
import { classifyDeadlineUrgency, daysUntilDate } from './dates.ts';
import { callLLM, isBluesMindsConfigured, getConfiguredBluesMindsModel } from './llm.ts';

export async function generateReminders(
  repo: FollowthroughRepository,
  source: 'manual_simulation' | 'cron',
  referenceDateIso?: string
): Promise<{
  created: ReminderRecord[];
  summary: { overdue: number; due_soon: number; upcoming: number; completed: number };
}> {
  const tasks = await repo.listActionItems();
  const eligible = tasks.filter((t) => t.status !== 'rejected');

  const toInsert: InsertReminderInput[] = [];
  const summary = { overdue: 0, due_soon: 0, upcoming: 0, completed: 0 };

  for (const task of eligible) {
    const urgency = classifyDeadlineUrgency(task.deadline, task.status, referenceDateIso);
    if (urgency === 'no_deadline') continue;

    summary[urgency] += 1;
    const ownerLabel = task.owner || 'Unassigned';
    const delta = daysUntilDate(task.deadline, referenceDateIso);

    let message = '';
    if (urgency === 'overdue') {
      message = `${ownerLabel}: "${task.title}" is overdue by ${Math.abs(delta || 0)} day(s) (due ${task.deadline}).`;
    } else if (urgency === 'due_soon') {
      message = `${ownerLabel}: "${task.title}" is due in ${delta} day(s) (${task.deadline}).`;
    } else if (urgency === 'upcoming') {
      message = `${ownerLabel}: "${task.title}" is scheduled for ${task.deadline} (${delta} days away).`;
    } else {
      message = `${ownerLabel}: "${task.title}" marked complete.`;
    }

    toInsert.push({
      action_item_id: task.id,
      kind: urgency,
      message,
      source,
    });
  }

  const created = await repo.insertReminders(toInsert);
  await repo.addAuditLog(source === 'cron' ? 'cron-scheduler' : 'workspace-user', 'reminders_generated', {
    source,
    count: created.length,
    summary,
  });

  return { created, summary };
}

function buildDeterministicEmailPreview(params: {
  person: string;
  role: string | null;
  openCommitments: ActionItemRecord[];
  upcomingDeadlines: ActionItemRecord[];
  overdueTasks: ActionItemRecord[];
  newAssignments: ActionItemRecord[];
  relevantDecisions: DecisionRecord[];
  conflictsRequiringAttention: ConflictRecord[];
}): string {
  const lines: string[] = [
    `Subject: Followthrough Weekly Digest — ${params.person}`,
    `Hi ${params.person}${params.role ? ` (${params.role})` : ''},`,
    '',
    'Here is your factual commitment summary from Followthrough organizational memory:',
    '',
  ];

  if (params.overdueTasks.length > 0) {
    lines.push(`OVERDUE (${params.overdueTasks.length})`);
    for (const t of params.overdueTasks) {
      lines.push(`- ${t.title} — Due ${t.deadline} [${t.status}] (from ${t.meeting_title || 'meeting'})`);
    }
    lines.push('');
  }

  if (params.upcomingDeadlines.length > 0) {
    lines.push(`UPCOMING DEADLINES (${params.upcomingDeadlines.length})`);
    for (const t of params.upcomingDeadlines) {
      lines.push(`- ${t.title} — Due ${t.deadline} [${t.priority} priority]`);
    }
    lines.push('');
  }

  if (params.newAssignments.length > 0) {
    lines.push(`AWAITING APPROVAL / NEW ASSIGNMENTS (${params.newAssignments.length})`);
    for (const t of params.newAssignments) {
      lines.push(`- ${t.title} — ${t.deadline ? `Due ${t.deadline}` : 'No deadline set'}`);
    }
    lines.push('');
  }

  if (params.conflictsRequiringAttention.length > 0) {
    lines.push(`CONFLICTS REQUIRING ATTENTION (${params.conflictsRequiringAttention.length})`);
    for (const c of params.conflictsRequiringAttention) {
      lines.push(`- [${c.type.replace(/_/g, ' ')}] ${c.reason}`);
    }
    lines.push('');
  }

  if (params.relevantDecisions.length > 0) {
    lines.push(`RELEVANT DECISIONS (${params.relevantDecisions.length})`);
    for (const d of params.relevantDecisions.slice(0, 6)) {
      lines.push(`- [${d.status}] ${d.topic}: ${d.statement} (${d.meeting_date || ''})`);
    }
    lines.push('');
  }

  if (
    params.openCommitments.length === 0 &&
    params.overdueTasks.length === 0 &&
    params.conflictsRequiringAttention.length === 0
  ) {
    lines.push('No open commitments or unresolved conflicts currently assigned to you.');
    lines.push('');
  }

  lines.push('— Followthrough Organizational Memory');
  return lines.join('\n');
}

export async function buildWeeklyDigests(
  repo: FollowthroughRepository,
  options?: { polishWithAI?: boolean; personName?: string }
): Promise<PersonDigest[]> {
  const [people, tasks, decisions, conflicts] = await Promise.all([
    repo.listPeople(),
    repo.listActionItems(),
    repo.listDecisions(),
    repo.listConflicts(),
  ]);

  // Combine identified people table + owners/speakers from tasks & decisions
  const personMap = new Map<string, { name: string; role: string | null }>();
  for (const p of people) {
    personMap.set(p.name.toLowerCase(), { name: p.name, role: p.role });
  }
  for (const t of tasks) {
    if (t.owner && !personMap.has(t.owner.toLowerCase())) {
      personMap.set(t.owner.toLowerCase(), { name: t.owner, role: null });
    }
  }
  for (const d of decisions) {
    if (d.decided_by && !personMap.has(d.decided_by.toLowerCase())) {
      personMap.set(d.decided_by.toLowerCase(), { name: d.decided_by, role: null });
    }
  }

  let targets = Array.from(personMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  if (options?.personName) {
    targets = targets.filter(
      (t) => t.name.toLowerCase() === options.personName?.trim().toLowerCase()
    );
  }

  const nowIso = new Date().toISOString();
  const digests: PersonDigest[] = [];

  for (const person of targets) {
    const lower = person.name.toLowerCase();
    const personTasks = tasks.filter(
      (t) => t.owner?.toLowerCase() === lower && t.status !== 'rejected'
    );
    const openCommitments = personTasks.filter((t) => t.status !== 'done');
    const overdueTasks = openCommitments.filter(
      (t) => classifyDeadlineUrgency(t.deadline, t.status) === 'overdue'
    );
    const upcomingDeadlines = openCommitments.filter((t) => {
      const u = classifyDeadlineUrgency(t.deadline, t.status);
      return u === 'due_soon' || u === 'upcoming';
    });
    const newAssignments = personTasks.filter((t) => t.status === 'proposed');

    const relevantDecisions = decisions.filter(
      (d) =>
        d.decided_by?.toLowerCase() === lower ||
        d.evidence.speaker?.toLowerCase() === lower ||
        d.statement.toLowerCase().includes(lower)
    );

    const conflictsRequiringAttention = conflicts.filter((c) => {
      if (c.resolution !== 'open') return false;
      const text = `${c.reason} ${c.new_decision?.statement || ''} ${c.old_decision?.statement || ''} ${c.new_decision?.decided_by || ''} ${c.old_decision?.decided_by || ''}`.toLowerCase();
      return text.includes(lower) || person.role?.toLowerCase().includes('product manager');
    });

    let emailPreview = buildDeterministicEmailPreview({
      person: person.name,
      role: person.role,
      openCommitments,
      upcomingDeadlines,
      overdueTasks,
      newAssignments,
      relevantDecisions,
      conflictsRequiringAttention,
    });

    let polishedWithAI = false;
    if (options?.polishWithAI && isBluesMindsConfigured() && getConfiguredBluesMindsModel()) {
      const PolishSchema = z.object({ email_preview: z.string().min(20) });
      const res = await callLLM({
        operation: 'digest_polish',
        system:
          'Improve readability of this weekly digest email while keeping EVERY task title, status, deadline date, decision, and conflict 100% factually identical. Never invent tasks, dates, or statuses. Return JSON: {"email_preview": "..."}',
        prompt: emailPreview,
        schema: PolishSchema,
        temperature: 0.2,
      });
      emailPreview = res.data.email_preview;
      polishedWithAI = true;
    }

    digests.push({
      person: person.name,
      role: person.role,
      generatedAt: nowIso,
      openCommitments,
      upcomingDeadlines,
      overdueTasks,
      newAssignments,
      relevantDecisions,
      conflictsRequiringAttention,
      emailPreview,
      polishedWithAI,
    });
  }

  return digests;
}
