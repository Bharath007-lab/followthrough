import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { NOVA_MEETING_1, NOVA_MEETING_2, NOVA_MEETING_3, EDGE_CASE_SAMPLES } from '../server/data/sampleMeetings.ts';
import { retrieveConflictCandidates } from '../server/lib/conflicts.ts';
import { classifyDeadlineUrgency, resolveDeadlinePhrase } from '../server/lib/dates.ts';
import { LocalFallbackRepository } from '../server/lib/db.ts';
import { computeTextJaccard, evaluateCommitmentQualityFlags, verifyEvidenceAgainstTurns } from '../server/lib/evidence.ts';
import { buildGitHubIssuePayload, createGitHubIssueIdempotent } from '../server/lib/github.ts';
import { parseTranscript } from '../server/lib/parser.ts';
import { resolveConflictDecision } from '../server/lib/pipeline.ts';
import { runQualityGate } from '../server/lib/qualityGate.ts';

describe('Followthrough Deterministic Engine & Workflow Suite', () => {
  it('parses TXT transcript with bracketed timestamps and speaker labels', () => {
    const parsed = parseTranscript(NOVA_MEETING_1.transcript, 'kickoff.txt');
    assert.equal(parsed.format, 'txt');
    assert.ok(parsed.turns.length >= 45);
    assert.deepEqual(parsed.speakers.sort(), ['Arjun', 'Meera', 'Priya', 'Raj', 'Sana']);
    assert.equal(parsed.speakerCoverage, 1);
    assert.equal(parsed.turns[0].timestamp, '10:00:02');
    assert.equal(parsed.turns[0].speaker, 'Priya');
  });

  it('parses Markdown transcript, strips formatting noise, and collapses consecutive duplicates', () => {
    const messy = EDGE_CASE_SAMPLES.find((s) => s.key === 'edge_messy')!;
    const parsed = parseTranscript(messy.transcript, 'notes.md');
    assert.equal(parsed.format, 'md');
    assert.equal(parsed.turns.length, 4);
    assert.deepEqual(parsed.speakers.sort(), ['Raj', 'Sana']);
    assert.ok(!parsed.turns.some((t) => t.text.includes('<b>')));
  });

  it('parses WebVTT transcript with WEBVTT header, NOTE block, timestamps, and <v> tags', () => {
    const vtt = EDGE_CASE_SAMPLES.find((s) => s.key === 'edge_vtt')!;
    const parsed = parseTranscript(vtt.transcript, 'capture.vtt');
    assert.equal(parsed.format, 'vtt');
    assert.equal(parsed.turns.length, 4);
    assert.equal(parsed.turns[0].speaker, 'Priya');
    assert.equal(parsed.turns[0].timestamp, '00:00:01.000');
    assert.deepEqual(parsed.speakers.sort(), ['Meera', 'Priya', 'Sana']);
  });

  it('parses SRT subtitle transcript and strips cue numbers', () => {
    const srt = `1
00:10:30,000 --> 00:10:34,000
Meera: I will complete the onboarding design.

2
00:10:35,000 --> 00:10:39,500
Raj: The API will be ready by November 20.`;
    const parsed = parseTranscript(srt, 'sync.srt');
    assert.equal(parsed.format, 'srt');
    assert.equal(parsed.turns.length, 2);
    assert.equal(parsed.turns[0].speaker, 'Meera');
    assert.equal(parsed.turns[0].timestamp, '00:10:30.000');
    assert.equal(parsed.turns[1].speaker, 'Raj');
  });

  it('resolves explicit and relative deadlines deterministically against meeting date', () => {
    assert.equal(resolveDeadlinePhrase('by November 20', '2026-11-03'), '2026-11-20');
    assert.equal(resolveDeadlinePhrase('December 1', '2026-11-03'), '2026-12-01');
    assert.equal(resolveDeadlinePhrase('tomorrow', '2026-11-17'), '2026-11-18');
    assert.equal(resolveDeadlinePhrase('in 2 days', '2026-11-17'), '2026-11-19');
    assert.equal(resolveDeadlinePhrase('in 4 days', '2026-11-17'), '2026-11-21');
    assert.equal(resolveDeadlinePhrase('by this Friday', '2026-11-17'), '2026-11-20');
    assert.equal(resolveDeadlinePhrase('by next Tuesday', '2026-11-17'), '2026-11-24');
    // Vague phrases must NEVER invent a deadline
    assert.equal(resolveDeadlinePhrase('sometime soon', '2026-11-10'), null);
    assert.equal(classifyDeadlineUrgency('2026-11-10', 'approved', '2026-11-17'), 'overdue');
    assert.equal(classifyDeadlineUrgency('2026-11-19', 'approved', '2026-11-17'), 'due_soon');
  });

  it('enforces quality gate blocks (empty, invalid extension, duplicate) and warnings (unlabelled, prompt injection)', () => {
    const emptyParsed = parseTranscript('');
    const emptyReport = runQualityGate({
      rawText: '',
      parsed: emptyParsed,
      meetingDate: '2026-11-18',
    });
    assert.equal(emptyReport.status, 'block');

    const badExtParsed = parseTranscript(NOVA_MEETING_1.transcript, 'audio.mp3');
    const badExtReport = runQualityGate({
      rawText: NOVA_MEETING_1.transcript,
      parsed: badExtParsed,
      meetingDate: '2026-11-03',
      filename: 'audio.mp3',
    });
    assert.equal(badExtReport.status, 'block');

    const dupReport = runQualityGate({
      rawText: NOVA_MEETING_1.transcript,
      parsed: parseTranscript(NOVA_MEETING_1.transcript),
      meetingDate: '2026-11-03',
      isDuplicate: true,
    });
    assert.equal(dupReport.status, 'block');

    const unlabelled = EDGE_CASE_SAMPLES.find((s) => s.key === 'edge_unlabelled')!;
    const unlabelledReport = runQualityGate({
      rawText: unlabelled.transcript,
      parsed: parseTranscript(unlabelled.transcript),
      meetingDate: unlabelled.meeting_date,
    });
    assert.equal(unlabelledReport.status, 'warning');
    assert.equal(unlabelledReport.speakers.length, 0);

    const injection = EDGE_CASE_SAMPLES.find((s) => s.key === 'edge_prompt_injection')!;
    const injReport = runQualityGate({
      rawText: injection.transcript,
      parsed: parseTranscript(injection.transcript),
      meetingDate: injection.meeting_date,
    });
    assert.equal(injReport.status, 'warning');
    assert.ok(injReport.injectionSignals.length >= 1);
  });

  it('verifies verbatim quotes against transcript turns and flags fabricated evidence + vague tasks', () => {
    const parsed = parseTranscript(NOVA_MEETING_1.transcript);
    const verified = verifyEvidenceAgainstTurns(
      {
        quote: 'the product will launch on December 1, 2026',
        speaker: 'Priya',
        turn_index: 0, // intentionally wrong index to verify turn matching
      },
      parsed.turns
    );
    assert.equal(verified.verified, true);
    assert.equal(verified.similarity, 1);
    assert.equal(verified.speaker, 'Priya');
    assert.ok(verified.turn_index > 0);

    const unverified = verifyEvidenceAgainstTurns(
      {
        quote: 'We decided to launch on Mars next summer with zero budget',
        speaker: 'Priya',
        turn_index: 0,
      },
      parsed.turns
    );
    assert.equal(unverified.verified, false);
    assert.ok((unverified.similarity || 0) < 0.85);

    const flags = evaluateCommitmentQualityFlags({
      title: 'Look into analytics sometime',
      description: 'Someone should probably look into funnel telemetry',
      owner: null,
      ownerSource: 'unassigned',
      deadline: null,
      confidence: 0.62,
      evidence: unverified,
    });
    assert.ok(flags.includes('missing_owner'));
    assert.ok(flags.includes('missing_deadline'));
    assert.ok(flags.includes('vague_commitment'));
    assert.ok(flags.includes('unverified_evidence'));
    assert.ok(flags.includes('low_confidence'));
    assert.ok(computeTextJaccard('Complete onboarding design', 'Complete the onboarding design') >= 0.65);
  });

  it('golden organizational memory workflow: Nova Meetings 1 -> 2 -> 3 lineage, conflict resolution, human approval, and safe demo reset', async () => {
    const tmpFile = path.join(os.tmpdir(), `followthrough-test-${Date.now()}.json`);
    const repo = new LocalFallbackRepository(tmpFile);

    try {
      // Non-demo user meeting that MUST survive demo reset
      const nonDemoMeeting = await repo.insertMeeting({
        title: 'Internal Security Architecture Review',
        meeting_date: '2026-11-01',
        attendees: ['Alex'],
        source_hash: 'non-demo-hash-001',
        raw_text: 'Alex: Keep private records intact.',
        quality_report: runQualityGate({
          rawText: 'Alex: Keep private records intact across all environments and resets.',
          parsed: parseTranscript('Alex: Keep private records intact across all environments and resets.'),
          meetingDate: '2026-11-01',
        }),
        open_questions: [],
        risks: [],
        health_score: 95,
        is_demo: false,
      });

      // Meeting 1: Dec 1 launch, $19/mo, Raj owns API
      const p1 = parseTranscript(NOVA_MEETING_1.transcript);
      const m1 = await repo.insertMeeting({
        title: NOVA_MEETING_1.title,
        meeting_date: NOVA_MEETING_1.meeting_date,
        attendees: NOVA_MEETING_1.attendees,
        source_hash: p1.sourceHash,
        raw_text: NOVA_MEETING_1.transcript,
        quality_report: runQualityGate({ rawText: NOVA_MEETING_1.transcript, parsed: p1, meetingDate: NOVA_MEETING_1.meeting_date }),
        open_questions: [],
        risks: [],
        health_score: 96,
        is_demo: true,
      });
      const [d1Launch, d1Price, d1Api] = await repo.insertDecisions([
        {
          meeting_id: m1.id,
          topic: 'Product launch date',
          statement: 'Product will launch on December 1, 2026.',
          decided_by: 'Priya',
          evidence: verifyEvidenceAgainstTurns(
            { quote: 'the product will launch on December 1, 2026', speaker: 'Priya', turn_index: 11 },
            p1.turns
          ),
          status: 'active',
          superseded_by: null,
          confidence: 0.98,
          is_demo: true,
        },
        {
          meeting_id: m1.id,
          topic: 'Subscription pricing',
          statement: 'Subscription price is $19/month.',
          decided_by: 'Priya',
          evidence: verifyEvidenceAgainstTurns(
            { quote: 'subscription price is $19/month', speaker: 'Priya', turn_index: 19 },
            p1.turns
          ),
          status: 'active',
          superseded_by: null,
          confidence: 0.96,
          is_demo: true,
        },
        {
          meeting_id: m1.id,
          topic: 'Backend API ownership',
          statement: 'Raj owns the backend API and completes it by November 20.',
          decided_by: 'Raj',
          evidence: verifyEvidenceAgainstTurns(
            { quote: 'Raj owns the backend API and will deliver it by November 20', speaker: 'Priya', turn_index: 26 },
            p1.turns
          ),
          status: 'active',
          superseded_by: null,
          confidence: 0.95,
          is_demo: true,
        },
      ]);

      assert.equal(d1Launch.evidence.verified, true);
      assert.equal(d1Price.evidence.verified, true);
      assert.equal(d1Api.evidence.verified, true);

      // Meeting 2: Dec 15 launch, $24/mo, Sana takes API
      const p2 = parseTranscript(NOVA_MEETING_2.transcript);
      const m2 = await repo.insertMeeting({
        title: NOVA_MEETING_2.title,
        meeting_date: NOVA_MEETING_2.meeting_date,
        attendees: NOVA_MEETING_2.attendees,
        source_hash: p2.sourceHash,
        raw_text: NOVA_MEETING_2.transcript,
        quality_report: runQualityGate({ rawText: NOVA_MEETING_2.transcript, parsed: p2, meetingDate: NOVA_MEETING_2.meeting_date }),
        open_questions: [],
        risks: [],
        health_score: 88,
        is_demo: true,
      });

      const candidatesForM2 = retrieveConflictCandidates(
        [
          { topic: 'Product launch date', statement: 'Moving product launch to December 15', decided_by: 'Priya' },
          { topic: 'Subscription pricing', statement: 'Subscription price changes to $24/month', decided_by: 'Priya' },
          { topic: 'Backend API ownership', statement: 'Backend API ownership reassigned from Raj to Sana', decided_by: 'Priya' },
        ],
        await repo.listDecisions(),
        15
      );
      assert.equal(candidatesForM2.length, 3);

      const [d2Launch] = await repo.insertDecisions([
        {
          meeting_id: m2.id,
          topic: 'Product launch date',
          statement: 'Product launch moves from December 1 to December 15, 2026.',
          decided_by: 'Priya',
          evidence: verifyEvidenceAgainstTurns(
            { quote: 'We are moving the product launch date from December 1 to December 15', speaker: 'Priya', turn_index: 13 },
            p2.turns
          ),
          status: 'active',
          superseded_by: null,
          confidence: 0.97,
          is_demo: true,
        },
      ]);

      const [conflict1] = await repo.insertConflicts([
        {
          new_ref: d2Launch.id,
          old_decision_id: d1Launch.id,
          type: 'deadline_change',
          severity: 'high',
          reason: 'Launch date moved from December 1 to December 15.',
          suggested_resolution: 'Accept December 15 and supersede December 1.',
          resolution: 'open',
          is_demo: true,
        },
      ]);

      // Resolve conflict: accept new decision -> preserves d1Launch as superseded with lineage
      await resolveConflictDecision(repo, conflict1.id, 'accept_new', 'qa-tester');
      const d1After = await repo.getDecisionById(d1Launch.id);
      assert.equal(d1After?.status, 'superseded');
      assert.equal(d1After?.superseded_by, d2Launch.id);

      // Meeting 3: Reversal back to December 1
      const p3 = parseTranscript(NOVA_MEETING_3.transcript);
      const m3 = await repo.insertMeeting({
        title: NOVA_MEETING_3.title,
        meeting_date: NOVA_MEETING_3.meeting_date,
        attendees: NOVA_MEETING_3.attendees,
        source_hash: p3.sourceHash,
        raw_text: NOVA_MEETING_3.transcript,
        quality_report: runQualityGate({ rawText: NOVA_MEETING_3.transcript, parsed: p3, meetingDate: NOVA_MEETING_3.meeting_date }),
        open_questions: [],
        risks: [],
        health_score: 91,
        is_demo: true,
      });

      const [d3Launch] = await repo.insertDecisions([
        {
          meeting_id: m3.id,
          topic: 'Product launch date',
          statement: 'Reversing delay: official launch returns to December 1, 2026.',
          decided_by: 'Priya',
          evidence: verifyEvidenceAgainstTurns(
            { quote: 'we can return to the December 1 launch date', speaker: 'Priya', turn_index: 11 },
            p3.turns
          ),
          status: 'active',
          superseded_by: null,
          confidence: 0.97,
          is_demo: true,
        },
      ]);
      assert.equal(d3Launch.evidence.verified, true);

      // Verify all 3 historical launch decisions remain accessible
      const launchHistory = (await repo.listDecisions()).filter((d) => d.topic === 'Product launch date');
      assert.equal(launchHistory.length, 3);

      // Task approval workflow & GitHub issue idempotency
      const [task] = await repo.insertActionItems([
        {
          meeting_id: m3.id,
          decision_id: d3Launch.id,
          title: 'Configure and verify Stripe Tax in staging',
          description: 'Enable Stripe Tax and verify EU VAT fixtures.',
          owner: 'Raj',
          owner_source: 'explicit',
          deadline: '2026-11-18',
          deadline_phrase: 'by tomorrow',
          priority: 'high',
          status: 'proposed',
          external_id: null,
          external_url: null,
          tracker: 'internal',
          evidence: verifyEvidenceAgainstTurns(
            { quote: 'I will configure and verify Stripe Tax in staging by tomorrow', speaker: 'Raj', turn_index: 16 },
            p3.turns
          ),
          confidence: 0.94,
          flags: [],
          is_demo: true,
        },
      ]);
      assert.equal(task.status, 'proposed');

      const payload = buildGitHubIssuePayload(task);
      assert.ok(payload.body.includes(`followthrough-task-id:${task.id}`));

      // Idempotency check when already linked to GitHub
      const linkedTask = {
        ...task,
        status: 'approved' as const,
        tracker: 'github' as const,
        external_id: '42',
        external_url: 'https://github.com/nova/app/issues/42',
      };
      let fetchCalled = false;
      const retryResult = await createGitHubIssueIdempotent(linkedTask, (async () => {
        fetchCalled = true;
        throw new Error('Should not call GitHub API when already linked');
      }) as typeof fetch);
      assert.equal(fetchCalled, false);
      assert.equal(retryResult.alreadyExisted, true);
      assert.equal(retryResult.externalId, '42');

      // Reset Demo MUST delete Nova demo records while protecting non-demo records
      const resetRes = await repo.resetDemoData();
      assert.equal(resetRes.meetingsDeleted, 3);
      const remainingMeetings = await repo.listMeetings();
      assert.equal(remainingMeetings.length, 1);
      assert.equal(remainingMeetings[0].id, nonDemoMeeting.id);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });
});
