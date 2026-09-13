/**
 * Which encrypted copies survive a pruning pass.
 *
 * Separated from `backup.ts` so it can be unit tested: that file runs a command as soon as it
 * is imported, and retention is the one part of the tool whose mistake is silent — it deletes
 * the copy an operator was going to need.
 *
 * Two rules, deliberately different. **Weekly** keeps the newest copy of each of the four most
 * recent ISO weeks, because that is the freshest state of that week. **Monthly** keeps the
 * *oldest* copy of each of the three most recent calendar months, so a month's representative
 * is fixed the moment the month's first backup lands rather than drifting forward all month.
 */

export const WEEKLY_COPIES = 4;
export const MONTHLY_COPIES = 3;
export const FILE_SUFFIX = '.backup.enc';

/**
 * The only names this tool will ever consider deleting. The date, the schema version, the
 * eight-hex suffix and the double extension all have to line up, so anything else in the
 * directory — a note, a key the operator misplaced, a copy taken by hand — is left strictly
 * alone. The name carries no user data: a household label, a date, and a schema version.
 */
export const NAME_PATTERN =
  /^(?<household>[a-z0-9-]+)-(?<date>\d{4}-\d{2}-\d{2})-schema(?<schema>\d+)-(?<suffix>[0-9a-f]{8})\.backup\.enc$/;

export type StoredCopy = { name: string; date: string; schema: number };

export function parseCopyName(name: string): StoredCopy | null {
  const match = NAME_PATTERN.exec(name);
  if (!match?.groups?.date) return null;
  return { name, date: match.groups.date, schema: Number(match.groups.schema ?? 0) };
}

/** Date first, then the whole name, so the ordering is total and identical on every machine. */
export function sortCopies(copies: StoredCopy[]): StoredCopy[] {
  return [...copies].sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date.localeCompare(b.date)));
}

/** ISO-8601 week key, `YYYY-Www`, so a backup taken on a Sunday lands in the right week. */
export function isoWeek(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const day = parsed.getUTCDay() === 0 ? 7 : parsed.getUTCDay();
  parsed.setUTCDate(parsed.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(parsed.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((parsed.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${parsed.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function group(copies: StoredCopy[], key: (copy: StoredCopy) => string): Map<string, StoredCopy[]> {
  const grouped = new Map<string, StoredCopy[]>();
  for (const copy of copies) {
    const bucket = grouped.get(key(copy));
    if (bucket) bucket.push(copy);
    else grouped.set(key(copy), [copy]);
  }
  return grouped;
}

/**
 * `keepAlways` carries the copy that was just written and verified, so a fresh backup can never
 * be pruned by its own run — the reason pruning happens after verification and not before.
 */
export function retainedCopies(copies: StoredCopy[], keepAlways: readonly string[] = []): Set<string> {
  const ordered = sortCopies(copies);
  const keep = new Set(keepAlways);

  const byWeek = group(ordered, copy => isoWeek(copy.date));
  for (const week of [...byWeek.keys()].sort().reverse().slice(0, WEEKLY_COPIES)) {
    const bucket = byWeek.get(week) ?? [];
    const newest = bucket[bucket.length - 1];
    if (newest) keep.add(newest.name);
  }

  const byMonth = group(ordered, copy => copy.date.slice(0, 7));
  for (const month of [...byMonth.keys()].sort().reverse().slice(0, MONTHLY_COPIES)) {
    const oldest = (byMonth.get(month) ?? [])[0];
    if (oldest) keep.add(oldest.name);
  }

  return keep;
}
