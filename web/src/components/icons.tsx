/**
 * The icons the interface actually needs, and nothing else.
 *
 * Every one is inline SVG on a 20×20 box at 1.5px stroke — Industry's weight — so no icon
 * package is added and no glyph depends on a font that might not load. They are decoration:
 * each sits beside visible text or inside a control that takes its accessible name from the
 * dictionary, so `aria-hidden` is set here rather than at every call site.
 *
 * The four that point along the reading direction carry `icon-mirror`, which flips them when
 * the document direction is right-to-left.
 */

import type { ReactNode } from 'react';

type IconProps = { className?: string };

function svg(children: ReactNode, className?: string) {
  return (
    <svg className={className ?? 'icon'} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return svg(
    <>
      <path d="M10 4v12" />
      <path d="M4 10h12" />
    </>,
    className
  );
}

export function ChevronUpIcon({ className }: IconProps) {
  return svg(<path d="M5 12.5 10 7.5l5 5" />, className);
}

export function ChevronDownIcon({ className }: IconProps) {
  return svg(<path d="M5 7.5l5 5 5-5" />, className);
}

/** Points towards the start of the reading direction, so it mirrors. */
export function ChevronStartIcon({ className }: IconProps) {
  return svg(<path d="M12.5 4.5 7 10l5.5 5.5" />, `${className ?? 'icon'} icon-mirror`);
}

/** Points towards the end of the reading direction, so it mirrors. */
export function ChevronEndIcon({ className }: IconProps) {
  return svg(<path d="M7.5 4.5 13 10l-5.5 5.5" />, `${className ?? 'icon'} icon-mirror`);
}

export function GripIcon({ className }: IconProps) {
  return (
    <svg className={`${className ?? 'icon'} icon-mirror`} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="7.5" cy="5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="15" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="15" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MoreIcon({ className }: IconProps) {
  return (
    <svg className={className ?? 'icon'} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="4.5" cy="10" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="10" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PencilIcon({ className }: IconProps) {
  return svg(
    <>
      <path d="M13.5 3.5 16.5 6.5 7 16H4v-3z" />
      <path d="M11.5 5.5 14.5 8.5" />
    </>,
    className
  );
}

export function TrashIcon({ className }: IconProps) {
  return svg(
    <>
      <path d="M3.5 5.5h13" />
      <path d="M8 5.5V4h4v1.5" />
      <path d="M5.5 5.5 6.3 16h7.4l.8-10.5" />
      <path d="M8.5 8.5v4.5" />
      <path d="M11.5 8.5v4.5" />
    </>,
    className
  );
}

export function CloseIcon({ className }: IconProps) {
  return svg(
    <>
      <path d="M5 5l10 10" />
      <path d="M15 5 5 15" />
    </>,
    className
  );
}

export function MenuIcon({ className }: IconProps) {
  return svg(
    <>
      <path d="M3.5 6h13" />
      <path d="M3.5 10h13" />
      <path d="M3.5 14h13" />
    </>,
    className
  );
}

export function PersonIcon({ className }: IconProps) {
  return svg(
    <>
      <circle cx="10" cy="7" r="3" />
      <path d="M4.5 16.5c.9-2.7 3-4 5.5-4s4.6 1.3 5.5 4" />
    </>,
    className
  );
}

/**
 * The Done cap's check. It draws itself once when a card arrives — a quiet acknowledgement,
 * not a reward: no confetti, no counter, no sound. Under a reduced-motion preference the
 * stroke is simply present.
 */
export function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className ?? 'icon'} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M4 10.5 8 14.5 16 5.5" />
    </svg>
  );
}

/**
 * The product mark: three column rules, one chip advancing column by column, and the check that
 * waits at the end. A line drawing at 1.5px, so it survives at 24px and reversed on steel.
 */
export function BrandMark({ className }: IconProps) {
  return (
    <svg className={className ?? 'brand-mark'} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3.5v17" />
        <path d="M9.5 3.5v17" />
        <path d="M16 3.5v17" />
        <rect x="4.6" y="8" width="3.3" height="3.3" fill="currentColor" stroke="none" />
        <rect x="11.1" y="12.4" width="3.3" height="3.3" fill="currentColor" stroke="none" />
        <path d="M18 11.5 20 13.5 23 8.5" />
      </g>
    </svg>
  );
}
