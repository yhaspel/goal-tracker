import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react';
import { useTranslation } from '../i18n';

// --- announcements --------------------------------------------------------------------------

type Announce = (message: string, urgency?: 'polite' | 'assertive') => void;

const AnnouncerContext = createContext<Announce | null>(null);

/**
 * Two live regions, mounted once. Move results and saves are polite; failures and conflicts
 * are assertive. Messages are re-stamped so an identical repeat is still announced.
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');

  const announce = useCallback<Announce>((message, urgency = 'polite') => {
    const stamped = message;
    if (urgency === 'assertive') {
      setAssertive('');
      window.setTimeout(() => setAssertive(stamped), 30);
    } else {
      setPolite('');
      window.setTimeout(() => setPolite(stamped), 30);
    }
  }, []);

  return (
    <AnnouncerContext.Provider value={announce}>
      {children}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="visually-hidden" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </AnnouncerContext.Provider>
  );
}

export function useAnnounce(): Announce {
  const value = useContext(AnnouncerContext);
  if (!value) throw new Error('useAnnounce must be used inside an AnnouncerProvider');
  return value;
}

// --- form fields ----------------------------------------------------------------------------

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password';
  help?: string;
  error?: string;
  required?: boolean;
  autoComplete?: string;
  /** Email addresses, codes, and phrases stay left-to-right inside a right-to-left page. */
  isolate?: boolean;
  rows?: number;
  inputMode?: 'text' | 'email';
};

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  help,
  error,
  required,
  autoComplete,
  isolate,
  rows,
  inputMode
}: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const shared = {
    id,
    value,
    required,
    autoComplete,
    'aria-describedby': describedBy,
    'aria-invalid': error ? (true as const) : undefined,
    dir: isolate ? ('ltr' as const) : undefined,
    className: isolate ? 'isolate' : undefined,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value)
  };

  return (
    <p className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {rows === undefined ? (
        <input {...shared} type={type} inputMode={inputMode} />
      ) : (
        <textarea {...shared} rows={rows} />
      )}
      {help ? (
        <span className="help" id={helpId}>
          {help}
        </span>
      ) : null}
      {error ? (
        <span className="error" id={errorId}>
          {error}
        </span>
      ) : null}
    </p>
  );
}

// --- dialog ---------------------------------------------------------------------------------

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A labelled modal that traps Tab, closes on Escape, and returns focus to whatever opened it.
 * Closing is always safe here: no dialog in this app commits on dismiss.
 */
export function Dialog({
  title,
  onClose,
  children,
  footer
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    opener.current = document.activeElement;
    // Prefer the first field over the close button, so a keyboard user lands where the work is.
    const firstField = panel.current?.querySelector<HTMLElement>('input, textarea, select');
    const firstFocusable = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (firstField ?? firstFocusable ?? panel.current)?.focus();
    return () => {
      if (opener.current instanceof HTMLElement && document.contains(opener.current)) opener.current.focus();
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panel.current) return;
    const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panel}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon" onClick={onClose}>
            {t('app.close')}
          </button>
        </div>
        {children}
        {footer ? <div className="dialog-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

// --- misc -----------------------------------------------------------------------------------

/** A submit button that cannot be double-fired while its request is in flight. */
export function Submit({ pending, children }: { pending: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <button type="submit" className="primary" disabled={pending}>
      {pending ? t('app.saving') : children}
    </button>
  );
}

export function Alert({ tone, children }: { tone: 'error' | 'notice'; children: ReactNode }) {
  return (
    <p className={tone === 'error' ? 'alert alert-error' : 'alert alert-notice'} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </p>
  );
}

/** Copies text without ever writing it to the console or to storage. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const announce = useAnnounce();
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          announce(t('app.copied'));
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
      aria-label={label}
    >
      {copied ? t('app.copied') : t('app.copy')}
    </button>
  );
}

export function useFormattedDate(): (iso: string) => string {
  const { locale } = useTranslation();
  return useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
    return (iso: string) => formatter.format(new Date(iso));
  }, [locale]);
}
