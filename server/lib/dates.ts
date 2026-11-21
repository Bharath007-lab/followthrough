const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseUtcDate(isoDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * Deterministically resolves explicit and relative deadline phrases against a meeting reference date.
 * Returns null if the phrase is vague or unresolvable (never invents deadlines).
 */
export function resolveDeadlinePhrase(
  phrase: string | null | undefined,
  meetingDateIso: string
): string | null {
  if (!phrase) return null;
  const base = parseUtcDate(meetingDateIso);
  if (!base) return null;

  const cleaned = phrase.trim().toLowerCase();
  if (!cleaned) return null;

  // Vague non-deadlines must return null
  if (
    /\b(sometime|soon|eventually|later|tbd|when possible|asap|next quarter|someday)\b/.test(
      cleaned
    )
  ) {
    return null;
  }

  // Exact ISO date YYYY-MM-DD
  const isoMatch = cleaned.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch && parseUtcDate(isoMatch[1])) {
    return isoMatch[1];
  }

  // Today / EOD
  if (/\b(today|eod|end of day|tonight)\b/.test(cleaned)) {
    return formatUtcDate(base);
  }

  // Tomorrow
  if (/\btomorrow\b/.test(cleaned)) {
    return formatUtcDate(addDays(base, 1));
  }

  // "in N days" or "N days from now"
  const inDaysMatch = cleaned.match(/\b(?:in\s+)?(\d{1,2})\s+days?\b/);
  if (inDaysMatch) {
    return formatUtcDate(addDays(base, Number(inDaysMatch[1])));
  }

  // "in N weeks"
  const inWeeksMatch = cleaned.match(/\b(?:in\s+)?(\d{1,2})\s+weeks?\b/);
  if (inWeeksMatch) {
    return formatUtcDate(addDays(base, Number(inWeeksMatch[1]) * 7));
  }

  // "end of this week" / "end of week" / "eow"
  if (/\b(end of (?:the |this )?week|eow)\b/.test(cleaned)) {
    const day = base.getUTCDay();
    const diffToFri = day <= 5 ? 5 - day : 6; // Friday of current week
    return formatUtcDate(addDays(base, diffToFri));
  }

  // "end of next week"
  if (/\bend of next week\b/.test(cleaned)) {
    const day = base.getUTCDay();
    const diffToThisFri = 5 - day;
    return formatUtcDate(addDays(base, diffToThisFri + 7));
  }

  // "end of month" / "eom"
  if (/\b(end of (?:the |this )?month|eom)\b/.test(cleaned)) {
    const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
    return formatUtcDate(lastDay);
  }

  // "next <weekday>" or "this <weekday>" or "by <weekday>"
  const weekdayMatch = cleaned.match(
    /\b(this|next|by|on)?\s*(monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)\b/
  );
  if (weekdayMatch) {
    const qualifier = weekdayMatch[1] || '';
    const targetDay = WEEKDAYS[weekdayMatch[2]];
    const currentDay = base.getUTCDay();
    let delta = (targetDay - currentDay + 7) % 7;
    if (delta === 0) {
      delta = qualifier === 'this' ? 0 : 7;
    } else if (qualifier === 'next' && delta <= 3) {
      // "next Tuesday" when meeting is Tuesday or Monday usually refers to the following week's Tuesday
      delta += 7;
    }
    return formatUtcDate(addDays(base, delta));
  }

  // Month Day [, Year] e.g. "November 20", "Dec 1", "December 15, 2026"
  const monthDayMatch = cleaned.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/
  );
  if (monthDayMatch) {
    const monthIdx = MONTHS[monthDayMatch[1]];
    const dayNum = Number(monthDayMatch[2]);
    let year = monthDayMatch[3] ? Number(monthDayMatch[3]) : base.getUTCFullYear();
    const candidate = new Date(Date.UTC(year, monthIdx, dayNum));
    // If no explicit year and date is > 60 days in the past relative to meeting date, advance year
    if (!monthDayMatch[3]) {
      const diffDays = (candidate.getTime() - base.getTime()) / 86_400_000;
      if (diffDays < -60) {
        year += 1;
      }
    }
    const finalDate = new Date(Date.UTC(year, monthIdx, dayNum));
    if (finalDate.getUTCMonth() === monthIdx && finalDate.getUTCDate() === dayNum) {
      return formatUtcDate(finalDate);
    }
  }

  // Day Month [Year] e.g. "20 November"
  const dayMonthMatch = cleaned.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\.?(?:,?\s*(\d{4}))?\b/
  );
  if (dayMonthMatch) {
    const dayNum = Number(dayMonthMatch[1]);
    const monthIdx = MONTHS[dayMonthMatch[2]];
    const year = dayMonthMatch[3] ? Number(dayMonthMatch[3]) : base.getUTCFullYear();
    const finalDate = new Date(Date.UTC(year, monthIdx, dayNum));
    if (finalDate.getUTCMonth() === monthIdx && finalDate.getUTCDate() === dayNum) {
      return formatUtcDate(finalDate);
    }
  }

  return null;
}

export function daysUntilDate(
  deadlineIso: string | null | undefined,
  referenceDateIso?: string
): number | null {
  if (!deadlineIso) return null;
  const target = parseUtcDate(deadlineIso);
  if (!target) return null;
  const todayIso = referenceDateIso || new Date().toISOString().slice(0, 10);
  const ref = parseUtcDate(todayIso);
  if (!ref) return null;
  return Math.round((target.getTime() - ref.getTime()) / 86_400_000);
}

export function classifyDeadlineUrgency(
  deadlineIso: string | null | undefined,
  status: string,
  referenceDateIso?: string
): 'completed' | 'overdue' | 'due_soon' | 'upcoming' | 'no_deadline' {
  if (status === 'done') return 'completed';
  const days = daysUntilDate(deadlineIso, referenceDateIso);
  if (days === null) return 'no_deadline';
  if (days < 0) return 'overdue';
  if (days <= 3) return 'due_soon';
  return 'upcoming';
}
