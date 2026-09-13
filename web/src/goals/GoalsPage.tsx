import { type FormEvent, useCallback, useMemo, useState } from 'react';
import type { Goal, GoalsMutationResponse, Milestone } from '../../../shared/api';
import { ApiError } from '../api/client';
import {
  createGoal,
  createMilestone,
  deleteGoal,
  deleteMilestone,
  moveGoal,
  moveMilestone,
  patchGoal,
  patchMilestone
} from '../api/endpoints';
import { useSession } from '../auth/session';
import { ActionsMenu, type MenuEntry } from '../components/ActionsMenu';
import { errorText, fieldErrorText } from '../components/errors';
import { PlusIcon } from '../components/icons';
import { Alert, Dialog, Field, Submit, useAnnounce, useMonthNames, WithValue } from '../components/ui';
import { useTranslation } from '../i18n';
import { useGoals } from './useGoals';

/** Mirrors `MAX_NOTES_LENGTH` in `worker/src/validation.ts`, in code points. */
const NOTES_MAX = 1000;
const NOTES_COUNT_FROM = 850;

type GoalDraft = { title: string; notes: string; year: number };
type MilestoneDraft = { title: string; notes: string; month: number };

type GoalForm = { goal: Goal | null; draft: GoalDraft };
type MilestoneForm = { goalId: string; milestone: Milestone | null; draft: MilestoneDraft };

export function GoalsPage() {
  const translator = useTranslation();
  const { t, plural } = translator;
  const months = useMonthNames();
  const { state, forgetSession } = useSession();
  const announce = useAnnounce();
  const { goals: snapshot, error, loading, refresh } = useGoals(state.status === 'active', forgetSession);

  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [goalForm, setGoalForm] = useState<GoalForm | null>(null);
  const [milestoneForm, setMilestoneForm] = useState<MilestoneForm | null>(null);
  const [deletingGoal, setDeletingGoal] = useState<Goal | null>(null);
  const [deletingMilestone, setDeletingMilestone] = useState<Milestone | null>(null);

  /**
   * Runs one goals mutation against the last confirmed revision. A `409` never applies the
   * change: the screen reloads and the outcome is announced.
   */
  const runMutation = useCallback(
    async (
      call: (revision: number) => Promise<GoalsMutationResponse>,
      announceOnSuccess?: string
    ): Promise<boolean> => {
      if (!snapshot || pending) return false;
      setPending(true);
      setFailure(null);
      try {
        await call(snapshot.goalsRevision);
        await refresh();
        if (announceOnSuccess) announce(announceOnSuccess);
        return true;
      } catch (cause) {
        setFailure(cause);
        if (cause instanceof ApiError && cause.status === 401) {
          forgetSession();
          return false;
        }
        if (cause instanceof ApiError && cause.code === 'revision_conflict') await refresh();
        return false;
      } finally {
        setPending(false);
      }
    },
    [snapshot, pending, refresh, announce, forgetSession]
  );

  /**
   * The years present in the data, plus the current year so a fresh household has somewhere to
   * put its first goal.
   */
  const years = useMemo(() => {
    const present = new Set((snapshot?.goals ?? []).map(goal => goal.year));
    present.add(new Date().getFullYear());
    return [...present].sort((a, b) => a - b);
  }, [snapshot]);

  const year = selectedYear !== null && years.includes(selectedYear) ? selectedYear : (years[0] ?? new Date().getFullYear());
  const inYear = (snapshot?.goals ?? []).filter(goal => goal.year === year);

  if (error) {
    return (
      <section className="panel">
        <h1>{t('goals.heading')}</h1>
        <Alert tone="error">{errorText(translator, error)}</Alert>
        <button type="button" onClick={() => void refresh()}>
          {t('goals.reload')}
        </button>
      </section>
    );
  }

  if (loading || !snapshot) {
    // The shape of what is coming rather than a spinner. The word is still rendered, for screen
    // readers and for anyone who cannot see the shimmer.
    return (
      <div className="goals-page">
        <div className="board-header">
          <h1>{t('goals.heading')}</h1>
          <p className="board-count">{t('app.loading')}</p>
        </div>
        <div className="skeleton-goals" aria-hidden="true">
          {[0, 1].map(index => (
            <div className="skeleton-plate" key={index}>
              <div className="skeleton-head" />
              <div className="skeleton-block" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const submitGoal = (event: FormEvent) => {
    event.preventDefault();
    if (!goalForm || pending) return;
    const { goal, draft } = goalForm;
    const notes = draft.notes.length > 0 ? draft.notes : null;
    void runMutation(
      revision =>
        goal
          ? patchGoal(goal.id, { goalsRevision: revision, title: draft.title, notes, year: draft.year })
          : createGoal({ goalsRevision: revision, year: draft.year, title: draft.title, notes }),
      t('goals.saved', { title: draft.title })
    ).then(saved => {
      if (!saved) return;
      setGoalForm(null);
      setSelectedYear(draft.year);
    });
  };

  const submitMilestone = (event: FormEvent) => {
    event.preventDefault();
    if (!milestoneForm || pending) return;
    const { goalId, milestone, draft } = milestoneForm;
    const notes = draft.notes.length > 0 ? draft.notes : null;
    void runMutation(
      revision =>
        milestone
          ? patchMilestone(milestone.id, {
              goalsRevision: revision,
              title: draft.title,
              notes,
              month: draft.month
            })
          : createMilestone({ goalsRevision: revision, goalId, month: draft.month, title: draft.title, notes }),
      t('milestone.saved', { title: draft.title })
    ).then(saved => {
      if (saved) setMilestoneForm(null);
    });
  };

  return (
    <div className="goals-page">
      <div className="board-header">
        <h1>{t('goals.heading')}</h1>
        <p className="board-count">{plural('goals.milestoneCount', inYear.reduce((sum, goal) => sum + goal.milestones.length, 0))}</p>
        <button
          type="button"
          onClick={() => setGoalForm({ goal: null, draft: { title: '', notes: '', year } })}
          disabled={pending}
        >
          <PlusIcon />
          {t('goals.addGoal')}
        </button>
      </div>

      {failure && !goalForm && !milestoneForm ? <Alert tone="error">{errorText(translator, failure)}</Alert> : null}

      {/*
       * The years wrap rather than scroll. The board track and the phone pager's chip row are the
       * only two horizontally scrolling regions in the product, and a wrapping strip keeps that
       * sentence true — which is why these are `.year-*` classes and not `.pager-*`.
       */}
      <div className="year-strip" role="group" aria-label={t('goals.yearStrip')}>
        {years.map(entry => (
          <button
            key={entry}
            type="button"
            className="year-chip"
            aria-pressed={entry === year}
            onClick={() => setSelectedYear(entry)}
          >
            {entry}
          </button>
        ))}
      </div>

      {snapshot.goals.length === 0 ? <p className="help">{t('goals.empty')}</p> : null}
      {snapshot.goals.length > 0 && inYear.length === 0 ? <p className="help">{t('goals.emptyYear')}</p> : null}

      <ol className="goal-list" role="list">
        {inYear.map((goal, index) => (
          <GoalPlate
            key={goal.id}
            goal={goal}
            index={index}
            total={inYear.length}
            months={months}
            pending={pending}
            onEdit={() =>
              setGoalForm({ goal, draft: { title: goal.title, notes: goal.notes ?? '', year: goal.year } })
            }
            onDelete={() => setDeletingGoal(goal)}
            onMove={target =>
              void runMutation(
                revision => moveGoal(goal.id, { goalsRevision: revision, targetIndex: target }),
                t('goals.moved', { title: goal.title, position: target + 1 })
              )
            }
            onAddMilestone={() =>
              setMilestoneForm({
                goalId: goal.id,
                milestone: null,
                draft: { title: '', notes: '', month: new Date().getMonth() + 1 }
              })
            }
            onEditMilestone={milestone =>
              setMilestoneForm({
                goalId: goal.id,
                milestone,
                draft: { title: milestone.title, notes: milestone.notes ?? '', month: milestone.month }
              })
            }
            onDeleteMilestone={setDeletingMilestone}
            onMoveMilestone={(milestone, target) =>
              void runMutation(
                revision => moveMilestone(milestone.id, { goalsRevision: revision, targetIndex: target }),
                t('milestone.moved', { title: milestone.title, position: target + 1 })
              )
            }
            onToggleMilestone={milestone => {
              const next = milestone.status === 'done' ? 'open' : 'done';
              void runMutation(
                revision => patchMilestone(milestone.id, { goalsRevision: revision, status: next }),
                t(next === 'done' ? 'milestone.markedDone' : 'milestone.markedOpen', { title: milestone.title })
              );
            }}
          />
        ))}
      </ol>

      {goalForm ? (
        <Dialog
          title={goalForm.goal ? t('goals.editHeading') : t('goals.createHeading')}
          onClose={() => setGoalForm(null)}
        >
          {failure ? <Alert tone="error">{errorText(translator, failure)}</Alert> : null}
          <form onSubmit={submitGoal} noValidate>
            <Field
              label={t('goals.title')}
              value={goalForm.draft.title}
              onChange={title => setGoalForm({ ...goalForm, draft: { ...goalForm.draft, title } })}
              error={fieldErrorText(translator, failure, 'title')}
              autoComplete="off"
              autoDir
              required
            />
            <Field
              label={`${t('goals.notes')} (${t('app.optional')})`}
              value={goalForm.draft.notes}
              onChange={notes => setGoalForm({ ...goalForm, draft: { ...goalForm.draft, notes } })}
              error={fieldErrorText(translator, failure, 'notes')}
              help={
                [...goalForm.draft.notes].length >= NOTES_COUNT_FROM
                  ? t('card.descriptionCount', { count: [...goalForm.draft.notes].length, max: NOTES_MAX })
                  : undefined
              }
              autoComplete="off"
              autoDir
              rows={4}
            />
            <p className="field">
              <label htmlFor="goal-year">{t('goals.year')}</label>
              <select
                id="goal-year"
                value={String(goalForm.draft.year)}
                onChange={event =>
                  setGoalForm({ ...goalForm, draft: { ...goalForm.draft, year: Number(event.target.value) } })
                }
              >
                {yearChoices(goalForm.draft.year).map(entry => (
                  <option key={entry} value={String(entry)}>
                    {entry}
                  </option>
                ))}
              </select>
              {fieldErrorText(translator, failure, 'year') ? (
                <span className="error">{fieldErrorText(translator, failure, 'year')}</span>
              ) : null}
            </p>
            <div className="dialog-footer">
              <button type="button" onClick={() => setGoalForm(null)}>
                {t('app.cancel')}
              </button>
              <Submit pending={pending}>{t('app.save')}</Submit>
            </div>
          </form>
        </Dialog>
      ) : null}

      {milestoneForm ? (
        <Dialog
          title={milestoneForm.milestone ? t('milestone.editHeading') : t('milestone.createHeading')}
          onClose={() => setMilestoneForm(null)}
        >
          {failure ? <Alert tone="error">{errorText(translator, failure)}</Alert> : null}
          <form onSubmit={submitMilestone} noValidate>
            <Field
              label={t('milestone.title')}
              value={milestoneForm.draft.title}
              onChange={title => setMilestoneForm({ ...milestoneForm, draft: { ...milestoneForm.draft, title } })}
              error={fieldErrorText(translator, failure, 'title')}
              autoComplete="off"
              autoDir
              required
            />
            <Field
              label={`${t('milestone.notes')} (${t('app.optional')})`}
              value={milestoneForm.draft.notes}
              onChange={notes => setMilestoneForm({ ...milestoneForm, draft: { ...milestoneForm.draft, notes } })}
              error={fieldErrorText(translator, failure, 'notes')}
              autoComplete="off"
              autoDir
              rows={4}
            />
            <p className="field">
              <label htmlFor="milestone-month">{t('milestone.month')}</label>
              {/* The month names come from the locale itself rather than from the dictionary. */}
              <select
                id="milestone-month"
                value={String(milestoneForm.draft.month)}
                onChange={event =>
                  setMilestoneForm({
                    ...milestoneForm,
                    draft: { ...milestoneForm.draft, month: Number(event.target.value) }
                  })
                }
              >
                {months.map((name, index) => (
                  <option key={name} value={String(index + 1)}>
                    {name}
                  </option>
                ))}
              </select>
              {fieldErrorText(translator, failure, 'month') ? (
                <span className="error">{fieldErrorText(translator, failure, 'month')}</span>
              ) : null}
            </p>
            <div className="dialog-footer">
              <button type="button" onClick={() => setMilestoneForm(null)}>
                {t('app.cancel')}
              </button>
              <Submit pending={pending}>{t('app.save')}</Submit>
            </div>
          </form>
        </Dialog>
      ) : null}

      {deletingGoal ? (
        <Dialog
          title={t('app.delete')}
          onClose={() => setDeletingGoal(null)}
          footer={
            <>
              <button type="button" onClick={() => setDeletingGoal(null)}>
                {t('app.cancel')}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const goal = deletingGoal;
                  setDeletingGoal(null);
                  void runMutation(
                    revision => deleteGoal(goal.id, { goalsRevision: revision }),
                    t('goals.deleted', { title: goal.title })
                  );
                }}
              >
                {t('app.delete')}
              </button>
            </>
          }
        >
          <p>
            <WithValue template={t('goals.deleteConfirm')} name="title">
              <span dir="auto">{deletingGoal.title}</span>
            </WithValue>
          </p>
        </Dialog>
      ) : null}

      {deletingMilestone ? (
        <Dialog
          title={t('app.delete')}
          onClose={() => setDeletingMilestone(null)}
          footer={
            <>
              <button type="button" onClick={() => setDeletingMilestone(null)}>
                {t('app.cancel')}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const milestone = deletingMilestone;
                  setDeletingMilestone(null);
                  void runMutation(
                    revision => deleteMilestone(milestone.id, { goalsRevision: revision }),
                    t('milestone.deleted', { title: milestone.title })
                  );
                }}
              >
                {t('app.delete')}
              </button>
            </>
          }
        >
          <p>
            <WithValue template={t('milestone.deleteConfirm')} name="title">
              <span dir="auto">{deletingMilestone.title}</span>
            </WithValue>
          </p>
        </Dialog>
      ) : null}
    </div>
  );
}

/** A window around whatever year the goal already has, inside the 2000–2999 the server allows. */
function yearChoices(current: number): number[] {
  const now = new Date().getFullYear();
  const from = Math.max(2000, Math.min(current, now) - 2);
  const to = Math.min(2999, Math.max(current, now) + 6);
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function GoalPlate({
  goal,
  index,
  total,
  months,
  pending,
  onEdit,
  onDelete,
  onMove,
  onAddMilestone,
  onEditMilestone,
  onDeleteMilestone,
  onMoveMilestone,
  onToggleMilestone
}: {
  goal: Goal;
  index: number;
  total: number;
  months: readonly string[];
  pending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (targetIndex: number) => void;
  onAddMilestone: () => void;
  onEditMilestone: (milestone: Milestone) => void;
  onDeleteMilestone: (milestone: Milestone) => void;
  onMoveMilestone: (milestone: Milestone, targetIndex: number) => void;
  onToggleMilestone: (milestone: Milestone) => void;
}) {
  const { t, plural } = useTranslation();
  const done = goal.milestones.filter(milestone => milestone.status === 'done').length;
  const total_ = goal.milestones.length;
  // Progress is an explicit per-milestone status, never "which column its cards sit in":
  // columns are renameable and deletable, so `done` is not a durable notion of completion.
  const ratio = total_ === 0 ? 0 : done / total_;

  const entries: MenuEntry[] = [
    { key: 'edit', label: t('app.edit'), disabled: pending, run: onEdit },
    { key: 'add', label: t('milestone.add'), disabled: pending, run: onAddMilestone },
    { key: 'up', label: t('goals.moveUp'), disabled: pending || index === 0, run: () => onMove(index - 1) },
    { key: 'down', label: t('goals.moveDown'), disabled: pending || index === total - 1, run: () => onMove(index + 1) },
    { key: 'delete', label: t('app.delete'), disabled: pending, danger: true, run: onDelete }
  ];

  /** Grouped by month, each group in its own dense order. */
  const byMonth = new Map<number, Milestone[]>();
  for (const milestone of goal.milestones) {
    const bucket = byMonth.get(milestone.month) ?? [];
    bucket.push(milestone);
    byMonth.set(milestone.month, bucket);
  }
  const monthGroups = [...byMonth.entries()].sort(([a], [b]) => a - b);

  return (
    <li className="goal-plate" role="listitem">
      <div className="goal-head">
        <h2 className="goal-title">
          {/* The title is the edit affordance, the rule `.card-title-button` already follows. */}
          <button type="button" className="card-title-button" dir="auto" onClick={onEdit} disabled={pending}>
            {goal.title}
          </button>
        </h2>
        <ActionsMenu
          entries={entries}
          triggerLabel={t('goals.actions', { title: goal.title })}
          menuLabel={t('goals.actions', { title: goal.title })}
        />
      </div>

      {/* Clamped to two lines. The full text is one step away, in the dialog. */}
      {goal.notes !== null ? (
        <p className="card-description" dir="auto">
          {goal.notes}
        </p>
      ) : null}

      <p className="goal-progress">{plural('goals.progress', total_, { done })}</p>
      {/*
       * A decorative bar after a real sentence. Not a native `<progress>` or `<meter>`, whose UA
       * chrome ignores every `--gt-*` token; `aria-hidden` because the sentence above already
       * says the same thing.
       */}
      <div className="meter" aria-hidden="true">
        <span className="meter-fill" style={{ inlineSize: `${Math.round(ratio * 100)}%` }} />
      </div>

      {monthGroups.length === 0 ? <p className="help">{t('goals.noMilestones')}</p> : null}

      {monthGroups.map(([month, milestones]) => (
        <section className="milestone-group" key={month}>
          <h3 className="milestone-month">{months[month - 1] ?? String(month)}</h3>
          <ol className="milestone-list" role="list">
            {milestones.map((milestone, position) => (
              <MilestoneRow
                key={milestone.id}
                milestone={milestone}
                index={position}
                total={milestones.length}
                pending={pending}
                onEdit={() => onEditMilestone(milestone)}
                onDelete={() => onDeleteMilestone(milestone)}
                onMove={target => onMoveMilestone(milestone, target)}
                onToggle={() => onToggleMilestone(milestone)}
              />
            ))}
          </ol>
        </section>
      ))}

      <button type="button" className="add-card" onClick={onAddMilestone} disabled={pending}>
        <PlusIcon />
        {t('milestone.addTo', { title: goal.title })}
      </button>
    </li>
  );
}

function MilestoneRow({
  milestone,
  index,
  total,
  pending,
  onEdit,
  onDelete,
  onMove,
  onToggle
}: {
  milestone: Milestone;
  index: number;
  total: number;
  pending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (targetIndex: number) => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation();

  const entries: MenuEntry[] = [
    { key: 'edit', label: t('app.edit'), disabled: pending, run: onEdit },
    { key: 'up', label: t('goals.moveUp'), disabled: pending || index === 0, run: () => onMove(index - 1) },
    { key: 'down', label: t('goals.moveDown'), disabled: pending || index === total - 1, run: () => onMove(index + 1) },
    { key: 'delete', label: t('app.delete'), disabled: pending, danger: true, run: onDelete }
  ];

  return (
    <li className="milestone-row" role="listitem">
      <div className="milestone-head">
        {/*
         * A button with `aria-pressed`, a constant accessible name and constant visible text
         * naming the action. A label that swapped with the state would announce the state twice
         * and contradict itself mid-request; `aria-pressed` flips only when the server confirms,
         * and the change is spoken once through the polite region.
         */}
        <button
          type="button"
          className="milestone-toggle"
          aria-pressed={milestone.status === 'done'}
          aria-label={t('milestone.toggle', { title: milestone.title })}
          disabled={pending}
          onClick={onToggle}
        >
          {t('milestone.done')}
        </button>
        <h4 className="milestone-title">
          <button type="button" className="card-title-button" dir="auto" onClick={onEdit} disabled={pending}>
            {milestone.title}
          </button>
        </h4>
        <ActionsMenu
          entries={entries}
          triggerLabel={t('milestone.actions', { title: milestone.title })}
          menuLabel={t('milestone.actions', { title: milestone.title })}
        />
      </div>

      {milestone.notes !== null ? (
        <p className="card-description" dir="auto">
          {milestone.notes}
        </p>
      ) : null}

      {milestone.cards.length === 0 ? (
        <p className="help">{t('milestone.noCards')}</p>
      ) : (
        <p className="milestone-cards">
          {milestone.cards.map(card => (
            // A chip is an element rather than plain text, so the card title gets a real
            // `dir="auto"` span and the separator stays part of the dictionary template.
            <span className="badge" key={card.id}>
              <WithValue template={t('milestone.cardChip')} name="title">
                <span dir="auto">{card.title}</span>
              </WithValue>
            </span>
          ))}
        </p>
      )}
    </li>
  );
}
