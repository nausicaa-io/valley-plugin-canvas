import { React } from './runtime'
import { paletteCssValue, paletteRef } from '@valley/plugin-sdk/palette'
import { CANVAS_PRESET_PALETTE, type CanvasColor, type CanvasEdge, type CanvasNodeType } from './canvasModel'
import { uiText } from './localization'
import { ArrowEndsIcon, DuplicateIcon, FileCardIcon, FitIcon, GroupIcon, LabelIcon, LinkCardIcon, MoreIcon, PaletteIcon, PencilIcon, TextCardIcon, TrashIcon, ZoomInIcon, ZoomOutIcon } from './icons'

/**
 * The create menu — bottom centre, like Obsidian's `.canvas-card-menu`. Each
 * button both clicks (card lands at the viewport centre) and drags (card lands
 * where you drop it).
 */
export const CardMenu = (props: {
  readOnly: boolean
  onCreateStart: (e: React.PointerEvent, kind: CanvasNodeType) => void
  onCreateClick: (kind: CanvasNodeType) => void
}): ReturnType<typeof React.createElement> => {
  const entries: { kind: CanvasNodeType; title: string; Icon: () => ReturnType<typeof React.createElement> }[] = [
    { kind: 'text', title: uiText('auto.0d93b235dd84'), Icon: TextCardIcon },
    { kind: 'file', title: uiText('auto.44cc5b642313'), Icon: FileCardIcon },
    { kind: 'link', title: uiText('auto.d0194874754e'), Icon: LinkCardIcon },
    { kind: 'group', title: uiText('auto.2fca464f9c89'), Icon: GroupIcon }
  ]
  return (
    <div className="canvas-card-menu" onPointerDown={(e) => e.stopPropagation()}>
      {entries.map(({ kind, title, Icon }) => (
        <button
          key={kind}
          type="button"
          className="canvas-btn draggable"
          title={title}
          disabled={props.readOnly}
          onPointerDown={(e) => props.onCreateStart(e, kind)}
          onClick={() => props.onCreateClick(kind)}
        >
          <Icon />
        </button>
      ))}
    </div>
  )
}

/** Zoom + fit, top right — Obsidian's `.canvas-controls` / `.canvas-control-group`. */
export const Controls = (props: {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
  onFit: () => void
}): ReturnType<typeof React.createElement> => (
  <div className="canvas-controls" onPointerDown={(e) => e.stopPropagation()}>
    <div className="canvas-control-group">
      <button type="button" className="canvas-btn" title={uiText('auto.4fc05f2763ba')} onClick={props.onZoomIn}>
        <ZoomInIcon />
      </button>
      <button type="button" className="canvas-zoom-label" title={uiText('auto.b138c837b224')} onClick={props.onReset}>
        {Math.round(props.zoom * 100)}%
      </button>
      <button type="button" className="canvas-btn" title={uiText('auto.a4ae4b24a1f5')} onClick={props.onZoomOut}>
        <ZoomOutIcon />
      </button>
    </div>
    <div className="canvas-control-group">
      <button type="button" className="canvas-btn" title={uiText('auto.71a8dbe16500')} onClick={props.onFit}>
        <FitIcon />
      </button>
    </div>
  </div>
)

/** The actions menu floating over the current selection. */
export const SelectionMenu = (props: {
  at: { x: number; y: number; below: boolean }
  edge: CanvasEdge | undefined
  canEdit: boolean
  editable: boolean
  readOnly: boolean
  onColor: (anchor: HTMLElement) => void
  onEditNode: () => void
  onEditLabel: () => void
  onArrowEnds: () => void
  onDuplicate: () => void
  onDelete: () => void
  onMore: (at: { x: number; y: number }) => void
}): ReturnType<typeof React.createElement> => {
  const { edge } = props
  const style: React.CSSProperties = {
    left: props.at.x,
    top: props.at.y,
    transform: props.at.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)'
  }
  return (
    <div className="canvas-selection-menu" style={style} onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="canvas-btn"
        title={uiText('auto.1d0c8304baed')}
        disabled={props.readOnly}
        onClick={(e) => props.onColor(e.currentTarget)}
      >
        <PaletteIcon />
      </button>
      {edge ? (
        <>
          <button type="button" className="canvas-btn" title={uiText('auto.996c71a5aa55')} disabled={props.readOnly} onClick={props.onArrowEnds}>
            <ArrowEndsIcon fromEnd={edge.fromEnd === 'arrow' ? 'arrow' : 'none'} toEnd={edge.toEnd === 'none' ? 'none' : 'arrow'} />
          </button>
          <button type="button" className="canvas-btn" title={uiText('auto.84e1c434e634')} disabled={props.readOnly} onClick={props.onEditLabel}>
            <LabelIcon />
          </button>
        </>
      ) : (
        <>
          {props.editable && (
            <button type="button" className="canvas-btn" title={uiText('auto.2077c3c7a6d7')} disabled={props.readOnly} onClick={props.onEditNode}>
              <PencilIcon />
            </button>
          )}
          <button type="button" className="canvas-btn" title={uiText('auto.972d57379db3')} disabled={props.readOnly} onClick={props.onDuplicate}>
            <DuplicateIcon />
          </button>
        </>
      )}
      <span className="sep" />
      <button
        type="button"
        className="canvas-btn danger"
        title={uiText('auto.f6fdbe48dc54')}
        disabled={props.readOnly}
        onClick={props.onDelete}
      >
        <TrashIcon />
      </button>
      {!edge && (
        <button
          type="button"
          className="canvas-btn"
          title={uiText('auto.86c0a35ec883')}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            props.onMore({ x: r.left, y: r.bottom + 4 })
          }}
        >
          <MoreIcon />
        </button>
      )}
    </div>
  )
}

/**
 * Six presets, a clear button and Obsidian's seventh **custom** swatch. Presets
 * render through `paletteCssValue`, so they follow the theme and a user's design
 * snippet; the custom swatch writes a `#rrggbb` literal straight into the file.
 */
export const ColorPicker = (props: {
  current: CanvasColor | undefined
  onPick: (color: CanvasColor | undefined) => void
}): ReturnType<typeof React.createElement> => {
  const custom = props.current?.startsWith('#') ? props.current : undefined
  return (
    <div className="canvas-color-picker">
      <button
        type="button"
        className={`canvas-swatch none${props.current ? '' : ' active'}`}
        title={uiText('auto.1d5c5b448862')}
        onClick={() => props.onPick(undefined)}
      />
      {Object.entries(CANVAS_PRESET_PALETTE).map(([key, id]) => (
        <button
          key={key}
          type="button"
          className={`canvas-swatch${props.current === key ? ' active' : ''}`}
          style={{ background: paletteCssValue(paletteRef(id)) }}
          title={uiText('auto.1c00478aa356', { p0: key })}
          onClick={() => props.onPick(key)}
        />
      ))}
      <span
        className={`canvas-swatch custom${custom ? ' has-value active' : ''}`}
        style={custom ? { background: custom } : undefined}
        title={uiText('auto.34cfc6448b9d')}
      >
        <input
          type="color"
          value={custom ?? '#888888'}
          onChange={(e) => props.onPick(e.target.value.toLowerCase())}
        />
      </span>
    </div>
  )
}

