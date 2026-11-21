import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, ShieldQuestion, Undo2 } from 'lucide-react';
import type { ConflictRecord } from '../../shared/types';
import { api } from '../lib/api';

interface ConflictsPageProps {
  refreshKey: number;
  navigate: (path: string) => void;
  onDataMutated: () => void;
}

export function ConflictsPage({
  refreshKey,
  navigate,
  onDataMutated,
}: ConflictsPageProps) {
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .listConflicts()
      .then((res) => setConflicts(res.conflicts))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load conflicts.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  const handleResolve = async (
    id: string,
    action: 'accept_new' | 'keep_old' | 'mark_contested'
  ) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await api.resolveConflict(id, action);
      setConflicts((prev) => prev.map((c) => (c.id === id ? res.conflict : c)));
      onDataMutated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve conflict.');
    } finally {
      setBusyId(null);
    }
  };

  const filtered = conflicts.filter((c) => {
    if (filter === 'open') return c.resolution === 'open';
    if (filter === 'resolved') return c.resolution !== 'open';
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">
            Cross-Meeting Conflict Review
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            LLMs never overwrite organizational memory silently. Review both meeting citations and confirm the active decision.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 self-start">
          {(
            [
              { id: 'open', label: `Open (${conflicts.filter((c) => c.resolution === 'open').length})` },
              {
                id: 'resolved',
                label: `Resolved (${conflicts.filter((c) => c.resolution !== 'open').length})`,
              },
              { id: 'all', label: `All (${conflicts.length})` },
            ] as const
          ).map((tab) => (
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
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-900">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-56 rounded-xl border border-slate-200 bg-white animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center space-y-2">
          <div className="text-sm font-semibold text-slate-900">
            {filter === 'open' ? 'No open conflicts requiring review' : 'No conflicts recorded'}
          </div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            When a later meeting changes a launch date, price, owner, or reverses an earlier
            decision, Followthrough surfaces both evidence quotes here for human resolution.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((c) => {
            const isBusy = busyId === c.id;
            return (
              <article
                key={c.id}
                className="rounded-xl border border-slate-200 bg-white overflow-hidden"
              >
                {/* Header strip */}
                <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs">
                    <AlertTriangle
                      className={`w-4 h-4 shrink-0 ${
                        c.severity === 'high'
                          ? 'text-red-700'
                          : c.severity === 'medium'
                            ? 'text-amber-700'
                            : 'text-slate-500'
                      }`}
                    />
                    <span className="font-semibold text-slate-900 capitalize">
                      {c.type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span
                      className={`font-medium capitalize ${
                        c.severity === 'high'
                          ? 'text-red-700'
                          : c.severity === 'medium'
                            ? 'text-amber-700'
                            : 'text-slate-600'
                      }`}
                    >
                      {c.severity} severity
                    </span>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-slate-600">
                      Topic: {c.new_decision?.topic || c.old_decision?.topic || 'Decision'}
                    </span>
                  </div>
                  <div className="font-mono text-xs text-slate-600">
                    Resolution:{' '}
                    <span className="font-semibold text-slate-900">
                      {c.resolution.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>

                {/* Side-by-side comparison */}
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
                  {/* Previous Decision */}
                  <div className="p-5 space-y-2.5">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">Previous Decision</span>
                      <span className="font-mono tabular-nums">
                        {c.old_decision?.meeting_date || 'Earlier'}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-slate-900">
                      {c.old_decision?.statement || 'Historical decision unavailable'}
                    </p>
                    {c.old_decision && (
                      <>
                        <div className="text-xs text-slate-500">
                          Meeting:{' '}
                          <button
                            type="button"
                            onClick={() => navigate(`/meetings/${c.old_decision!.meeting_id}`)}
                            className="text-[#1D4ED8] hover:underline"
                          >
                            {c.old_decision.meeting_title || c.old_decision.meeting_id}
                          </button>{' '}
                          · Status: {c.old_decision.status}
                        </div>
                        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700 italic">
                          “{c.old_decision.evidence.quote}”
                          <div className="not-italic text-[11px] font-mono text-slate-500 mt-1">
                            — {c.old_decision.evidence.speaker || 'Unknown'} (Turn #
                            {c.old_decision.evidence.turn_index + 1})
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* New Decision */}
                  <div className="p-5 space-y-2.5">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-semibold text-[#1D4ED8]">New Decision</span>
                      <span className="font-mono tabular-nums">
                        {c.new_decision?.meeting_date || 'Latest'}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-slate-900">
                      {c.new_decision?.statement || 'New decision unavailable'}
                    </p>
                    {c.new_decision && (
                      <>
                        <div className="text-xs text-slate-500">
                          Meeting:{' '}
                          <button
                            type="button"
                            onClick={() => navigate(`/meetings/${c.new_decision!.meeting_id}`)}
                            className="text-[#1D4ED8] hover:underline"
                          >
                            {c.new_decision.meeting_title || c.new_decision.meeting_id}
                          </button>{' '}
                          · Status: {c.new_decision.status}
                        </div>
                        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700 italic">
                          “{c.new_decision.evidence.quote}”
                          <div className="not-italic text-[11px] font-mono text-slate-500 mt-1">
                            — {c.new_decision.evidence.speaker || 'Unknown'} (Turn #
                            {c.new_decision.evidence.turn_index + 1})
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Explanation & Human Actions */}
                <div className="px-5 py-4 border-t border-slate-200 bg-slate-50/70 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="space-y-1 text-xs max-w-2xl">
                    <div className="text-slate-900">
                      <strong className="font-semibold">Analysis:</strong> {c.reason}
                    </div>
                    {c.suggested_resolution && (
                      <div className="text-slate-600">
                        <strong className="font-medium">Suggested resolution:</strong>{' '}
                        {c.suggested_resolution}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleResolve(c.id, 'accept_new')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#1D4ED8] text-white px-3.5 py-2 text-xs font-medium hover:bg-[#1E40AF] disabled:opacity-45 whitespace-nowrap"
                    >
                      {isBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>Accept new decision</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleResolve(c.id, 'keep_old')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 px-3.5 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-45 whitespace-nowrap"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                      <span>Keep previous decision</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleResolve(c.id, 'mark_contested')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white text-amber-900 px-3.5 py-2 text-xs font-medium hover:bg-amber-50 disabled:opacity-45 whitespace-nowrap"
                    >
                      <ShieldQuestion className="w-3.5 h-3.5" />
                      <span>Mark contested</span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
