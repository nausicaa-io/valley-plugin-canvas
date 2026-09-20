import { registerCanvasSession, pendingCanvasView, notifyCanvas, type CanvasSession } from './session'
import { canvasDocument } from './document'
import { restoreCanvasTarget } from './commands'
import { React, captureCanvasOwner } from './runtime'
import { useCanvasViewport } from './viewport'
import { useCanvasSelection } from './selection'
import { GHOST_SIZE, useCanvasGestures } from './gestures'
import { CardMenu, ColorPicker, Controls, SelectionMenu } from './menus'
import {
  type CanvasColor,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeType,
  addNode,
  createFileNode,
  createGroupNode,
  createLinkNode,
  createTextNode,
  duplicateNodes,
  edgeById,
  nextEdgeEnds,
  nodeById,
  removeEdges,
  removeNodes,
  reorderNodes,
  serializeCanvas,
  setEdgeColor,
  setEdgeEnds,
  setEdgeLabel,
  setNodesColor,
  updateNode
} from './canvasModel'
import {
  type Point,
  bezierMidpoint,
  boundsOf,
  chooseSide,
  fitView,
  gridSpacing,
  nodeRect,
  screenToWorld,
  sideAnchor,
  worldToScreen,
  zoomAt,
  zoomBy,
  zoomMultiplier
} from './geometry'
import { NodeView } from './CanvasNode'
import { EdgeLayer } from './edges'
import { uiText } from './localization'
import { BringToFrontIcon, DuplicateIcon, SendToBackIcon, TrashIcon } from './icons'

const LOD_ZOOM = 0.4 // below this, cards fade to skeleton placeholders
/** One press of the zoom buttons, in log2 octaves — a quarter-doubling. */
const ZOOM_BUTTON_STEP = 0.25
const MENU_GAP = 10 // screen px between the selection and its floating menu
const MENU_HEIGHT = 36 // enough to decide whether the menu fits above

interface Props {
  relPath: string
}

const CanvasEditor = ({ relPath }: Props): ReturnType<typeof React.createElement> => {
  const [owner] = React.useState(() => captureCanvasOwner())
  const api = owner.api
  const document = React.useMemo(() => canvasDocument(owner, relPath), [owner, relPath])
  const context = React.useMemo(() => ({ mounted: true }), [document])
  const latestContext = React.useRef(context)
  latestContext.current = context
  const isViewActive = React.useCallback(() => context.mounted && latestContext.current === context && owner.isActive(), [context, owner])
  const snapshot = React.useSyncExternalStore(document.subscribe, document.get, document.get)
  const { data: model, error: saveError } = snapshot
  const rootRef = React.useRef<HTMLDivElement>(null)
  const viewportState = useCanvasViewport(rootRef)
  const { viewport, setViewport, viewportRef, viewportSize, dimensions, worldAt } = viewportState
  const [readOnly, setReadOnly] = React.useState(false)

  const modelRef = React.useRef(model)
  const selectionState = useCanvasSelection(modelRef)
  const { selection, setSelection, selectionRef, selectedEdge, setSelectedEdge, selectedEdgeRef, editingId, setEditingId, editingRef, editingEdgeLabel, setEditingEdgeLabel, replaceSelection } = selectionState
  const readOnlyRef = React.useRef(false)
  modelRef.current = model
  readOnlyRef.current = readOnly || snapshot.busy || !snapshot.ready || !isViewActive()

  const nodesById = React.useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model.nodes])

  // Counteracts the world transform so chrome inside it holds its on-screen size.
  // `sqrt(1/zoom)`, which is Obsidian's `--zoom-multiplier` exactly: handles and
  // ports give back *some* of the scale rather than none, so a card zoomed far
  // out does not sprout enormous handles and the clamp this used to need is gone.
  const invZoom = zoomMultiplier(viewport.zoom)

  const setModelBoth = React.useCallback((next: CanvasData): void => {
    if (!isViewActive()) return
    document.setData(next)
    modelRef.current = document.get().data
  }, [document, isViewActive])
  const flushSave = (next: CanvasData): Promise<void> => isViewActive() ? document.flush(next) : Promise.resolve()
  const scheduleSave = (next: CanvasData): void => { if (isViewActive()) document.schedule(next) }
  const pushUndo = (label: string, prev: CanvasData, next: CanvasData): void => {
    if (!isViewActive() || document.get().busy) return
    const previous = structuredClone(prev)
    const following = structuredClone(next)
    api.undo.push({
      label,
      undo: async () => { await restoreCanvasTarget(owner, relPath, previous, serializeCanvas(following)); return { ok: true } },
      redo: async () => { await restoreCanvasTarget(owner, relPath, following, serializeCanvas(previous)); return { ok: true } }
    })
  }
  const apply = (next: CanvasData, label: string): void => {
    if (readOnlyRef.current || !isViewActive() || document.get().busy) return
    const prev = document.get().data
    setModelBoth(next)
    scheduleSave(next)
    pushUndo(label, prev, next)
  }
  React.useEffect(() => {
    context.mounted = true
    const detach = document.attach()
    return () => { context.mounted = false; detach() }
  }, [document, context])
  const fitted = React.useMemo(() => ({ done: false }), [document])
  React.useEffect(() => {
    if (!snapshot.ready || fitted.done || !context.mounted) return
    const rect = viewportSize()
    const bounds = boundsOf(snapshot.data.nodes)
    fitted.done = Boolean(rect && rect.width > 0 && rect.height > 0)
    if (bounds && rect && fitted.done) setViewport(fitView(bounds, rect.width, rect.height))
    const pending = pendingCanvasView(relPath, owner)
    if (pending?.viewport) { setViewport(pending.viewport); fitted.done = true }
    if (pending?.nodeIds) setSelection(new Set(pending.nodeIds))
    if (pending?.edgeId !== undefined) setSelectedEdge(pending.edgeId)
  }, [snapshot, fitted, context, viewportSize, dimensions, setViewport, setSelection, setSelectedEdge, relPath, owner])

  const bridgeRef = React.useMemo<{ current: CanvasSession | null }>(() => ({ current: null }), [document])
  bridgeRef.current = {
    get: () => ({ data: document.get().data, viewport: viewportRef.current, nodeIds: [...selectionRef.current], edgeId: selectedEdgeRef.current, readOnly: readOnlyRef.current, ready: document.get().ready && isViewActive(), revision: serializeCanvas(document.get().data), error: document.get().error }),
    commit: async (next, revision) => {
      owner.assertActive()
      if (!isViewActive() || readOnlyRef.current) throw new Error(uiText('canvas.error.readOnly'))
      await document.commit(next, revision)
    },
    restore: (view) => {
      owner.assertActive()
      if (!isViewActive()) return
      if (view.viewport) setViewport(view.viewport)
      if (view.nodeIds) setSelection(new Set(view.nodeIds))
      if (view.edgeId !== undefined) setSelectedEdge(view.edgeId)
    }
  }
  React.useEffect(() => registerCanvasSession(relPath, { get: () => bridgeRef.current!.get(), commit: (data, revision) => bridgeRef.current!.commit(data, revision), restore: (view) => bridgeRef.current!.restore(view) }, owner), [relPath, bridgeRef, owner])
  React.useEffect(() => notifyCanvas(owner), [owner, model, viewport, selection, selectedEdge, readOnly, saveError])

  const reloadDisk = async (): Promise<void> => {
    const restored = await document.reload(() => api.ui.confirm({ title: uiText('canvas.action.reload'), message: uiText('canvas.error.discard'), actions: [{ label: uiText('canvas.action.cancel'), value: 'cancel', variant: 'ghost' }, { label: uiText('canvas.action.reload'), value: 'reload', variant: 'danger' }] }), isViewActive)
    if (restored && isViewActive()) { setSelection(new Set()); setSelectedEdge(null) }
  }

  // ── Selection helpers ────────────────────────────────────────────────────────
  // ── Node body edits + create / delete ────────────────────────────────────────
  const commitNode = (node: CanvasNode, patch: Partial<CanvasNode>): void => {
    setEditingId(null)
    apply(updateNode(modelRef.current, node.id, patch), 'Edit card')
  }

  const viewportCenterWorld = (): Point => {
    const r = viewportSize()
    return screenToWorld(viewportRef.current, (r?.width ?? 600) / 2, (r?.height ?? 400) / 2)
  }

  const addAndSelect = (node: CanvasNode, label: string, edit = false): void => {
    apply(addNode(modelRef.current, node), label)
    replaceSelection(new Set([node.id]))
    setSelectedEdge(null)
    if (edit) setEditingId(node.id)
  }

  // Add helpers center the new card on `at` (a right-click / drop world point) or,
  // when omitted, on the viewport center. Pre-filled cards skip edit mode.
  const addText = (at?: Point, text = ''): void => {
    const c = at ?? viewportCenterWorld()
    addAndSelect(createTextNode(c.x - 125, c.y - 60, text), 'Add text card', !text)
  }
  const addFile = (at?: Point): void => {
    const c = at ?? viewportCenterWorld()
    addAndSelect(createFileNode(c.x - 200, c.y - 200, ''), 'Add file card', true)
  }
  const addLink = (at?: Point, url = ''): void => {
    const c = at ?? viewportCenterWorld()
    addAndSelect(createLinkNode(c.x - 200, c.y - 150, url), 'Add link card', !url)
  }
  const addGroup = (at?: Point): void => {
    const c = at ?? viewportCenterWorld()
    addAndSelect(createGroupNode(c.x - 175, c.y - 125, 350, 250), 'Add group')
  }
  const addOfKind = (kind: CanvasNodeType, at?: Point): void => {
    if (kind === 'text') addText(at)
    else if (kind === 'file') addFile(at)
    else if (kind === 'link') addLink(at)
    else addGroup(at)
  }

  const { marquee, preview, ghost, snapGuides, draggingIds, onRootPointerDown, onRootPointerMove, onRootPointerUp, onNodePointerDown, onResizeStart, onConnectStart, onReconnect, onCreateStart, cancelInteraction } = useCanvasGestures({ rootRef, modelRef, readOnlyRef, viewport: viewportState, selection: selectionState, setModelBoth, apply, pushUndo, scheduleSave, addOfKind })

  // Undo runs through the core bus command (the canvas pushes onto that same stack).
  const doUndo = (): void => {
    if (isViewActive()) void api.commands.execute('undo')
  }
  // Paste clipboard text at the cursor: a URL → link card, anything else → text card.
  const doPaste = async (at: Point): Promise<void> => {
    if (readOnlyRef.current) return
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (!text || !isViewActive() || readOnlyRef.current) return
      if (/^https?:\/\//i.test(text)) addLink(at, text)
      else addText(at, text)
    } catch {
      /* clipboard unavailable / permission denied — no-op */
    }
  }
  const toggleSnapToGrid = (): void => {
    if (isViewActive()) void api.settings.set('snapToGrid', !api.settings.get().snapToGrid)
  }
  const toggleSnapToObjects = (): void => {
    if (isViewActive()) void api.settings.set('snapToObjects', api.settings.get().snapToObjects === false)
  }

  const deleteSelection = (): void => {
    if (selectedEdgeRef.current) {
      apply(removeEdges(modelRef.current, new Set([selectedEdgeRef.current])), 'Delete connection')
      setSelectedEdge(null)
      return
    }
    if (selectionRef.current.size === 0) return
    apply(removeNodes(modelRef.current, selectionRef.current), 'Delete cards')
    replaceSelection(new Set())
  }

  const duplicateSelection = (): void => {
    if (readOnlyRef.current || selectionRef.current.size === 0) return
    const result = duplicateNodes(modelRef.current, selectionRef.current)
    if (result.ids.size === 0) return
    apply(result.data, 'Duplicate cards')
    replaceSelection(result.ids)
  }

  const restack = (to: 'front' | 'back'): void => {
    if (readOnlyRef.current || selectionRef.current.size === 0) return
    apply(reorderNodes(modelRef.current, selectionRef.current, to), to === 'front' ? 'Bring to front' : 'Send to back')
  }

  const applyColor = (color: CanvasColor | undefined): void => {
    if (selectedEdgeRef.current) apply(setEdgeColor(modelRef.current, selectedEdgeRef.current, color), 'Color connection')
    else if (selectionRef.current.size) apply(setNodesColor(modelRef.current, selectionRef.current, color), 'Color cards')
  }

  const cycleArrowEnds = (): void => {
    const id = selectedEdgeRef.current
    if (!id || readOnlyRef.current) return
    const edge = edgeById(modelRef.current, id)
    if (!edge) return
    const next = nextEdgeEnds(edge)
    apply(setEdgeEnds(modelRef.current, id, next.fromEnd, next.toEnd), 'Change arrow ends')
  }

  const commitEdgeLabel = (id: string, label: string): void => {
    setEditingEdgeLabel(null)
    apply(setEdgeLabel(modelRef.current, id, label), 'Edit connection label')
  }

  /**
   * The colour picker rides `api.ui.openPopover`, not a positioned div of our
   * own: the host portals it out of the pane, tracks the anchor and joins the
   * Escape stack (`plugin-sdk.ts` says as much).
   */
  const openColorPicker = (anchor: HTMLElement): void => {
    if (!isViewActive()) return
    const current = currentColor()
    void api.ui.openPopover(
      (ctx) => (
        <ColorPicker
          current={current}
          onPick={(color) => {
            applyColor(color)
            ctx.close()
          }}
        />
      ),
      { anchor, gap: 6 },
      { className: 'canvas-color-picker-panel', ariaLabel: uiText('auto.2e1a93636a60') }
    )
  }

  /** The colour shared by the current selection, for the picker's active ring. */
  const currentColor = (): CanvasColor | undefined => {
    if (selectedEdgeRef.current) return edgeById(modelRef.current, selectedEdgeRef.current)?.color
    const first = [...selectionRef.current][0]
    return first ? nodeById(modelRef.current, first)?.color : undefined
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (editingRef.current) {
      if (e.key === 'Escape') setEditingId(null)
      return
    }
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (readOnlyRef.current) return
      e.preventDefault()
      deleteSelection()
    } else if (e.shiftKey && (e.code === 'Digit1' || e.code === 'Digit2')) {
      e.preventDefault()
      const bounds = boundsOf(modelRef.current.nodes.filter((node) => e.code === 'Digit1' || selectionRef.current.has(node.id)))
      const rect = viewportSize()
      if (bounds && rect) setViewport(fitView(bounds, rect.width, rect.height))
    } else if (e.key === 'Escape') {
      cancelInteraction()
      replaceSelection(new Set())
      setSelectedEdge(null)
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      replaceSelection(new Set(modelRef.current.nodes.map((n) => n.id)))
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      duplicateSelection()
    }
  }

  // ── Drag-drop vault files / URLs onto the canvas ─────────────────────────────
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    if (readOnlyRef.current) return
    const world = worldAt(e)
    const path = e.dataTransfer.getData('application/x-valley-path')
    if (path) {
      addAndSelect(createFileNode(world.x - 200, world.y - 200, path), 'Add file card')
      return
    }
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    if (/^https?:\/\//i.test(text.trim())) addAndSelect(createLinkNode(world.x - 200, world.y - 150, text.trim()), 'Add link card')
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const onSelectEdge = (id: string, additive: boolean): void => {
    if (!additive) replaceSelection(new Set())
    setSelectedEdge(id)
  }

  /** The actions that apply to a card selection, shared by ⋯ and right-click. */
  const selectionMenuItems = (): Parameters<typeof api.ui.openMenu>[0] => [
    { label: uiText('auto.1f65ed95fba6'), icon: <BringToFrontIcon />, enabled: !readOnly, onSelect: () => restack('front') },
    { label: uiText('auto.e259d4e19e69'), icon: <SendToBackIcon />, enabled: !readOnly, onSelect: () => restack('back') },
    { type: 'separator' },
    { label: uiText('auto.972d57379db3'), icon: <DuplicateIcon />, enabled: !readOnly, onSelect: duplicateSelection },
    { type: 'separator' },
    { label: uiText('auto.f6fdbe48dc54'), icon: <TrashIcon />, danger: true, enabled: !readOnly, onSelect: deleteSelection }
  ]

  const openMoreMenu = (at: { x: number; y: number }): void => {
    if (!isViewActive()) return
    void api.ui.openMenu(selectionMenuItems(), at)
  }

  // Right-click: open the empty-canvas menu, or a node menu when over a card.
  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    if (!isViewActive()) return
    const nodeId = (e.target as HTMLElement).closest('[data-node-id]')?.getAttribute('data-node-id') ?? null
    if (nodeId && !selectionRef.current.has(nodeId)) {
      replaceSelection(new Set([nodeId]))
      setSelectedEdge(null)
    }
    const world = worldAt(e)
    void api.ui.openMenu(nodeId ? selectionMenuItems() : [
      { label: uiText('auto.91edf1fe47ea'), enabled: !readOnly, onSelect: () => addText(world) },
      { label: uiText('auto.f4ee7eb1d857'), enabled: !readOnly, onSelect: () => addFile(world) },
      { label: uiText('auto.ddc84cc1637c'), enabled: !readOnly, onSelect: () => addFile(world) },
      { label: uiText('auto.9b2b448d5f52'), enabled: !readOnly, onSelect: () => addLink(world) },
      { label: uiText('auto.5a0b1c170fd5'), enabled: !readOnly, onSelect: () => addGroup(world) },
      { type: 'separator' },
      { label: uiText('auto.39fc72124884'), onSelect: doUndo },
      { label: uiText('auto.db2483000d15'), enabled: !readOnly, onSelect: () => doPaste(world) },
      { type: 'separator' },
      { label: uiText('auto.f364135dee55'), type: 'checkbox', checked: !!api.settings.get().snapToGrid, onSelect: toggleSnapToGrid },
      { label: uiText('auto.17e67aaf94df'), type: 'checkbox', checked: api.settings.get().snapToObjects !== false, onSelect: toggleSnapToObjects },
      { label: 'Read-only', type: 'checkbox', checked: readOnly, onSelect: () => setReadOnly((value) => !value) }
    ], { x: e.clientX, y: e.clientY })
  }

  // The floating selection menu, anchored above the selection in screen space —
  // over the node bounds, or over an edge's curve midpoint.
  const menuAnchor = React.useMemo((): { x: number; y: number; below: boolean } | null => {
    if (editingId || preview || marquee) return null
    if (selectedEdge) {
      const edge = model.edges.find((x) => x.id === selectedEdge)
      if (!edge) return null
      const a = nodesById.get(edge.fromNode)
      const b = nodesById.get(edge.toNode)
      if (!a || !b) return null
      const ra = nodeRect(a)
      const rb = nodeRect(b)
      const fromSide = edge.fromSide ?? chooseSide(ra, rb)
      const toSide = edge.toSide ?? chooseSide(rb, ra)
      const mid = bezierMidpoint(sideAnchor(ra, fromSide), fromSide, sideAnchor(rb, toSide), toSide)
      const p = worldToScreen(viewport, mid.x, mid.y)
      return { x: p.x, y: p.y - MENU_GAP - 14, below: false }
    }
    if (selection.size === 0) return null
    const nodes = model.nodes.filter((n) => selection.has(n.id))
    const bounds = boundsOf(nodes)
    if (!bounds) return null
    const topLeft = worldToScreen(viewport, bounds.x, bounds.y)
    const bottomRight = worldToScreen(viewport, bounds.x + bounds.width, bounds.y + bounds.height)
    const centerX = (topLeft.x + bottomRight.x) / 2
    const above = topLeft.y - MENU_GAP
    // Flip below rather than clamping over the selection when the top is tight.
    return above < MENU_HEIGHT
      ? { x: centerX, y: bottomRight.y + MENU_GAP, below: true }
      : { x: centerX, y: above, below: false }
  }, [selectedEdge, selection, model, nodesById, viewport, editingId, preview, marquee])

  const selectedEdgeObj: CanvasEdge | undefined = selectedEdge
    ? model.edges.find((x) => x.id === selectedEdge)
    : undefined
  const singleNode = selection.size === 1 ? model.nodes.find((n) => selection.has(n.id)) : undefined

  const rootClass =
    'canvas-root' +
    (preview ? ' canvas-connecting' : '') +
    (ghost ? ' canvas-creating' : '') +
    (viewport.zoom < LOD_ZOOM ? ' canvas-lod-far' : '') +
    (readOnly ? ' canvas-readonly' : '')
  // The tile is the *stepped* world spacing times the scale, so the dots keep a
  // near-constant screen density across the whole range instead of turning to
  // grey mush at the bottom of it. The position is the pan modulo one tile —
  // the grid still reads as world-locked, it just changes which world grid it is
  // drawing as you cross a threshold.
  const gridPx = gridSpacing(viewport.zoom) * viewport.zoom
  const gridStyle: React.CSSProperties = {
    backgroundSize: `${gridPx}px ${gridPx}px`,
    backgroundPosition: `${viewport.x % gridPx}px ${viewport.y % gridPx}px`
  }

  return (
    <div
      ref={rootRef}
      className={rootClass}
      style={gridStyle}
      tabIndex={0}
      onPointerDown={onRootPointerDown}
      onPointerMove={onRootPointerMove}
      onPointerUp={onRootPointerUp}
      onPointerCancel={cancelInteraction}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {saveError && <div className="canvas-save-error" role="alert">{saveError}<button onClick={() => { void flushSave(modelRef.current).catch(() => {}) }}>{uiText('canvas.action.retry')}</button><button onClick={() => void reloadDisk()}>{uiText('canvas.action.reload')}</button></div>}
      {model.nodes.length === 0 && (
        <div className="canvas-empty-hint">{uiText('auto.ea33620e5d61')}</div>
      )}

      <div
        className="canvas-world"
        style={
          {
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            ['--canvas-inv-zoom' as string]: String(invZoom)
          } as React.CSSProperties
        }
      >
        <EdgeLayer
          data={model}
          nodesById={nodesById}
          selectedEdge={selectedEdge}
          editingLabel={editingEdgeLabel}
          invZoom={invZoom}
          onSelectEdge={onSelectEdge}
          onStartLabelEdit={(id) => {
            if (!readOnly) setEditingEdgeLabel(id)
          }}
          onCommitLabel={commitEdgeLabel}
          onCancelLabel={() => setEditingEdgeLabel(null)}
          preview={preview}
          onReconnect={readOnly ? undefined : onReconnect}
        />
        {model.nodes.map((node, index) => (
          <NodeView
            owner={owner}
            previewEnabled={viewport.zoom >= LOD_ZOOM}
            sourcePath={relPath}
            key={node.id}
            node={node}
            index={index}
            selected={selection.has(node.id)}
            singleSelected={selection.size === 1 && selection.has(node.id) && !selectedEdge}
            editing={editingId === node.id}
            dragging={draggingIds.has(node.id)}
            readOnly={readOnly}
            onNodePointerDown={onNodePointerDown}
            onResizeStart={onResizeStart}
            onConnectStart={onConnectStart}
            onStartEdit={(n) => {
              if (!readOnly) setEditingId(n.id)
            }}
            onCommit={commitNode}
            onCancelEdit={() => setEditingId(null)}
          />
        ))}
      </div>

      {/* Alignment guides while object-snapping (screen-space overlay, constant 1px). */}
      {snapGuides.map((g, i) => {
        const a = worldToScreen(viewport, g.x1, g.y1)
        const b = worldToScreen(viewport, g.x2, g.y2)
        return (
          <div
            key={i}
            className="canvas-snap-guide"
            style={{
              left: Math.min(a.x, b.x),
              top: Math.min(a.y, b.y),
              width: g.orientation === 'v' ? 1 : Math.abs(b.x - a.x),
              height: g.orientation === 'v' ? Math.abs(b.y - a.y) : 1
            }}
          />
        )
      })}

      {marquee && (
        <div className="canvas-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />
      )}

      {ghost && (
        <div
          className="canvas-drag-ghost"
          style={{
            left: ghost.x,
            top: ghost.y,
            width: GHOST_SIZE[ghost.kind].width * viewport.zoom,
            height: GHOST_SIZE[ghost.kind].height * viewport.zoom
          }}
        />
      )}

      {readOnly && <div className="canvas-readonly-badge">{uiText('auto.9b19a5a212de')}</div>}

      {menuAnchor && (
        <SelectionMenu
          at={menuAnchor}
          edge={selectedEdgeObj}
          canEdit={!readOnly && (!!selectedEdgeObj || !!singleNode)}
          editable={!!singleNode && singleNode.type !== 'file'}
          readOnly={readOnly}
          onColor={openColorPicker}
          onEditNode={() => singleNode && setEditingId(singleNode.id)}
          onEditLabel={() => selectedEdge && setEditingEdgeLabel(selectedEdge)}
          onArrowEnds={cycleArrowEnds}
          onDuplicate={duplicateSelection}
          onDelete={deleteSelection}
          onMore={openMoreMenu}
        />
      )}

      <CardMenu readOnly={readOnly} onCreateStart={onCreateStart} onCreateClick={(kind) => addOfKind(kind)} />

      <Controls
        zoom={viewport.zoom}
        onZoomIn={() => {
          const r = viewportSize()
          setViewport((v) => zoomBy(v, (r?.width ?? 0) / 2, (r?.height ?? 0) / 2, ZOOM_BUTTON_STEP))
        }}
        onZoomOut={() => {
          const r = viewportSize()
          setViewport((v) => zoomBy(v, (r?.width ?? 0) / 2, (r?.height ?? 0) / 2, -ZOOM_BUTTON_STEP))
        }}
        onReset={() => {
          const r = viewportSize()
          setViewport((v) => zoomAt(v, (r?.width ?? 0) / 2, (r?.height ?? 0) / 2, 1 / v.zoom))
        }}
        onFit={() => {
          const r = viewportSize()
          const b = boundsOf(modelRef.current.nodes)
          if (b && r) setViewport(fitView(b, r.width, r.height))
        }}
      />
    </div>
  )
}

export default CanvasEditor
