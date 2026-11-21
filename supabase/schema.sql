-- Followthrough — Supabase PostgreSQL Organizational Memory Schema
-- Run this SQL in your Supabase SQL Editor before connecting SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. People (identified speakers & team members)
CREATE TABLE IF NOT EXISTS public.people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  role TEXT,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Meetings (ingested transcripts with SHA-256 deduplication)
CREATE TABLE IF NOT EXISTS public.meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  meeting_date DATE NOT NULL,
  attendees TEXT[] NOT NULL DEFAULT '{}',
  source_hash TEXT NOT NULL UNIQUE,
  raw_text TEXT NOT NULL,
  quality_report JSONB NOT NULL,
  open_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  health_score INTEGER NOT NULL DEFAULT 100 CHECK (health_score >= 0 AND health_score <= 100),
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meetings_meeting_date ON public.meetings (meeting_date DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_is_demo ON public.meetings (is_demo);

-- 3. Turns (normalized speaker turns with timestamps)
CREATE TABLE IF NOT EXISTS public.turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  timestamp TEXT,
  speaker TEXT,
  text TEXT NOT NULL,
  UNIQUE (meeting_id, idx)
);

CREATE INDEX IF NOT EXISTS idx_turns_meeting_id ON public.turns (meeting_id, idx);

-- 4. Decisions (persistent organizational memory with lineage)
CREATE TABLE IF NOT EXISTS public.decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  statement TEXT NOT NULL,
  decided_by TEXT,
  evidence JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'contested')),
  superseded_by UUID REFERENCES public.decisions(id) ON DELETE SET NULL,
  confidence REAL NOT NULL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decisions_meeting_id ON public.decisions (meeting_id);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON public.decisions (status);
CREATE INDEX IF NOT EXISTS idx_decisions_topic ON public.decisions (LOWER(topic));
CREATE INDEX IF NOT EXISTS idx_decisions_is_demo ON public.decisions (is_demo);

-- 5. Action Items (proposed, approved, rejected, tracked commitments)
CREATE TABLE IF NOT EXISTS public.action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  decision_id UUID REFERENCES public.decisions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner TEXT,
  owner_source TEXT NOT NULL DEFAULT 'unassigned' CHECK (owner_source IN ('explicit', 'inferred', 'unassigned')),
  deadline DATE,
  deadline_phrase TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'in_progress', 'done')),
  external_id TEXT,
  external_url TEXT,
  tracker TEXT NOT NULL DEFAULT 'internal' CHECK (tracker IN ('internal', 'github')),
  evidence JSONB NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
  flags TEXT[] NOT NULL DEFAULT '{}',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_items_meeting_id ON public.action_items (meeting_id);
CREATE INDEX IF NOT EXISTS idx_action_items_status ON public.action_items (status);
CREATE INDEX IF NOT EXISTS idx_action_items_owner ON public.action_items (LOWER(owner));
CREATE INDEX IF NOT EXISTS idx_action_items_deadline ON public.action_items (deadline);
CREATE INDEX IF NOT EXISTS idx_action_items_is_demo ON public.action_items (is_demo);

-- 6. Conflicts (cross-meeting contradictions, changes, reversals)
CREATE TABLE IF NOT EXISTS public.conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  new_ref UUID NOT NULL REFERENCES public.decisions(id) ON DELETE CASCADE,
  old_decision_id UUID NOT NULL REFERENCES public.decisions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'direct_contradiction',
    'deadline_change',
    'owner_change',
    'scope_change',
    'duplicate_commitment',
    'dependency_conflict'
  )),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  reason TEXT NOT NULL,
  suggested_resolution TEXT NOT NULL DEFAULT '',
  resolution TEXT NOT NULL DEFAULT 'open' CHECK (resolution IN ('open', 'superseded', 'kept_old', 'contested')),
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (new_ref, old_decision_id)
);

CREATE INDEX IF NOT EXISTS idx_conflicts_resolution ON public.conflicts (resolution);
CREATE INDEX IF NOT EXISTS idx_conflicts_is_demo ON public.conflicts (is_demo);

-- 7. Reminders (simulated or cron-scheduled commitment reminders)
CREATE TABLE IF NOT EXISTS public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_item_id UUID NOT NULL REFERENCES public.action_items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('overdue', 'due_soon', 'upcoming', 'completed')),
  message TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual_simulation' CHECK (source IN ('manual_simulation', 'cron')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seen BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_reminders_action_item_id ON public.reminders (action_item_id);
CREATE INDEX IF NOT EXISTS idx_reminders_seen ON public.reminders (seen);

-- 8. Audit Log (immutable governance trail for approvals, resolutions, ingestion)
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log (created_at DESC);

-- Row Level Security (RLS)
-- All application mutations and reads flow through the authenticated Node.js server using SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS safely on the server while blocking direct anonymous browser writes.
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Restrict direct public/anon access so data is exclusively accessed via server API routes
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['people','meetings','turns','decisions','action_items','conflicts','reminders','audit_log']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "service_role_all_%s" ON public.%I;', tbl, tbl);
    EXECUTE format('CREATE POLICY "service_role_all_%s" ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'');', tbl, tbl);
  END LOOP;
END $$;
