import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import type { ActionItemStatus } from '../../shared/types';
import { api, type TaskWithPreview } from '../lib/api';

interface TasksPageProps {
  refreshKey: number;
  navigate: (path: string) => void;
  onDataMutated: () => void;
}

type BoardFilter = 'all' | 'proposed' | 'approved' | 'in_progress' | 'done' | 'overdue' | 'rejected';

function isOverdue(deadline: string | null, status: ActionItemStatus): boolean {
  if (!deadline || status === 'done' || status === 'rejected') return false;
  const today = new Date().toISOString().slice(0, 10);
  return deadline < today;
}

export function TasksPage({ refreshKey, navigate, onDataMutated }: TasksPageProps) {
  const [tasks, setTasks] = useState<TaskWithPreview[]>([]);
  const [githubConfigured, setGithubConfigured] = useState(false);
  const [githubRepo, setGithubRepo] = useState<string | null>(null);
  const [filter, setFilter] = useState<BoardFilter>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .listTasks()
      .then((res) => {
        setTasks(res.tasks);
        setGithubConfigured(res.githubConfigured);
        setGithubRepo(res.githubRepo);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load tasks.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (filter === 'overdue') {
        if (!isOverdue(t.deadline, t.status)) return false;
      } else if (filter !== 'all' && t.status !== filter) {
        return false;
      }
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.owner || '').toLowerCase().includes(q) ||
        (t.meeting_title || '').toLowerCase().includes(q)
      );
    });
  }, [tasks, filter, query]);

  const handleStatusChange = async (id: string, nextStatus: ActionItemStatus) => {
    setBusyId(id);
    setError(null);
    setMessage(null);
    try {
      const res = await api.updateTask(id, { status: nextStatus });
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...res.task } : t)));
      onDataMutated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task status.');
    } finally {
      setBusyId(null);
    }
  };

  const handleGitHubSync = async (id: string) => {
    setBusyId(id);
    setError(null);
    setMessage(null);
    try {
      const res = await api.syncTaskGitHub(id);
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...res.task } : t)));
      setMessage(res.github.message);
      onDataMutated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GitHub sync failed.');
    } finally {
      setBusyId(null);
    }
  };

  const tabs: Array<{ id: BoardFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: tasks.length },
    { id: 'proposed', label: 'Proposed', count: tasks.filter((t) => t.status === 'proposed').length },
    { id: 'approved', label: 'Approved', count: tasks.filter((t) => t.status === 'approved').length },
    {
      id: 'in_progress',
      label: 'In Progress',
      count: tasks.filter((t) => t.status === 'in_progress').length,
    },
    { id: 'done', label: 'Done', count: tasks.filter((t) => t.status === 'done').length },
    {
      id: 'overdue',
      label: 'Overdue',
      count: tasks.filter((t) => isOverdue(t.deadline, t.status)).length,
    },
    { id: 'rejected', label: 'Rejected', count: tasks.filter((t) => t.status === 'rejected').length },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Internal Task Board</h2>
          <p className="text-xs text-slate-500 mt-1">
            Tracks all extracted commitments independently of external trackers.
            {githubConfigured
              ? ` Connected to GitHub repo ${githubRepo}.`
              : ' GitHub Issues optional — internal board active.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate('/review')}
          className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap self-start sm:self-auto"
        >
          Open Approval Queue ({tasks.filter((t) => t.status === 'proposed').length})
        </button>
      </div>

      {/* Filter strip */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 self-start">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                filter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label} <span className="font-mono tabular-nums text-slate-400">{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="relative w-full lg:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter tasks or owners..."
            className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-1.5 text-sm text-slate-900 focus:border-[#1D4ED8] focus:outline-none"
          />
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-950">
          {message}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-900">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white h-64 animate-pulse" />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center space-y-2">
          <div className="text-sm font-semibold text-slate-900">No tasks in this view</div>
          <p className="text-xs text-slate-500">
            Process meetings and approve proposed items in Review & Post to populate the board.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-3 px-5">Commitment</th>
                <th className="py-3 px-4">Owner</th>
                <th className="py-3 px-4">Deadline</th>
                <th className="py-3 px-4">Priority</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-5 text-right">Tracker</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.map((t) => {
                const overdue = isOverdue(t.deadline, t.status);
                const isBusy = busyId === t.id;
                const safeExternalUrl =
                  t.external_url && t.external_url.startsWith('https://github.com/')
                    ? t.external_url
                    : null;

                return (
                  <tr key={t.id} className="hover:bg-slate-50/70">
                    <td className="py-3.5 px-5 max-w-md">
                      <div className="font-medium text-slate-900">{t.title}</div>
                      <div className="text-xs text-slate-500 mt-0.5 truncate">
                        <button
                          type="button"
                          onClick={() => navigate(`/meetings/${t.meeting_id}`)}
                          className="text-[#1D4ED8] hover:underline"
                        >
                          {t.meeting_title || 'Meeting'}
                        </button>
                        {t.flags.length > 0 && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="text-amber-700">
                              {t.flags.map((f) => f.replace(/_/g, ' ')).join(', ')}
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-700 whitespace-nowrap">
                      {t.owner || <span className="text-amber-700">Unassigned</span>}
                    </td>
                    <td
                      className={`py-3.5 px-4 font-mono text-xs tabular-nums whitespace-nowrap ${
                        overdue ? 'text-red-700 font-semibold' : 'text-slate-700'
                      }`}
                    >
                      {t.deadline || '—'}
                      {overdue ? ' (Overdue)' : ''}
                    </td>
                    <td className="py-3.5 px-4 text-xs capitalize text-slate-700 whitespace-nowrap">
                      {t.priority}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {t.status === 'proposed' ? (
                        <button
                          type="button"
                          onClick={() => navigate('/review')}
                          className="text-xs font-medium text-[#1D4ED8] hover:underline"
                        >
                          Proposed — Review
                        </button>
                      ) : (
                        <select
                          aria-label={`Status for ${t.title}`}
                          disabled={isBusy}
                          value={t.status}
                          onChange={(e) =>
                            handleStatusChange(t.id, e.target.value as ActionItemStatus)
                          }
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-[#1D4ED8] focus:outline-none"
                        >
                          <option value="approved">Approved</option>
                          <option value="in_progress">In Progress</option>
                          <option value="done">Done</option>
                          <option value="rejected">Rejected</option>
                        </select>
                      )}
                    </td>
                    <td className="py-3.5 px-5 text-right text-xs whitespace-nowrap">
                      {safeExternalUrl ? (
                        <a
                          href={safeExternalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[#1D4ED8] hover:underline font-mono"
                        >
                          <span>GitHub #{t.external_id}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : t.status !== 'proposed' && t.status !== 'rejected' ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleGitHubSync(t.id)}
                          className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 disabled:opacity-45"
                        >
                          {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                          <span>{githubConfigured ? 'Post to GitHub' : 'Internal'}</span>
                        </button>
                      ) : (
                        <span className="text-slate-400">Internal</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
