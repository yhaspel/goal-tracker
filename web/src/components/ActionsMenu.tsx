import { Fragment, type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n';
import { MoreIcon } from './icons';
import { useMediaQuery } from './ui';

/**
 * One actions menu, shared by the board, the goals screen and the vision board.
 *
 * It was written for the card and is now generic, because three screens need the same keyboard
 * contract and three copies of it would drift: `aria-haspopup="menu"`, `aria-expanded`,
 * `role="menu"` with real `<button role="menuitem">` children; Enter, Space or ↓ opens on the
 * first item and ↑ on the last; ↑↓ cycle, Home and End jump, Escape closes and returns focus to
 * the trigger, Tab closes and moves on. Move up and move down are **disabled, not hidden**, at
 * the ends of a list, so the menu keeps its shape.
 */

export type MenuEntry = {
  key: string;
  label: string;
  disabled: boolean;
  danger?: boolean;
  /**
   * Optional flat group. The first entry carrying a given label renders it as a heading; the
   * rest of the run sits under it. A flat labelled group rather than a submenu, so there is no
   * nested keyboard model to learn.
   */
  group?: string;
  /** Member-written text — a column name, a goal title — takes its direction from itself. */
  autoDir?: boolean;
  run: () => void;
};

/** Below this the menu is a sheet, positioned entirely by the stylesheet. */
const PHONE = '(max-width: 833px)';

export function ActionsMenu({
  entries,
  triggerLabel,
  menuLabel
}: {
  entries: readonly MenuEntry[];
  triggerLabel: string;
  menuLabel: string;
}) {
  const { dir } = useTranslation();
  const phone = useMediaQuery(PHONE);
  const [open, setOpen] = useState(false);
  const [activeItem, setActiveItem] = useState(0);
  /**
   * Where the trigger sat when the menu opened.
   *
   * The board track scrolls sideways, which makes it a scroll container on both axes, and a menu
   * positioned inside it is clipped at the column's foot. Anchoring to the viewport instead is
   * what lets the menu stand clear; a resize closes it rather than letting it drift away from
   * the row it belongs to.
   */
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);

  const reachable = entries
    .map((entry, position) => (entry.disabled ? -1 : position))
    .filter(position => position >= 0);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };

  const openAt = (end: 'first' | 'last') => {
    const target = end === 'first' ? reachable[0] : reachable[reachable.length - 1];
    if (target === undefined) return;
    setAnchor(trigger.current?.getBoundingClientRect() ?? null);
    setActiveItem(target);
    setOpen(true);
  };

  // A resize invalidates the anchor outright. A scroll cannot: the backdrop is what the pointer
  // meets while the menu is open, so what is underneath does not move.
  useEffect(() => {
    if (!open) return;
    const dismiss = () => setOpen(false);
    window.addEventListener('resize', dismiss);
    return () => window.removeEventListener('resize', dismiss);
  }, [open]);

  const placement =
    phone || anchor === null
      ? undefined
      : (() => {
          const viewportHeight = document.documentElement.clientHeight;
          const viewportWidth = document.documentElement.clientWidth;
          const room = 340;
          const upward = viewportHeight - anchor.bottom < room && anchor.top > room;
          return {
            position: 'fixed' as const,
            insetBlockStart: upward ? undefined : Math.round(anchor.bottom + 4),
            insetBlockEnd: upward ? Math.round(viewportHeight - anchor.top + 4) : undefined,
            insetInlineStart: dir === 'rtl' ? Math.round(anchor.left) : undefined,
            insetInlineEnd: dir === 'rtl' ? undefined : Math.round(viewportWidth - anchor.right),
            maxBlockSize: 'min(60vh, 340px)',
            overflowY: 'auto' as const
          };
        })();

  // Focus follows the roving index whenever the menu is open, which is what makes ↑ ↓ Home and
  // End move the reading position rather than just a highlight.
  useEffect(() => {
    if (open) items.current[activeItem]?.focus();
  }, [open, activeItem]);

  const step = (direction: 1 | -1) => {
    if (reachable.length === 0) return;
    const here = reachable.indexOf(activeItem);
    const next = here < 0 ? 0 : (here + direction + reachable.length) % reachable.length;
    setActiveItem(reachable[next]!);
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        step(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        step(-1);
        return;
      case 'Home':
        event.preventDefault();
        if (reachable[0] !== undefined) setActiveItem(reachable[0]);
        return;
      case 'End':
        event.preventDefault();
        if (reachable.length > 0) setActiveItem(reachable[reachable.length - 1]!);
        return;
      case 'Escape':
        // Stopped here so an open menu inside a dialog does not also close the dialog.
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      case 'Tab':
        // Tab closes the menu and moves on rather than trapping inside it.
        close(false);
        return;
      default:
        return;
    }
  };

  let openedGroup: string | null = null;

  return (
    <div className="card-menu">
      <button
        type="button"
        className="icon"
        ref={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            openAt('first');
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            openAt('last');
          }
        }}
        onClick={() => (open ? close(false) : openAt('first'))}
      >
        <MoreIcon />
      </button>

      {open ? (
        <>
          <div className="menu-backdrop" onMouseDown={() => close(false)} />
          <div className="menu" role="menu" aria-label={menuLabel} style={placement} onKeyDown={onMenuKeyDown}>
            {entries.map((entry, position) => {
              const heading = entry.group !== undefined && entry.group !== openedGroup;
              if (entry.group !== undefined) openedGroup = entry.group;
              return (
                <Fragment key={entry.key}>
                  {heading ? (
                    <p className="menu-group-label" role="presentation">
                      {entry.group}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    ref={element => {
                      items.current[position] = element;
                    }}
                    tabIndex={position === activeItem ? 0 : -1}
                    className={
                      entry.danger === true
                        ? 'menu-item danger'
                        : entry.group !== undefined
                          ? 'menu-item menu-item-column'
                          : 'menu-item'
                    }
                    disabled={entry.disabled}
                    dir={entry.autoDir === true ? 'auto' : undefined}
                    onFocus={() => setActiveItem(position)}
                    onClick={() => {
                      close(true);
                      entry.run();
                    }}
                  >
                    {entry.label}
                  </button>
                </Fragment>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
