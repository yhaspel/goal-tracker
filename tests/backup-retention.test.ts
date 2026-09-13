import { describe, expect, it } from 'vitest';
import { isoWeek, parseCopyName, retainedCopies, type StoredCopy } from '../scripts/backup-retention';

/**
 * Retention is the one part of the backup tool whose mistake is silent: it deletes the copy the
 * operator was going to need. These cases pin the rule rather than the implementation.
 */

function copy(date: string, suffix: string): StoredCopy {
  return { name: `goal-tracker-production-${date}-schema4-${suffix}.backup.enc`, date, schema: 4 };
}

describe('what a pruning pass keeps', () => {
  it('recognises only names this tool writes', () => {
    expect(parseCopyName('goal-tracker-production-2026-09-13-schema4-a1b2c3d4.backup.enc')).toEqual({
      name: 'goal-tracker-production-2026-09-13-schema4-a1b2c3d4.backup.enc',
      date: '2026-09-13',
      schema: 4
    });
    for (const stranger of [
      'notes.txt',
      'backup.key',
      'goal-tracker-production-2026-09-13-schema4.backup.enc',
      'goal-tracker-production-13-09-2026-schema4-a1b2c3d4.backup.enc',
      'goal-tracker-production-2026-09-13-schema4-a1b2c3d4.backup.enc.old'
    ]) {
      expect(parseCopyName(stranger)).toBeNull();
    }
  });

  it('puts a Sunday and the Monday before it in the same ISO week', () => {
    // 2026-09-07 is a Monday; 2026-09-13 is the Sunday that closes the same ISO week.
    expect(isoWeek('2026-09-13')).toBe(isoWeek('2026-09-07'));
    expect(isoWeek('2026-09-14')).not.toBe(isoWeek('2026-09-13'));
  });

  it('keeps four weekly copies and three monthly ones', () => {
    const copies = [
      copy('2026-05-04', 'aaaaaaaa'),
      copy('2026-06-01', 'bbbbbbbb'),
      copy('2026-07-06', 'cccccccc'),
      copy('2026-07-27', 'dddddddd'),
      copy('2026-08-03', 'eeeeeeee'),
      copy('2026-08-17', 'ffffffff'),
      copy('2026-08-31', '11111111'),
      copy('2026-09-07', '22222222')
    ];
    const keep = retainedCopies(copies);
    // The four most recent ISO weeks are 2026-09-07, 08-31, 08-17 and 08-03; the three most
    // recent months contribute their oldest copy, which adds 2026-07-06 and nothing else.
    expect([...keep].sort()).toEqual(
      [
        copy('2026-07-06', 'cccccccc').name,
        copy('2026-08-03', 'eeeeeeee').name,
        copy('2026-08-17', 'ffffffff').name,
        copy('2026-08-31', '11111111').name,
        copy('2026-09-07', '22222222').name
      ].sort()
    );
    expect(keep.has(copy('2026-05-04', 'aaaaaaaa').name)).toBe(false);
    expect(keep.has(copy('2026-06-01', 'bbbbbbbb').name)).toBe(false);
    expect(keep.has(copy('2026-07-27', 'dddddddd').name)).toBe(false);
  });

  it('never prunes the copy that was just written and verified', () => {
    const fresh = copy('2026-09-13', '99999999');
    const older = Array.from({ length: 20 }, (_, index) =>
      copy(`2026-0${1 + Math.floor(index / 10)}-${String((index % 28) + 1).padStart(2, '0')}`, String(index).padStart(8, '0'))
    );
    expect(retainedCopies([...older, fresh], [fresh.name]).has(fresh.name)).toBe(true);
  });

  it('lets the oldest copy of a month represent it, not the newest', () => {
    const first = copy('2026-09-01', 'aaaaaaaa');
    const middle = copy('2026-09-15', 'bbbbbbbb');
    const last = copy('2026-09-29', 'cccccccc');
    const keep = retainedCopies([first, middle, last]);
    expect(keep.has(first.name)).toBe(true);
  });

  it('keeps nothing from an empty directory and does not throw', () => {
    expect(retainedCopies([]).size).toBe(0);
  });

  /**
   * Why `create()` refuses to prune at all when the household failed its own integrity checks.
   *
   * Retention has no idea whether a copy is restorable; it ranks by date and pins the newest. So a
   * copy `importBackup` would reject, taken today, both survives the pass and displaces the clean
   * copy from earlier in the same ISO week. This case pins that mechanism so the ordering in
   * `create()` cannot be "tidied" back into pruning before the integrity gate.
   */
  it('would discard a clean copy in favour of a newer pinned one, which is why a failed integrity check skips pruning', () => {
    const monthOldest = copy('2026-09-01', 'aaaaaaaa');
    const clean = copy('2026-09-08', 'bbbbbbbb');
    const newestButUnrestorable = copy('2026-09-09', 'cccccccc');

    // 2026-09-08 and 2026-09-09 fall in one ISO week, so only one of them can represent it.
    expect(isoWeek('2026-09-08')).toBe(isoWeek('2026-09-09'));

    const keep = retainedCopies([monthOldest, clean, newestButUnrestorable], [newestButUnrestorable.name]);
    expect(keep.has(newestButUnrestorable.name)).toBe(true);
    expect(keep.has(monthOldest.name)).toBe(true);
    // The one a restore would actually accept is the one retention drops.
    expect(keep.has(clean.name)).toBe(false);
  });
});
