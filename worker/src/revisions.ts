import { conflict, invalidRequest, isSafeIndex } from './http';

/**
 * The three independent revisions, and the one guard every mutation runs against its own.
 *
 * They are separate on purpose. A single shared revision would make a member adding a vision
 * image invalidate another member's open card editor with a `409`, and vice versa; domains that
 * do not touch each other's rows do not get to invalidate each other's work.
 *
 * All three live in singleton tables of the same shape — `id INTEGER PRIMARY KEY CHECK (id = 1)`
 * plus `revision INTEGER NOT NULL` — so one reader and one bump serve all of them. The table
 * names below are literals in this module and never come from a request.
 */
export type RevisionDomain = {
  /** The `error.details` key a stale mutation reports the current value under. */
  readonly key: 'boardRevision' | 'goalsRevision' | 'visionRevision';
  readonly table: 'board_state' | 'goal_state' | 'vision_state';
};

export const BOARD_REVISION: RevisionDomain = { key: 'boardRevision', table: 'board_state' };
export const GOALS_REVISION: RevisionDomain = { key: 'goalsRevision', table: 'goal_state' };
export const VISION_REVISION: RevisionDomain = { key: 'visionRevision', table: 'vision_state' };

export function readRevision(sql: SqlStorage, domain: RevisionDomain): number {
  const row = [...sql.exec<{ revision: number }>(`SELECT revision FROM ${domain.table} WHERE id = 1`)][0];
  if (!row) throw new Error(`${domain.table} singleton row is missing`);
  return row.revision;
}

/** Advances one revision exactly once and returns the new value. */
export function bumpRevision(sql: SqlStorage, domain: RevisionDomain): number {
  sql.exec(`UPDATE ${domain.table} SET revision = revision + 1 WHERE id = 1`);
  return readRevision(sql, domain);
}

/**
 * Refuses a mutation whose client revision is not the committed one, without writing.
 *
 * The conflict code stays `revision_conflict` for all three domains rather than gaining
 * per-domain spellings, because `errorText` in `web/src/components/errors.ts` looks up
 * `error.${code}` with no domain context. That is why the shared sentence in the dictionaries no
 * longer names the board.
 */
export function assertCurrentRevision(sql: SqlStorage, claimed: unknown, domain: RevisionDomain): number {
  if (!isSafeIndex(claimed)) {
    throw invalidRequest('That request was missing a revision.', { [domain.key]: 'invalid' });
  }
  const current = readRevision(sql, domain);
  if (claimed !== current) {
    throw conflict('revision_conflict', 'It changed somewhere else; reload and retry.', { [domain.key]: current });
  }
  return current;
}
