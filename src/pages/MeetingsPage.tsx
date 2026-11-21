import React, { useEffect, useMemo, useState } from 'react';
import { FilePlus, Search } from 'lucide-react';
import { api, type MeetingListItem } from '../lib/api';

interface MeetingsPageProps {
  refreshKey: number;
  navigate: (path: string) => void;
  onOpenIngest: (sampleKey?: string) => void;
}

export function MeetingsPage({ refreshKey, navigate, onOpenIngest }: MeetingsPageProps) {
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'demo' | 'custom' | 'conflicts'>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listMeetings()
      .then((res) => {
        if (!cancelled) setMeetings(res.meetings);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load meetings.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return meetings.filter((m) => {
      if (scopeFilter === 'demo' && !m.is_demo) return false;
      if (scopeFilter === 'custom' && m.is_demo) return false;
      if (scopeFilter === 'conflicts' && m.conflictCount === 0) return false;
      if (!q) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        m.meeting_date.includes(q) ||
        m.attendees.some((a) => a.toLowerCase().includes(q))
      );
    });
  }, [meetings, query, scopeFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Meetings</h2>
          <p className="text-xs text-slate-500 mt-1">
            Ingested transcripts, deterministic quality gate scores, and extracted organizational memory.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenIngest()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#1D4ED8] text-white px-4 py-2 text-xs font-medium hover:bg-[#1E40AF] whitespace-nowrap self-start sm:self-auto"
        >
          <FilePlus className="w-3.5 h-3.5" />
          <span>Ingest Transcript</span>
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by meeting title, date, or speaker..."
            className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          />
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 self-start">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'demo', label: 'Nova Demo' },
              { id: 'custom', label: 'Custom' },
              { id: 'conflicts', label: 'With Conflicts' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setScopeFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                scopeFilter === tab.id
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
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 px-5 animate-pulse bg-slate-50/40" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center space-y-3">
          <div className="text-sm font-semibold text-slate-900">No meetings found</div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {meetings.length === 0
              ? 'Paste or upload a transcript (.txt, .md, .vtt, .srt) or load one of the interconnected Nova sample meetings.'
              : 'No meetings match your current search or filter.'}
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenIngest('nova_meeting_1')}
              className="rounded-lg bg-[#1D4ED8] text-white px-4 py-2 text-xs font-medium hover:bg-[#1E40AF]"
            >
              Load Nova Meeting 1
            </button>
            <button
              type="button"
              onClick={() => onOpenIngest()}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Paste Custom Transcript
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-3 px-5">Meeting</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Speakers</th>
                <th className="py-3 px-4 text-right">Decisions</th>
                <th className="py-3 px-4 text-right">Tasks</th>
                <th className="py-3 px-4 text-right">Conflicts</th>
                <th className="py-3 px-5 text-right">Quality</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => navigate(`/meetings/${m.id}`)}
                  className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                >
                  <td className="py-3.5 px-5">
                    <div className="font-medium text-slate-900">{m.title}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      <span>{m.is_demo ? 'Nova Demo' : 'Custom'}</span>
                      <span aria-hidden="true"> · </span>
                      <span>{m.quality_report?.turnCount ?? 0} turns</span>
                      <span aria-hidden="true"> · </span>
                      <span>{m.quality_report?.wordCount ?? 0} words</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-xs tabular-nums text-slate-700 whitespace-nowrap">
                    {m.meeting_date}
                  </td>
                  <td className="py-3.5 px-4 text-xs text-slate-600 max-w-[200px] truncate">
                    {m.attendees.length > 0 ? m.attendees.join(', ') : 'Unlabelled'}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-xs tabular-nums text-slate-900">
                    {m.decisionCount}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-xs tabular-nums text-slate-900">
                    {m.taskCount}
                  </td>
                  <td
                    className={`py-3.5 px-4 text-right font-mono text-xs tabular-nums ${
                      m.conflictCount > 0 ? 'text-amber-700 font-semibold' : 'text-slate-500'
                    }`}
                  >
                    {m.conflictCount}
                  </td>
                  <td className="py-3.5 px-5 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                    <span
                      className={
                        m.quality_report?.status === 'pass'
                          ? 'text-emerald-700'
                          : 'text-amber-700'
                      }
                    >
                      {m.quality_report?.score ?? 100}/100
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
