import { React } from './runtime'
import {
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type EdgeSide,
  resolveColor
} from './canvasModel'
import {
  arrowPoints,
  bezierMidpoint,
  bezierPath,
  boundsOf,
  chooseSide,
  nodeRect,
  sideAnchor,
  type Point
} from './geometry'

const ARROW_SIZE = 10
// Padding around the node bounds so the SVG box comfortably contains bezier
// control-point bows + arrowheads (the curve can bow out by up to ~400px).
const SVG_PAD = 500

function opposite(side: EdgeSide): EdgeSide {
  return side === 'top' ? 'bottom' : side === 'bottom' ? 'top' : side === 'left' ? 'right' : 'left'
}

interface EdgeGeom {
  edge: CanvasEdge
  path: string
  from: Point
  fromSide: EdgeSide
  to: Point
  toSide: EdgeSide
  mid: Point
  color: string | null
}

function geomFor(edge: CanvasEdge, nodes: Map<string, CanvasNode>): EdgeGeom | null {
  const a = nodes.get(edge.fromNode)
  const b = nodes.get(edge.toNode)
  if (!a || !b) return null
  const ra = nodeRect(a)
  const rb = nodeRect(b)
  const fromSide = edge.fromSide ?? chooseSide(ra, rb)
  const toSide = edge.toSide ?? chooseSide(rb, ra)
  const from = sideAnchor(ra, fromSide)
  const to = sideAnchor(rb, toSide)
  return {
    edge,
    path: bezierPath(from, fromSide, to, toSide),
    from,
    fromSide,
    to,
    toSide,
    mid: bezierMidpoint(from, fromSide, to, toSide),
    color: resolveColor(edge.color)
  }
}

export interface ConnectPreview {
  from: Point
  fromSide: EdgeSide
  to: Point
}

export interface EdgeLayerProps {
  data: CanvasData
  nodesById: Map<string, CanvasNode>
  selectedEdge: string | null
  /** Id of the edge whose label is being edited inline, if any. */
  editingLabel: string | null
  /** Counteracts the world transform so chrome holds its on-screen size. */
  invZoom: number
  onSelectEdge: (id: string, additive: boolean) => void
  onStartLabelEdit: (id: string) => void
  onCommitLabel: (id: string, label: string) => void
  onCancelLabel: () => void
  preview: ConnectPreview | null
  onReconnect?: (event: React.PointerEvent, edge: CanvasEdge, end: 'from' | 'to') => void
}

/**
 * The connector layer, drawn in world units inside the transformed world element
 * so it pans/zooms with the nodes.
 *
 * Two sub-layers: one SVG for the curves, arrowheads and fat transparent hit
 * paths, and a DOM layer above it for labels. Labels are DOM rather than SVG
 * `<text>` (which is what Obsidian does too) because they need an opaque plate
 * to stay readable over a card, and an inline editor on double-click. Stroke
 * widths live in CSS so they can multiply by `--canvas-chrome`; the arrowhead is
 * built in JS, so it takes `invZoom` directly.
 */
export const EdgeLayer = (props: EdgeLayerProps): ReturnType<typeof React.createElement> => {
  const { data, nodesById, selectedEdge, editingLabel, invZoom, onSelectEdge, preview } = props
  // Size the SVG to the node bounds (+ padding) and give it a matching viewBox so
  // its user space is identical to world space — a 0×0 SVG does not paint its
  // overflow in Chromium, so edges drawn at world coords were being culled.
  const bounds = boundsOf(data.nodes)
  if (!bounds) return <svg className="canvas-edges" />
  const minX = bounds.x - SVG_PAD
  const minY = bounds.y - SVG_PAD
  const w = bounds.width + SVG_PAD * 2
  const h = bounds.height + SVG_PAD * 2
  const arrow = ARROW_SIZE * invZoom

  const geoms = data.edges
    .map((edge) => geomFor(edge, nodesById))
    .filter((g): g is EdgeGeom => g !== null)

  return (
    <>
      <svg
        className="canvas-edges"
        style={{ left: minX, top: minY, width: w, height: h }}
        width={w}
        height={h}
        viewBox={`${minX} ${minY} ${w} ${h}`}
      >
        {geoms.map((g) => {
          const edge = g.edge
          const selected = selectedEdge === edge.id
          const style = g.color ? ({ ['--canvas-edge-color' as string]: g.color } as React.CSSProperties) : undefined
          const toEnd = edge.toEnd ?? 'arrow'
          const fromEnd = edge.fromEnd ?? 'none'
          return (
            <g key={edge.id} className={`canvas-edge${selected ? ' selected' : ''}`} style={style}>
              <path
                className="canvas-edge-hit"
                d={g.path}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onSelectEdge(edge.id, e.shiftKey)
                }}
              />
              <path className="canvas-edge-line" d={g.path} />
              {toEnd === 'arrow' && <polygon className="canvas-arrow" points={arrowPoints(g.to, g.toSide, arrow)} />}
              {fromEnd === 'arrow' && (
                <polygon className="canvas-arrow" points={arrowPoints(g.from, g.fromSide, arrow)} />
              )}
              {selected && props.onReconnect && (['from', 'to'] as const).map((end) => (
                <circle
                  key={end}
                  className="canvas-edge-endpoint"
                  data-edge-end={end}
                  cx={g[end].x}
                  cy={g[end].y}
                  r={7 * invZoom}
                  onPointerDown={(event) => props.onReconnect?.(event, edge, end)}
                />
              ))}
            </g>
          )
        })}
        {preview && (
          <path
            className="canvas-edge-preview"
            d={bezierPath(preview.from, preview.fromSide, preview.to, opposite(preview.fromSide))}
          />
        )}
      </svg>

      <div className="canvas-edge-labels">
        {geoms.map((g) => {
          const editing = editingLabel === g.edge.id
          if (!g.edge.label && !editing) return null
          return (
            <div
              key={g.edge.id}
              className={`canvas-path-label-wrapper canvas-edge${selectedEdge === g.edge.id ? ' selected' : ''}`}
              style={{ left: g.mid.x, top: g.mid.y }}
            >
              {editing ? (
                <EdgeLabelInput
                  initial={g.edge.label ?? ''}
                  onCommit={(value) => props.onCommitLabel(g.edge.id, value)}
                  onCancel={props.onCancelLabel}
                />
              ) : (
                <div
                  className="canvas-path-label"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    onSelectEdge(g.edge.id, e.shiftKey)
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    props.onStartLabelEdit(g.edge.id)
                  }}
                >
                  {g.edge.label}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

const EdgeLabelInput = (props: {
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
}): ReturnType<typeof React.createElement> => {
  const [value, setValue] = React.useState(props.initial)
  return (
    <input
      className="canvas-path-label canvas-path-label-input"
      autoFocus
      value={value}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => props.onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          props.onCommit(value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          props.onCancel()
        }
      }}
    />
  )
}
