import { type FormEvent, useState } from 'react';
import type { BoardCard, BoardMember, GoalsIndex } from '../../../shared/api';
import { errorText, fieldErrorText } from '../components/errors';
import { Alert, Dialog, Field, Submit, useMonthNames } from '../components/ui';
import { useTranslation } from '../i18n';

export type CardDraft = {
  title: string;
  description: string;
  assigneeUserId: string;
  /** Always `YYYY-MM-DD` or empty, which is what a native date input's value is. */
  dueDate: string;
  milestoneId: string;
};

/** Mirrors `MAX_DESCRIPTION_LENGTH` in `worker/src/board/service.ts`, in code points. */
const DESCRIPTION_MAX = 4000;

/** The count appears only once the limit is close enough to matter. */
const DESCRIPTION_COUNT_FROM = 3500;

export function draftFromCard(card: BoardCard | null): CardDraft {
  return {
    title: card?.title ?? '',
    description: card?.description ?? '',
    assigneeUserId: card?.assigneeUserId ?? '',
    dueDate: card?.dueDate ?? '',
    milestoneId: card?.milestoneId ?? ''
  };
}

/**
 * Create and edit share one dialog. The draft lives in the parent so a background refetch
 * cannot overwrite typed text: the parent only warns that the underlying card changed and
 * leaves the draft alone for the person to review.
 */
export function CardDialog({
  card,
  draft,
  onDraftChange,
  members,
  goalsIndex,
  onSubmit,
  onClose,
  pending,
  failure,
  changedElsewhere
}: {
  card: BoardCard | null;
  draft: CardDraft;
  onDraftChange: (draft: CardDraft) => void;
  members: readonly BoardMember[];
  /**
   * `null` when the compact goals read failed. That is isolated state: the selector is hidden
   * and the rest of the editor works, rather than a working board being blocked by a list that
   * changes rarely.
   */
  goalsIndex: GoalsIndex | null;
  onSubmit: () => void;
  onClose: () => void;
  pending: boolean;
  failure: unknown;
  changedElsewhere: boolean;
}) {
  const translator = useTranslation();
  const { t } = translator;
  const months = useMonthNames();
  const [assigneeId] = useState(draft.assigneeUserId);
  const [milestoneId] = useState(draft.milestoneId);
  // The server counts code points, so the count shown here has to as well.
  const descriptionLength = [...draft.description].length;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    onSubmit();
  };

  /** Milestones grouped under their goal, in the order the goals screen shows them. */
  const groups = (goalsIndex?.goals ?? []).map(goal => ({
    goal,
    milestones: (goalsIndex?.milestones ?? [])
      .filter(milestone => milestone.goalId === goal.id)
      .sort((a, b) => a.month - b.month)
  }));
  const known = new Set((goalsIndex?.milestones ?? []).map(milestone => milestone.id));

  return (
    <Dialog title={card ? t('card.editHeading') : t('card.createHeading')} onClose={onClose}>
      {changedElsewhere ? (
        <Alert tone="notice">
          {t('card.changedElsewhere')} {t('card.draftKept')}
        </Alert>
      ) : null}
      {failure ? <Alert tone="error">{errorText(translator, failure)}</Alert> : null}

      <form onSubmit={submit} noValidate>
        <Field
          label={t('card.title')}
          value={draft.title}
          onChange={title => onDraftChange({ ...draft, title })}
          error={fieldErrorText(translator, failure, 'title')}
          autoComplete="off"
          autoDir
          required
        />
        <Field
          label={`${t('card.description')} (${t('app.optional')})`}
          value={draft.description}
          onChange={description => onDraftChange({ ...draft, description })}
          error={fieldErrorText(translator, failure, 'description')}
          help={
            descriptionLength >= DESCRIPTION_COUNT_FROM
              ? t('card.descriptionCount', { count: descriptionLength, max: DESCRIPTION_MAX })
              : undefined
          }
          autoComplete="off"
          autoDir
          rows={5}
        />
        <Field
          label={`${t('card.dueDate')} (${t('app.optional')})`}
          value={draft.dueDate}
          onChange={dueDate => onDraftChange({ ...draft, dueDate })}
          error={fieldErrorText(translator, failure, 'dueDate')}
          help={t('card.dueDateHelp')}
          type="date"
          autoComplete="off"
        />
        <p className="field">
          <label htmlFor="card-assignee">{t('card.assignee')}</label>
          <select
            id="card-assignee"
            value={draft.assigneeUserId}
            onChange={event => onDraftChange({ ...draft, assigneeUserId: event.target.value })}
          >
            <option value="">{t('card.unassigned')}</option>
            {members.map(member => (
              <option key={member.id} value={member.id}>
                {member.email}
              </option>
            ))}
            {/* Keeps a now-ineligible assignee visible until the person changes it. */}
            {assigneeId.length > 0 && !members.some(member => member.id === assigneeId) ? (
              <option value={assigneeId}>{assigneeId}</option>
            ) : null}
          </select>
          {fieldErrorText(translator, failure, 'assigneeUserId') ? (
            <span className="error">{fieldErrorText(translator, failure, 'assigneeUserId')}</span>
          ) : null}
        </p>

        {/* Hidden outright when the goals index could not be read, rather than shown empty. */}
        {goalsIndex ? (
          <p className="field">
            <label htmlFor="card-milestone">{t('card.partOf')}</label>
            <select
              id="card-milestone"
              value={draft.milestoneId}
              onChange={event => onDraftChange({ ...draft, milestoneId: event.target.value })}
            >
              <option value="">{t('card.partOfNone')}</option>
              {groups.map(({ goal, milestones }) =>
                milestones.length === 0 ? null : (
                  // An `<optgroup label>` and an `<option>` are plain text, so the bidi isolates
                  // are part of the dictionary template rather than elements around the parts.
                  <optgroup key={goal.id} label={t('goals.optgroupLabel', { title: goal.title, year: goal.year })}>
                    {milestones.map(milestone => (
                      <option key={milestone.id} value={milestone.id}>
                        {t('milestone.optionLabel', {
                          month: months[milestone.month - 1] ?? String(milestone.month),
                          title: milestone.title
                        })}
                      </option>
                    ))}
                  </optgroup>
                )
              )}
              {/* Keeps a milestone deleted elsewhere visible, so the editor cannot silently
                  detach the card behind the person's back. */}
              {milestoneId.length > 0 && !known.has(milestoneId) ? (
                <option value={milestoneId}>{t('card.partOfUnknown')}</option>
              ) : null}
            </select>
            {fieldErrorText(translator, failure, 'milestoneId') ? (
              <span className="error">{fieldErrorText(translator, failure, 'milestoneId')}</span>
            ) : null}
          </p>
        ) : null}

        <div className="dialog-footer">
          {/*
           * After a refused write the draft is deliberately kept, so the way out of it has to be
           * visible: Discard puts the fields back to what the board actually holds, and Save
           * sends the same text again against the reloaded revision. Neither is a new request.
           */}
          {changedElsewhere ? (
            <button
              type="button"
              aria-disabled={pending}
              onClick={() => {
                if (!pending) onDraftChange(draftFromCard(card));
              }}
            >
              {t('card.discardDraft')}
            </button>
          ) : null}
          <button type="button" onClick={onClose}>
            {t('app.cancel')}
          </button>
          <Submit pending={pending}>{t('app.save')}</Submit>
        </div>
      </form>
    </Dialog>
  );
}
