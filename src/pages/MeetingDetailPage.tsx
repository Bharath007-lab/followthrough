import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, ShieldAlert } from 'lucide-react';
import { api, type MeetingDetailPayload } from '../lib/api';

interface MeetingDetailPageProps {
  meetingId: string;
  refreshKey: number;
  navigate: (path: string) => void;
}

export function MeetingDetailPage({
  meetingId,
  refreshKey,
  navigate,
}: MeetingDetailPageProps) {
  const [data, setData] = useState<MeetingDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightedTurnIdx, setHighlightedTurnIdx] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'extractions' | 'quality'>('extractions');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getMeeting(meetingId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load meeting.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId, refreshKey]);

  const jumpToTurn = (turnIdx: number) => {
    setHighlightedTurnIdx(turnIdx);
    const el = document.getElementById(`transcript-turn-${turnIdx}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-24 rounded-xl border border-slate-200 bg-white animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 h-96 rounded-xl border border-slate-200 bg-white animate-pulse" />
          <div className="lg:col-span-5 h-96 rounded-xl border border-slate-200 bg-white animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 space-y-3 text-sm text-red-900">
        <div className="font-semibold">Meeting not available</div>
        <p className="text-xs">{error || 'Meeting could not be found.'}</p>
        <button
          type="button"
          onClick={() => navigate('/meetings')}
          className="text-xs font-medium text-[#1D4ED8] hover:underline"
        >
          Return to Meetings
        </button>
      </div>
    );
  }

  const { meeting, turns, decisions, actionItems, conflicts } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => navigate('/meetings')}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 mb-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Meetings</span>
          </button>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">{meeting.title}</h2>
          <div className="text-xs text-slate-500 font-mono tabular-nums">
            <span>{meeting.meeting_date}</span>
            <span aria-hidden="true"> · </span>
            <span>{turns.length} turns</span>
            <span aria-hidden="true"> · </span>
            <span>{meeting.quality_report.wordCount} words</span>
            <span aria-hidden="true"> · </span>
            <span>Health {meeting.health_score}/100</span>
            <span aria-hidden="true"> · </span>
            <span>Quality {meeting.quality_report.score}/100</span>
          </div>
          <div className="text-xs text-slate-600 pt-1">
            Speakers: {meeting.attendees.length > 0 ? meeting.attendees.join(', ') : 'None attributed'}
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 shrink-0 self-start">
          <button
            type="button"
            onClick={() => setActiveTab('extractions')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'extractions'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Extractions & Conflicts
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('quality')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'quality'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Quality Report
          </button>
        </div>
      </div>

      {/* Split Workspace: Left = Structured Extractions / Quality Report, Right = Interactive Transcript */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-6">
          {activeTab === 'quality' ? (
            <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Deterministic Quality Gate Report
                </h3>
                <span className="font-mono text-xs tabular-nums text-slate-600">
                  Status: {meeting.quality_report.status} · Score {meeting.quality_report.score}/100
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {meeting.quality_report.checks.map((c) => (
                  <div key={c.id} className="py-3 flex items-start justify-between gap-4 text-xs">
                    <div>
                      <div className="font-medium text-slate-900">{c.label}</div>
                      <div className="text-slate-600 mt-0.5">{c.detail}</div>
                    </div>
                    <span
                      className={`font-mono uppercase shrink-0 ${
                        c.status === 'pass'
                          ? 'text-emerald-700'
                          : c.status === 'warning'
                            ? 'text-amber-700'
                            : 'text-red-700'
                      }`}
                    >
                      {c.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <>
              {/* Conflicts */}
              {conflicts.length > 0 && (
                <section className="rounded-xl border border-amber-200 bg-amber-50/40 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-amber-200 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-amber-950 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-700" />
                      <span>Cross-Meeting Conflicts ({conflicts.length})</span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => navigate('/conflicts')}
                      className="text-xs font-medium text-[#1D4ED8] hover:underline"
                    >
                      Resolve in Conflicts
                    </button>
                  </div>
                  <div className="divide-y divide-amber-200/70">
                    {conflicts.map((c) => (
                      <div key={c.id} className="p-4 text-xs space-y-1">
                        <div className="font-medium text-amber-950">
                          {c.type.replace(/_/g, ' ')} · {c.severity} severity · Resolution:{' '}
                          {c.resolution}
                        </div>
                        <p className="text-slate-800">{c.reason}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Decisions */}
              <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Decisions ({decisions.length})
                  </h3>
                  <span className="text-xs text-slate-500">Click any quote to highlight turn</span>
                </div>
                {decisions.length === 0 ? (
                  <div className="p-5 text-xs text-slate-500">
                    No finalized decisions extracted from this meeting.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {decisions.map((d) => (
                      <div key={d.id} className="p-5 space-y-2">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="font-semibold text-slate-900">{d.topic}</span>
                          <span className="font-mono tabular-nums text-slate-500">
                            {d.status} · {Math.round(d.confidence * 100)}% conf
                          </span>
                        </div>
                        <p className="text-sm text-slate-800">{d.statement}</p>
                        <div className="text-xs text-slate-500">
                          Decided by: {d.decided_by || 'Unspecified'}
                        </div>
                        <button
                          type="button"
                          onClick={() => jumpToTurn(d.evidence.turn_index)}
                          className="w-full text-left rounded-lg border border-slate-200 bg-slate-50 hover:border-[#1D4ED8] px-3 py-2 text-xs transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-slate-500 mb-1">
                            <span>
                              Turn #{d.evidence.turn_index + 1} ·{' '}
                              {d.evidence.speaker || 'Unknown speaker'}
                            </span>
                            <span
                              className={
                                d.evidence.verified ? 'text-emerald-700' : 'text-amber-700'
                              }
                            >
                              {d.evidence.verified ? (
                                <span className="inline-flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3" /> Verified quote (
                                  {Math.round((d.evidence.similarity ?? 1) * 100)}%)
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <ShieldAlert className="w-3 h-3" /> Unverified — review
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="italic text-slate-800">“{d.evidence.quote}”</div>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Action Items */}
              <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Action Items ({actionItems.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => navigate('/review')}
                    className="text-xs font-medium text-[#1D4ED8] hover:underline"
                  >
                    Open Review & Post
                  </button>
                </div>
                {actionItems.length === 0 ? (
                  <div className="p-5 text-xs text-slate-500">No commitments extracted.</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {actionItems.map((t) => (
                      <div key={t.id} className="p-5 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-sm font-medium text-slate-900">{t.title}</div>
                          <span className="font-mono text-xs text-slate-600 shrink-0">
                            {t.status}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600">
                          Owner: <strong className="text-slate-900">{t.owner || 'Unassigned'}</strong>{' '}
                          ({t.owner_source}) · Deadline:{' '}
                          <span className="font-mono tabular-nums">
                            {t.deadline || 'None'}
                          </span>
                          {t.deadline_phrase ? ` (“${t.deadline_phrase}”)` : ''} · Priority:{' '}
                          {t.priority}
                        </div>
                        {t.flags.length > 0 && (
                          <div className="text-xs text-amber-800">
                            Quality flags: {t.flags.map((f) => f.replace(/_/g, ' ')).join(' · ')}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => jumpToTurn(t.evidence.turn_index)}
                          className="w-full text-left rounded-lg border border-slate-200 bg-slate-50 hover:border-[#1D4ED8] px-3 py-2 text-xs transition-colors"
                        >
                          <div className="text-[11px] font-mono text-slate-500 mb-0.5">
                            Turn #{t.evidence.turn_index + 1} · {t.evidence.speaker || 'Unknown'} ·{' '}
                            {t.evidence.verified ? 'Verified' : 'Unverified'}
                          </div>
                          <div className="italic text-slate-800">“{t.evidence.quote}”</div>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Open Questions & Risks */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Open Questions ({meeting.open_questions.length})
                  </h3>
                  {meeting.open_questions.length === 0 ? (
                    <p className="text-xs text-slate-500">None recorded.</p>
                  ) : (
                    <ul className="space-y-3">
                      {meeting.open_questions.map((q) => (
                        <li key={q.id} className="text-xs space-y-1">
                          <div className="font-medium text-slate-900">{q.question}</div>
                          <div className="text-slate-500">
                            {q.status} · Raised by {q.raised_by || 'Unknown'}
                          </div>
                          <button
                            type="button"
                            onClick={() => jumpToTurn(q.evidence.turn_index)}
                            className="text-[11px] text-[#1D4ED8] hover:underline"
                          >
                            Highlight Turn #{q.evidence.turn_index + 1}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Risks & Blockers ({meeting.risks.length})
                  </h3>
                  {meeting.risks.length === 0 ? (
                    <p className="text-xs text-slate-500">None recorded.</p>
                  ) : (
                    <ul className="space-y-3">
                      {meeting.risks.map((r) => (
                        <li key={r.id} className="text-xs space-y-1">
                          <div className="font-medium text-slate-900">{r.description}</div>
                          <div className="text-slate-500">
                            {r.category.replace(/_/g, ' ')} · {r.severity} severity
                          </div>
                          <button
                            type="button"
                            onClick={() => jumpToTurn(r.evidence.turn_index)}
                            className="text-[11px] text-[#1D4ED8] hover:underline"
                          >
                            Highlight Turn #{r.evidence.turn_index + 1}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </>
          )}
        </div>

        {/* Right: Synchronized Speaker Transcript Viewer */}
        <aside className="lg:col-span-5 rounded-xl border border-slate-200 bg-white overflow-hidden lg:sticky lg:top-20">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Parsed Transcript</h3>
            <span className="font-mono text-xs tabular-nums text-slate-500">
              {turns.length} turns
            </span>
          </div>
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-slate-100">
            {turns.map((turn) => {
              const highlighted = highlightedTurnIdx === turn.idx;
              return (
                <div
                  key={turn.id}
                  id={`transcript-turn-${turn.idx}`}
                  className={`px-4 py-3 text-xs transition-colors ${
                    highlighted ? 'bg-blue-50 ring-1 ring-inset ring-blue-300' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-slate-500 mb-1">
                    <span className="font-semibold text-slate-900">
                      {turn.speaker || 'Unknown speaker'}
                    </span>
                    <span className="tabular-nums">
                      #{turn.idx + 1}
                      {turn.timestamp ? ` · ${turn.timestamp}` : ''}
                    </span>
                  </div>
                  <p className="text-slate-700 leading-relaxed">{turn.text}</p>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
