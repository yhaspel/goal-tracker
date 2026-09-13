import { Accessibility, defaultPreset } from '@dnd-kit/dom';
import { DragDropProvider, useDroppable } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { BoardCard, BoardColumn, BoardMember, BoardMutationResponse } from '../../../shared/api';
import { ApiError } from '../api/client';
import {
  createCard,
  createColumn,
  deleteCard,
  deleteColumn,
  moveCard,
  moveColumn,
  patchCard,
  renameColumn
} from '../api/endpoints';
import { useSession } from '../auth/session';
import { errorText } from '../components/errors';
import { Alert, Dialog, Field, Submit, useAnnounce, WithValue } from '../components/ui';
import { useTranslation } from '../i18n';
import { CardDialog, type CardDraft, draftFromCard } from './CardDialog';
import { type DropTarget, placeOfCard, projectedDrop, withMovedCard } from './reorder';
import { useBoard } from './useBoard';

const DRAG_PLUGINS = defaultPreset.plugins.filter(plugin => plugin !== Accessibility);

function columnLabel(column: BoardColumn, t: (key: 'board.column.todo' | 'board.column.in_progress' | 'board.column.done') => string): string {
  if (column.customName !== null) return column.customName;
  return t(`board.column.${column.nameKey ?? 'todo'}`);
}

export function BoardPage() {
  const translator = useTranslation();
  const { t, plural } = translator;
  const { state, forgetSession } = useSession();
  const announce = useAnnounce();

  const isOwner = state.status === 'active' && state.user.role === 'owner';
  const { board, error, loading, refresh, setOptimistic } = useBoard(state.status === 'active', forgetSession);

  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [editing, setEditing] = useState<{ card: BoardCard | null; columnId: string } | null>(null);
  const [draft, setDraft] = useState<CardDraft>(draftFromCard(null));
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [deletingCard, setDeletingCard] = useState<BoardCard | null>(null);
  const [deletingColumn, setDeletingColumn] = useState<BoardColumn | null>(null);
  const [columnForm, setColumnForm] = useState<{ column: BoardColumn | null; name: string } | null>(null);

  const members: readonly BoardMember[] = board?.activeMembers ?? [];

  /**
   * Runs one board mutation against the last confirmed revision.
   *
   * A `409 revision_conflict` never applies the change: the board reloads, the outcome is
   * announced, and any open editor keeps its text so the person can review and resubmit.
   */
  const runMutation = useCallback(
    async (
      call: (revision: number) => Promise<BoardMutationResponse>,
      options: { onConflict?: () => void; announceOnSuccess?: string } = {}
    ): Promise<boolean> => {
      if (!board || pending) return false;
      setPending(true);
      setFailure(null);
      try {
        await call(board.boardRevision);
        await refresh();
        if (options.announceOnSuccess) announce(options.announceOnSuccess);
        return true;
      } catch (cause) {
        setFailure(cause);
        if (cause instanceof ApiError && cause.status === 401) {
          forgetSession();
          return false;
        }
        if (cause instanceof ApiError && cause.code === 'revision_conflict') {
          options.onConflict?.();
          setChangedElsewhere(true);
          await refresh();
        }
        return false;
      } finally {
        setPending(false);
      }
    },
    [board, pending, refresh, announce, forgetSession]
  );

  const submitCard = useCallback(async () => {
    if (!editing) return;
    const assignee = draft.assigneeUserId.length > 0 ? draft.assigneeUserId : null;
    const description = draft.description.length > 0 ? draft.description : null;
    const saved = editing.card
      ? await runMutation(revision =>
          patchCard(editing.card!.id, {
            boardRevision: revision,
            title: draft.title,
            description,
            assigneeUserId: assignee
          })
        )
      : await runMutation(revision =>
          createCard({
            boardRevision: revision,
            columnId: editing.columnId,
            title: draft.title,
            description,
            assigneeUserId: assignee
          })
        );
    if (saved) {
      announce(t('card.saved', { title: draft.title }));
      setEditing(null);
      setChangedElsewhere(false);
    }
  }, [editing, draft, runMutation, announce, t]);

  const requestMove = useCallback(
    async (card: BoardCard, targetColumnId: string, targetIndex: number) => {
      if (!board) return;
      const previous = board;
      const destination = board.columns.find(column => column.id === targetColumnId);
      setOptimistic(withMovedCard(board, card.id, targetColumnId, targetIndex));
      const moved = await runMutation(
        revision => moveCard(card.id, { boardRevision: revision, targetColumnId, targetIndex }),
        {
          // Speculative ordering is thrown away; the reload below is the source of truth.
          onConflict: () => setOptimistic(previous)
        }
      );
      if (moved) {
        announce(
          t('card.movedTo', {
            title: card.title,
            column: destination ? columnLabel(destination, t) : '',
            position: targetIndex + 1
          })
        );
      } else {
        setOptimistic(previous);
        announce(t('card.moveRejected', { title: card.title }), 'assertive');
        await refresh();
      }
    },
    [board, runMutation, setOptimistic, announce, t, refresh]
  );

  /** Resolves the card a drag operation is carrying, if the board still knows about it. */
  const draggedCard = useCallback(
    (source: unknown): BoardCard | null => {
      const id = (source as { id?: unknown } | null)?.id;
      if (id === undefined || id === null || !board) return null;
      return board.columns.flatMap(column => column.cards).find(entry => entry.id === String(id)) ?? null;
    },
    [board]
  );

  /** Suppresses repeats while a drag rests on one slot, so the live region stays legible. */
  const lastSpokenPlace = useRef('');

  /**
   * A drag used to be silent between pick-up and drop: nothing said the card had been lifted,
   * and nothing said where the arrow keys had taken it. Both are announced here.
   */
  const onDragStart = useCallback(
    (event: { operation: { source: unknown } }) => {
      const card = draggedCard(event.operation.source);
      const place = card && board ? placeOfCard(board, card.id) : null;
      if (!card || !place) return;
      lastSpokenPlace.current = `${place.column.id}:${place.position}`;
      announce(
        t('card.dragPickedUp', {
          title: card.title,
          column: columnLabel(place.column, t),
          position: place.position
        })
      );
    },
    [board, draggedCard, announce, t]
  );

  const onDragOver = useCallback(
    (event: { operation: { source: unknown; target: unknown } }) => {
      const card = draggedCard(event.operation.source);
      const place = card && board ? projectedDrop(board, card.id, (event.operation.target ?? {}) as DropTarget) : null;
      if (!card || !place) return;
      const key = `${place.column.id}:${place.position}`;
      if (key === lastSpokenPlace.current) return;
      lastSpokenPlace.current = key;
      announce(
        t('card.dragOver', {
          title: card.title,
          column: columnLabel(place.column, t),
          position: place.position
        })
      );
    },
    [board, draggedCard, announce, t]
  );

  const onDragEnd = useCallback(
    (event: { canceled: boolean; operation: { source: unknown; target: unknown } }) => {
      lastSpokenPlace.current = '';
      if (event.canceled) {
        // Escape during a drag was silent too, leaving no way to tell a cancel from a move
        // that never registered.
        const card = draggedCard(event.operation.source);
        const place = card && board ? placeOfCard(board, card.id) : null;
        if (card && place) {
          announce(t('card.dragCanceled', { title: card.title, column: columnLabel(place.column, t) }));
        }
        return;
      }
      if (!board) return;
      const source = event.operation.source as {
        id?: string;
        index?: number;
        group?: string;
        initialIndex?: number;
        initialGroup?: string;
      } | null;
      if (!source?.id) return;
      const card = board.columns.flatMap(column => column.cards).find(entry => entry.id === source.id);
      if (!card) return;

      const columnIds = new Set(board.columns.map(column => column.id));
      const target = event.operation.target as { id?: string } | null;
      const droppedOn = target?.id === undefined ? null : String(target.id);
      const group = source.group === undefined ? null : String(source.group);

      // Dropping on a column's empty area targets the column itself; the sortable's own group
      // has not moved in that case, so it is read from the drop target and appended.
      if (droppedOn !== null && columnIds.has(droppedOn) && droppedOn !== group) {
        const destination = board.columns.find(column => column.id === droppedOn);
        void requestMove(card, droppedOn, destination?.cards.length ?? 0);
        return;
      }

      // Otherwise the sortable plugin has already computed the destination group and index.
      if (group === null || !columnIds.has(group) || source.index === undefined) return;
      if (group === source.initialGroup && source.index === source.initialIndex) return;
      void requestMove(card, group, source.index);
    },
    [board, requestMove]
  );

  const openCreate = (columnId: string) => {
    setDraft(draftFromCard(null));
    setChangedElsewhere(false);
    setFailure(null);
    setEditing({ card: null, columnId });
  };

  const openEdit = (card: BoardCard) => {
    setDraft(draftFromCard(card));
    setChangedElsewhere(false);
    setFailure(null);
    setEditing({ card, columnId: card.columnId });
  };

  const totalCards = useMemo(
    () => board?.columns.reduce((sum, column) => sum + column.cards.length, 0) ?? 0,
    [board]
  );

  if (error) {
    return (
      <section className="panel">
        <h1>{t('board.heading')}</h1>
        <Alert tone="error">{errorText(translator, error)}</Alert>
        <button type="button" onClick={() => void refresh()}>
          {t('board.reload')}
        </button>
      </section>
    );
  }

  if (loading || !board) {
    return (
      <section className="panel">
        <h1>{t('board.heading')}</h1>
        <p>{t('app.loading')}</p>
      </section>
    );
  }

  return (
    <div className="board-page">
      <div className="board-header">
        <h1>{t('board.heading')}</h1>
        {isOwner ? (
          <button type="button" onClick={() => setColumnForm({ column: null, name: '' })}>
            {t('board.addColumn')}
          </button>
        ) : null}
      </div>

      {failure && !editing ? <Alert tone="error">{errorText(translator, failure)}</Alert> : null}
      {totalCards === 0 ? <p className="help">{t('board.empty')}</p> : null}

      <p className="visually-hidden" id="drag-instructions">
        {t('card.dragInstructions')}
      </p>

      {/* The library's own announcer names items by opaque id, and would speak alongside our
          own result announcement. Dropping it leaves exactly one voice, in the chosen
          language, describing what the server actually saved. */}
      <DragDropProvider
        plugins={DRAG_PLUGINS}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <ol className="board" aria-label={t('board.heading')} role="list">
          {board.columns.map((column, columnIndex) => (
            <ColumnView
              key={column.id}
              column={column}
              columnIndex={columnIndex}
              columns={board.columns}
              members={members}
              isOwner={isOwner}
              pending={pending}
              onAddCard={() => openCreate(column.id)}
              onRename={() => setColumnForm({ column, name: columnLabel(column, t) })}
              onDelete={() => setDeletingColumn(column)}
              onMoveColumn={index =>
                void runMutation(revision => moveColumn(column.id, { boardRevision: revision, targetIndex: index }))
              }
              onEditCard={openEdit}
              onDeleteCard={setDeletingCard}
              onMoveCard={requestMove}
            />
          ))}
        </ol>
      </DragDropProvider>

      {editing ? (
        <CardDialog
          card={editing.card}
          draft={draft}
          onDraftChange={setDraft}
          members={members}
          onSubmit={() => void submitCard()}
          onClose={() => {
            setEditing(null);
            setDraft(draftFromCard(null));
            setChangedElsewhere(false);
          }}
          pending={pending}
          failure={failure}
          changedElsewhere={changedElsewhere}
        />
      ) : null}

      {deletingCard ? (
        <Dialog
          title={t('app.delete')}
          onClose={() => setDeletingCard(null)}
          footer={
            <>
              <button type="button" onClick={() => setDeletingCard(null)}>
                {t('app.cancel')}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const card = deletingCard;
                  setDeletingCard(null);
                  void runMutation(revision => deleteCard(card.id, { boardRevision: revision }), {
                    announceOnSuccess: t('card.deleted', { title: card.title })
                  });
                }}
              >
                {t('app.delete')}
              </button>
            </>
          }
        >
          <p>
            {/* The title is whatever the member typed, so it keeps its own direction. */}
            <WithValue template={t('card.deleteConfirm')} name="title">
              <span dir="auto">{deletingCard.title}</span>
            </WithValue>
          </p>
        </Dialog>
      ) : null}

      {deletingColumn ? (
        <Dialog
          title={t('app.delete')}
          onClose={() => setDeletingColumn(null)}
          footer={
            <>
              <button type="button" onClick={() => setDeletingColumn(null)}>
                {t('app.cancel')}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const column = deletingColumn;
                  setDeletingColumn(null);
                  void runMutation(revision => deleteColumn(column.id, { boardRevision: revision }));
                }}
              >
                {t('app.delete')}
              </button>
            </>
          }
        >
          <p>
            <WithValue template={t('board.deleteColumnConfirm')} name="name">
              <span dir="auto">{columnLabel(deletingColumn, t)}</span>
            </WithValue>
          </p>
        </Dialog>
      ) : null}

      {columnForm ? (
        <Dialog title={columnForm.column ? t('board.renameColumn', { name: '' }) : t('board.addColumn')} onClose={() => setColumnForm(null)}>
          <form
            onSubmit={event => {
              event.preventDefault();
              const form = columnForm;
              void runMutation(revision =>
                form.column
                  ? renameColumn(form.column.id, { boardRevision: revision, name: form.name })
                  : createColumn({ boardRevision: revision, name: form.name })
              ).then(saved => {
                if (saved) setColumnForm(null);
              });
            }}
            noValidate
          >
            <Field
              label={t('board.columnName')}
              value={columnForm.name}
              onChange={name => setColumnForm({ ...columnForm, name })}
              autoComplete="off"
              autoDir
              required
            />
            {failure ? <Alert tone="error">{errorText(translator, failure)}</Alert> : null}
            <div className="dialog-footer">
              <button type="button" onClick={() => setColumnForm(null)}>
                {t('app.cancel')}
              </button>
              <Submit pending={pending}>{t('app.save')}</Submit>
            </div>
          </form>
        </Dialog>
      ) : null}

      <p className="visually-hidden">{plural('board.cardCount', totalCards)}</p>
    </div>
  );
}

function ColumnView({
  column,
  columnIndex,
  columns,
  members,
  isOwner,
  pending,
  onAddCard,
  onRename,
  onDelete,
  onMoveColumn,
  onEditCard,
  onDeleteCard,
  onMoveCard
}: {
  column: BoardColumn;
  columnIndex: number;
  columns: readonly BoardColumn[];
  members: readonly BoardMember[];
  isOwner: boolean;
  pending: boolean;
  onAddCard: () => void;
  onRename: () => void;
  onDelete: () => void;
  onMoveColumn: (index: number) => void;
  onEditCard: (card: BoardCard) => void;
  onDeleteCard: (card: BoardCard) => void;
  onMoveCard: (card: BoardCard, targetColumnId: string, targetIndex: number) => void;
}) {
  const { t, plural } = useTranslation();
  const label = columnLabel(column, t);
  // Lets an empty column accept a drop; cards register their own sortable targets.
  const { ref } = useDroppable({ id: column.id, type: 'column', accept: 'card' });

  return (
    <li className="column" role="listitem">
      <div className="column-header">
        <h2 dir="auto">{label}</h2>
        <span className="help">{plural('board.cardCount', column.cards.length)}</span>
        {isOwner ? (
          <div className="column-actions">
            <button type="button" onClick={onRename} disabled={pending}>
              {t('board.renameColumn', { name: label })}
            </button>
            <button
              type="button"
              onClick={() => onMoveColumn(columnIndex - 1)}
              disabled={pending || columnIndex === 0}
            >
              {t('board.moveColumnStart', { name: label })}
            </button>
            <button
              type="button"
              onClick={() => onMoveColumn(columnIndex + 1)}
              disabled={pending || columnIndex === columns.length - 1}
            >
              {t('board.moveColumnEnd', { name: label })}
            </button>
            <button type="button" onClick={onDelete} disabled={pending || columns.length <= 1}>
              {t('board.deleteColumn', { name: label })}
            </button>
          </div>
        ) : null}
      </div>

      {/* `list-style: none` with a flex layout drops list semantics in some browsers, so the
          roles are restored explicitly. */}
      <ol className="card-list" ref={ref} aria-label={label} role="list">
        {column.cards.map((card, index) => (
          <CardView
            key={card.id}
            card={card}
            index={index}
            column={column}
            columns={columns}
            assigneeEmail={
              card.assigneeUserId === null
                ? null
                : (members.find(member => member.id === card.assigneeUserId)?.email ?? card.assigneeUserId)
            }
            pending={pending}
            onEdit={() => onEditCard(card)}
            onDelete={() => onDeleteCard(card)}
            onMove={onMoveCard}
          />
        ))}
        {column.cards.length === 0 ? (
          <li className="empty help" role="listitem">
            {t('board.columnEmpty')}
          </li>
        ) : null}
      </ol>

      <button type="button" onClick={onAddCard} disabled={pending}>
        {t('board.addCard')}
      </button>
    </li>
  );
}

function CardView({
  card,
  index,
  column,
  columns,
  assigneeEmail,
  pending,
  onEdit,
  onDelete,
  onMove
}: {
  card: BoardCard;
  index: number;
  column: BoardColumn;
  columns: readonly BoardColumn[];
  assigneeEmail: string | null;
  pending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (card: BoardCard, targetColumnId: string, targetIndex: number) => void;
}) {
  const { t } = useTranslation();
  // The handle is a small button rather than the whole card. Making the card itself draggable
  // turns it into one giant button whose accessible name swallows every control inside it.
  const { ref, handleRef, isDragging } = useSortable({
    id: card.id,
    index,
    group: column.id,
    type: 'card',
    accept: 'card'
  });
  const assignee = assigneeEmail === null ? t('card.unassigned') : assigneeEmail;

  return (
    <li className={isDragging ? 'card dragging' : 'card'} ref={ref} role="listitem">
      <div className="card-head">
        <button
          type="button"
          className="drag-handle"
          ref={handleRef}
          aria-label={t('card.dragHandle', { title: card.title })}
          aria-describedby="drag-instructions"
        >
          <span aria-hidden="true">⠿</span>
        </button>
        <h3 dir="auto">{card.title}</h3>
      </div>
      {card.description !== null ? (
        <p className="card-description" dir="auto">
          {card.description}
        </p>
      ) : null}
      <p className="help">
        {t('card.assignee')}:{' '}
        <span className="isolate" dir="ltr">
          {assignee}
        </span>
      </p>

      <div className="card-actions" role="group" aria-label={t('card.actions', { title: card.title })}>
        <button type="button" onClick={onEdit} disabled={pending}>
          {t('app.edit')}
        </button>
        <button type="button" onClick={() => onMove(card, column.id, index - 1)} disabled={pending || index === 0}>
          {t('card.moveUp')}
        </button>
        <button
          type="button"
          onClick={() => onMove(card, column.id, index + 1)}
          disabled={pending || index === column.cards.length - 1}
        >
          {t('card.moveDown')}
        </button>
        {/* Named by `aria-label` rather than a `<label for>`: the drag overlay is a clone of
            this whole card, and any `id` in here would be duplicated in the document while a
            drag is in flight. */}
        <select
          aria-label={t('card.moveToColumn')}
          value=""
          disabled={pending}
          onChange={event => {
            const targetColumnId = event.target.value;
            if (targetColumnId.length === 0) return;
            const destination = columns.find(entry => entry.id === targetColumnId);
            onMove(card, targetColumnId, destination?.cards.length ?? 0);
            event.target.value = '';
          }}
        >
          <option value="">{t('card.moveToColumn')}</option>
          {columns
            .filter(entry => entry.id !== column.id)
            .map(entry => (
              <option key={entry.id} value={entry.id}>
                {columnLabel(entry, t)}
              </option>
            ))}
        </select>
        <button type="button" className="danger" onClick={onDelete} disabled={pending}>
          {t('app.delete')}
        </button>
      </div>
    </li>
  );
}
