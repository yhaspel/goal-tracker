import type { BoardSnapshot } from '../../../shared/api';

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
