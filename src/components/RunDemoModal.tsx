import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Play, Settings, X } from 'lucide-react';
import { api, type DemoStreamEvent } from '../lib/api';

interface RunDemoModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  onNavigateSettings: () => void;
  onNavigateConflicts: () => void;
}

interface StageItem {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  message: string;
  details?: string[];
  modelUsed?: string;
}

const INITIAL_STAGES: StageItem[] = [
  {
    id: 'init',
    label: 'Reset demo workspace & Nova roster',
    status: 'pending',
    message: 'Waiting to start...',
  },
  {
    id: 'meeting_1',
    label: 'Meeting 1 — Nov 3, 2026 (Launch Kickoff)',
    status: 'pending',
    message: 'Quality gate, parsing, BluesMinds extraction, memory save',
  },
  {
    id: 'meeting_2',
    label: 'Meeting 2 — Nov 10, 2026 (Weekly Scope Sync)',
    status: 'pending',
    message: 'Extraction + cross-meeting conflict detection (launch, pricing, owner)',
  },
  {
    id: 'meeting_3',
    label: 'Meeting 3 — Nov 17, 2026 (Launch Readiness Review)',
    status: 'pending',
    message: 'Extraction + launch reversal detection & historical lineage update',
  },
];

export function RunDemoModal({
  open,
  onClose,
  onComplete,
  onNavigateSettings,
  onNavigateConflicts,
}: RunDemoModalProps) {
  const [stages, setStages] = useState<StageItem[]>(INITIAL_STAGES);
  const [running, setRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<DemoStreamEvent['summary'] | null>(null);

  const startDemo = async () => {
    setStages(INITIAL_STAGES);
    setErrorMessage(null);
    setSummary(null);
    setRunning(true);

    try {
      await api.runFullDemoStream((ev) => {
        if (ev.type === 'stage' && ev.stage) {
          setStages((prev) =>
            prev.map((s) =>
              s.id === ev.stage
                ? {
                    ...s,
                    status: ev.status === 'done' ? 'done' : 'running',
                    message: ev.message || s.message,
                    details: ev.details || s.details,
                    modelUsed: ev.modelUsed || s.modelUsed,
                  }
                : s
            )
          );
        } else if (ev.type === 'complete') {
          setSummary(ev.summary || null);
          onComplete();
        } else if (ev.type === 'error') {
          setErrorMessage(ev.error || 'Demo pipeline failed.');
          setStages((prev) =>
            prev.map((s) => (s.status === 'running' ? { ...s, status: 'failed' } : s))
          );
        }
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to connect to demo stream.');
      setStages((prev) =>
        prev.map((s) => (s.status === 'running' ? { ...s, status: 'failed' } : s))
      );
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (open) {
      startDemo();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-modal-title"
        className="w-full max-w-2xl rounded-xl bg-white border border-slate-200 shadow-lg overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 id="demo-modal-title" className="text-base font-semibold text-slate-900">
              Run Full Demo — Nova 3-Meeting Pipeline
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Executes the real parsing, quality gate, BluesMinds extraction, and conflict pipeline sequentially.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            aria-label="Close modal"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg bg-slate-50/40">
            {stages.map((stage) => (
              <div key={stage.id} className="p-4 flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  {stage.status === 'running' && (
                    <Loader2 className="w-4 h-4 text-[#1D4ED8] animate-spin" />
                  )}
                  {stage.status === 'done' && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                  )}
                  {stage.status === 'failed' && (
                    <AlertCircle className="w-4 h-4 text-red-700" />
                  )}
                  {stage.status === 'pending' && (
                    <div className="w-4 h-4 rounded-full border border-slate-300" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-slate-900">{stage.label}</div>
                    {stage.modelUsed && (
                      <span className="font-mono text-[11px] text-slate-500 truncate max-w-[180px]">
                        {stage.modelUsed}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">{stage.message}</p>
                  {stage.details && stage.details.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-slate-700">
                      {stage.details.map((d, idx) => (
                        <li key={idx} className="flex items-center gap-1.5">
                          <span className="text-emerald-700 font-semibold">✓</span>
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>

          {errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-900 space-y-2">
              <div className="font-semibold">Pipeline stopped with error</div>
              <p className="leading-relaxed break-words">{errorMessage}</p>
              <p className="text-red-800">
                Followthrough never fakes AI extraction. Configure{' '}
                <code className="font-mono">BLUESMINDS_API_KEY</code> and{' '}
                <code className="font-mono">BLUESMINDS_MODEL</code> in server Secrets, then verify
                connectivity in Settings.
              </p>
            </div>
          )}

          {summary && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-950">
              <div className="font-semibold">All 3 Nova meetings processed end-to-end</div>
              <div className="mt-1 font-mono tabular-nums">
                {summary.meetings} meetings · {summary.decisions} decisions · {summary.actionItems}{' '}
                commitments queued for human review · {summary.conflicts} cross-meeting conflicts
                detected
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <div>
            {errorMessage && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onNavigateSettings();
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1D4ED8] hover:underline whitespace-nowrap"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Open Integration Settings</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!running && (
              <button
                type="button"
                onClick={startDemo}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Retry Demo</span>
              </button>
            )}
            {summary ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onNavigateConflicts();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#1D4ED8] text-white px-4 py-2 text-xs font-medium hover:bg-[#1E40AF] whitespace-nowrap"
              >
                <span>Inspect Detected Conflicts</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                disabled={running}
                className="rounded-lg bg-slate-900 text-white px-4 py-2 text-xs font-medium hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
              >
                {running ? 'Running...' : 'Close'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
