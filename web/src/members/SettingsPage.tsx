import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type {
  AllowedEmailsResponse,
  CreatedInvitationResponse,
  InvitationSummary,
  MemberSummary
} from '../../../shared/api';
import { ApiError } from '../api/client';
import {
  createInvitation,
  deactivateMember,
  readAllowedEmails,
  readInvitations,
  readMembers,
  replaceAllowedEmails,
  revokeInvitation
} from '../api/endpoints';
import { errorText, fieldErrorText } from '../components/errors';
import { Alert, CopyButton, Dialog, Field, Submit, useAnnounce, useFormattedDate, WithValue } from '../components/ui';
import { useTranslation } from '../i18n';
import { useSession } from '../auth/session';

const MAX_ALLOWED = 7;

/** Mirrors the server's normalisation closely enough to give guidance before saving. */
function normalize(entry: string): string {
  return entry.trim().toLowerCase();
}

function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map(normalize)
    .filter(line => line.length > 0);
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function SettingsPage() {
  const translator = useTranslation();
  const { t } = translator;
  const { state } = useSession();
  const announce = useAnnounce();
  const formatDate = useFormattedDate();

  const ownerEmail = state.status === 'active' ? state.user.email : '';

  const [allowed, setAllowed] = useState<AllowedEmailsResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [draftTouched, setDraftTouched] = useState(false);
  const [invitations, setInvitations] = useState<InvitationSummary[]>([]);
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [issued, setIssued] = useState<CreatedInvitationResponse | null>(null);
  const [inviteError, setInviteError] = useState<unknown>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<MemberSummary | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [list, invites, roster] = await Promise.all([
          readAllowedEmails({ signal }),
          readInvitations({ signal }),
          readMembers({ signal })
        ]);
        setAllowed(list);
        setInvitations(invites.invitations);
        setMembers(roster.members);
        setLoadError(null);
        // A background reload never discards text the owner has typed.
        setDraft(current => (draftTouched ? current : list.emails.join('\n')));
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadError(error);
      }
    },
    [draftTouched]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const entries = parseLines(draft);
  const duplicate = entries.find((entry, index) => entries.indexOf(entry) !== index);
  const malformed = entries.find(entry => !EMAIL_SHAPE.test(entry));
  const ownerMissing = ownerEmail.length > 0 && !entries.includes(ownerEmail);
  const removals = allowed ? allowed.emails.filter(email => !entries.includes(email)) : [];

  const saveList = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || !allowed) return;
    setPending(true);
    setSaveError(null);
    setNotice(null);
    try {
      const saved = await replaceAllowedEmails({ emails: entries, allowlistRevision: allowed.allowlistRevision });
      setAllowed(saved);
      setDraft(saved.emails.join('\n'));
      setDraftTouched(false);
      setNotice(t('settings.allowedSaved'));
      announce(t('settings.allowedSaved'));
      await load();
    } catch (error) {
      setSaveError(error);
      // A stale revision keeps the draft exactly as typed and refreshes the current list
      // alongside it, so the owner can compare rather than lose their edit.
      if (error instanceof ApiError && error.code === 'allowlist_conflict') {
        const current = await readAllowedEmails().catch(() => null);
        if (current) setAllowed(current);
        setDraftTouched(true);
      }
    } finally {
      setPending(false);
    }
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setInviteError(null);
    setIssued(null);
    try {
      const created = await createInvitation({ email: normalize(inviteEmail) });
      setIssued(created);
      setInviteEmail('');
      await load();
    } catch (error) {
      setInviteError(error);
    } finally {
      setPending(false);
    }
  };

  const revoke = async (id: string) => {
    setPending(true);
    try {
      await revokeInvitation(id);
      announce(t('invitations.revoked'));
      await load();
    } catch (error) {
      setInviteError(error);
    } finally {
      setPending(false);
    }
  };

  const deactivate = async (member: MemberSummary) => {
    setPending(true);
    setConfirmDeactivate(null);
    try {
      await deactivateMember(member.id);
      announce(t('members.deactivated', { email: member.email }));
      await load();
    } catch (error) {
      setSaveError(error);
    } finally {
      setPending(false);
    }
  };

  if (loadError) {
    return (
      <section className="panel">
        <h1>{t('settings.heading')}</h1>
        <Alert tone="error">{errorText(translator, loadError)}</Alert>
        <button type="button" onClick={() => void load()}>
          {t('app.retry')}
        </button>
      </section>
    );
  }

  if (!allowed) {
    return (
      <section className="panel">
        <h1>{t('settings.heading')}</h1>
        <p>{t('app.loading')}</p>
      </section>
    );
  }

  const activeCount = members.filter(member => member.status === 'active').length;
  const allowedSet = new Set(allowed.emails);

  return (
    <div className="panel">
      <h1>{t('settings.heading')}</h1>

      <section aria-labelledby="allowed-heading" className="card">
        <h2 id="allowed-heading">{t('settings.allowedHeading')}</h2>
        <p>{t('settings.allowedBody', { max: MAX_ALLOWED })}</p>
        <p className="help">
          <WithValue template={t('settings.ownerLocked')} name="email">
            <span className="isolate" dir="ltr">
              {ownerEmail}
            </span>
          </WithValue>
        </p>

        {notice ? <Alert tone="notice">{notice}</Alert> : null}
        {saveError ? (
          <Alert tone="error">
            {saveError instanceof ApiError && saveError.code === 'allowlist_conflict'
              ? t('settings.allowedConflict')
              : (fieldErrorText(translator, saveError, 'emails', { max: MAX_ALLOWED }) ??
                errorText(translator, saveError))}
          </Alert>
        ) : null}

        <form onSubmit={saveList} noValidate>
          <Field
            label={t('settings.allowedLabel')}
            value={draft}
            onChange={value => {
              setDraft(value);
              setDraftTouched(true);
            }}
            rows={8}
            autoComplete="off"
            isolate
          />
          {duplicate ? <Alert tone="error">{t('settings.duplicate', { email: duplicate })}</Alert> : null}
          {malformed ? <Alert tone="error">{t('settings.invalidEntry', { entry: malformed })}</Alert> : null}
          {ownerMissing ? <Alert tone="error">{t('field.emails.owner_required')}</Alert> : null}
          {entries.length > MAX_ALLOWED ? (
            <Alert tone="error">{t('settings.tooMany', { count: entries.length, max: MAX_ALLOWED })}</Alert>
          ) : null}
          {removals.length > 0 ? <Alert tone="notice">{t('settings.removalWarning')}</Alert> : null}
          <Submit pending={pending}>{t('settings.allowedSave')}</Submit>
        </form>
      </section>

      <section aria-labelledby="invitations-heading" className="card">
        <h2 id="invitations-heading">{t('invitations.heading')}</h2>
        <p>{t('invitations.body')}</p>
        {inviteError ? <Alert tone="error">{errorText(translator, inviteError)}</Alert> : null}

        <form onSubmit={invite} noValidate>
          <Field
            label={t('invitations.email')}
            value={inviteEmail}
            onChange={setInviteEmail}
            type="email"
            inputMode="email"
            autoComplete="off"
            error={fieldErrorText(translator, inviteError, 'email')}
            required
            isolate
          />
          <Submit pending={pending}>{t('invitations.create')}</Submit>
        </form>

        {issued ? (
          <div className="callout">
            <h3>
              <WithValue template={t('invitations.codeHeading')} name="email">
                <span className="isolate" dir="ltr">
                  {issued.email}
                </span>
              </WithValue>
            </h3>
            <p className="warning">{t('invitations.codeOnce')}</p>
            <p className="code isolate" dir="ltr">
              {issued.inviteCode}
            </p>
            <CopyButton value={issued.inviteCode} label={t('app.copy')} />
          </div>
        ) : null}

        {invitations.length === 0 ? (
          <p className="help">{t('invitations.none')}</p>
        ) : (
          <ul className="list">
            {invitations.map(invitation => (
              <li key={invitation.id}>
                <span className="isolate" dir="ltr">
                  {invitation.email}
                </span>
                <span className="badge">{t(`invitations.status.${invitation.status}`)}</span>
                <span className="help">{t('invitations.expires', { date: formatDate(invitation.expiresAt) })}</span>
                {invitation.status === 'pending' ? (
                  <button
                    type="button"
                    onClick={() => void revoke(invitation.id)}
                    disabled={pending}
                    aria-label={t('invitations.revokeFor', { email: invitation.email })}
                  >
                    {t('invitations.revoke')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="people-heading" className="card">
        <h2 id="people-heading">{t('members.heading')}</h2>
        <p>{t('members.seats', { active: activeCount, max: MAX_ALLOWED })}</p>
        <ul className="list">
          {members.map(member => (
            <li key={member.id}>
              <span className="isolate" dir="ltr">
                {member.email}
              </span>
              <span className="badge">{t(`members.role.${member.role}`)}</span>
              <span className="badge">{t(`members.status.${member.status}`)}</span>
              {member.status === 'active' && !allowedSet.has(member.email) ? (
                <span className="badge warning">{t('members.notAllowed')}</span>
              ) : null}
              {member.role !== 'owner' && member.status === 'active' ? (
                <button
                  type="button"
                  onClick={() => setConfirmDeactivate(member)}
                  disabled={pending}
                  aria-label={t('members.deactivateFor', { email: member.email })}
                >
                  {t('members.deactivate')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {confirmDeactivate ? (
        <Dialog
          title={t('members.deactivate')}
          onClose={() => setConfirmDeactivate(null)}
          footer={
            <>
              <button type="button" onClick={() => setConfirmDeactivate(null)}>
                {t('app.cancel')}
              </button>
              <button type="button" className="danger" onClick={() => void deactivate(confirmDeactivate)}>
                {t('members.deactivate')}
              </button>
            </>
          }
        >
          <p>
            <WithValue template={t('members.deactivateConfirm')} name="email">
              <span className="isolate" dir="ltr">
                {confirmDeactivate.email}
              </span>
            </WithValue>
          </p>
        </Dialog>
      ) : null}
    </div>
  );
}
