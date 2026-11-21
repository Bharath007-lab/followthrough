import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { DecisionRecord } from '../../shared/types';
import { AskMemoryPanel } from '../components/AskMemoryPanel';
import { api, type DecisionTimelineGroup } from '../lib/api';

interface DecisionsPageProps {
  refreshKey: number;
  navigate: (path: string) => void;
}

export function DecisionsPage({ refreshKey, navigate }: DecisionsPageProps) {
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [timelines, setTimelines] = useState<DecisionTimelineGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'superseded' | 'contested'>('all');
  const [viewMode, setViewMode] = useState<'timeline' | 'ledger'>('timeline');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listDecisions()
      .then((res) => {
        if (!cancelled) {
          setDecisions(res.decisions);
          setTimelines(res.timelines);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load decisions.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const filteredDecisions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return decisions.filter((d) => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (!q) return true;
      return (
        d.topic.toLowerCase().includes(q) ||
        d.statement.toLowerCase().includes(q) ||
        (d.decided_by || '').toLowerCase().includes(q)
      );
    });
  }, [decisions, statusFilter, query]);

  const filteredTimelines = useMemo(() => {
    const q = query.trim().toLowerCase();
    return timelines
      .map((group) => ({
        topic: group.topic,
        items: group.items.filter((d) => {
          if (statusFilter !== 'all' && d.status !== statusFilter) return false;
          if (!q) return true;
          return (
            d.topic.toLowerCase().includes(q) ||
            d.statement.toLowerCase().includes(q) ||
            (d.decided_by || '').toLowerCase().includes(q)
          );
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [timelines, statusFilter, query]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">
            Decision Memory & Historical Timeline
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Persistent organizational memory across meetings, preserving every supersession and reversal.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 self-start">
          <button
            type="button"
            onClick={() => setViewMode('timeline')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              viewMode === 'timeline'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Topic Timelines
          </button>
          <button
            type="button"
            onClick={() => setViewMode('ledger')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              viewMode === 'ledger'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Decisions
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by topic, decision text, or decider..."
            className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          />
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 self-start">
          {(['all', 'active', 'superseded', 'contested'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {st}
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
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 rounded-xl border border-slate-200 bg-white animate-pulse" />
          ))}
        </div>
      ) : decisions.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center space-y-2">
          <div className="text-sm font-semibold text-slate-900">No decisions in memory yet</div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Process a meeting transcript or run the 3-meeting Nova demo to build organizational
            decision lineage.
          </p>
        </div>
      ) : viewMode === 'timeline' ? (
        <div className="space-y-4">
          {filteredTimelines.map((group) => (
            <section
              key={group.topic}
              className="rounded-xl border border-slate-200 bg-white overflow-hidden"
            >
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
                <h3 className="text-sm font-semibold text-slate-900">{group.topic}</h3>
                <span className="font-mono text-xs tabular-nums text-slate-500">
                  {group.items.length} historical record(s)
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {group.items.map((d) => (
                  <div
                    key={d.id}
                    className="px-5 py-4 flex flex-col md:flex-row md:items-start justify-between gap-4"
                  >
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono tabular-nums font-semibold text-slate-900">
                          {d.meeting_date || d.created_at.slice(0, 10)}
                        </span>
                        <span className="text-slate-300" aria-hidden="true">
                          ·
                        </span>
                        <button
                          type="button"
                          onClick={() => navigate(`/meetings/${d.meeting_id}`)}
                          className="text-[#1D4ED8] hover:underline"
                        >
                          {d.meeting_title || 'View meeting'}
                        </button>
                        <span className="text-slate-300" aria-hidden="true">
                          ·
                        </span>
                        <span
                          className={`font-medium capitalize ${
                            d.status === 'active'
                              ? 'text-emerald-700'
                              : d.status === 'contested'
                                ? 'text-amber-700'
                                : 'text-slate-500 line-through'
                          }`}
                        >
                          {d.status}
                        </span>
                      </div>
                      <p
                        className={`text-sm ${
                          d.status === 'superseded'
                            ? 'text-slate-500 line-through'
                            : 'text-slate-900 font-medium'
                        }`}
                      >
                        {d.statement}
                      </p>
                      <div className="text-xs text-slate-600 italic">
                        “{d.evidence.quote}” — {d.evidence.speaker || 'Unknown'} (
                        {d.evidence.verified ? 'verified' : 'unverified'})
                      </div>
                    </div>
                    <div className="text-xs font-mono tabular-nums text-slate-500 shrink-0">
                      {d.decided_by || 'Unspecified'} · {Math.round(d.confidence * 100)}%
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-3 px-5">Topic & Statement</th>
                <th className="py-3 px-4">Meeting</th>
                <th className="py-3 px-4">Decided By</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-5 text-right">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredDecisions.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50/70">
                  <td className="py-3.5 px-5 max-w-lg">
                    <div className="text-xs font-semibold text-slate-500">{d.topic}</div>
                    <div className="text-slate-900 mt-0.5">{d.statement}</div>
                    <div className="text-xs text-slate-500 italic mt-1">
                      “{d.evidence.quote}”
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => navigate(`/meetings/${d.meeting_id}`)}
                      className="text-[#1D4ED8] hover:underline block"
                    >
                      {d.meeting_title || 'Meeting'}
                    </button>
                    <span className="font-mono tabular-nums text-slate-500">
                      {d.meeting_date || ''}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-xs text-slate-700">
                    {d.decided_by || 'Unspecified'}
                  </td>
                  <td className="py-3.5 px-4 text-xs font-medium capitalize">
                    <span
                      className={
                        d.status === 'active'
                          ? 'text-emerald-700'
                          : d.status === 'contested'
                            ? 'text-amber-700'
                            : 'text-slate-500'
                      }
                    >
                      {d.status}
                    </span>
                  </td>
                  <td className="py-3.5 px-5 text-right font-mono text-xs tabular-nums text-slate-700">
                    {Math.round(d.confidence * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AskMemoryPanel />
    </div>
  );
}
