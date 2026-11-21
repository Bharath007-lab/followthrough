import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  FilePlus,
  Loader2,
  Play,
  RotateCcw,
} from 'lucide-react';
import type { IntegrationStatus } from '../../shared/types';
import { AskMemoryPanel } from '../components/AskMemoryPanel';
import { api, type DashboardPayload } from '../lib/api';

interface OverviewPageProps {
  refreshKey: number;
  integrationStatus: IntegrationStatus | null;
  navigate: (path: string) => void;
  onOpenIngest: (sampleKey?: string) => void;
  onRunFullDemo: () => void;
  onResetDemo: () => Promise<void>;
}

export function OverviewPage({
  refreshKey,
  integrationStatus,
  navigate,
  onOpenIngest,
  onRunFullDemo,
  onResetDemo,
}: OverviewPageProps) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getDashboard()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const handleReset = async () => {
    setResetting(true);
    try {
      await onResetDemo();
    } finally {
      setResetting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="h-44 rounded-xl border border-slate-200 bg-white animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl border border-slate-200 bg-white animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <div className="font-semibold">Unable to load Overview</div>
        <p className="mt-1 text-xs">{error}</p>
      </div>
    );
  }

  const metrics = data?.metrics;
  const kpis = [
    { label: 'Meetings processed', value: metrics?.meetingsProcessed ?? 0, path: '/meetings' },
    { label: 'Active decisions', value: metrics?.activeDecisions ?? 0, path: '/decisions' },
    { label: 'Pending approvals', value: metrics?.pendingApprovals ?? 0, path: '/review' },
    { label: 'Open tasks', value: metrics?.openTasks ?? 0, path: '/tasks' },
    {
      label: 'Overdue tasks',
      value: metrics?.overdueTasks ?? 0,
      path: '/reminders',
      tone: (metrics?.overdueTasks ?? 0) > 0 ? 'text-red-700' : 'text-slate-900',
    },
    {
      label: 'Unresolved conflicts',
      value: metrics?.unresolvedConflicts ?? 0,
      path: '/conflicts',
      tone: (metrics?.unresolvedConflicts ?? 0) > 0 ? 'text-amber-700' : 'text-slate-900',
    },
  ];

  const bluesmindsReady = Boolean(
    integrationStatus?.bluesminds.configured && integrationStatus?.bluesminds.model
  );

  return (
    <div className="space-y-6">
      {/* Public judge welcome & demonstration hero */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 lg:p-7 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
          <div className="space-y-2 max-w-2xl">
            <div className="text-xs font-medium text-slate-500">
              Demo Workspace — Sample Organization: Nova · Shared Judge Environment
            </div>
            <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900">
              Meetings end. Commitments shouldn’t.
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Followthrough maintains persistent organizational memory across meetings, detects
              decision contradictions and reversals with verbatim evidence, and requires human
              approval before turning commitments into tracked work.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onRunFullDemo}
              className="inline-flex items-center gap-2 rounded-lg bg-[#1D4ED8] text-white px-4 py-2.5 text-xs font-medium hover:bg-[#1E40AF] transition-colors whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Run Full Demo</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenIngest()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white text-slate-800 px-4 py-2.5 text-xs font-medium hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <FilePlus className="w-3.5 h-3.5" />
              <span>Process Meeting</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenIngest('nova_meeting_1')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 px-3.5 py-2.5 text-xs font-medium hover:bg-slate-100 transition-colors whitespace-nowrap"
            >
              <span>Load Sample Meeting</span>
            </button>
            {data?.hasDemoData && (
              <button
                type="button"
                onClick={handleReset}
                disabled={resetting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 px-3 py-2.5 text-xs font-medium hover:text-red-700 hover:border-red-200 transition-colors whitespace-nowrap disabled:opacity-50"
              >
                {resetting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
                <span>Reset Demo</span>
              </button>
            )}
          </div>
        </div>

        {/* Honest integration configuration banner when secrets are missing */}
        {integrationStatus && (!bluesmindsReady || !integrationStatus.supabase.connected) && (
          <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
            <div className="text-slate-700 space-y-1">
              {!bluesmindsReady && (
                <div>
                  <span className="font-semibold text-amber-800">BluesMinds API not configured:</span>{' '}
                  Set <code className="font-mono">BLUESMINDS_API_KEY</code> and{' '}
                  <code className="font-mono">BLUESMINDS_MODEL</code> in server Secrets to enable AI
                  extraction and Run Full Demo.
                </div>
              )}
              {!integrationStatus.supabase.connected && (
                <div>
                  <span className="font-semibold text-slate-900">Storage notice:</span>{' '}
                  {integrationStatus.supabase.error ||
                    'Using local server fallback until SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are configured.'}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="text-[#1D4ED8] font-medium hover:underline whitespace-nowrap shrink-0 self-start sm:self-center"
            >
              Configure & Verify in Settings
            </button>
          </div>
        )}
      </section>

      {/* Real Database Metrics Strip */}
      <section aria-label="Workspace metrics" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((kpi) => (
          <button
            key={kpi.label}
            type="button"
            onClick={() => navigate(kpi.path)}
            className="text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <div className="text-xs text-slate-500 truncate">{kpi.label}</div>
            <div
              className={`mt-2 text-2xl font-bold font-mono tabular-nums ${kpi.tone || 'text-slate-900'}`}
            >
              {kpi.value}
            </div>
          </button>
        ))}
      </section>

      {/* Two-column operational breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Open Conflicts & Pending Approvals */}
        <div className="lg:col-span-7 space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Unresolved Cross-Meeting Conflicts
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Contradictions, deadline shifts, pricing edits, and ownership reassignments awaiting confirmation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/conflicts')}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#1D4ED8] hover:underline whitespace-nowrap shrink-0"
              >
                <span>View all</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {!data || data.openConflicts.length === 0 ? (
              <div className="p-6 text-xs text-slate-500 space-y-2">
                <p>No unresolved cross-meeting conflicts right now.</p>
                <p>
                  Process Meeting 1, 2, and 3 sequentially (or click <strong>Run Full Demo</strong>)
                  to observe launch date, pricing, and API ownership conflicts across meetings.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.openConflicts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => navigate('/conflicts')}
                    className="w-full text-left px-5 py-4 hover:bg-slate-50/70 transition-colors block"
                  >
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-medium text-amber-800 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>{c.type.replace(/_/g, ' ')}</span>
                        <span className="text-slate-300" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-slate-600">{c.severity} severity</span>
                      </span>
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                        {c.old_decision?.meeting_date || ''} → {c.new_decision?.meeting_date || ''}
                      </span>
                    </div>
                    <p className="text-sm text-slate-900 mt-1.5 font-medium">{c.reason}</p>
                    <div className="mt-1 text-xs text-slate-500 truncate">
                      Topic: {c.new_decision?.topic || c.old_decision?.topic || 'Decision'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Commitments Awaiting Human Approval
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  No external or board tasks are finalized without explicit human confirmation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/review')}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#1D4ED8] hover:underline whitespace-nowrap shrink-0"
              >
                <span>Review queue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {!data || data.pendingTasks.length === 0 ? (
              <div className="p-6 text-xs text-slate-500">
                No proposed tasks awaiting review. Process a meeting transcript to extract proposed
                commitments.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.pendingTasks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => navigate('/review')}
                    className="w-full text-left px-5 py-3.5 hover:bg-slate-50/70 transition-colors flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{t.title}</div>
                      <div className="text-xs text-slate-500 mt-0.5 truncate">
                        <span>{t.owner || 'Unassigned'}</span>
                        <span aria-hidden="true"> · </span>
                        <span className="font-mono tabular-nums">
                          {t.deadline || 'No deadline'}
                        </span>
                        <span aria-hidden="true"> · </span>
                        <span>{t.priority} priority</span>
                        {t.flags.length > 0 && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="text-amber-700">{t.flags.length} flag(s)</span>
                          </>
                        )}
                      </div>
                    </div>
                    <span className="text-xs font-medium text-[#1D4ED8] shrink-0">Review</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right: Recent Meetings & Ask Organizational Memory */}
        <div className="lg:col-span-5 space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <h2 className="text-sm font-semibold text-slate-900">Recent Meetings</h2>
              <button
                type="button"
                onClick={() => navigate('/meetings')}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#1D4ED8] hover:underline whitespace-nowrap shrink-0"
              >
                <span>All meetings</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {!data || data.recentMeetings.length === 0 ? (
              <div className="p-6 text-xs text-slate-500 space-y-3">
                <p>No meetings processed yet in this workspace.</p>
                <button
                  type="button"
                  onClick={() => onOpenIngest('nova_meeting_1')}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Open Sample Meeting 1
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.recentMeetings.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => navigate(`/meetings/${m.id}`)}
                    className="w-full text-left px-5 py-3.5 hover:bg-slate-50/70 transition-colors block"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-900 truncate">{m.title}</span>
                      <span className="text-xs font-mono tabular-nums text-slate-500 shrink-0">
                        {m.meeting_date}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      <span>{m.attendees.length} attendees</span>
                      <span aria-hidden="true"> · </span>
                      <span className="font-mono tabular-nums">
                        Quality {m.quality_report?.score ?? 100}/100
                      </span>
                      <span aria-hidden="true"> · </span>
                      <span>{m.is_demo ? 'Demo' : 'Custom'}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <AskMemoryPanel />
        </div>
      </div>
    </div>
  );
}
