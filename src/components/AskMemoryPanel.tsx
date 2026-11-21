import React, { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import type { MemoryAnswer } from '../../shared/types';
import { api } from '../lib/api';

const SUGGESTED_QUESTIONS = [
  'What is our current launch date?',
  'Who owns the backend API?',
  'When did pricing change?',
  'What changed between meetings?',
  'Which tasks are overdue?',
];

export function AskMemoryPanel() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<(MemoryAnswer & { modelUsed: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runQuery = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuestion(trimmed);
    setLoading(true);
    setError(null);
    try {
      const res = await api.askMemory(trimmed);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to query organizational memory.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Ask Organizational Memory</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Answers are strictly grounded in recorded meetings and cite exact dates and quotes.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          runQuery(question);
        }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about decisions, owners, pricing, or timeline changes..."
            className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          />
        </div>
        <button
          type="submit"
          disabled={loading || question.trim().length < 3}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 text-white px-4 py-2 text-xs font-medium hover:bg-slate-800 disabled:opacity-45 whitespace-nowrap shrink-0"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          <span>Ask Memory</span>
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => runQuery(q)}
            className="text-xs text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md px-2.5 py-1 transition-colors whitespace-nowrap"
          >
            {q}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 space-y-3">
          <div className="text-sm text-slate-900 leading-relaxed">{result.answer}</div>
          {result.citations.length > 0 && (
            <div className="pt-2 border-t border-slate-200 space-y-2">
              <div className="text-xs font-medium text-slate-500">Supporting Citations</div>
              {result.citations.map((c, idx) => (
                <div key={idx} className="text-xs text-slate-700 space-y-0.5">
                  <div className="font-mono text-[11px] text-slate-500">
                    {c.meeting_date} · {c.meeting_title}
                    {c.speaker ? ` · ${c.speaker}` : ''}
                  </div>
                  <div className="italic text-slate-800">“{c.quote}”</div>
                </div>
              ))}
            </div>
          )}
          {result.modelUsed && result.modelUsed !== 'none' && (
            <div className="text-[11px] font-mono text-slate-400">
              Model: {result.modelUsed}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
