import { describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../shared/api';
import { ApiError } from '../web/src/api/client';
import { withMovedCard } from '../web/src/board/reorder';
import { errorText, fieldErrorText } from '../web/src/components/errors';
import { en } from '../web/src/i18n/en';
import { localeFromTags } from '../web/src/i18n';
import { createTranslate, interpolate } from '../web/src/i18n/translate';
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
      'unsupported_media_type'
    ];
    for (const code of codes) {
      expect(Object.prototype.hasOwnProperty.call(en, `error.${code}`), code).toBe(true);
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

describe('navigation contract', () => {
  it('keeps the client routes and the Worker SPA allowlist in step', () => {
    // The Worker serves index.html only for the paths it allowlists. A route added on one
    // side and not the other is either a deep link that 404s or an unknown path that renders
    // the shell, so the two lists are compared directly rather than restated.
    expect([...ROUTES].sort()).toEqual([...SPA_ROUTES].sort());
  });
});
