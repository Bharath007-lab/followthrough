import type { ActionItemRecord } from '../../shared/types.ts';

const REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

export function getGitHubConfig(): {
  configured: boolean;
  repo: string | null;
  token: string | null;
} {
  const token = process.env.GITHUB_TOKEN?.trim() || null;
  const rawRepo = process.env.GITHUB_REPO?.trim() || null;
  const repo = rawRepo && REPO_PATTERN.test(rawRepo) ? rawRepo : null;
  return {
    configured: Boolean(token && repo),
    repo,
    token,
  };
}

export function buildGitHubIssuePayload(task: ActionItemRecord): {
  title: string;
  body: string;
  labels: string[];
} {
  const marker = `<!-- followthrough-task-id:${task.id} -->`;
  const lines = [
    task.description || task.title,
    '',
    '### Commitment Metadata',
    `- **Owner:** ${task.owner || 'Unassigned'} (${task.owner_source})`,
    `- **Deadline:** ${task.deadline || 'Not specified'}${task.deadline_phrase ? ` (from "${task.deadline_phrase}")` : ''}`,
    `- **Priority:** ${task.priority}`,
    `- **Source Meeting:** ${task.meeting_title || task.meeting_id}${task.meeting_date ? ` (${task.meeting_date})` : ''}`,
    '',
    '### Supporting Evidence',
    `> "${task.evidence.quote}"`,
    `— ${task.evidence.speaker || 'Unknown speaker'} (Turn #${task.evidence.turn_index + 1})`,
    '',
    marker,
  ];

  return {
    title: `[Followthrough] ${task.title}`,
    body: lines.join('\n'),
    labels: ['followthrough', `priority:${task.priority}`],
  };
}

export interface GitHubIssueCreateResult {
  created: boolean;
  alreadyExisted: boolean;
  externalId: string | null;
  externalUrl: string | null;
  tracker: 'github' | 'internal';
  message: string;
}

export async function createGitHubIssueIdempotent(
  task: ActionItemRecord,
  fetchImpl: typeof fetch = fetch
): Promise<GitHubIssueCreateResult> {
  // Local idempotency guard: if already linked to a GitHub issue, never create a duplicate
  if (task.tracker === 'github' && task.external_id && task.external_url) {
    return {
      created: false,
      alreadyExisted: true,
      externalId: task.external_id,
      externalUrl: task.external_url,
      tracker: 'github',
      message: `Task is already linked to GitHub Issue #${task.external_id}. Skipped duplicate creation.`,
    };
  }

  const config = getGitHubConfig();
  if (!config.configured || !config.token || !config.repo) {
    return {
      created: false,
      alreadyExisted: false,
      externalId: null,
      externalUrl: null,
      tracker: 'internal',
      message:
        'GitHub integration is not configured (set GITHUB_TOKEN and GITHUB_REPO in Secrets). Task saved to internal task board.',
    };
  }

  const headers = {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'Followthrough-App',
  };

  // Remote idempotency check: search existing issues for our hidden followthrough-task-id marker
  const searchQuery = encodeURIComponent(
    `repo:${config.repo} "followthrough-task-id:${task.id}" in:body`
  );
  const searchRes = await fetchImpl(
    `https://api.github.com/search/issues?q=${searchQuery}&per_page=1`,
    { method: 'GET', headers }
  );

  if (searchRes.ok) {
    const searchData = (await searchRes.json()) as {
      items?: Array<{ number?: number; html_url?: string }>;
    };
    const existing = searchData.items?.[0];
    if (existing?.number && existing?.html_url) {
      return {
        created: false,
        alreadyExisted: true,
        externalId: String(existing.number),
        externalUrl: existing.html_url,
        tracker: 'github',
        message: `Found existing GitHub Issue #${existing.number} via idempotency marker; linked without duplicating.`,
      };
    }
  }

  const payload = buildGitHubIssuePayload(task);
  const createRes = await fetchImpl(`https://api.github.com/repos/${config.repo}/issues`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!createRes.ok) {
    const errText = (await createRes.text().catch(() => '')).slice(0, 300);
    throw new Error(`GitHub Issue creation failed (HTTP ${createRes.status}): ${errText}`);
  }

  const created = (await createRes.json()) as { number: number; html_url: string };
  return {
    created: true,
    alreadyExisted: false,
    externalId: String(created.number),
    externalUrl: created.html_url,
    tracker: 'github',
    message: `Created GitHub Issue #${created.number} in ${config.repo}.`,
  };
}
