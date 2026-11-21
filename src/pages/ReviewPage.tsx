import React, { useEffect, useState } from 'react';
import { Check, CheckCircle2, Code2, ExternalLink, Loader2, ShieldAlert, X } from 'lucide-react';
import type { ActionItemPriority } from '../../shared/types';
import { api, type TaskWithPreview } from '../lib/api';

interface ReviewPageProps {
  refreshKey: number;
  navigate: (path: string) => void;
  onDataMutated: () => void;
}

interface DraftEdits {
  title: string;
  description: string;
  owner: string;
  deadline: string;
  priority: ActionItemPriority;
}

export function ReviewPage({ refreshKey, navigate, onDataMutated }: ReviewPageProps) {
  const [tasks, setTasks] = useState<TaskWithPreview[]>([]);
  const [githubConfigured, setGithubConfigured] = useState(false);
  const [githubRepo, setGithubRepo] = useState<string | null>(null);
  const [postToGitHub, setPostToGitHub] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, DraftEdits>>({});
  const [expandedPayloadId, setExpandedPayloadId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .listTasks('proposed')
      .then((res) => {
        setTasks(res.tasks);
        setGithubConfigured(res.githubConfigured);
        setGithubRepo(res.githubRepo);
        const initialDrafts: Record<string, DraftEdits> = {};
        for (const t of res.tasks) {
          initialDrafts[t.id] = {
            title: t.title,
            description: t.description,
            owner: t.owner || '',
            deadline: t.deadline || '',
            priority: t.priority,
          };
        }
        setDrafts(initialDrafts);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load review queue.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  const updateDraft = (id: string, patch: Partial<DraftEdits>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }));
  };

  const handleApprove = async (task: TaskWithPreview) => {
    const draft = drafts[task.id];
    if (!draft) return;
    setBusyId(task.id);
    setError(null);
    setFeedback(null);
    try {
      const res = await api.approveTask(task.id, {
        title: draft.title.trim() || task.title,
        description: draft.description.trim(),
        owner: draft.owner.trim() || null,
        deadline: draft.deadline.trim() || null,
        priority: draft.priority,
        postToGitHub: postToGitHub && githubConfigured,
      });
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      setFeedback(
        res.github?.message ||
          `Approved "${res.task.title}" and added it to the internal task board.`
      );
      onDataMutated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (task: TaskWithPreview) => {
    setBusyId(task.id);
    setError(null);
    setFeedback(null);
    try {
      await api.rejectTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      setFeedback(`Rejected "${task.title}". Preserved in database with status "rejected".`);
      onDataMutated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rejection failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">
            Review & Post — Human Approval Queue
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Edit extracted owners, deadlines, or wording before approving. External tracker issues are never created without explicit confirmation.
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs bg-white border border-slate-200 rounded-lg px-3.5 py-2 self-start">
          {githubConfigured ? (
            <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700">
              <input
                type="checkbox"
                checked={postToGitHub}
                onChange={(e) => setPostToGitHub(e.target.checked)}
                className="rounded border-slate-300 text-[#1D4ED8] focus:ring-blue-600"
              />
              <span>Create GitHub Issue in {githubRepo} on approval</span>
            </label>
          ) : (
            <span className="text-slate-600">
              GitHub Issues not configured — approvals post to the internal task board.{' '}
              <button
                type="button"
                onClick={() => navigate('/settings')}
                className="text-[#1D4ED8] hover:underline font-medium"
              >
                Configure
              </button>
            </span>
          )}
        </div>
      </div>

      {feedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-950">
          {feedback}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-900">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-52 rounded-xl border border-slate-200 bg-white animate-pulse" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center space-y-3">
          <div className="text-sm font-semibold text-slate-900">Review queue is clear</div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            There are no proposed commitments awaiting approval. View approved work on the Task
            Board or process a new meeting transcript.
          </p>
          <button
            type="button"
            onClick={() => navigate('/tasks')}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Open Task Board
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => {
            const draft = drafts[task.id] || {
              title: task.title,
              description: task.description,
              owner: task.owner || '',
              deadline: task.deadline || '',
              priority: task.priority,
            };
            const isBusy = busyId === task.id;
            const showPayload = expandedPayloadId === task.id;

            return (
              <article
                key={task.id}
                className="rounded-xl border border-slate-200 bg-white overflow-hidden"
              >
                <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="text-slate-600">
                    <button
                      type="button"
                      onClick={() => navigate(`/meetings/${task.meeting_id}`)}
                      className="font-medium text-[#1D4ED8] hover:underline"
                    >
                      {task.meeting_title || 'Source meeting'}
                    </button>
                    <span aria-hidden="true"> · </span>
                    <span className="font-mono tabular-nums">{task.meeting_date || ''}</span>
                    <span aria-hidden="true"> · </span>
                    <span className="font-mono tabular-nums">
                      {Math.round(task.confidence * 100)}% confidence
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {task.evidence.verified ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Verified quote
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Unverified quote
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedPayloadId(showPayload ? null : task.id)}
                      className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900"
                    >
                      <Code2 className="w-3.5 h-3.5" />
                      <span>{showPayload ? 'Hide payload' : 'Preview payload'}</span>
                    </button>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  {/* Quality flags warning */}
                  {task.flags.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-900">
                      <strong className="font-semibold">Quality flags requiring review:</strong>{' '}
                      {task.flags.map((f) => f.replace(/_/g, ' ')).join(' · ')}
                    </div>
                  )}

                  {/* Editable fields */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                    <div className="md:col-span-6">
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Task title
                      </label>
                      <input
                        type="text"
                        value={draft.title}
                        onChange={(e) => updateDraft(task.id, { title: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-[#1D4ED8] focus:outline-none"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Owner ({task.owner_source})
                      </label>
                      <input
                        type="text"
                        value={draft.owner}
                        placeholder="Unassigned"
                        onChange={(e) => updateDraft(task.id, { owner: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-[#1D4ED8] focus:outline-none"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Deadline
                      </label>
                      <input
                        type="date"
                        value={draft.deadline}
                        onChange={(e) => updateDraft(task.id, { deadline: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-mono tabular-nums text-slate-900 focus:border-[#1D4ED8] focus:outline-none"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Priority
                      </label>
                      <select
                        value={draft.priority}
                        onChange={(e) =>
                          updateDraft(task.id, {
                            priority: e.target.value as ActionItemPriority,
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-[#1D4ED8] focus:outline-none"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">
                      Description
                    </label>
                    <textarea
                      rows={2}
                      value={draft.description}
                      onChange={(e) => updateDraft(task.id, { description: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                    />
                  </div>

                  {/* Supporting verbatim quote */}
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-xs text-slate-700">
                    <div className="italic">“{task.evidence.quote}”</div>
                    <div className="text-[11px] font-mono text-slate-500 mt-1">
                      — {task.evidence.speaker || 'Unknown speaker'} · Turn #
                      {task.evidence.turn_index + 1}
                      {task.deadline_phrase ? ` · Phrase: "${task.deadline_phrase}"` : ''}
                    </div>
                  </div>

                  {/* Exact payload preview */}
                  {showPayload && (
                    <div className="rounded-lg border border-slate-200 bg-slate-900 text-slate-100 p-3.5 text-xs font-mono overflow-x-auto">
                      <div className="text-slate-400 mb-1.5">
                        Exact Task / GitHub Issue Payload Preview
                      </div>
                      <pre className="whitespace-pre-wrap leading-relaxed">
                        {JSON.stringify(
                          {
                            title: `[Followthrough] ${draft.title}`,
                            owner: draft.owner || 'Unassigned',
                            deadline: draft.deadline || null,
                            priority: draft.priority,
                            tracker: postToGitHub && githubConfigured ? 'github' : 'internal',
                            idempotencyKey: `followthrough-task-id:${task.id}`,
                            bodyPreview: task.githubPayloadPreview.body,
                          },
                          null,
                          2
                        )}
                      </pre>
                    </div>
                  )}
                </div>

                {/* Explicit human actions */}
                <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50/70 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleReject(task)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:text-red-700 hover:border-red-200 disabled:opacity-45 whitespace-nowrap"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Reject</span>
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleApprove(task)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#1D4ED8] text-white px-4 py-2 text-xs font-medium hover:bg-[#1E40AF] disabled:opacity-45 whitespace-nowrap"
                  >
                    {isBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : postToGitHub && githubConfigured ? (
                      <ExternalLink className="w-3.5 h-3.5" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {postToGitHub && githubConfigured
                        ? 'Approve & Create GitHub Issue'
                        : 'Approve to Task Board'}
                    </span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
