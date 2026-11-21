import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { z } from 'zod';
import {
  ALL_SAMPLE_MEETINGS,
  NOVA_MEETING_1,
  NOVA_MEETING_2,
  NOVA_MEETING_3,
  NOVA_TEAM_ROLES,
} from './server/data/sampleMeetings.ts';
import { classifyDeadlineUrgency } from './server/lib/dates.ts';
import { getRepository, isSupabaseConfigured } from './server/lib/db.ts';
import { buildWeeklyDigests, generateReminders } from './server/lib/digests.ts';
import {
  buildGitHubIssuePayload,
  createGitHubIssueIdempotent,
  getGitHubConfig,
} from './server/lib/github.ts';
import {
  BluesMindsError,
  discoverBluesMindsModels,
  getBluesMindsBaseUrl,
  getConfiguredBluesMindsModel,
  getLastVerificationResult,
  getRecentLLMLogs,
  isBluesMindsConfigured,
  setRuntimeSelectedModel,
  verifyBluesMindsConnection,
} from './server/lib/llm.ts';
import { parseTranscript } from './server/lib/parser.ts';
import {
  askOrganizationalMemory,
  processMeetingTranscript,
  QualityGateBlockedError,
  resolveConflictDecision,
} from './server/lib/pipeline.ts';
import { MAX_TRANSCRIPT_CHARS, runQualityGate } from './server/lib/qualityGate.ts';

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

function timingSafeBearerCheck(authHeader: string | undefined, expectedSecret: string): boolean {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(authHeader.slice('Bearer '.length).trim(), 'utf8');
  const expected = Buffer.from(expectedSecret, 'utf8');
  if (supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(supplied, expected);
}

const PreflightSchema = z.object({
  rawText: z.string().max(MAX_TRANSCRIPT_CHARS + 5000),
  meetingDate: z.string().max(32),
  filename: z.string().max(200).optional(),
  fileSizeBytes: z.number().int().nonnegative().max(10_000_000).optional(),
});

const ProcessMeetingBodySchema = z.object({
  title: z.string().trim().min(2).max(200),
  meetingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  attendees: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  rawText: z.string().min(1).max(MAX_TRANSCRIPT_CHARS + 5000),
  filename: z.string().max(200).optional(),
  fileSizeBytes: z.number().int().nonnegative().max(10_000_000).optional(),
  isDemo: z.boolean().default(false),
});

const ResolveConflictBodySchema = z.object({
  action: z.enum(['accept_new', 'keep_old', 'mark_contested']),
});

const UpdateTaskBodySchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().max(2000).optional(),
  owner: z.string().trim().max(100).nullable().optional(),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  status: z.enum(['proposed', 'approved', 'rejected', 'in_progress', 'done']).optional(),
});

const ApproveTaskBodySchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().max(2000).optional(),
  owner: z.string().trim().max(100).nullable().optional(),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  postToGitHub: z.boolean().default(true),
});

const AskMemoryBodySchema = z.object({
  question: z.string().trim().min(3).max(500),
});

function handleApiError(res: Response, err: unknown) {
  if (err instanceof QualityGateBlockedError) {
    res.status(422).json({
      error: err.message,
      code: 'QUALITY_GATE_BLOCKED',
      qualityReport: err.report,
    });
    return;
  }
  if (err instanceof BluesMindsError) {
    res.status(err.status && err.status >= 400 && err.status < 600 ? err.status : 502).json({
      error: err.message,
      code: err.code,
    });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      code: 'VALIDATION_ERROR',
    });
    return;
  }
  const message = err instanceof Error ? err.message : 'Unexpected server error';
  res.status(500).json({ error: message, code: 'INTERNAL_ERROR' });
}

export function createApiRouter() {
  const router = express.Router();
  const repo = getRepository();

  // 1. Integration & Configuration Status
  router.get('/status', async (_req: Request, res: Response) => {
    try {
      const dbHealth = await repo.checkConnection();
      const gh = getGitHubConfig();
      res.json({
        status: {
          bluesminds: {
            configured: isBluesMindsConfigured(),
            baseUrl: getBluesMindsBaseUrl(),
            model: getConfiguredBluesMindsModel(),
            lastVerification: getLastVerificationResult(),
          },
          supabase: {
            configured: isSupabaseConfigured(),
            connected: dbHealth.connected,
            storageMode: repo.mode,
            error: dbHealth.error,
          },
          github: {
            configured: gh.configured,
            repo: gh.repo,
          },
          cron: {
            configured: Boolean(process.env.CRON_SECRET?.trim()),
          },
          appUrl: process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || null,
        },
        llmLogs: getRecentLLMLogs(),
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // 2. BluesMinds Model Discovery & 5-Step Verification
  router.get('/bluesminds/models', async (_req: Request, res: Response) => {
    try {
      const result = await discoverBluesMindsModels();
      res.json(result);
    } catch (err) {
      handleApiError(res, err);
    }
  });

  router.post('/bluesminds/verify', async (req: Request, res: Response) => {
    try {
      const modelOverride =
        typeof req.body?.model === 'string' && req.body.model.trim().length <= 120
          ? req.body.model.trim()
          : undefined;
      const verification = await verifyBluesMindsConnection(modelOverride);
      res.status(verification.verified ? 200 : 502).json(verification);
    } catch (err) {
      handleApiError(res, err);
    }
  });

  router.post('/bluesminds/model', async (req: Request, res: Response) => {
    try {
      const parsed = z.object({ model: z.string().trim().min(1).max(120) }).parse(req.body);
      setRuntimeSelectedModel(parsed.model);
      await repo.addAuditLog('workspace-user', 'bluesminds_model_selected', {
        model: parsed.model,
      });
      res.json({ model: getConfiguredBluesMindsModel() });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // 3. Dashboard Overview
  router.get('/dashboard', async (_req: Request, res: Response) => {
    try {
      const [metrics, meetings, conflicts, tasks, decisions] = await Promise.all([
        repo.getDashboardMetrics(),
        repo.listMeetings(),
        repo.listConflicts(),
        repo.listActionItems(),
        repo.listDecisions(),
      ]);

      res.json({
        metrics,
        recentMeetings: meetings.slice(0, 6),
        openConflicts: conflicts.filter((c) => c.resolution === 'open').slice(0, 6),
        pendingTasks: tasks.filter((t) => t.status === 'proposed').slice(0, 8),
        recentDecisions: decisions.slice(0, 8),
        hasDemoData: meetings.some((m) => m.is_demo),
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // 4. Sample Transcripts
  router.get('/samples', (_req: Request, res: Response) => {
    res.json({ samples: ALL_SAMPLE_MEETINGS });
  });

  // 5. Transcript Preflight (Deterministic parser + quality gate)
  router.post('/meetings/preflight', async (req: Request, res: Response) => {
    try {
      const body = PreflightSchema.parse(req.body);
      const parsed = parseTranscript(body.rawText, body.filename);
      const existing = await repo.findMeetingByHash(parsed.sourceHash);
      const qualityReport = runQualityGate({
        rawText: body.rawText,
        parsed,
        meetingDate: body.meetingDate,
        filename: body.filename,
        fileSizeBytes: body.fileSizeBytes,
        isDuplicate: Boolean(existing),
      });
      res.json({
        sourceHash: parsed.sourceHash,
        duplicateMeetingId: existing?.id || null,
        qualityReport,
        previewTurns: parsed.turns.slice(0, 12),
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // 6. Process Meeting Transcript (Full AI + Memory + Conflict pipeline)
  router.post('/meetings/process', async (req: Request, res: Response) => {
    try {
      const body = ProcessMeetingBodySchema.parse(req.body);
      const result = await processMeetingTranscript(repo, {
        title: body.title,
        meetingDate: body.meetingDate,
        attendees: body.attendees,
        rawText: body.rawText,
        filename: body.filename,
        fileSizeBytes: body.fileSizeBytes,
        isDemo: body.isDemo,
      });
      res.status(201).json(result);
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // 7. Meetings List & Detail
  router.get('/meetings', async (_req: Request, res: Response) => {
    try {
      const [meetings, decisions, tasks, conflicts] = await Promise.all([
        repo.listMeetings(),
        repo.listDecisions(),
        repo.listActionItems(),
        repo.listConflicts(),
      ]);

      const enriched = meetings.map((m) => ({
        ...m,
        decisionCount: decisions.filter((d) => d.meeting_id === m.id).length,
        taskCount: tasks.filter((t) => t.meeting_id === m.id).length,
        conflictCount: conflicts.filter(
          (c) => c.new_decision?.meeting_id === m.id || c.old_decision?.meeting_id === m.id
        ).length,
      }));
      res.json({ meetings: enriched });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  router.get('/meetings/:id', async (req: Request, res: Response) => {
    try {
      const meeting = await repo.getMeetingById(req.params.id);
      if (!meeting) {
        res.status(404).json({ error: 'Meeting not found.' });
        return;
      }
      const [turns, decisions, actionItems, conflicts] = await Promise.all([
        repo.listTurnsByMeeting(meeting.id),
        repo.listDecisions(meeting.id),
        repo.listActionItems({ meetingId: meeting.id }),
        repo.listConflicts(meeting.id),
      ]);
      res.json({ meeting, turns, decisions, actionItems, conflicts });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // 8. Decisions & Topic Lineage Timeline
  router.get('/decisions', async (_req: Request, res: Response) => {
    try {
      const decisions = await repo.listDecisions();
      // Group by normalized topic for historical timeline view
      const groups = new Map<string, { topic: string; items: typeof decisions }>();
      for (const d of decisions) {
        const key = d.topic.toLowerCase().trim();
        if (!groups.has(key)) {
          groups.set(key, { topic: d.topic, items: [] });
        }
        groups.get(key)!.items.push(d);
      }

      const timelines = Array.from(groups.values())
        .map((g) => ({
          topic: g.topic,
          items: g.items.sort(
            (a, b) =>
              (a.meeting_date || '').localeCompare(b.meeting_date || '') ||
              a.created_at.localeCompare(b.created_at)
          ),
        }))
        .sort((a, b) => b.items.length - a.items.length || a.topic.localeCompare(b.topic));

      res.json({ decisions, timelines });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // 9. Conflicts & Human Resolution
  router.get('/conflicts', async (_req: Request, res: Response) => {
    try {
      const conflicts = await repo.listConflicts();
      res.json({ conflicts });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  router.post('/conflicts/:id/resolve', async (req: Request, res: Response) => {
    try {
      const body = ResolveConflictBodySchema.parse(req.body);
      const updated = await resolveConflictDecision(repo, req.params.id, body.action);
      res.json({ conflict: updated });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // 10. Tasks, Review & Post, Approval, Rejection, and GitHub Issue Idempotent Sync
  router.get('/tasks', async (req: Request, res: Response) => {
    try {
      const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
      const validStatuses = new Set(['proposed', 'approved', 'rejected', 'in_progress', 'done']);
      const tasks = await repo.listActionItems(
        statusParam && validStatuses.has(statusParam)
          ? { status: statusParam as 'proposed' | 'approved' | 'rejected' | 'in_progress' | 'done' }
          : undefined
      );
      const gh = getGitHubConfig();
      res.json({
        tasks: tasks.map((t) => ({
          ...t,
          githubPayloadPreview: buildGitHubIssuePayload(t),
        })),
        githubConfigured: gh.configured,
        githubRepo: gh.repo,
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  router.patch('/tasks/:id', async (req: Request, res: Response) => {
    try {
      const body = UpdateTaskBodySchema.parse(req.body);
      const existing = await repo.getActionItemById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Task not found.' });
        return;
      }

      // Guard: never allow bypassing human approval directly via PATCH to github tracker
      const patch: Record<string, unknown> = { ...body };
      if (body.owner !== undefined) {
        patch.owner_source = body.owner ? 'explicit' : 'unassigned';
      }

      const updated = await repo.updateActionItem(req.params.id, patch);
      await repo.addAuditLog('workspace-user', 'task_updated', {
        task_id: req.params.id,
        changes: Object.keys(body),
      });
      res.json({ task: updated });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  router.post('/tasks/:id/approve', async (req: Request, res: Response) => {
    try {
      const body = ApproveTaskBodySchema.parse(req.body || {});
      const existing = await repo.getActionItemById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Task not found.' });
        return;
      }

      // Apply reviewer edits and mark explicitly approved
      const approved = await repo.updateActionItem(req.params.id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.owner !== undefined
          ? { owner: body.owner, owner_source: body.owner ? 'explicit' : 'unassigned' }
          : {}),
        ...(body.deadline !== undefined ? { deadline: body.deadline } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        status: existing.status === 'in_progress' || existing.status === 'done' ? existing.status : 'approved',
      });

      if (!approved) {
        res.status(404).json({ error: 'Task not found after approval.' });
        return;
      }

      let githubResult = null;
      let finalTask = approved;

      if (body.postToGitHub) {
        githubResult = await createGitHubIssueIdempotent(approved);
        if (githubResult.tracker === 'github' && githubResult.externalId) {
          const linked = await repo.updateActionItem(approved.id, {
            tracker: 'github',
            external_id: githubResult.externalId,
            external_url: githubResult.externalUrl,
          });
          if (linked) finalTask = linked;
        }
      }

      await repo.addAuditLog('workspace-user', 'task_approved', {
        task_id: finalTask.id,
        title: finalTask.title,
        tracker: finalTask.tracker,
        external_id: finalTask.external_id,
        github_message: githubResult?.message || 'Internal task board only',
      });

      res.json({ task: finalTask, github: githubResult });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  router.post('/tasks/:id/reject', async (req: Request, res: Response) => {
    try {
      const existing = await repo.getActionItemById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Task not found.' });
        return;
      }
      const updated = await repo.updateActionItem(req.params.id, { status: 'rejected' });
      await repo.addAuditLog('workspace-user', 'task_rejected', {
        task_id: existing.id,
        title: existing.title,
      });
      res.json({ task: updated });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  router.post('/tasks/:id/sync-github', async (req: Request, res: Response) => {
    try {
      const task = await repo.getActionItemById(req.params.id);
      if (!task) {
        res.status(404).json({ error: 'Task not found.' });
        return;
      }
      if (task.status === 'proposed' || task.status === 'rejected') {
        res.status(400).json({
          error: 'Task must be explicitly approved by a human before creating a GitHub issue.',
        });
        return;
      }
      const githubResult = await createGitHubIssueIdempotent(task);
      let finalTask = task;
      if (githubResult.tracker === 'github' && githubResult.externalId) {
        const linked = await repo.updateActionItem(task.id, {
          tracker: 'github',
          external_id: githubResult.externalId,
          external_url: githubResult.externalUrl,
        });
        if (linked) finalTask = linked;
      }
      await repo.addAuditLog('workspace-user', 'github_sync_attempted', {
        task_id: task.id,
        created: githubResult.created,
        already_existed: githubResult.alreadyExisted,
        external_id: githubResult.externalId,
      });
      res.json({ task: finalTask, github: githubResult });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // 11. Reminders & Protected Cron Endpoint
  router.get('/reminders', async (_req: Request, res: Response) => {
    try {
      const [reminders, tasks] = await Promise.all([
        repo.listReminders(),
        repo.listActionItems(),
      ]);

      const activeTasks = tasks.filter((t) => t.status !== 'rejected');
      const buckets = {
        overdue: activeTasks.filter((t) => classifyDeadlineUrgency(t.deadline, t.status) === 'overdue'),
        due_soon: activeTasks.filter((t) => classifyDeadlineUrgency(t.deadline, t.status) === 'due_soon'),
        upcoming: activeTasks.filter((t) => classifyDeadlineUrgency(t.deadline, t.status) === 'upcoming'),
        completed: activeTasks.filter((t) => t.status === 'done'),
      };

      res.json({
        reminders,
        buckets,
        cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  router.post('/reminders/simulate', async (_req: Request, res: Response) => {
    try {
      const result = await generateReminders(repo, 'manual_simulation');
      res.json({
        ...result,
        label: 'Manually simulated (email delivery not configured)',
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  router.post('/cron/reminders', async (req: Request, res: Response) => {
    try {
      const secret = process.env.CRON_SECRET?.trim();
      if (!secret) {
        res.status(503).json({
          error: 'CRON_SECRET is not configured on the server. Scheduled reminders are disabled.',
        });
        return;
      }
      if (!timingSafeBearerCheck(req.headers.authorization, secret)) {
        res.status(401).json({ error: 'Unauthorized cron request.' });
        return;
      }
      const result = await generateReminders(repo, 'cron');
      res.json(result);
    } catch (err) {
      handleApiError(res, err);
    }
  });

  router.post('/reminders/:id/seen', async (req: Request, res: Response) => {
    try {
      const seen = Boolean(req.body?.seen ?? true);
      const updated = await repo.markReminderSeen(req.params.id, seen);
      if (!updated) {
        res.status(404).json({ error: 'Reminder not found.' });
        return;
      }
      res.json({ reminder: updated });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // 12. Personalized Weekly Digests
  router.get('/digests', async (req: Request, res: Response) => {
    try {
      const person = typeof req.query.person === 'string' ? req.query.person : undefined;
      const digests = await buildWeeklyDigests(repo, { personName: person });
      res.json({ digests });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  router.post('/digests/polish', async (req: Request, res: Response) => {
    try {
      const body = z.object({ person: z.string().trim().min(1).max(100) }).parse(req.body);
      const digests = await buildWeeklyDigests(repo, {
        personName: body.person,
        polishWithAI: true,
      });
      if (digests.length === 0) {
        res.status(404).json({ error: `No digest found for "${body.person}".` });
        return;
      }
      res.json({ digest: digests[0] });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // 13. Ask Organizational Memory
  router.post('/memory/ask', async (req: Request, res: Response) => {
    try {
      const body = AskMemoryBodySchema.parse(req.body);
      const result = await askOrganizationalMemory(repo, body.question);
      res.json(result);
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // 14. Run Full Demo (Real sequential pipeline via NDJSON streaming — NEVER fakes success)
  router.post('/demo/run', async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    const emit = (event: Record<string, unknown>) => {
      res.write(`${JSON.stringify(event)}\n`);
    };

    try {
      emit({
        type: 'stage',
        stage: 'init',
        status: 'running',
        message: 'Clearing previous demo records while preserving non-demo workspace data...',
      });

      await repo.resetDemoData();
      await repo.upsertPeople(
        NOVA_TEAM_ROLES.map((p) => ({
          name: p.name,
          role: p.role,
          aliases: p.aliases,
          is_demo: true,
        }))
      );

      emit({
        type: 'stage',
        stage: 'init',
        status: 'done',
        message: 'Demo workspace reset and Nova team roster initialized.',
      });

      const sequence = [
        { num: 1, sample: NOVA_MEETING_1, label: 'Meeting 1 (Nov 3 — Launch Kickoff)' },
        { num: 2, sample: NOVA_MEETING_2, label: 'Meeting 2 (Nov 10 — Weekly Scope Sync)' },
        { num: 3, sample: NOVA_MEETING_3, label: 'Meeting 3 (Nov 17 — Readiness & Reversal Review)' },
      ];

      let totalDecisions = 0;
      let totalTasks = 0;
      let totalConflicts = 0;

      for (const step of sequence) {
        emit({
          type: 'stage',
          stage: `meeting_${step.num}`,
          status: 'running',
          message: `Processing ${step.label}: quality gate, parsing, BluesMinds extraction, and conflict check...`,
        });

        const result = await processMeetingTranscript(repo, {
          title: step.sample.title,
          meetingDate: step.sample.meeting_date,
          attendees: step.sample.attendees,
          rawText: step.sample.transcript,
          isDemo: true,
          actor: 'demo-runner',
        });

        totalDecisions += result.decisions.length;
        totalTasks += result.actionItems.length;
        totalConflicts += result.conflicts.length;

        const details: string[] = [
          `${result.decisions.length} decision(s) extracted`,
          `${result.actionItems.length} commitment(s) queued for human review`,
        ];
        if (result.conflicts.length > 0) {
          const types = result.conflicts
            .map((c) => c.type.replace(/_/g, ' '))
            .slice(0, 4)
            .join(', ');
          details.push(`${result.conflicts.length} cross-meeting conflict(s) detected (${types})`);
        } else {
          details.push('Organizational memory updated');
        }

        emit({
          type: 'stage',
          stage: `meeting_${step.num}`,
          status: 'done',
          message: `${step.label} processed`,
          details,
          meetingId: result.meeting.id,
          modelUsed: result.modelUsed,
          counts: {
            decisions: result.decisions.length,
            actionItems: result.actionItems.length,
            conflicts: result.conflicts.length,
          },
        });
      }

      emit({
        type: 'complete',
        status: 'done',
        summary: {
          meetings: 3,
          decisions: totalDecisions,
          actionItems: totalTasks,
          conflicts: totalConflicts,
        },
      });
      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Demo pipeline failed';
      const code = err instanceof BluesMindsError ? err.code : 'DEMO_ERROR';
      emit({
        type: 'error',
        status: 'failed',
        code,
        error: message,
      });
      res.end();
    }
  });

  // 15. Reset Demo (Safely deletes ONLY is_demo = true records)
  router.post('/demo/reset', async (_req: Request, res: Response) => {
    try {
      const deleted = await repo.resetDemoData();
      await repo.addAuditLog('workspace-user', 'demo_workspace_reset', deleted);
      res.json({ ok: true, deleted });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // 16. Audit Logs
  router.get('/audit-logs', async (_req: Request, res: Response) => {
    try {
      const logs = await repo.listAuditLogs(60);
      res.json({ logs });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  return router;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', createApiRouter());

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Production build not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Followthrough] Server running on http://0.0.0.0:${PORT}`);
    console.log(
      `[Followthrough] Storage=${getRepository().mode} | BluesMindsKey=${isBluesMindsConfigured() ? 'set' : 'missing'} | Model=${getConfiguredBluesMindsModel() || 'unset'}`
    );
  });
}

// Only start listening when executed directly (allows importing createApiRouter in tests)
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'));

if (isDirectRun) {
  startServer().catch((err) => {
    console.error('[Followthrough] Fatal server boot error:', err);
    process.exit(1);
  });
}
