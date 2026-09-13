import { type FormEvent, useState } from 'react';
import type { BoardCard, BoardMember } from '../../../shared/api';
import { errorText, fieldErrorText } from '../components/errors';
import { Alert, Dialog, Field, Submit } from '../components/ui';
import { useTranslation } from '../i18n';

export type CardDraft = { title: string; description: string; assigneeUserId: string };

export function draftFromCard(card: BoardCard | null): CardDraft {
  return {
    title: card?.title ?? '',
    description: card?.description ?? '',
    assigneeUserId: card?.assigneeUserId ?? ''
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
  onSubmit: () => void;
  onClose: () => void;
  pending: boolean;
  failure: unknown;
  changedElsewhere: boolean;
}) {
  const translator = useTranslation();
  const { t } = translator;
  const [assigneeId] = useState(draft.assigneeUserId);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    onSubmit();
  };

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
          required
        />
        <Field
          label={`${t('card.description')} (${t('app.optional')})`}
          value={draft.description}
          onChange={description => onDraftChange({ ...draft, description })}
          error={fieldErrorText(translator, failure, 'description')}
          autoComplete="off"
          rows={5}
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

        <div className="dialog-footer">
          <button type="button" onClick={onClose}>
            {t('app.cancel')}
          </button>
          <Submit pending={pending}>{t('app.save')}</Submit>
        </div>
      </form>
    </Dialog>
  );
}
