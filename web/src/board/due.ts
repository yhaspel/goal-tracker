/**
 * A due date is a **calendar day, not an instant**, and lateness is decided here rather than on
 * the server.
 *
 * Nothing server-side ever compares a due date to the current time. A server deciding it in UTC
 * would be wrong for several hours every day for a household in Asia/Jerusalem: at 01:00 local
 * on the 5th, UTC is still the 4th, and a card due on the 5th would read as due tomorrow. The
 * comparison below uses the viewer's own local date, which is the only clock that matches what
 * the person reading the card thinks today is.
 */
export type DueState = 'due' | 'dueSoon' | 'overdue';

/** The viewer's local date as `YYYY-MM-DD`, so a date is only ever compared to another date. */
export function localToday(now = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The day after a `YYYY-MM-DD`, computed through UTC so no timezone can shift it. */
function nextDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(year, month - 1, date + 1));
  return at.toISOString().slice(0, 10);
}

/**
 * Which of the three badges a card shows. "Due soon" is today or tomorrow; anything earlier than
 * today is overdue. String comparison is exact for `YYYY-MM-DD` and needs no `Date` at all.
 */
export function dueState(dueDate: string, today = localToday()): DueState {
  if (dueDate < today) return 'overdue';
  if (dueDate === today || dueDate === nextDay(today)) return 'dueSoon';
  return 'due';
}
