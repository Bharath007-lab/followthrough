import React, { useEffect, useState } from 'react';
import { Check, Copy, Loader2, Sparkles } from 'lucide-react';
import type { PersonDigest } from '../../shared/types';
import { api } from '../lib/api';

interface DigestsPageProps {
  refreshKey: number;
}

export function DigestsPage({ refreshKey }: DigestsPageProps) {
  const [digests, setDigests] = useState<PersonDigest[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [polishing, setPolishing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getDigests()
      .then((res) => {
        if (!cancelled) {
          setDigests(res.digests);
          if (res.digests.length > 0 && !selectedPerson) {
            setSelectedPerson(res.digests[0].person);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to build digests.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const activeDigest = digests.find((d) => d.person === selectedPerson) || digests[0] || null;

  const handleCopy = async () => {
    if (!activeDigest) return;
    await navigator.clipboard.writeText(activeDigest.emailPreview);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handlePolish = async () => {
    if (!activeDigest) return;
    setPolishing(true);
    setError(null);
    try {
      const res = await api.polishDigest(activeDigest.person);
      setDigests((prev) =>
        prev.map((d) => (d.person === activeDigest.person ? res.digest : d))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to polish digest via BluesMinds.');
    } finally {
      setPolishing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-slate-900">
          Personalized Weekly Digests
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Every factual commitment, deadline, decision, and conflict comes directly from database records.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-900">
          {error}
        </div>
      )}

      {loading ? (
        <div className="h-80 rounded-xl border border-slate-200 bg-white animate-pulse" />
      ) : digests.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center space-y-2">
          <div className="text-sm font-semibold text-slate-900">No people identified yet</div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Process a meeting transcript or run the Nova demo to generate per-person weekly digests
            for Priya, Raj, Meera, Arjun, and Sana.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Person selector */}
          <aside className="lg:col-span-3 rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 text-xs font-semibold text-slate-700">
              Team Members ({digests.length})
            </div>
            <div className="divide-y divide-slate-100">
              {digests.map((d) => {
                const selected = activeDigest?.person === d.person;
                return (
                  <button
                    key={d.person}
                    type="button"
                    onClick={() => setSelectedPerson(d.person)}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      selected ? 'bg-slate-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-sm font-medium text-slate-900">{d.person}</div>
                    <div className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                      {d.role ? `${d.role} · ` : ''}
                      {d.openCommitments.length} open · {d.overdueTasks.length} overdue
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Selected digest preview */}
          {activeDigest && (
            <div className="lg:col-span-9 space-y-4">
              <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">
                      {activeDigest.person}
                      {activeDigest.role ? ` — ${activeDigest.role}` : ''}
                    </h3>
                    <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                      {activeDigest.openCommitments.length} open commitments ·{' '}
                      {activeDigest.upcomingDeadlines.length} upcoming ·{' '}
                      {activeDigest.overdueTasks.length} overdue ·{' '}
                      {activeDigest.conflictsRequiringAttention.length} conflicts
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handlePolish}
                      disabled={polishing}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-45 whitespace-nowrap"
                    >
                      {polishing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>Polish Readability</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 text-white px-3.5 py-1.5 text-xs font-medium hover:bg-slate-800 whitespace-nowrap"
                    >
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copied' : 'Copy Email'}</span>
                    </button>
                  </div>
                </div>

                {/* Email-style preview */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-5">
                  <div className="text-[11px] font-mono text-slate-500 mb-3">
                    Email Preview (preview only — no automated email sent)
                    {activeDigest.polishedWithAI ? ' · Readability polished via BluesMinds' : ''}
                  </div>
                  <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800 leading-relaxed">
                    {activeDigest.emailPreview}
                  </pre>
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
