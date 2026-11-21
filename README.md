# Followthrough

**Meetings end. Commitments shouldn't.**

Followthrough is an organizational memory and execution platform that converts meeting transcripts into verified decisions, detects cross-meeting contradictions and reversals, requires human confirmation before creating tasks, and tracks commitments across meetings.

## Architecture

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Lucide icons (`src/`)
- **Backend:** Node.js, Express, TypeScript (`server.ts`, `server/lib/`)
- **Primary AI Provider:** BluesMinds API (`server/lib/llm.ts`) via official OpenAI Node.js SDK (`openai`) + Zod structured validation
- **Database:** Supabase PostgreSQL (`supabase/schema.sql`, `server/lib/db.ts`) with automatic local server fallback when Supabase credentials are unset
- **External Tracker (Optional):** GitHub Issues (`server/lib/github.ts`) with idempotent markers

## Setup

### 1. Environment Variables

Configure these server-side environment variables (see `.env.example`):

```env
BLUESMINDS_API_KEY=
BLUESMINDS_BASE_URL=https://api.bluesminds.com/v1
BLUESMINDS_MODEL=

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

GITHUB_TOKEN=
GITHUB_REPO=

CRON_SECRET=
APP_URL=
```

### 2. Supabase Database Schema

Run `supabase/schema.sql` in your Supabase SQL Editor to create all 8 tables (`people`, `meetings`, `turns`, `decisions`, `action_items`, `conflicts`, `reminders`, `audit_log`), indexes, unique constraints, and RLS policies.

### 3. Verify BluesMinds Connection

Run the 5-step API verification from the CLI or in the **Settings** page:

```bash
npm run verify:llm
```

### 4. Development, Tests & Production Build

```bash
npm run dev      # Starts Express + Vite on port 3000
npm test         # Runs deterministic parser, quality gate, evidence, lineage & idempotency tests
npm run lint     # TypeScript type-check (tsc --noEmit)
npm run build    # Production frontend bundle
```
