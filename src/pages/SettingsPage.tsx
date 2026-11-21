import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import type {
  AuditLogRecord,
  BluesMindsVerificationResult,
  DiscoveredModel,
  IntegrationStatus,
  LLMCallLog,
} from '../../shared/types';
import { api } from '../lib/api';

interface SettingsPageProps {
  refreshKey: number;
  onStatusUpdated: (status: IntegrationStatus) => void;
  onResetDemo: () => Promise<void>;
}

export function SettingsPage({
  refreshKey,
  onStatusUpdated,
  onResetDemo,
}: SettingsPageProps) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [llmLogs, setLlmLogs] = useState<LLMCallLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [discovering, setDiscovering] = useState(false);
  const [models, setModels] = useState<DiscoveredModel[]>([]);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<BluesMindsVerificationResult | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<string | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const [statusRes, auditRes] = await Promise.all([api.getStatus(), api.getAuditLogs()]);
      setStatus(statusRes.status);
      setLlmLogs(statusRes.llmLogs);
      setVerification(statusRes.status.bluesminds.lastVerification);
      setSelectedModel(statusRes.status.bluesminds.model || '');
      setAuditLogs(auditRes.logs);
      onStatusUpdated(statusRes.status);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, [refreshKey]);

  const handleDiscoverModels = async () => {
    setDiscovering(true);
    setDiscoveryError(null);
    try {
      const res = await api.discoverModels();
      setModels(res.models);
      if (!selectedModel && res.recommendedModel) {
        setSelectedModel(res.recommendedModel);
      }
    } catch (err) {
      setDiscoveryError(err instanceof Error ? err.message : 'Model discovery failed.');
      setModels([]);
    } finally {
      setDiscovering(false);
    }
  };

  const handleSelectModel = async (modelId: string) => {
    setSelectedModel(modelId);
    try {
      await api.selectBluesMindsModel(modelId);
      await loadStatus();
    } catch (err) {
      setDiscoveryError(err instanceof Error ? err.message : 'Unable to select model.');
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const result = await api.verifyBluesMinds(selectedModel || undefined);
      setVerification(result);
      await loadStatus();
    } catch (err) {
      setDiscoveryError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  const handleResetDemo = async () => {
    setResetting(true);
    setResetFeedback(null);
    try {
      await onResetDemo();
      setResetFeedback(
        'Demo workspace records (Nova) have been safely cleared. Non-demo user records remain protected.'
      );
      await loadStatus();
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">
            Settings & Integration Diagnostics
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            All API keys and database secrets are read strictly server-side from environment variables. No secrets are ever exposed or entered in the browser.
          </p>
        </div>
        <button
          type="button"
          onClick={loadStatus}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Status</span>
        </button>
      </div>

      {/* Integration Status Grid */}
      {status && (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1.5">
            <div className="text-xs font-semibold text-slate-900">BluesMinds LLM Gateway</div>
            <div
              className={`text-xs font-medium ${
                status.bluesminds.configured ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {status.bluesminds.configured ? 'API Key Configured' : 'Missing BLUESMINDS_API_KEY'}
            </div>
            <div className="text-[11px] font-mono text-slate-500 truncate">
              {status.bluesminds.baseUrl}
            </div>
            <div className="text-[11px] font-mono text-slate-600 truncate">
              Model: {status.bluesminds.model || 'Not set'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1.5">
            <div className="text-xs font-semibold text-slate-900">Supabase PostgreSQL</div>
            <div
              className={`text-xs font-medium ${
                status.supabase.connected ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {status.supabase.connected
                ? 'Connected (PostgreSQL)'
                : status.supabase.configured
                  ? 'Configured — Schema Check Needed'
                  : 'Local Server Fallback'}
            </div>
            <div className="text-[11px] text-slate-500">
              {status.supabase.connected
                ? 'Persistent organizational memory active.'
                : 'Set SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY and apply supabase/schema.sql.'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1.5">
            <div className="text-xs font-semibold text-slate-900">GitHub Issues Tracker</div>
            <div
              className={`text-xs font-medium ${
                status.github.configured ? 'text-emerald-700' : 'text-slate-600'
              }`}
            >
              {status.github.configured ? 'Configured' : 'Optional — Internal Board Active'}
            </div>
            <div className="text-[11px] font-mono text-slate-500 truncate">
              {status.github.repo || 'Set GITHUB_TOKEN & GITHUB_REPO'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1.5">
            <div className="text-xs font-semibold text-slate-900">Scheduled Reminders</div>
            <div
              className={`text-xs font-medium ${
                status.cron.configured ? 'text-emerald-700' : 'text-slate-600'
              }`}
            >
              {status.cron.configured ? 'CRON_SECRET Active' : 'Manual Simulation Only'}
            </div>
            <div className="text-[11px] font-mono text-slate-500">
              POST /api/cron/reminders
            </div>
          </div>
        </section>
      )}

      {/* BluesMinds Model Discovery & 5-Step API Verification */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              BluesMinds Model Discovery & 5-Step Verification
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Queries GET /v1/models on your BluesMinds account and runs a real Zod-validated JSON prompt test.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDiscoverModels}
              disabled={discovering}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-45 whitespace-nowrap"
            >
              {discovering ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              <span>Discover Models</span>
            </button>
            <button
              type="button"
              onClick={handleVerify}
              disabled={verifying}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1D4ED8] text-white px-4 py-2 text-xs font-medium hover:bg-[#1E40AF] disabled:opacity-45 whitespace-nowrap"
            >
              {verifying ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" />
              )}
              <span>Run 5-Step Verification</span>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {discoveryError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-900">
              {discoveryError}
            </div>
          )}

          {/* Discovered Models Table */}
          {models.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-700">
                Accessible Models on Your BluesMinds Account ({models.length})
              </div>
              <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                {models.map((m) => (
                  <div
                    key={m.id}
                    className="px-4 py-2.5 flex items-center justify-between gap-4 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-medium text-slate-900 truncate">
                        {m.id}{' '}
                        {m.recommended && (
                          <span className="font-sans text-emerald-700 font-semibold">
                            · Recommended
                          </span>
                        )}
                      </div>
                      <div className="text-slate-500 mt-0.5">{m.notes}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectModel(m.id)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                        selectedModel === m.id
                          ? 'bg-slate-900 text-white'
                          : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {selectedModel === m.id ? 'Selected' : 'Use Model'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 5-Step Verification Result */}
          {verification ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  {verification.verified ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                      <span className="text-emerald-800">
                        Verified — Model {verification.actualModelUsed}
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4 text-red-700" />
                      <span className="text-red-800">Verification Failed</span>
                    </>
                  )}
                </div>
                <div className="font-mono text-[11px] tabular-nums text-slate-500">
                  {verification.latencyMs !== null ? `${verification.latencyMs}ms · ` : ''}
                  {verification.timestamp.slice(0, 19).replace('T', ' ')} UTC
                </div>
              </div>

              <div className="divide-y divide-slate-200/70">
                {verification.steps.map((s) => (
                  <div key={s.step} className="py-2 flex items-start justify-between gap-4 text-xs">
                    <div>
                      <span className="font-medium text-slate-900">
                        {s.step}. {s.name}
                      </span>
                      <div className="text-slate-600 mt-0.5">{s.detail}</div>
                    </div>
                    <span
                      className={`font-mono uppercase shrink-0 ${
                        s.status === 'pass'
                          ? 'text-emerald-700'
                          : s.status === 'fail'
                            ? 'text-red-700 font-semibold'
                            : 'text-slate-400'
                      }`}
                    >
                      {s.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-500">
              No live verification run yet in this server session. Click{' '}
              <strong>Run 5-Step Verification</strong> after setting{' '}
              <code className="font-mono">BLUESMINDS_API_KEY</code> in AI Studio Secrets.
            </div>
          )}
        </div>
      </section>

      {/* Safe Demo Workspace Reset */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-slate-900">Demo Workspace Controls</h3>
          <p className="text-xs text-slate-500">
            Resets only sample organization records (Nova, <code className="font-mono">is_demo = true</code>). Non-demo user meetings and decisions are protected.
          </p>
          {resetFeedback && (
            <p className="text-xs text-emerald-800 font-medium pt-1">{resetFeedback}</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleResetDemo}
          disabled={resetting}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-45 whitespace-nowrap shrink-0 self-start sm:self-center"
        >
          {resetting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RotateCcw className="w-3.5 h-3.5" />
          )}
          <span>Reset Demo Data</span>
        </button>
      </section>

      {/* Recent LLM Call Metadata Log & Governance Audit Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              BluesMinds Request Log ({llmLogs.length})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Tracks model, latency, status, and tokens only. Never logs API keys or transcripts.
            </p>
          </div>
          {llmLogs.length === 0 ? (
            <div className="p-5 text-xs text-slate-500">No BluesMinds API calls made yet.</div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {llmLogs.map((log) => (
                <div key={log.id} className="px-5 py-3 text-xs space-y-0.5">
                  <div className="flex items-center justify-between font-mono">
                    <span className="font-medium text-slate-900">{log.operation}</span>
                    <span
                      className={log.status === 'success' ? 'text-emerald-700' : 'text-red-700'}
                    >
                      {log.status} · {log.latencyMs}ms
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                    {log.model} · tokens: {log.totalTokens ?? 'n/a'}
                    {log.repairAttempted ? ' · JSON repair retry' : ''}
                  </div>
                  {log.errorMessage && (
                    <div className="text-red-700 truncate">{log.errorMessage}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Governance Audit Log ({auditLogs.length})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Immutable record of meeting processing, conflict resolutions, approvals, and resets.
            </p>
          </div>
          {auditLogs.length === 0 ? (
            <div className="p-5 text-xs text-slate-500">No audit events recorded yet.</div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {auditLogs.map((ev) => (
                <div key={ev.id} className="px-5 py-3 text-xs space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-medium text-slate-900">{ev.event}</span>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {ev.created_at.slice(0, 19).replace('T', ' ')}
                    </span>
                  </div>
                  <div className="text-slate-500 truncate">
                    Actor: {ev.actor} · {JSON.stringify(ev.payload)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
