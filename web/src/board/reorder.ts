import type { BoardColumn, BoardSnapshot } from '../../../shared/api';

/** A column and a one-based position, as spoken in a drag announcement. */
export type Place = { column: BoardColumn; position: number };

/** The part of a drag operation's drop target this module reads. The library types it loosely. */
export type DropTarget = { id?: unknown; index?: number; group?: unknown };

/**
 * Where the board holds a card right now.
 *
 * Dragging never mutates board state, so during a drag this still reports the place the card
 * will return to if the move is canceled or refused.
 */
export function placeOfCard(board: BoardSnapshot, cardId: string): Place | null {
  for (const column of board.columns) {
    const index = column.cards.findIndex(entry => entry.id === cardId);
    if (index >= 0) return { column, position: index + 1 };
  }
  return null;
}

/**
 * Where a dragged card would land if it were dropped on `target` right now.
 *
 * Read from the target rather than from the dragged item because the sortable plugin applies
 * its reordering in a microtask *after* the `dragover` handlers run — the dragged item still
 * reports its pre-move index at that point.
 *
 * Positions are one-based to match `card.movedTo`, so an announcement made mid-drag and the one
 * made after the server confirms agree on the number.
 */
export function projectedDrop(board: BoardSnapshot, cardId: string, target: DropTarget): Place | null {
  if (target.id === undefined || target.id === null) return null;
  const targetId = String(target.id);

  const asColumn = board.columns.find(column => column.id === targetId);
  if (asColumn) {
    // A column's own area appends to it — but only from somewhere else. Collision detection
    // also reports the column a card is already in, and calling that an append would announce
    // a jump to the end of the list that no drop would actually perform.
    const from = placeOfCard(board, cardId);
    if (from && from.column.id === asColumn.id) return from;
    return { column: asColumn, position: asColumn.cards.length + 1 };
  }

  // Otherwise the target is another card, and it hands over the slot it occupies.
  const group = target.group === undefined || target.group === null ? null : String(target.group);
  const column = board.columns.find(entry => entry.id === group);
  if (!column || target.index === undefined) return null;
  return { column, position: target.index + 1 };
}

/**
 * Reorders a board snapshot locally so a drag or a move control feels immediate.
 *
 * This is speculative only: the result is replaced by the server's board on the next fetch,
 * and restored to the previous snapshot if the move is refused. Positions are renumbered
 * densely so the optimistic view obeys the same invariant the server enforces.
 */
export function withMovedCard(
  board: BoardSnapshot,
  cardId: string,
  targetColumnId: string,
  targetIndex: number
): BoardSnapshot {
  const card = board.columns.flatMap(column => column.cards).find(entry => entry.id === cardId);
  const destinationExists = board.columns.some(column => column.id === targetColumnId);
  if (!card || !destinationExists) return board;

  const columns = board.columns.map(column => ({
    ...column,
    cards: column.cards.filter(entry => entry.id !== cardId)
  }));
  const destination = columns.find(column => column.id === targetColumnId);
  if (!destination) return board;

  const index = Math.max(0, Math.min(targetIndex, destination.cards.length));
  destination.cards.splice(index, 0, { ...card, columnId: targetColumnId });

  return {
    ...board,
    columns: columns.map(column => ({
      ...column,
      cards: column.cards.map((entry, position) => ({ ...entry, position }))
    }))
  };
}
