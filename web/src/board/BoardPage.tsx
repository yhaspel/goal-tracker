import { Accessibility, defaultPreset } from '@dnd-kit/dom';
import { DragDropProvider, useDroppable } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';
import {
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type {
  BoardCard,
  BoardColumn,
  BoardMember,
  BoardMutationResponse,
  BoardSnapshot,
  GoalsIndex
} from '../../../shared/api';
import { ApiError } from '../api/client';
import {
  createCard,
  createColumn,
  deleteCard,
  deleteColumn,
  moveCard,
  moveColumn,
  patchCard,
  readGoalsIndex,
  renameColumn
} from '../api/endpoints';
import { useSession } from '../auth/session';
import { ActionsMenu, type MenuEntry } from '../components/ActionsMenu';
import { errorText } from '../components/errors';
import {
  CheckIcon,
  ChevronEndIcon,
  ChevronStartIcon,
  GripIcon,
  PencilIcon,
  PersonIcon,
  PlusIcon,
  TrashIcon
} from '../components/icons';
import {
  Alert,
  Dialog,
  Field,
  Submit,
  useAnnounce,
  useCalendarDay,
  useMediaQuery,
  WithValue
} from '../components/ui';
import { useTranslation } from '../i18n';
import { CardDialog, type CardDraft, draftFromCard } from './CardDialog';
import { dueState } from './due';
import { type DropTarget, placeOfCard, projectedDrop, withMovedCard } from './reorder';
import { useBoard } from './useBoard';

const DRAG_PLUGINS = defaultPreset.plugins.filter(plugin => plugin !== Accessibility);

/** Below this the board is a column pager rather than a track, and dialogs are sheets. */
const PHONE = '(max-width: 833px)';

function columnLabel(column: BoardColumn, t: (key: 'board.column.todo' | 'board.column.in_progress' | 'board.column.done') => string): string {
  if (column.customName !== null) return column.customName;
  return t(`board.column.${column.nameKey ?? 'todo'}`);
}

/**
 * The class set a column wears: the tinted plate identifies a built-in column, a renamed one
 * drops the tint, and Done takes the reversed steel cap.
 */
function columnClass(column: BoardColumn): string {
  if (column.customName !== null) return 'column column-custom';
  return column.nameKey === 'done' ? 'column column-done' : 'column';
}

/**
 * The avatar is derived purely from the address: the first character of the local part,
 * uppercased, on one of four ramp pairs chosen by hashing the whole address. The letter and the
 * address carry the meaning; the fill is decoration, which is why a non-Latin local part simply
 * shows its own first character.
 */
function avatarOf(email: string): { letter: string; tone: number } {
  const at = email.indexOf('@');
  const local = at < 0 ? email : email.slice(0, at);
  const letter = [...local][0]?.toLocaleUpperCase() ?? '?';
  let hash = 0;
  for (const character of email) hash = (hash * 31 + character.codePointAt(0)!) % 997;
  return { letter, tone: hash % 4 };
}

export function BoardPage() {
  const translator = useTranslation();
  const { t, plural, dir } = translator;
  const { state, forgetSession } = useSession();
  const announce = useAnnounce();
  const phone = useMediaQuery(PHONE);

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
  /** The column the phone pager is showing. Clamped in case columns disappear under it. */
  const [pagerIndex, setPagerIndex] = useState(0);
  /** Where the current swipe began. A ref, so a re-render mid-gesture cannot lose it. */
  const swipeFrom = useRef<{ x: number; y: number } | null>(null);

  const members: readonly BoardMember[] = board?.activeMembers ?? [];

  /**
   * The "Part of" choices, fetched once on mount and again after a card mutation that touched
   * `milestoneId` — **never polled**. A second 30 s poll would double the board's Durable Object
   * cost for a list that changes rarely. Its failure is isolated: `null` hides the selector and
   * renders a linked card's badge without a name, and never blocks a working board.
   */
  const [goalsIndex, setGoalsIndex] = useState<GoalsIndex | null>(null);
  const refreshGoalsIndex = useCallback(() => {
    void readGoalsIndex()
      .then(setGoalsIndex)
      .catch(() => setGoalsIndex(null));
  }, []);

  useEffect(() => {
    if (state.status !== 'active') return;
    refreshGoalsIndex();
  }, [state.status, refreshGoalsIndex]);

  const milestoneTitles = useMemo(() => {
    const titles = new Map<string, string>();
    for (const milestone of goalsIndex?.milestones ?? []) titles.set(milestone.id, milestone.title);
    return titles;
  }, [goalsIndex]);

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
    const dueDate = draft.dueDate.length > 0 ? draft.dueDate : null;
    const milestoneId = draft.milestoneId.length > 0 ? draft.milestoneId : null;
    const linkChanged = (editing.card?.milestoneId ?? null) !== milestoneId;
    const saved = editing.card
      ? await runMutation(revision =>
          patchCard(editing.card!.id, {
            boardRevision: revision,
            title: draft.title,
            description,
            assigneeUserId: assignee,
            dueDate,
            milestoneId
          })
        )
      : await runMutation(revision =>
          createCard({
            boardRevision: revision,
            columnId: editing.columnId,
            title: draft.title,
            description,
            assigneeUserId: assignee,
            dueDate,
            milestoneId
          })
        );
    if (saved) {
      announce(t('card.saved', { title: draft.title }));
      setEditing(null);
      setChangedElsewhere(false);
      // Only when the link actually moved: the list changes rarely, and this is its only refresh.
      if (linkChanged) refreshGoalsIndex();
    }
  }, [editing, draft, runMutation, announce, t, refreshGoalsIndex]);

  const requestMove = useCallback(
    async (card: BoardCard, targetColumnId: string, targetIndex: number, restoreTo?: BoardSnapshot) => {
      if (!board) return;
      // A drag has already moved the card locally, so the board to restore on a refusal is the
      // one from before the drag started, not the one this call was made against.
      const previous = restoreTo ?? board;
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
   * The board as it stood when the current drag was picked up.
   *
   * A drag now reorders the board locally as it goes, which is what lets a card cross into
   * another column; this is what a cancel or a refused move puts back.
   */
  const dragOrigin = useRef<BoardSnapshot | null>(null);

  /**
   * Where the drag would land, written on every step.
   *
   * This is a ref and not read back off `board` at the end, because the last `dragover`'s state
   * update has not necessarily been committed by the time `dragend` runs: reading the snapshot
   * there lands the card one step behind what was just announced.
   */
  const dragPlace = useRef<{ columnId: string; position: number } | null>(null);

  /**
   * A drag used to be silent between pick-up and drop: nothing said the card had been lifted,
   * and nothing said where the arrow keys had taken it. Both are announced here.
   */
  const onDragStart = useCallback(
    (event: { operation: { source: unknown } }) => {
      const card = draggedCard(event.operation.source);
      const place = card && board ? placeOfCard(board, card.id) : null;
      if (!card || !place) return;
      dragOrigin.current = board;
      dragPlace.current = { columnId: place.column.id, position: place.position };
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
      // A last `dragover` can arrive after `dragend` has already unwound the operation. Acting
      // on it re-applies the move that was just canceled, leaving the board showing a card in a
      // column the server does not have it in. `dragOrigin` is only set while a drag is live.
      if (!dragOrigin.current) return;
      const card = draggedCard(event.operation.source);
      if (!card || !board) return;
      const place = projectedDrop(board, card.id, (event.operation.target ?? {}) as DropTarget);
      if (!place) return;
      const key = `${place.column.id}:${place.position}`;
      if (key === lastSpokenPlace.current) return;
      lastSpokenPlace.current = key;
      dragPlace.current = { columnId: place.column.id, position: place.position };
      // Moving the card in board state here is what makes a cross-column drag work at all.
      // Left to itself the sortable plugin relocates the card's own DOM node into the other
      // column's list, which React did not do and cannot then reconcile: it tears the board
      // down on the next render. Reordering the snapshot instead makes React perform the move,
      // and the plugin stands down as soon as it sees the indices it was about to write.
      setOptimistic(withMovedCard(board, card.id, place.column.id, place.position - 1));
      announce(
        t('card.dragOver', {
          title: card.title,
          column: columnLabel(place.column, t),
          position: place.position
        })
      );
    },
    [board, draggedCard, setOptimistic, announce, t]
  );

  const onDragEnd = useCallback(
    (event: { canceled: boolean; operation: { source: unknown; target: unknown } }) => {
      lastSpokenPlace.current = '';
      const origin = dragOrigin.current;
      const landing = dragPlace.current;
      dragOrigin.current = null;
      dragPlace.current = null;
      const card = draggedCard(event.operation.source);
      // The card can go missing mid-drag if someone else deletes it. Put the board back rather
      // than leaving the drag's own speculative ordering on screen.
      if (!card || !board) {
        if (origin) setOptimistic(origin);
        return;
      }

      if (event.canceled) {
        // Escape during a drag was silent too, leaving no way to tell a cancel from a move
        // that never registered. The board goes back to where the card was picked up from.
        const place = placeOfCard(origin ?? board, card.id);
        if (origin) setOptimistic(origin);
        if (place) {
          announce(t('card.dragCanceled', { title: card.title, column: columnLabel(place.column, t) }));
        }
        return;
      }

      // The landing comes from the same projection every announcement was made from, so what
      // was said mid-drag and what is sent now cannot disagree.
      const started = placeOfCard(origin ?? board, card.id);
      if (!landing || !started) {
        if (origin) setOptimistic(origin);
        return;
      }
      if (landing.columnId === started.column.id && landing.position === started.position) {
        if (origin) setOptimistic(origin);
        return;
      }
      void requestMove(card, landing.columnId, landing.position - 1, origin ?? board);
    },
    [board, draggedCard, requestMove, setOptimistic, announce, t]
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
    // The shape of the board that is coming rather than a spinner. The word is still rendered,
    // for screen readers and for anyone who cannot see the shimmer.
    return (
      <div className="board-page">
        <div className="board-header">
          <h1>{t('board.heading')}</h1>
          <p className="board-count">{t('app.loading')}</p>
        </div>
        <div className="skeleton-board" aria-hidden="true">
          {[0, 1, 2].map(index => (
            <div className="skeleton-column" key={index}>
              <div className="skeleton-head" />
              <div className="skeleton-block" />
              {index === 1 ? null : <div className="skeleton-block" />}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const columns = board.columns;
  const active = columns.length === 0 ? 0 : Math.min(pagerIndex, columns.length - 1);
  const activeColumn = columns[active];
  const openColumnForm = () => setColumnForm({ column: null, name: '' });

  const columnProps = (column: BoardColumn, columnIndex: number) => ({
    column,
    columnIndex,
    columns,
    members,
    milestoneTitles,
    isOwner,
    pending,
    phone,
    onAddCard: () => openCreate(column.id),
    onRename: () => setColumnForm({ column, name: columnLabel(column, t) }),
    onDelete: () => setDeletingColumn(column),
    onMoveColumn: (index: number) =>
      void runMutation(revision => moveColumn(column.id, { boardRevision: revision, targetIndex: index })),
    onEditCard: openEdit,
    onDeleteCard: setDeletingCard,
    onMoveCard: requestMove
  });

  /** A horizontal swipe on the card list steps one column, mirrored for a right-to-left page. */
  const onSwipeStart = (event: ReactTouchEvent) => {
    const touch = event.touches[0];
    swipeFrom.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const onSwipeEnd = (event: ReactTouchEvent) => {
    const start = swipeFrom.current;
    const touch = event.changedTouches[0];
    swipeFrom.current = null;
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    // A mostly-vertical drag is the list scrolling, not a column change.
    if (Math.abs(deltaX) < 56 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    const towardsEnd = dir === 'rtl' ? deltaX > 0 : deltaX < 0;
    setPagerIndex(current => Math.min(Math.max(current + (towardsEnd ? 1 : -1), 0), columns.length - 1));
  };

  return (
    <div className="board-page">
      <div className="board-header">
        <h1>{t('board.heading')}</h1>
        <p className="board-count">{plural('board.cardCount', totalCards)}</p>
        {/* On a phone the dashed add-a-column plate at the end of the track has nowhere to
            live, so the owner's control sits in the header instead. */}
        {isOwner && phone ? (
          <button type="button" onClick={openColumnForm}>
            <PlusIcon />
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
        {phone && activeColumn ? (
          <div className="pager">
            {/* The chip row is the switcher, and it is the only sideways-scrolling thing on the
                screen — the page itself still never scrolls sideways. */}
            <div className="pager-tabs" role="tablist" aria-label={t('board.heading')}>
              {columns.map((column, index) => (
                <button
                  key={column.id}
                  type="button"
                  role="tab"
                  id={`pager-tab-${column.id}`}
                  className="pager-tab"
                  aria-selected={index === active}
                  aria-controls={`pager-panel-${column.id}`}
                  tabIndex={index === active ? 0 : -1}
                  onClick={() => setPagerIndex(index)}
                  onKeyDown={event => {
                    const pressed = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                    if (pressed === 0) return;
                    event.preventDefault();
                    const forward = dir === 'rtl' ? -pressed : pressed;
                    const next = (index + forward + columns.length) % columns.length;
                    setPagerIndex(next);
                    document.getElementById(`pager-tab-${columns[next]!.id}`)?.focus();
                  }}
                >
                  <span dir="auto">{columnLabel(column, t)}</span>
                  <span className="pager-tab-count">{column.cards.length}</span>
                </button>
              ))}
            </div>

            <div className="pager-nav">
              <button
                type="button"
                className="icon"
                disabled={active === 0}
                aria-label={columnLabel(columns[active - 1] ?? activeColumn, t)}
                onClick={() => setPagerIndex(active - 1)}
              >
                <ChevronStartIcon />
              </button>
              <div className="pager-title">
                <h2 dir="auto">{columnLabel(activeColumn, t)}</h2>
                <p className="pager-position">{t('board.columnPosition', { n: active + 1, total: columns.length })}</p>
              </div>
              <button
                type="button"
                className="icon"
                disabled={active === columns.length - 1}
                aria-label={columnLabel(columns[active + 1] ?? activeColumn, t)}
                onClick={() => setPagerIndex(active + 1)}
              >
                <ChevronEndIcon />
              </button>
            </div>

            <div className="pager-panel" onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd}>
              <ColumnView key={activeColumn.id} {...columnProps(activeColumn, active)} />
            </div>

            <p className="pager-dots" aria-hidden="true">
              {columns.map((column, index) => (
                <span key={column.id} className="pager-dot" data-current={index === active} />
              ))}
            </p>
          </div>
        ) : (
          <BoardTrack isOwner={isOwner} pending={pending} onAddColumn={openColumnForm} columnCount={columns.length}>
            {columns.map((column, columnIndex) => (
              <ColumnView key={column.id} {...columnProps(column, columnIndex)} />
            ))}
          </BoardTrack>
        )}
      </DragDropProvider>

      {editing ? (
        <CardDialog
          card={editing.card}
          draft={draft}
          onDraftChange={setDraft}
          members={members}
          goalsIndex={goalsIndex}
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
    </div>
  );
}

/**
 * The desktop and tablet board: one contained horizontal track. The page itself never scrolls
 * sideways, so when more board sits past the end edge the track says so with a fade and offers
 * a keyboard-reachable button that scrolls it — a control that only exists while there is
 * something left to scroll to.
 */
function BoardTrack({
  children,
  isOwner,
  pending,
  onAddColumn,
  columnCount
}: {
  children: ReactNode;
  isOwner: boolean;
  pending: boolean;
  onAddColumn: () => void;
  columnCount: number;
}) {
  const { t, dir } = useTranslation();
  const track = useRef<HTMLOListElement>(null);
  const [canScrollEnd, setCanScrollEnd] = useState(false);

  const measure = useCallback(() => {
    const element = track.current;
    if (!element) return;
    // `scrollLeft` counts down from zero in a right-to-left track, so distance is its magnitude.
    const travelled = Math.abs(element.scrollLeft);
    setCanScrollEnd(travelled + element.clientWidth < element.scrollWidth - 1);
  }, []);

  useEffect(() => {
    measure();
    const element = track.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure, columnCount]);

  return (
    <div className="board-track" data-overflow={canScrollEnd}>
      <ol className="board" aria-label={t('board.heading')} role="list" ref={track} onScroll={measure}>
        {children}
        {isOwner ? (
          <li role="listitem">
            <button type="button" className="add-column" onClick={onAddColumn} disabled={pending}>
              <PlusIcon />
              {t('board.addColumn')}
            </button>
          </li>
        ) : null}
      </ol>
      {canScrollEnd ? (
        <button
          type="button"
          className="board-scroll-end"
          aria-label={t('board.scrollEnd')}
          onClick={() => {
            const element = track.current;
            if (!element) return;
            const step = element.clientWidth * 0.8;
            element.scrollBy({ left: dir === 'rtl' ? -step : step });
          }}
        >
          <ChevronEndIcon />
        </button>
      ) : null}
    </div>
  );
}

function ColumnView({
  column,
  columnIndex,
  columns,
  members,
  milestoneTitles,
  isOwner,
  pending,
  phone,
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
  milestoneTitles: ReadonlyMap<string, string>;
  isOwner: boolean;
  pending: boolean;
  phone: boolean;
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
  const isDone = column.customName === null && column.nameKey === 'done';
  // Lets an empty column accept a drop; cards register their own sortable targets.
  const { ref } = useDroppable({ id: column.id, type: 'column', accept: 'card' });

  const body = (
    <>
      {/* The pager already names the column above the panel, so it is not repeated inside. */}
      {phone ? null : (
        <div className="column-header">
          {/* A card arriving in Done redraws the cap's check, once: a quiet acknowledgement,
              not a reward. Keying it on the count is what makes the stroke run again. */}
          {isDone ? <CheckIcon key={column.cards.length} className="done-check" /> : null}
          <h2 dir="auto">{label}</h2>
          <span className="column-count">{plural('board.cardCount', column.cards.length)}</span>
        </div>
      )}

      {/*
       * Owner controls are their own strip under the header, separated by a hairline — present
       * for the owner, absent for members, never disabled-and-teasing. Each is an icon button
       * whose accessible name is the same full sentence the button used to show: four names
       * like "Move Waiting on someone towards the start" cannot be read as visible text inside
       * a 272px column in any of the three languages.
       */}
      {isOwner ? (
        <div className="column-actions">
          <button type="button" className="icon" onClick={onRename} disabled={pending} aria-label={t('board.renameColumn', { name: label })}>
            <PencilIcon className="icon icon-sm" />
          </button>
          <button
            type="button"
            className="icon"
            onClick={() => onMoveColumn(columnIndex - 1)}
            disabled={pending || columnIndex === 0}
            aria-label={t('board.moveColumnStart', { name: label })}
          >
            <ChevronStartIcon className="icon icon-sm" />
          </button>
          <button
            type="button"
            className="icon"
            onClick={() => onMoveColumn(columnIndex + 1)}
            disabled={pending || columnIndex === columns.length - 1}
            aria-label={t('board.moveColumnEnd', { name: label })}
          >
            <ChevronEndIcon className="icon icon-sm" />
          </button>
          <button
            type="button"
            className="icon"
            onClick={onDelete}
            disabled={pending || columns.length <= 1}
            aria-label={t('board.deleteColumn', { name: label })}
          >
            <TrashIcon className="icon icon-sm" />
          </button>
        </div>
      ) : null}

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
            phone={phone}
            assigneeEmail={
              card.assigneeUserId === null
                ? null
                : (members.find(member => member.id === card.assigneeUserId)?.email ?? card.assigneeUserId)
            }
            milestoneTitle={card.milestoneId === null ? null : (milestoneTitles.get(card.milestoneId) ?? null)}
            pending={pending}
            onEdit={() => onEditCard(card)}
            onDelete={() => onDeleteCard(card)}
            onMove={onMoveCard}
          />
        ))}
        {/* A dashed slot keeps the column's height and doubles as the visible drop target, so
            an empty column never looks like a rendering error. */}
        {column.cards.length === 0 ? (
          <li className="card-slot" role="listitem">
            {t('board.columnEmpty')}
          </li>
        ) : null}
      </ol>

      <button type="button" className="add-card" onClick={onAddCard} disabled={pending}>
        <PlusIcon />
        {/* On a phone the button names the column it will add to, so a card can never land in
            the wrong one by accident. */}
        {phone ? t('board.addCardTo', { column: label }) : t('board.addCard')}
      </button>
    </>
  );

  if (phone) {
    return (
      <div
        className={columnClass(column)}
        role="tabpanel"
        id={`pager-panel-${column.id}`}
        aria-labelledby={`pager-tab-${column.id}`}
      >
        {body}
      </div>
    );
  }

  return (
    <li className={columnClass(column)} role="listitem">
      {body}
    </li>
  );
}

/**
 * Which of the three sentences a due date reads as, decided here against the viewer's own local
 * date. Nothing server-side ever compares a due date to the current time.
 */
function DueBadge({ dueDate }: { dueDate: string }) {
  const { t } = useTranslation();
  const day = useCalendarDay();
  const state = dueState(dueDate);
  const text = t(state === 'overdue' ? 'card.overdue' : state === 'dueSoon' ? 'card.dueSoon' : 'card.due', {
    date: day(dueDate)
  });
  return <span className={state === 'due' ? 'badge' : 'badge warning'}>{text}</span>;
}

function CardView({
  card,
  index,
  column,
  columns,
  phone,
  assigneeEmail,
  milestoneTitle,
  pending,
  onEdit,
  onDelete,
  onMove
}: {
  card: BoardCard;
  index: number;
  column: BoardColumn;
  columns: readonly BoardColumn[];
  phone: boolean;
  assigneeEmail: string | null;
  /** `null` when the goals index could not be read; the badge then names no milestone. */
  milestoneTitle: string | null;
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
  const avatar = assigneeEmail === null ? null : avatarOf(assigneeEmail);

  return (
    <li className={isDragging ? 'card dragging' : 'card'} ref={ref} role="listitem">
      {/* The held marker belongs to the card and not to the animation, so a reduced-motion
          preference that removes the tilt still leaves the picked-up state visible. */}
      {isDragging ? (
        <span className="held-marker" aria-hidden="true">
          <GripIcon className="icon-sm" />
        </span>
      ) : null}

      <div className="card-head">
        <h3 className="card-title">
          {/* Activating the title opens Edit — that is how editing stays one step from the
              board, and what let four of the five per-card controls move into the menu. */}
          <button type="button" className="card-title-button" dir="auto" onClick={onEdit} disabled={pending}>
            {card.title}
          </button>
        </h3>
        <div className="card-tools">
          {/* A phone has no drag handle at all: touch-dragging inside a swipeable, scrollable
              list is a trap, and everything dragging could do lives in the actions menu. */}
          {phone ? null : (
            <button
              type="button"
              className="icon drag-handle"
              ref={handleRef}
              aria-label={t('card.dragHandle', { title: card.title })}
              aria-describedby="drag-instructions"
            >
              <GripIcon />
            </button>
          )}
          <ActionsMenu
            entries={cardMenuEntries(card, index, column, columns, pending, t, onEdit, onDelete, onMove)}
            triggerLabel={t('card.actions', { title: card.title })}
            menuLabel={t('card.actions', { title: card.title })}
          />
        </div>
      </div>

      {/* Clamped to two lines. The full 4,000 characters live in the edit dialog, one step away
          through the title, so there is no expand toggle and no new string for it. */}
      {card.description !== null ? (
        <p className="card-description" dir="auto">
          {card.description}
        </p>
      ) : null}

      {/*
       * Neither badge is a control, so the card still carries exactly two. `.badge` already
       * carries a mark as well as a colour, and each of the three due states is its own
       * dictionary sentence, so the meaning never rests on the tint.
       */}
      {card.dueDate !== null || card.milestoneId !== null ? (
        <p className="card-badges">
          {card.dueDate !== null ? <DueBadge dueDate={card.dueDate} /> : null}
          {card.milestoneId !== null ? (
            <span className="badge">
              {milestoneTitle === null ? (
                t('card.partOfUnknown')
              ) : (
                <WithValue template={t('card.partOfBadge')} name="milestone">
                  <span dir="auto">{milestoneTitle}</span>
                </WithValue>
              )}
            </span>
          ) : null}
        </p>
      ) : null}

      <p className="card-meta">
        <span className="visually-hidden">{t('card.assignee')}: </span>
        {avatar === null ? (
          <span className="avatar avatar-none" aria-hidden="true">
            <PersonIcon className="icon-sm" />
          </span>
        ) : (
          <span className={`avatar avatar-${avatar.tone}`} aria-hidden="true">
            {avatar.letter}
          </span>
        )}
        {/* The address is one line, ellipsised at the end by the stylesheet; the full value
            stays in the DOM, and in the tooltip. It keeps its own direction in a Hebrew page. */}
        <span className="isolate" dir="ltr" title={assignee}>
          {assignee}
        </span>
      </p>
    </li>
  );
}

/**
 * Two controls per card instead of five.
 *
 * Edit, move up, move down, move to column and delete all call the same handlers they did when
 * each was its own control on the card; nothing became drag-only, and every one of them is still
 * one or two keystrokes away. The menu itself now lives in `components/ActionsMenu.tsx`, because
 * the goals screen and the vision board need the same keyboard contract and three copies of it
 * would drift apart.
 */
function cardMenuEntries(
  card: BoardCard,
  index: number,
  column: BoardColumn,
  columns: readonly BoardColumn[],
  pending: boolean,
  t: ReturnType<typeof useTranslation>['t'],
  onEdit: () => void,
  onDelete: () => void,
  onMove: (card: BoardCard, targetColumnId: string, targetIndex: number) => void
): MenuEntry[] {
  return [
    { key: 'edit', label: t('app.edit'), disabled: pending, run: onEdit },
    // Disabled at the ends of the list rather than hidden, so the menu keeps its shape.
    { key: 'up', label: t('card.moveUp'), disabled: pending || index === 0, run: () => onMove(card, column.id, index - 1) },
    {
      key: 'down',
      label: t('card.moveDown'),
      disabled: pending || index === column.cards.length - 1,
      run: () => onMove(card, column.id, index + 1)
    },
    // The current column is omitted: a card can never be "moved" to where it already is.
    ...columns
      .filter(entry => entry.id !== column.id)
      .map(entry => ({
        key: `column-${entry.id}`,
        label: columnLabel(entry, t),
        disabled: pending,
        group: t('card.moveToColumn'),
        autoDir: true,
        run: () => onMove(card, entry.id, entry.cards.length)
      })),
    { key: 'delete', label: t('app.delete'), disabled: pending, danger: true, run: onDelete }
  ];
}
