import { useId, type ReactNode } from 'react'

/**
 * The Writer icon set (Phase 8). A dimensional, theme-aware style: each object
 * icon's body is `currentColor` (so it retints with the theme, including custom
 * themes) with a gloss gradient (light top → shadow bottom) + a soft drop shadow
 * layered on for depth. Small functional marks (chevrons, close, the thread
 * wave) stay as clean strokes so they read at tiny sizes. SVG source of truth
 * lives in the Writer Design System project (claude.ai/design → assets/icons).
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
  | 'thread'
  | 'link'
  | 'book-open'
  | 'info'
  | 'pin'
  | 'x'
  | 'reload'
  | 'tag'
  | 'comment'
  | 'activity'

/** Filled ("solid") icons get the glossy 3D treatment. Value = the silhouette
 * path(s); `evenodd` cuts interior holes (the map-pin dot, the info "i"). */
type Solid = { d: string; evenodd?: boolean; badge?: 'plus' }

const SOLID: Partial<Record<IconName, Solid>> = {
  file: {
    d: 'M6.8 2.5h6.4L18 7.3v13.4a.8.8 0 0 1-.8.8H6.8a.8.8 0 0 1-.8-.8V3.3a.8.8 0 0 1 .8-.8z'
  },
  'file-plus': {
    d: 'M6.8 2.5h6.4L18 7.3v13.4a.8.8 0 0 1-.8.8H6.8a.8.8 0 0 1-.8-.8V3.3a.8.8 0 0 1 .8-.8z',
    badge: 'plus'
  },
  folder: {
    d: 'M4 6.5c0-.8.6-1.4 1.4-1.4h3.3c.4 0 .8.2 1.1.5l1 1.1c.3.3.7.5 1.1.5h6.7c.8 0 1.4.6 1.4 1.4v8.5c0 .8-.6 1.4-1.4 1.4H5.4c-.8 0-1.4-.6-1.4-1.4z'
  },
  'folder-plus': {
    d: 'M4 6.5c0-.8.6-1.4 1.4-1.4h3.3c.4 0 .8.2 1.1.5l1 1.1c.3.3.7.5 1.1.5h6.7c.8 0 1.4.6 1.4 1.4v8.5c0 .8-.6 1.4-1.4 1.4H5.4c-.8 0-1.4-.6-1.4-1.4z',
    badge: 'plus'
  },
  user: {
    d: 'M12 4.7a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6zM12 13.4c-4 0-7.2 2.6-7.8 6-.1.7.4 1.3 1.1 1.3h13.4c.7 0 1.2-.6 1.1-1.3-.6-3.4-3.8-6-7.8-6z'
  },
  'map-pin': {
    d: 'M12 2.2c-3.9 0-7 3.1-7 7 0 4.6 5.6 10.8 6.5 11.8.3.3.7.3 1 0C13.4 20 19 13.8 19 9.2c0-3.9-3.1-7-7-7zm0 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
    evenodd: true
  },
  gem: { d: 'M11.6 2.6 3.2 8.7l8.4 12.5L20 8.7z' },
  flag: {
    d: 'M5.2 3a.8.8 0 0 0-.8.8v16.4a.8.8 0 0 0 1.6 0v-6.4h9.7c.7 0 1.1-.8.7-1.4l-1.9-2.6 1.9-2.6c.4-.6 0-1.4-.7-1.4H5.2z'
  },
  sparkles: {
    d: 'M12 2.2l1.8 5.2c.1.3.3.5.6.6l5.2 1.8-5.2 1.8c-.3.1-.5.3-.6.6L12 17.4l-1.8-5.2c-.1-.3-.3-.5-.6-.6L4.4 9.8l5.2-1.8c.3-.1.5-.3.6-.6zM18.8 14.4l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z'
  },
  'book-open': {
    d: 'M11.2 6.6c-1-.9-2.5-1.5-4.1-1.5H3.7a.7.7 0 0 0-.7.7v10.8c0 .4.3.7.7.7h3.4c1.6 0 3.1.6 4.1 1.5zM12.8 6.6c1-.9 2.5-1.5 4.1-1.5h3.4c.4 0 .7.3.7.7v10.8c0 .4-.3.7-.7.7h-3.4c-1.6 0-3.1.6-4.1 1.5z'
  },
  info: {
    d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 3.6a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zM10.9 10.7h2.2v6.6h-2.2z',
    evenodd: true
  },
  pin: {
    d: 'M9 3.2h6a.7.7 0 0 1 .7.9l-1 4.2 2 1.9c.2.2.3.4.3.6v.5a.7.7 0 0 1-.7.7h-4.6v5.4a.7.7 0 0 1-1.4 0v-5.4H5.7a.7.7 0 0 1-.7-.7v-.5c0-.2.1-.4.3-.6l2-1.9-1-4.2a.7.7 0 0 1 .7-.9z'
  },
  tag: {
    d: 'M3.6 12V5.2c0-.9.7-1.6 1.6-1.6H12c.4 0 .8.2 1.1.5l8.4 8.4c.6.6.6 1.6 0 2.2l-5.4 5.4c-.6.6-1.6.6-2.2 0L4.1 13.1c-.3-.3-.5-.7-.5-1.1zm3.9-5.6a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z',
    evenodd: true
  }
}

/** Stroke ("line") icons — linear marks that don't fill meaningfully. */
const LINE: Partial<Record<IconName, ReactNode>> = {
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'git-branch': (
    <>
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="7" cy="18" r="2.2" />
      <circle cx="17" cy="8" r="2.2" />
      <path d="M7 8.2v7.6M7 15a8 8 0 0 0 8-6.6" />
    </>
  ),
  thread: (
    <>
      <path d="M3 13c2-4 4-4 6 0s4 4 6 0 4-4 6 0" />
      <circle cx="3" cy="13" r="1.1" />
      <circle cx="21" cy="13" r="1.1" />
    </>
  ),
  link: (
    <>
      <path d="M9.5 14.5l5-5" />
      <path d="M10.5 6.5l1-1a3.5 3.5 0 0 1 5 5l-1 1" />
      <path d="M13.5 17.5l-1 1a3.5 3.5 0 0 1-5-5l1-1" />
    </>
  ),
  comment: (
    <path d="M4.5 5.5a1.5 1.5 0 0 1 1.5-1.5h12a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4 3.5V15H6a1.5 1.5 0 0 1-1.5-1.5z" />
  ),
  activity: <path d="M3 12h3.5l2.5-7 4 14 2.5-7H21" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  reload: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1L20.5 8" />
      <path d="M20.5 3.5V8H16" />
    </>
  )
}

export function Icon({
  name,
  size = 16,
  className
}: {
  name: IconName | string
  size?: number
  className?: string
}) {
  const gid = useId()
  const cls = className ? `icon ${className}` : 'icon'
  const solid = SOLID[name as IconName]

  if (solid) {
    return (
      <svg
        className={cls}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <defs>
          {/* Gloss: light highlight up top → transparent → soft shadow at the
              bottom. Overlaid on the currentColor body for a dimensional look. */}
          <linearGradient id={`${gid}-gloss`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.42" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.62" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.28" />
          </linearGradient>
        </defs>
        {/* Soft cast shadow (an offset, faded copy behind the body). */}
        <path
          d={solid.d}
          fillRule={solid.evenodd ? 'evenodd' : 'nonzero'}
          fill="#000"
          opacity="0.16"
          transform="translate(0 0.9)"
        />
        {/* Body (themes with the text colour) + gloss overlay. */}
        <path
          d={solid.d}
          fillRule={solid.evenodd ? 'evenodd' : 'nonzero'}
          fill="currentColor"
        />
        <path
          d={solid.d}
          fillRule={solid.evenodd ? 'evenodd' : 'nonzero'}
          fill={`url(#${gid}-gloss)`}
        />
        {solid.badge === 'plus' && (
          <>
            <circle cx="18" cy="18" r="4.6" fill="var(--accent)" />
            <path
              d="M18 15.8v4.4M15.8 18h4.4"
              stroke="var(--accent-fg)"
              strokeWidth="1.8"
              strokeLinecap="round"
              fill="none"
            />
          </>
        )}
      </svg>
    )
  }

  return (
    <svg
      className={cls}
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
      {LINE[name as IconName] ?? LINE['chevron-right']}
    </svg>
  )
}
