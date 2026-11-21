import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Loader2,
  ShieldAlert,
  Upload,
  X,
} from 'lucide-react';
import type { QualityReport, SampleMeetingInfo, TranscriptTurn } from '../../shared/types';
import { api, ApiError } from '../lib/api';

interface IngestMeetingPanelProps {
  open: boolean;
  initialSampleKey?: string | null;
  onClose: () => void;
  onProcessed: (meetingId: string) => void;
  onNavigateSettings: () => void;
}

export function IngestMeetingPanel({
  open,
  initialSampleKey,
  onClose,
  onProcessed,
  onNavigateSettings,
}: IngestMeetingPanelProps) {
  const [samples, setSamples] = useState<SampleMeetingInfo[]>([]);
  const [title, setTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState('2026-11-21');
  const [attendeesInput, setAttendeesInput] = useState('');
  const [rawText, setRawText] = useState('');
  const [filename, setFilename] = useState<string | undefined>(undefined);
  const [fileSizeBytes, setFileSizeBytes] = useState<number | undefined>(undefined);
  const [isDemoSample, setIsDemoSample] = useState(false);

  const [preflightLoading, setPreflightLoading] = useState(false);
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);
  const [previewTurns, setPreviewTurns] = useState<TranscriptTurn[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api
      .getSamples()
      .then((res) => {
        setSamples(res.samples);
        if (initialSampleKey) {
          const found = res.samples.find((s) => s.key === initialSampleKey);
          if (found) applySample(found);
        }
      })
      .catch(() => {});
  }, [open, initialSampleKey]);

  const applySample = (sample: SampleMeetingInfo) => {
    setTitle(sample.title);
    setMeetingDate(sample.meeting_date);
    setAttendeesInput(sample.attendees.join(', '));
    setRawText(sample.transcript);
    setFilename(`${sample.key}.${sample.format}`);
    setFileSizeBytes(new Blob([sample.transcript]).size);
    setIsDemoSample(sample.category === 'nova_series');
    setSubmitError(null);
  };

  // Run deterministic preflight quality gate whenever transcript or date changes
  useEffect(() => {
    if (!open || !rawText.trim()) {
      setQualityReport(null);
      setPreviewTurns([]);
      return;
    }

    const handle = setTimeout(() => {
      setPreflightLoading(true);
      api
        .preflightTranscript({
          rawText,
          meetingDate,
          filename,
          fileSizeBytes,
        })
        .then((res) => {
          setQualityReport(res.qualityReport);
          setPreviewTurns(res.previewTurns);
        })
        .catch(() => {
          setQualityReport(null);
        })
        .finally(() => setPreflightLoading(false));
    }, 280);

    return () => clearTimeout(handle);
  }, [open, rawText, meetingDate, filename, fileSizeBytes]);

  const handleFileUpload = async (file: File | undefined) => {
    if (!file) return;
    setSubmitError(null);
    setFilename(file.name);
    setFileSizeBytes(file.size);
    setIsDemoSample(false);

    if (file.size > 1_048_576) {
      setSubmitError(
        `File "${file.name}" is ${(file.size / 1024 / 1024).toFixed(2)} MB, exceeding the 1 MB maximum.`
      );
      return;
    }

    const text = await file.text();
    setRawText(text);
    if (!title.trim()) {
      setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!title.trim()) {
      setSubmitError('Please enter a meeting title.');
      return;
    }
    if (!rawText.trim()) {
      setSubmitError('Please paste or upload a meeting transcript.');
      return;
    }

    setSubmitting(true);
    try {
      const attendees = attendeesInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await api.processMeeting({
        title: title.trim(),
        meetingDate,
        attendees,
        rawText,
        filename,
        fileSizeBytes,
        isDemo: isDemoSample,
      });

      onProcessed(res.meeting.id);
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(err.message);
      } else {
        setSubmitError(err instanceof Error ? err.message : 'Failed to process meeting.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const novaSamples = samples.filter((s) => s.category === 'nova_series');
  const edgeSamples = samples.filter((s) => s.category === 'edge_case');

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/45">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ingest-panel-title"
        className="w-full max-w-3xl bg-white h-full overflow-y-auto border-l border-slate-200 flex flex-col"
      >
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h2 id="ingest-panel-title" className="text-base font-semibold text-slate-900">
              Ingest & Process Meeting Transcript
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Supports pasted transcripts or .txt, .md, .vtt, .srt uploads (max 1 MB / 200,000 chars).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close ingestion panel"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 flex-1">
          {/* Quick sample loaders */}
          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-700">
              Load Nova Interconnected Sample Meetings
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {novaSamples.map((s, idx) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => applySample(s)}
                  className="text-left p-3 rounded-lg border border-slate-200 hover:border-[#1D4ED8] hover:bg-blue-50/30 transition-colors"
                >
                  <div className="text-xs font-semibold text-slate-900 truncate">
                    {idx + 1}. {s.meeting_date}
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5 line-clamp-2">{s.title}</div>
                </button>
              ))}
            </div>

            <div className="pt-1">
              <div className="text-xs font-medium text-slate-500 mb-2">
                Edge-case & QA test samples
              </div>
              <div className="flex flex-wrap gap-1.5">
                {edgeSamples.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => applySample(s)}
                    className="px-2.5 py-1.5 text-xs rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-400 hover:bg-white transition-colors whitespace-nowrap"
                  >
                    {s.title}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Metadata inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="meeting-title" className="block text-xs font-medium text-slate-700 mb-1">
                Meeting title
              </label>
              <input
                id="meeting-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Nova Weekly Execution Sync"
                required
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>
            <div>
              <label htmlFor="meeting-date" className="block text-xs font-medium text-slate-700 mb-1">
                Meeting date
              </label>
              <input
                id="meeting-date"
                type="date"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono tabular-nums text-slate-900 focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>
          </div>

          <div>
            <label htmlFor="meeting-attendees" className="block text-xs font-medium text-slate-700 mb-1">
              Attendees (comma-separated, optional)
            </label>
            <input
              id="meeting-attendees"
              type="text"
              value={attendeesInput}
              onChange={(e) => setAttendeesInput(e.target.value)}
              placeholder="Priya, Raj, Meera, Arjun, Sana"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
          </div>

          {/* File upload + transcript textarea */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="transcript-input" className="text-xs font-medium text-slate-700">
                Transcript content
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1D4ED8] hover:underline cursor-pointer whitespace-nowrap">
                <Upload className="w-3.5 h-3.5" />
                <span>Upload .txt / .md / .vtt / .srt</span>
                <input
                  type="file"
                  accept=".txt,.md,.vtt,.srt,text/plain,text/markdown,text/vtt"
                  className="sr-only"
                  onChange={(e) => handleFileUpload(e.target.files?.[0])}
                />
              </label>
            </div>
            <textarea
              id="transcript-input"
              rows={10}
              value={rawText}
              onChange={(e) => {
                setRawText(e.target.value);
                setFileSizeBytes(new Blob([e.target.value]).size);
                setIsDemoSample(false);
              }}
              placeholder={`[10:00:02] Priya: Let us confirm the December 1 launch date.\n[10:00:18] Raj: I will finish the backend API by November 20.`}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-mono leading-relaxed text-slate-900 focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
              <span>{filename ? `Source: ${filename}` : 'Pasted transcript'}</span>
              <span>{rawText.length.toLocaleString()} / 200,000 chars</span>
            </div>
          </div>

          {/* Live deterministic Quality Gate report */}
          {(preflightLoading || qualityReport) && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  {preflightLoading ? (
                    <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
                  ) : qualityReport?.status === 'pass' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                  ) : qualityReport?.status === 'warning' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-700" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-red-700" />
                  )}
                  <span className="text-xs font-semibold text-slate-900">
                    Deterministic Quality Gate:{' '}
                    {preflightLoading
                      ? 'Checking...'
                      : qualityReport?.status === 'pass'
                        ? 'Pass'
                        : qualityReport?.status === 'warning'
                          ? 'Pass with Warnings'
                          : 'Blocked'}
                  </span>
                </div>
                {qualityReport && (
                  <div className="text-xs font-mono tabular-nums text-slate-600">
                    Score {qualityReport.score}/100 · {qualityReport.turnCount} turns ·{' '}
                    {qualityReport.wordCount} words · {qualityReport.speakers.length} speakers
                  </div>
                )}
              </div>

              {qualityReport && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                  {qualityReport.checks.map((chk) => (
                    <div
                      key={chk.id}
                      className="flex items-start gap-2 py-1 text-slate-700"
                    >
                      <span
                        className={`font-mono text-[11px] uppercase shrink-0 mt-0.5 ${
                          chk.status === 'pass'
                            ? 'text-emerald-700'
                            : chk.status === 'warning'
                              ? 'text-amber-700'
                              : 'text-red-700 font-semibold'
                        }`}
                      >
                        {chk.status}
                      </span>
                      <span className="min-w-0">
                        <strong className="font-medium text-slate-900">{chk.label}:</strong>{' '}
                        {chk.detail}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {previewTurns.length > 0 && (
                <details className="pt-2 border-t border-slate-200">
                  <summary className="text-xs font-medium text-slate-700 cursor-pointer hover:text-slate-900">
                    Preview parsed turns ({previewTurns.length} shown)
                  </summary>
                  <div className="mt-2 max-h-36 overflow-y-auto space-y-1 text-xs font-mono text-slate-600">
                    {previewTurns.map((t) => (
                      <div key={t.index} className="truncate">
                        <span className="text-slate-400">#{t.index + 1}</span>{' '}
                        {t.timestamp && <span className="text-slate-400">[{t.timestamp}]</span>}{' '}
                        <span className="text-slate-900 font-medium">
                          {t.speaker || 'Unknown'}:
                        </span>{' '}
                        {t.text}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {submitError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-900 space-y-1.5">
              <div className="font-semibold">Unable to process meeting</div>
              <p>{submitError}</p>
              {submitError.toLowerCase().includes('bluesminds') && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNavigateSettings();
                  }}
                  className="text-[#1D4ED8] font-medium hover:underline"
                >
                  Verify BluesMinds API configuration in Settings
                </button>
              )}
            </div>
          )}

          <div className="sticky bottom-0 bg-white pt-4 pb-2 border-t border-slate-200 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              All extracted tasks enter Proposed status and require explicit human approval.
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || qualityReport?.status === 'block'}
                className="inline-flex items-center gap-2 rounded-lg bg-[#1D4ED8] text-white px-4 py-2 text-xs font-medium hover:bg-[#1E40AF] disabled:opacity-45 whitespace-nowrap"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Extracting via BluesMinds...</span>
                  </>
                ) : (
                  <>
                    <FileUp className="w-3.5 h-3.5" />
                    <span>Process Meeting</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
