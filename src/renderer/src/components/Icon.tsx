import type { ReactNode } from 'react'

/**
 * The Writer icon set (Phase 8) — a cohesive stroke-based system that replaces
 * the ad-hoc emoji. Every icon is a 24×24 line drawing in `currentColor`, so it
 * inherits text colour and themes automatically (including custom themes). The
 * SVG source of truth lives in the Writer Design System project
 * (claude.ai/design → assets/icons); keep the two in sync.
 */
export type IconName =
  | 'file'
  | 'file-plus'
  | 'folder'
  | 'folder-plus'
  | 'chevron-right'
  | 'chevron-down'
  | 'user'
  | 'map-pin'
  | 'gem'
  | 'flag'
  | 'sparkles'
  | 'git-branch'
  | 'link'
  | 'book-open'
  | 'info'
  | 'pin'
  | 'x'
  | 'reload'
  | 'tag'

const PATHS: Record<IconName, ReactNode> = {
  file: (
    <>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
    </>
  ),
  'file-plus': (
    <>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M12 12v5M9.5 14.5h5" />
    </>
  ),
  folder: (
    <path d="M4 7a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
  ),
  'folder-plus': (
    <>
      <path d="M4 7a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M12 11.5v5M9.5 14h5" />
    </>
  ),
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  'map-pin': (
    <>
      <path d="M12 21s6.5-5.8 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.2 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.2" />
    </>
  ),
  gem: (
    <>
      <path d="M12 2 22 9 12 22 2 9z" />
      <path d="M2 9h20M8 2 6 9l6 13 6-13-2-7" />
    </>
  ),
  flag: <path d="M5 21V4M5 5h12l-2.2 3.5L17 12H5" />,
  sparkles: (
    <>
      <path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7z" />
      <path d="M18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </>
  ),
  'git-branch': (
    <>
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="7" cy="18" r="2.2" />
      <circle cx="17" cy="8" r="2.2" />
      <path d="M7 8.2v7.6M7 15a8 8 0 0 0 8-6.6" />
    </>
  ),
  link: (
    <>
      <path d="M9.5 14.5l5-5" />
      <path d="M10.5 6.5l1-1a3.5 3.5 0 0 1 5 5l-1 1" />
      <path d="M13.5 17.5l-1 1a3.5 3.5 0 0 1-5-5l1-1" />
    </>
  ),
  'book-open': (
    <path d="M12 6.5v13M12 6.5a3.5 3.5 0 0 0-3.5-2H3.5v12.5h5a3.5 3.5 0 0 1 3.5 2M12 6.5a3.5 3.5 0 0 1 3.5-2h5V17h-5a3.5 3.5 0 0 0-3.5 2" />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5h.01" />
    </>
  ),
  pin: (
    <>
      <path d="M12 17v5" />
      <path d="M9 3.5h6l-1 5.5 2.5 2.5v2H7.5v-2L10 9z" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  reload: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1L20.5 8" />
      <path d="M20.5 3.5V8H16" />
    </>
  ),
  tag: (
    <>
      <path d="M3 11.5V5a2 2 0 0 1 2-2h6.5L21 12.5 12.5 21z" />
      <path d="M7.5 7.5h.01" />
    </>
  )
}

export function Icon({
  name,
  size = 16,
  className
}: {
  /** An IconName, or any string (unknown names fall back to `tag`) so dynamic
   * entity `iconName`s can be passed through safely. */
  name: IconName | string
  size?: number
  className?: string
}) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name as IconName] ?? PATHS.tag}
    </svg>
  )
}
