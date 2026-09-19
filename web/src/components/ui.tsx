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
import { CloseIcon } from './icons';

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

// --- viewport -------------------------------------------------------------------------------

/**
 * Tracks a media query in React state.
 *
 * A few of the responsive rules cannot be expressed in CSS alone: below 834px the board renders
 * one column at a time behind a pager rather than the whole track, and the phone header's sheet
 * only exists while the button that opens it does. Everything else stays in the stylesheet.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return matches;
}

// --- form fields ----------------------------------------------------------------------------

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * `'date'` renders a native date input, whose value is always `YYYY-MM-DD` whatever the
   * browser displays. The stylesheet restores its picker indicator, which the global
   * `appearance: none` on `input` would otherwise remove along with the only affordance saying
   * the field opens a picker.
   */
  type?: 'text' | 'email' | 'password' | 'date';
  help?: string;
  error?: string;
  required?: boolean;
  autoComplete?: string;
  /** Email addresses, codes, and phrases stay left-to-right inside a right-to-left page. */
  isolate?: boolean;
  /**
   * Free text the member writes — a card title, a description, a column name — takes its
   * direction from what was typed rather than from the interface language, matching the
   * `dir="auto"` on the element that will display it. Without this, a Latin title typed into a
   * Hebrew interface is laid out right-to-left in the editor and left-to-right on the board.
   */
  autoDir?: boolean;
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
  autoDir,
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
    dir: isolate ? ('ltr' as const) : autoDir ? ('auto' as const) : undefined,
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
 *
 * Below 834px the stylesheet renders the same component bottom-anchored, with the footer row
 * pinned above the keyboard. It is a class and a media query, not a second implementation, so
 * the focus contract is identical on a phone.
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  size = 'default'
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * `'wide'` is the carousel. The default dialog is `min(34rem, 100%)`, which would show a
   * "full-size" image at 544px; `.dialog-wide` carries its own token-driven width instead. The
   * focus contract, the Escape handling and the sheet treatment below 834px are identical.
   */
  size?: 'default' | 'wide';
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
      // The control that opened the dialog is often gone by the time it closes — deleting a
      // card removes its own Delete button. Falling back to the main landmark keeps focus
      // somewhere sensible instead of dropping it on the document.
      if (opener.current instanceof HTMLElement && document.contains(opener.current)) {
        opener.current.focus();
        return;
      }
      document.getElementById('main')?.focus();
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
        className={size === 'wide' ? 'dialog dialog-wide' : 'dialog'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panel}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon" onClick={onClose} aria-label={t('app.close')}>
            <CloseIcon />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

// --- misc -----------------------------------------------------------------------------------

/**
 * Moves focus after the next commit, but only if focus was lost to the document.
 *
 * A control that a mutation removes or re-mounts — a deleted card's menu, a card moved to another
 * column, a column button that just became structurally disabled — drops focus onto `<body>`. The
 * caller names candidates in order; the first that exists and is enabled gets focus. If none
 * does, the main landmark keeps the keyboard position sensible, as the dialog already does.
 */
export function useFocusAfterRender(): (candidates: readonly string[]) => void {
  const pending = useRef<readonly string[] | null>(null);
  useEffect(() => {
    const candidates = pending.current;
    if (candidates === null) return;
    pending.current = null;
    if (document.activeElement !== null && document.activeElement !== document.body) return;
    for (const id of candidates) {
      const element = document.getElementById(id);
      if (element instanceof HTMLElement && !(element instanceof HTMLButtonElement && element.disabled)) {
        element.focus();
        return;
      }
    }
    document.getElementById('main')?.focus();
  });
  return useCallback((candidates: readonly string[]) => {
    pending.current = candidates;
  }, []);
}

/**
 * A submit button that cannot be double-fired while its request is in flight, and that keeps
 * keyboard focus while it waits: `aria-disabled`, never `disabled`.
 *
 * The label does not change while the request runs: a button whose accessible name rewrites
 * itself mid-action is disorienting, and one generic word cannot be right for signing in,
 * saving a card, and confirming a recovery phrase at once. The busy state is conveyed by
 * `aria-busy` and by three small squares, which keep their place — static rather than pulsing —
 * under a reduced-motion preference, so the state is never carried by movement alone.
 */
export function Submit({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      className={pending ? 'primary busy' : 'primary'}
      aria-disabled={pending}
      aria-busy={pending}
      onClick={event => {
        // The real `disabled` attribute would drop keyboard focus onto the document — inside a
        // modal, out of the Tab trap. Clicks are refused here, and every form's submit handler
        // already returns early while a request is in flight, so Enter in a field is safe too.
        if (pending) event.preventDefault();
      }}
    >
      {children}
      {pending ? (
        <span className="busy-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : null}
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

/**
 * Renders a translated sentence with one value substituted as an element rather than as text.
 *
 * Interpolating an email address or a code into a right-to-left sentence reorders it visibly.
 * Splitting the template keeps each language's own word order while the value sits in its own
 * isolated, left-to-right span.
 */
export function WithValue({
  template,
  name,
  children
}: {
  template: string;
  name: string;
  children: ReactNode;
}) {
  const marker = `{${name}}`;
  const index = template.indexOf(marker);
  if (index < 0) {
    return (
      <>
        {template} {children}
      </>
    );
  }
  return (
    <>
      {template.slice(0, index)}
      {children}
      {template.slice(index + marker.length)}
    </>
  );
}

export function useFormattedDate(): (iso: string) => string {
  const { locale } = useTranslation();
  return useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
    return (iso: string) => formatter.format(new Date(iso));
  }, [locale]);
}

/**
 * A calendar day, `YYYY-MM-DD`, with no time of day.
 *
 * A second shape on the same formatter family rather than a second `Intl.DateTimeFormat`
 * constructed in board code. `timeZone: 'UTC'` is not cosmetic: the string is parsed as UTC
 * midnight, so formatting it in a timezone behind UTC would render the previous day.
 */
export function useCalendarDay(): (day: string) => string {
  const { locale } = useTranslation();
  return useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
    return (day: string) => formatter.format(new Date(`${day}T00:00:00Z`));
  }, [locale]);
}

/** The twelve month names the locale itself supplies, for the milestone month selector. */
export function useMonthNames(): string[] {
  const { locale } = useTranslation();
  return useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
    return Array.from({ length: 12 }, (_, index) => formatter.format(new Date(Date.UTC(2026, index, 1))));
  }, [locale]);
}
