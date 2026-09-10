import { React } from './runtime'

/**
 * Inline SVG icons for the canvas toolbar / node chrome. Each is a *component*
 * (not a module-level element): the classic JSX transform binds `React` inside
 * `register()`, so evaluating JSX at module top level would run with
 * `React === undefined` and reject the bundle. Locked by `bundleLoads.test`.
 */
type Icon = () => ReturnType<typeof React.createElement>

const svg = (children: ReturnType<typeof React.createElement>): ReturnType<typeof React.createElement> => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const TextCardIcon: Icon = () =>
  svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="7" y1="9" x2="17" y2="9" />
      <line x1="7" y1="13" x2="17" y2="13" />
      <line x1="7" y1="17" x2="13" y2="17" />
    </>
  )

export const FileCardIcon: Icon = () =>
  svg(
    <>
      <path d="M14 3v5h5" />
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    </>
  )

export const LinkCardIcon: Icon = () =>
  svg(
    <>
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </>
  )

export const GroupIcon: Icon = () =>
  svg(
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 3" />
    </>
  )

export const ZoomInIcon: Icon = () =>
  svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </>
  )

export const ZoomOutIcon: Icon = () =>
  svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </>
  )

export const FitIcon: Icon = () =>
  svg(
    <>
      <path d="M4 9V5a1 1 0 0 1 1-1h4" />
      <path d="M20 9V5a1 1 0 0 0-1-1h-4" />
      <path d="M4 15v4a1 1 0 0 0 1 1h4" />
      <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
    </>
  )

export const TrashIcon: Icon = () =>
  svg(
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <path d="M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </>
  )

export const PaletteIcon: Icon = () =>
  svg(
    <>
      <circle cx="13.5" cy="6.5" r="1" />
      <circle cx="17.5" cy="10.5" r="1" />
      <circle cx="8.5" cy="7.5" r="1" />
      <circle cx="6.5" cy="12.5" r="1" />
      <path d="M12 2a10 10 0 1 0 0 20 2 2 0 0 0 2-2v-1a2 2 0 0 1 2-2h1a4 4 0 0 0 4-4 10 10 0 0 0-9-9z" />
    </>
  )

export const PencilIcon: Icon = () =>
  svg(
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  )

export const DuplicateIcon: Icon = () =>
  svg(
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  )

export const MoreIcon: Icon = () =>
  svg(
    <>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </>
  )

export const BringToFrontIcon: Icon = () =>
  svg(
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M4 16V6a2 2 0 0 1 2-2h10" />
    </>
  )

export const SendToBackIcon: Icon = () =>
  svg(
    <>
      <rect x="4" y="4" width="12" height="12" rx="2" />
      <path d="M20 8v10a2 2 0 0 1-2 2H8" />
    </>
  )

export const LabelIcon: Icon = () =>
  svg(
    <>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 3 12V5a2 2 0 0 1 2-2h7a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.6z" />
      <circle cx="7.5" cy="7.5" r="1" />
    </>
  )

/**
 * The arrow-ends glyph, drawn for the edge's *current* ends so the button shows
 * the state it will change. Not an `Icon` — it takes props — but it follows the
 * same never-at-module-scope rule.
 */
export const ArrowEndsIcon = (props: {
  fromEnd: 'none' | 'arrow'
  toEnd: 'none' | 'arrow'
}): ReturnType<typeof React.createElement> =>
  svg(
    <>
      <line x1="6" y1="12" x2="18" y2="12" />
      {props.fromEnd === 'arrow' && <polyline points="9,8 5,12 9,16" />}
      {props.toEnd === 'arrow' && <polyline points="15,8 19,12 15,16" />}
    </>
  )
