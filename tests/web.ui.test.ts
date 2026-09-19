import { describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../shared/api';
import { ApiError } from '../web/src/api/client';
import { dueState, localToday } from '../web/src/board/due';
import { placeOfCard, projectedDrop, withMovedCard } from '../web/src/board/reorder';
import { errorText, fieldErrorText } from '../web/src/components/errors';
import { en } from '../web/src/i18n/en';
import { he } from '../web/src/i18n/he';
import { ru } from '../web/src/i18n/ru';
import { directionOf, localeFromTags } from '../web/src/i18n';
import { createTranslate, DICTIONARIES, interpolate } from '../web/src/i18n/translate';
import { LOCALES } from '../shared/api';
import { ROUTES } from '../web/src/router';
import { SPA_ROUTES } from '../worker/src/index';

const translator = createTranslate('en');

function snapshot(): BoardSnapshot {
  const card = (id: string, columnId: string, position: number) => ({
    id,
    columnId,
    title: id,
    description: null,
    assigneeUserId: null,
    creatorUserId: 'owner',
    position,
    dueDate: null,
    milestoneId: null,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z'
  });
  return {
    boardRevision: 7,
    activeMembers: [{ id: 'owner', email: 'owner@example.test' }],
    columns: [
      { id: 'a', nameKey: 'todo', customName: null, position: 0, cards: [card('a1', 'a', 0), card('a2', 'a', 1)] },
      { id: 'b', nameKey: 'in_progress', customName: null, position: 1, cards: [card('b1', 'b', 0)] },
      { id: 'c', nameKey: 'done', customName: null, position: 2, cards: [] }
    ]
  };
}

function assertDense(board: BoardSnapshot): void {
  for (const column of board.columns) {
    column.cards.forEach((card, index) => {
      expect(card.position).toBe(index);
      expect(card.columnId).toBe(column.id);
    });
  }
  const ids = board.columns.flatMap(column => column.cards.map(card => card.id));
  expect(new Set(ids).size).toBe(ids.length);
}

describe('translation', () => {
  it('interpolates named parameters and leaves unknown ones alone', () => {
    expect(interpolate('Hello {name}, you have {count}', { name: 'Dana', count: 2 })).toBe('Hello Dana, you have 2');
    expect(interpolate('Keep {unknown}', { other: 1 })).toBe('Keep {unknown}');
    expect(interpolate('No parameters')).toBe('No parameters');
  });

  it('selects plural forms by count', () => {
    expect(translator.plural('board.cardCount', 1)).toBe('1 card');
    expect(translator.plural('board.cardCount', 0)).toBe('0 cards');
    expect(translator.plural('board.cardCount', 5)).toBe('5 cards');
  });

  it('covers every stable error code the API can return', () => {
    // Each of these is thrown by the Worker; a missing key would silently degrade to a
    // generic sentence, which is exactly what the UI must not do for an actionable failure.
    const codes = [
      'invalid_request',
      'unauthenticated',
      'invalid_credentials',
      'forbidden',
      'already_authenticated',
      'not_found',
      'rate_limited',
      'unavailable',
      'bootstrap_consumed',
      'email_taken',
      'email_not_allowed',
      'seats_full',
      'invalid_invitation',
      'invalid_pending_token',
      'invalid_phrase',
      'invalid_challenge',
      'recovery_failed',
      'rotation_conflict',
      'too_many_rotations',
      'allowlist_conflict',
      'invitation_consumed',
      'cannot_deactivate_owner',
      'revision_conflict',
      'column_not_empty',
      'last_column',
      'board_full',
      'column_limit',
      'payload_too_large',
      'unsupported_media_type',
      'goal_limit',
      'milestone_limit',
      'image_limit',
      'storage_full',
      'image_too_large',
      'unsupported_image_type',
      'image_rejected'
    ];
    for (const code of codes) {
      expect(Object.prototype.hasOwnProperty.call(en, `error.${code}`), code).toBe(true);
    }
  });

  it('registers exactly the supported locales, so the release check sees them all', () => {
    // `scripts/check-i18n.ts` imports the dictionary modules directly; this keeps the
    // registry the application actually reads from drifting away from that list.
    expect(Object.keys(DICTIONARIES).sort()).toEqual([...LOCALES].sort());
    expect(DICTIONARIES.en).toBe(en);
    expect(DICTIONARIES.he).toBe(he);
    expect(DICTIONARIES.ru).toBe(ru);
  });

  it('uses each language’s own plural rules', () => {
    const hebrew = createTranslate('he');
    expect(hebrew.plural('board.cardCount', 1)).toBe(he['board.cardCount.one']);
    expect(hebrew.plural('board.cardCount', 2)).toBe(he['board.cardCount.two']);
    expect(hebrew.plural('board.cardCount', 7)).toBe('7 כרטיסים');

    const russian = createTranslate('ru');
    expect(russian.plural('board.cardCount', 1)).toBe('1 карточка');
    expect(russian.plural('board.cardCount', 3)).toBe('3 карточки');
    expect(russian.plural('board.cardCount', 5)).toBe('5 карточек');
    expect(russian.plural('board.cardCount', 21)).toBe('21 карточка');
  });

  it('gives the due-soon badge its own sentence, so the state never rests on the tint', () => {
    for (const locale of LOCALES) {
      expect(DICTIONARIES[locale]['card.dueSoon']).not.toBe(DICTIONARIES[locale]['card.due']);
    }
  });

  it('keeps the product name identical in every locale', () => {
    // The one string the redesign deliberately does not translate. A household that mixes
    // languages would otherwise see a different product name per person, and the Russian
    // translation does not fit the phone header. It is bidi-isolated where it is rendered.
    for (const dictionary of [he, ru]) {
      expect((dictionary as Record<string, string>)['app.name']).toBe(en['app.name']);
    }
  });

  /**
   * Keys whose value is deliberately identical in all three locales.
   *
   * `app.name` is the product name, asserted identical in its own test above. The two composite
   * labels are pure structure: an `<optgroup label>` and an `<option>` are plain text, so each is
   * a separator plus two U+2068/U+2069-isolated placeholders and contains no translatable word.
   * Every part a member reads — the goal title, the milestone title, the Intl-supplied month
   * name, the year — is interpolated and is already localised or already member-written.
   */
  const SAME_IN_EVERY_LOCALE = new Set(['app.name', 'goals.optgroupLabel', 'milestone.optionLabel']);

  it('translates every screen into Hebrew and Russian, never falling back to English', () => {
    // A key that silently renders English is the exact failure the release check exists to
    // prevent; this asserts the same property from the application's own lookup path.
    for (const [locale, dictionary] of [
      ['he', he],
      ['ru', ru]
    ] as const) {
      const translate = createTranslate(locale);
      for (const key of Object.keys(en) as Array<keyof typeof en>) {
        if (key.startsWith('board.cardCount.')) continue;
        const translated = translate.t(key);
        expect(translated, `${locale}:${key}`).toBe((dictionary as Record<string, string>)[key]);
        if (SAME_IN_EVERY_LOCALE.has(key)) continue;
        expect(translated, `${locale}:${key}`).not.toBe(en[key]);
      }
    }
  });

  it('keeps the two composite labels bidi-isolated, because a select option is plain text', () => {
    // An element cannot be placed inside an `<optgroup label>`, so the isolates have to be part
    // of the template. Losing them reorders a Hebrew goal title against a Latin year on screen.
    for (const locale of LOCALES) {
      for (const key of ['goals.optgroupLabel', 'milestone.optionLabel'] as const) {
        const template = DICTIONARIES[locale][key]!;
        expect((template.match(/⁨/g) ?? []).length, `${locale}:${key}`).toBe(2);
        expect((template.match(/⁩/g) ?? []).length, `${locale}:${key}`).toBe(2);
      }
    }
  });

  it('maps browser language tags onto the three supported locales', () => {
    expect(localeFromTags(['he-IL', 'en-US'])).toBe('he');
    expect(localeFromTags(['iw'])).toBe('he');
    expect(localeFromTags(['ru-RU'])).toBe('ru');
    expect(localeFromTags(['fr-FR', 'en'])).toBe('en');
    expect(localeFromTags(['fr-FR'])).toBe('en');
    expect(localeFromTags([])).toBe('en');
  });

  it('sets the document direction from the locale', () => {
    expect(directionOf('he')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
    expect(directionOf('ru')).toBe('ltr');
  });
});

describe('error presentation', () => {
  it('shows a translated message for a known code and never the server text', () => {
    const error = new ApiError(409, 'revision_conflict', 'SERVER TEXT THAT MUST NOT APPEAR');
    const shown = errorText(translator, error);
    expect(shown).toBe(en['error.revision_conflict']);
    expect(shown).not.toContain('SERVER TEXT');
  });

  it('falls back safely for an unknown code, a network failure, and a non-API throw', () => {
    expect(errorText(translator, new ApiError(500, 'something_new', 'x'))).toBe(en['error.generic']);
    expect(errorText(translator, new ApiError(0, 'network', 'x'))).toBe(en['error.network']);
    expect(errorText(translator, new Error('boom'))).toBe(en['error.generic']);
  });

  it('translates per-field reasons, sharing the password family across field names', () => {
    const error = new ApiError(400, 'invalid_request', 'x', { fieldErrors: { newPassword: 'too_common' } });
    expect(fieldErrorText(translator, error, 'newPassword')).toBe(en['field.password.too_common']);
    expect(fieldErrorText(translator, error, 'email')).toBeUndefined();

    const unknown = new ApiError(400, 'invalid_request', 'x', { fieldErrors: { mystery: 'whatever' } });
    expect(fieldErrorText(translator, unknown, 'mystery')).toBe(en['field.fallback']);
  });
});

describe('optimistic reordering', () => {
  it('moves a card across columns and renumbers both', () => {
    const moved = withMovedCard(snapshot(), 'a1', 'b', 0);
    expect(moved.columns[0]?.cards.map(card => card.id)).toEqual(['a2']);
    expect(moved.columns[1]?.cards.map(card => card.id)).toEqual(['a1', 'b1']);
    assertDense(moved);
  });

  it('reorders within a column', () => {
    const moved = withMovedCard(snapshot(), 'a1', 'a', 1);
    expect(moved.columns[0]?.cards.map(card => card.id)).toEqual(['a2', 'a1']);
    assertDense(moved);
  });

  it('moves into an empty column', () => {
    const moved = withMovedCard(snapshot(), 'b1', 'c', 0);
    expect(moved.columns[1]?.cards).toHaveLength(0);
    expect(moved.columns[2]?.cards.map(card => card.id)).toEqual(['b1']);
    assertDense(moved);
  });

  it('leaves the board untouched for an unknown card or column', () => {
    const original = snapshot();
    expect(withMovedCard(original, 'missing', 'a', 0)).toBe(original);
    expect(withMovedCard(original, 'a1', 'missing', 0)).toBe(original);
  });

  it('clamps an out-of-range index rather than leaving a gap', () => {
    const moved = withMovedCard(snapshot(), 'a1', 'b', 99);
    expect(moved.columns[1]?.cards.map(card => card.id)).toEqual(['b1', 'a1']);
    assertDense(moved);
  });
});

describe('drag announcements', () => {
  it('reports where a card sits, one-based, wherever it is', () => {
    const board = snapshot();
    expect(placeOfCard(board, 'a2')).toMatchObject({ position: 2 });
    expect(placeOfCard(board, 'a2')?.column.id).toBe('a');
    expect(placeOfCard(board, 'b1')).toMatchObject({ position: 1 });
    expect(placeOfCard(board, 'missing')).toBeNull();
  });

  it('projects the slot a hovered card would hand over', () => {
    const board = snapshot();
    // Hovering the second card of column a means landing in position 2 of column a.
    expect(projectedDrop(board, 'a1', { id: 'a2', index: 1, group: 'a' })).toMatchObject({ position: 2 });
    expect(projectedDrop(board, 'a1', { id: 'a2', index: 1, group: 'a' })?.column.id).toBe('a');
  });

  it('projects an append when the target is some other column', () => {
    const board = snapshot();
    // Column b holds one card, so a card arriving from column a lands at position 2...
    expect(projectedDrop(board, 'a1', { id: 'b' })).toMatchObject({ position: 2 });
    // ...and an empty column always lands at position 1.
    expect(projectedDrop(board, 'a1', { id: 'c' })).toMatchObject({ position: 1 });
  });

  it('does not call the column a card is already in an append', () => {
    // Collision detection reports the card's own column as a target mid-drag. Treating that as
    // an append announced a jump to the end of the list that no drop would have performed.
    const board = snapshot();
    expect(projectedDrop(board, 'a1', { id: 'a' })).toMatchObject({ position: 1 });
    expect(projectedDrop(board, 'a2', { id: 'a' })).toMatchObject({ position: 2 });
  });

  it('agrees with the position the confirmed move announces', () => {
    // `requestMove` appends with `targetIndex = cards.length` and announces `targetIndex + 1`.
    // A mid-drag announcement that disagreed would have the card audibly jump on drop.
    const board = snapshot();
    const column = board.columns[1]!;
    expect(projectedDrop(board, 'a1', { id: column.id })?.position).toBe(column.cards.length + 1);
  });

  it('says nothing when the target is unknown or carries no position', () => {
    const board = snapshot();
    expect(projectedDrop(board, 'a1', {})).toBeNull();
    expect(projectedDrop(board, 'a1', { id: 'a2', group: 'a' })).toBeNull();
    expect(projectedDrop(board, 'a1', { id: 'a2', index: 0, group: 'gone' })).toBeNull();
  });

  it('phrases pick-up, hover, and cancel in every locale', () => {
    // The announcement keys are the only feedback a screen-reader user gets mid-drag, so a
    // locale missing one would leave that language silent where the others speak.
    for (const locale of LOCALES) {
      const speak = createTranslate(locale);
      for (const key of ['card.dragPickedUp', 'card.dragOver', 'card.dragCanceled'] as const) {
        const spoken = speak.t(key, { title: 'Milk', column: 'To do', position: 2 });
        expect(spoken).not.toContain('{');
        expect(spoken).toContain('Milk');
        expect(DICTIONARIES[locale][key]).toBeDefined();
      }
    }
  });

  it('confirms a language change in the language just chosen', () => {
    // The selector builds this from the incoming locale rather than from the render's own
    // translator, which still holds the outgoing one.
    for (const locale of LOCALES) {
      expect(createTranslate(locale).t('account.languageSaved')).toBe(DICTIONARIES[locale]['account.languageSaved']);
    }
    const spoken = LOCALES.map(locale => createTranslate(locale).t('account.languageSaved'));
    expect(new Set(spoken).size).toBe(LOCALES.length);
  });
});

describe('due dates are a calendar day, decided in the browser', () => {
  it('reads today as due soon and yesterday as overdue, against the viewer’s own local date', () => {
    expect(dueState('2026-09-14', '2026-09-14')).toBe('dueSoon');
    expect(dueState('2026-09-15', '2026-09-14')).toBe('dueSoon');
    expect(dueState('2026-09-16', '2026-09-14')).toBe('due');
    expect(dueState('2026-09-13', '2026-09-14')).toBe('overdue');
  });

  it('a viewer at UTC+3 sees a card due today as due, not overdue, at 01:00 local', () => {
    // The plan's named case. At 01:00 local on the 5th in Asia/Jerusalem the UTC instant is still
    // 22:00 on the 4th, so the two calendars disagree about what day it is. What decides is the
    // viewer's own local date, and a card due on that date is never overdue.
    const localDate = localToday(new Date(2026, 8, 5, 1, 0, 0));
    expect(localDate).toBe('2026-09-05');
    expect(dueState('2026-09-05', localDate)).toBe('dueSoon');
    expect(dueState('2026-09-05', localDate)).not.toBe('overdue');

    // The trap this avoids: deriving "today" from the UTC calendar instead. For any viewer whose
    // offset puts local midnight on the other side of UTC midnight, that is a different day, and
    // every card due on one of the two days is then classified against the wrong one.
    const sameInstantInUtc = new Date(Date.UTC(2026, 8, 4, 22, 0, 0)).toISOString().slice(0, 10);
    expect(sameInstantInUtc).toBe('2026-09-04');
    expect(sameInstantInUtc).not.toBe(localDate);
    // A card due on the 4th, read against the UTC day, would still look like "due today"; read
    // against the viewer's own calendar it is already yesterday.
    expect(dueState('2026-09-04', sameInstantInUtc)).toBe('dueSoon');
    expect(dueState('2026-09-04', localDate)).toBe('overdue');
  });

  it('steps across a month and a year boundary without a timezone shifting it', () => {
    expect(dueState('2026-10-01', '2026-09-30')).toBe('dueSoon');
    expect(dueState('2027-01-01', '2026-12-31')).toBe('dueSoon');
    expect(dueState('2026-12-31', '2027-01-01')).toBe('overdue');
    // A leap day is a real day for this comparison like any other.
    expect(dueState('2028-02-29', '2028-02-28')).toBe('dueSoon');
  });

  it('formats the viewer’s local date as YYYY-MM-DD from local fields, not UTC ones', () => {
    expect(localToday(new Date(2026, 8, 5, 1, 0, 0))).toBe('2026-09-05');
    expect(localToday(new Date(2026, 0, 1, 23, 59, 0))).toBe('2026-01-01');
  });
});

describe('navigation contract', () => {
  it('keeps the client routes and the Worker SPA allowlist in step', () => {
    // The Worker serves index.html only for the paths it allowlists. A route added on one
    // side and not the other is either a deep link that 404s or an unknown path that renders
    // the shell, so the two lists are compared directly rather than restated.
    expect([...ROUTES].sort()).toEqual([...SPA_ROUTES].sort());
  });
});
