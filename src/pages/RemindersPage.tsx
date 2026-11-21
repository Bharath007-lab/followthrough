import React, { useEffect, useState } from 'react';
import { Bell, Check, Loader2 } from 'lucide-react';
import type { ActionItemRecord, ReminderRecord } from '../../shared/types';
import { api } from '../lib/api';

interface RemindersPageProps {
  refreshKey: number;
  onDataMutated: () => void;
}

export function RemindersPage({ refreshKey, onDataMutated }: RemindersPageProps) {
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [buckets, setBuckets] = useState<{
    overdue: ActionItemRecord[];
    due_soon: ActionItemRecord[];
    upcoming: ActionItemRecord[];
    completed: ActionItemRecord[];
  }>({ overdue: [], due_soon: [], upcoming: [], completed: [] });
  const [cronConfigured, setCronConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .getReminders()
      .then((res) => {
        setReminders(res.reminders);
        setBuckets(res.buckets);
        setCronConfigured(res.cronConfigured);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load reminders.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  const handleSimulate = async () => {
    setSimulating(true);
    setError(null);
    setBanner(null);
    try {
      const res = await api.simulateReminders();
      setBanner(
        `${res.label}: generated ${res.created.length} reminder(s) (${res.summary.overdue} overdue, ${res.summary.due_soon} due soon, ${res.summary.upcoming} upcoming, ${res.summary.completed} completed).`
      );
      load();
      onDataMutated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed.');
    } finally {
      setSimulating(false);
    }
  };

  const handleMarkSeen = async (id: string, seen: boolean) => {
    try {
      await api.markReminderSeen(id, seen);
      setReminders((prev) => prev.map((r) => (r.id === id ? { ...r, seen } : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update reminder.');
    }
  };

  const bucketCards = [
    { key: 'overdue', title: 'Overdue', items: buckets.overdue, tone: 'text-red-700' },
    { key: 'due_soon', title: 'Due Soon (≤ 3 days)', items: buckets.due_soon, tone: 'text-amber-700' },
    { key: 'upcoming', title: 'Upcoming', items: buckets.upcoming, tone: 'text-slate-900' },
    { key: 'completed', title: 'Completed', items: buckets.completed, tone: 'text-emerald-700' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Reminders</h2>
          <p className="text-xs text-slate-500 mt-1">
            {cronConfigured
              ? 'Protected /api/cron/reminders endpoint enabled via CRON_SECRET. Manual simulation also available.'
              : 'Scheduled cron not configured — reminders are manually simulated in-app (email delivery is not enabled).'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleSimulate}
          disabled={simulating}
          className="inline-flex items-center gap-2 rounded-lg bg-[#1D4ED8] text-white px-4 py-2 text-xs font-medium hover:bg-[#1E40AF] disabled:opacity-45 whitespace-nowrap self-start sm:self-auto"
        >
          {simulating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Bell className="w-3.5 h-3.5" />
          )}
          <span>Simulate Reminders Now</span>
        </button>
      </div>

      {banner && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-950">
          {banner}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-900">
          {error}
        </div>
      )}

      {/* Deadline buckets */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {bucketCards.map((b) => (
          <section key={b.key} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className={`text-xs font-semibold ${b.tone}`}>{b.title}</h3>
              <span className="font-mono text-xs tabular-nums text-slate-500">
                {b.items.length}
              </span>
            </div>
            {loading ? (
              <div className="p-4 h-24 animate-pulse bg-slate-50/50" />
            ) : b.items.length === 0 ? (
              <div className="p-4 text-xs text-slate-400">No commitments</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {b.items.map((t) => (
                  <li key={t.id} className="p-3.5 text-xs space-y-1">
                    <div className="font-medium text-slate-900">{t.title}</div>
                    <div className="text-slate-500 font-mono tabular-nums">
                      {t.owner || 'Unassigned'} · {t.deadline || 'No date'}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {/* Generated Reminder Log */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Generated Reminder Feed ({reminders.length})
          </h3>
          <span className="text-xs text-slate-500">In-app feed (no outbound email sent)</span>
        </div>

        {reminders.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No reminders generated yet. Click <strong>Simulate Reminders Now</strong> to evaluate
            current commitments against today’s date.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {reminders.map((r) => (
              <div
                key={r.id}
                className={`px-5 py-3.5 flex items-center justify-between gap-4 text-xs ${
                  r.seen ? 'opacity-60' : ''
                }`}
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="text-slate-900 font-medium">{r.message}</div>
                  <div className="text-slate-500 font-mono text-[11px] tabular-nums">
                    {r.kind.replace(/_/g, ' ')} ·{' '}
                    {r.source === 'cron' ? 'Scheduled cron' : 'Manually simulated'} ·{' '}
                    {r.created_at.slice(0, 19).replace('T', ' ')} UTC
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleMarkSeen(r.id, !r.seen)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
                >
                  <Check className="w-3 h-3" />
                  <span>{r.seen ? 'Unread' : 'Acknowledge'}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
