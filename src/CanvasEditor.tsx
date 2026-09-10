import { canvasDraft, saveCanvasDraft, registerCanvasSession, pendingCanvasView, notifyCanvas, type CanvasSession } from './session'
import { React, api } from './runtime'
import type { FileBaseline } from '@valley/plugin-sdk/types'
import { paletteCssValue, paletteRef } from '@valley/plugin-sdk/palette'
import {
  type CanvasColor,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeType,
  type EdgeSide,
  CANVAS_PRESET_PALETTE,
  addEdge,
  addNode,
  createFileNode,
  createGroupNode,
  createLinkNode,
  createTextNode,
  duplicateNodes,
  edgeById,
  genId,
  nextEdgeEnds,
  nodeById,
  parseCanvas,
  removeEdges,
  removeNodes,
  reorderNodes,
  serializeCanvas,
  setEdgeColor,
  setEdgeEnds,
  setEdgeLabel,
  setNodePositions,
  setNodeRect,
  setNodesColor,
  updateNode
} from './canvasModel'
import {
  type Point,
  type ResizeHandle,
  type SnapGuide,
  type Viewport,
  bezierMidpoint,
  boundsOf,
  chooseSide,
  fitView,
  gridSpacing,
  nodeRect,
  panBy,
  rectContains,
  rectFromPoints,
  rectsIntersect,
  resizeRect,
  screenToWorld,
  sideAnchor,
  snap as snapValue,
  snapToObjects,
  worldToScreen,
  zoomAt,
  zoomBy,
  zoomMultiplier
} from './geometry'
import { NodeView } from './CanvasNode'
import { EdgeLayer, type ConnectPreview } from './edges'
import { uiText } from './localization'
import {
  ArrowEndsIcon,
  BringToFrontIcon,
  DuplicateIcon,
  FileCardIcon,
  FitIcon,
  GroupIcon,
  LabelIcon,
  LinkCardIcon,
  MoreIcon,
  PaletteIcon,
  PencilIcon,
  SendToBackIcon,
  TextCardIcon,
  TrashIcon,
  ZoomInIcon,
  ZoomOutIcon
} from './icons'

const MIN_NODE = 60
const MOVE_THRESHOLD = 3 // screen px before a click becomes a drag
const LOD_ZOOM = 0.4 // below this, cards fade to skeleton placeholders
/** One press of the zoom buttons, in log2 octaves — a quarter-doubling. */
const ZOOM_BUTTON_STEP = 0.25
const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')

/**
 * A wheel delta in pixels. A mouse that reports lines or pages would otherwise
 * zoom by a rounding error; these are the multipliers Obsidian applies.
 */
function deltaPixels(e: WheelEvent): number {
  if (e.deltaMode === 1) return e.deltaY * 40 // DOM_DELTA_LINE
  if (e.deltaMode === 2) return e.deltaY * 800 // DOM_DELTA_PAGE
  return e.deltaY
}
const SNAP_PX = 8 // screen-px threshold for object snapping
const MENU_GAP = 10 // screen px between the selection and its floating menu
const MENU_HEIGHT = 36 // enough to decide whether the menu fits above

/**
 * Pointer capture is a best-effort convenience — it keeps a drag alive when the
 * cursor leaves the element — never a correctness requirement, and jsdom does
 * not implement it at all. A bare call therefore threw and aborted the handler
 * mid-gesture, taking the selection update with it.
 */
function capturePointer(el: HTMLElement | null, pointerId: number): void {
  try {
    el?.setPointerCapture?.(pointerId)
  } catch {
    /* no active pointer (or no implementation) — the gesture works without it */
  }
}

/** Default size of a card dropped out of the create menu, per type. */
const GHOST_SIZE: Record<CanvasNodeType, { width: number; height: number }> = {
  text: { width: 250, height: 120 },
  file: { width: 400, height: 400 },
  link: { width: 400, height: 300 },
  group: { width: 350, height: 250 }
}

type Interaction =
  | { type: 'pan'; startScreen: Point; origin: Viewport }
  | { type: 'marquee'; startScreen: Point; additive: boolean }
  | { type: 'drag'; before?: CanvasData; ids: Set<string>; primary: string; startWorld: Point; startScreen: Point; startPositions: Map<string, Point>; moved: boolean }
  | { type: 'resize'; id: string; handle: ResizeHandle; startRect: { x: number; y: number; width: number; height: number }; startWorld: Point; moved: boolean }
  | { type: 'connect'; fromNode: string; fromSide: EdgeSide; fromAnchor: Point; edgeId?: string; end?: 'from' | 'to' }
  /** Dragging a card out of the create menu. `engaged` gates pointer capture. */
  | { type: 'create'; kind: CanvasNodeType; startScreen: Point; engaged: boolean }

interface Props {
  relPath: string
}

const CanvasEditor = ({ relPath }: Props): ReturnType<typeof React.createElement> => {
  const [model, setModel] = React.useState<CanvasData>(() => canvasDraft(relPath)?.data ?? { nodes: [], edges: [] })
  const [saveError, setSaveError] = React.useState(() => canvasDraft(relPath)?.error ?? '')
  const saveChain = React.useRef<Promise<unknown>>(Promise.resolve())
  const [viewport, setViewport] = React.useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const [selection, setSelection] = React.useState<Set<string>>(new Set())
  const [selectedEdge, setSelectedEdge] = React.useState<string | null>(null)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingEdgeLabel, setEditingEdgeLabel] = React.useState<string | null>(null)
  const [marquee, setMarquee] = React.useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [preview, setPreview] = React.useState<ConnectPreview | null>(null)
  const [ghost, setGhost] = React.useState<{ kind: CanvasNodeType; x: number; y: number } | null>(null)
  const [readOnly, setReadOnly] = React.useState(false)
  const [snapGuides, setSnapGuides] = React.useState<SnapGuide[]>([])
  const [draggingIds, setDraggingIds] = React.useState<Set<string>>(new Set())

  const rootRef = React.useRef<HTMLDivElement>(null)
  const modelRef = React.useRef(model)
  const viewportRef = React.useRef(viewport)
  const selectionRef = React.useRef(selection)
  const selectedEdgeRef = React.useRef<string | null>(null)
  const editingRef = React.useRef<string | null>(null)
  const readOnlyRef = React.useRef(false)
  const commandBusyRef = React.useRef(false)
  const interactionRef = React.useRef<Interaction | null>(null)
  const gestureStartRef = React.useRef<CanvasData>(model)
  const spaceRef = React.useRef(false)
  const lastWrittenRef = React.useRef<string | null>(null)
  const baselineRef = React.useRef<FileBaseline | null>(null)
  const dirtyRef = React.useRef(false)
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout>>()
  const loadedRef = React.useRef(false)

  const viewportSize = React.useCallback((): { width: number; height: number } | null => {
    const root = rootRef.current
    if (!root) return null
    const rect = root.getBoundingClientRect()
    return { width: root.clientWidth || rect.width, height: root.clientHeight || rect.height }
  }, [])

  modelRef.current = model
  viewportRef.current = viewport
  selectionRef.current = selection
  selectedEdgeRef.current = selectedEdge
  editingRef.current = editingId
  readOnlyRef.current = readOnly || commandBusyRef.current

  const nodesById = React.useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model.nodes])

  // Counteracts the world transform so chrome inside it holds its on-screen size.
  // `sqrt(1/zoom)`, which is Obsidian's `--zoom-multiplier` exactly: handles and
  // ports give back *some* of the scale rather than none, so a card zoomed far
  // out does not sprout enormous handles and the clamp this used to need is gone.
  const invZoom = zoomMultiplier(viewport.zoom)

  // ── Persistence ────────────────────────────────────────────────────────────
  const setModelBoth = React.useCallback((next: CanvasData): void => {
    modelRef.current = next
    setModel(next)
  }, [])

  const adoptDisk = React.useCallback((content: string, baseline: FileBaseline | null): void => {
    baselineRef.current = baseline
    lastWrittenRef.current = content
    setModelBoth(parseCanvas(content))
  }, [setModelBoth])

  const flushSave = (next: CanvasData): Promise<void> => {
    const text = serializeCanvas(next)
    const write = async (): Promise<void> => {
      const written = await api.vault.writeFileGuarded(relPath, text, baselineRef.current)
      if (!written.ok) {
        const message = uiText(written.reason === 'conflict' ? 'canvas.error.conflict' : 'canvas.error.save')
        saveCanvasDraft(relPath, { data: modelRef.current, baseline: baselineRef.current, lastWritten: lastWrittenRef.current, error: message })
        setSaveError(message)
        throw new Error(message)
      }
      baselineRef.current = written.baseline
      lastWrittenRef.current = text
      dirtyRef.current = serializeCanvas(modelRef.current) !== text
      saveCanvasDraft(relPath, dirtyRef.current ? { data: modelRef.current, baseline: written.baseline, lastWritten: text, error: '' } : null)
      setSaveError('')
    }
    const pending = saveChain.current.then(write, write)
    saveChain.current = pending.catch(() => {})
    return pending
  }

  const scheduleSave = (next: CanvasData): void => {
    dirtyRef.current = true
    saveCanvasDraft(relPath, { data: next, baseline: baselineRef.current, lastWritten: lastWrittenRef.current, error: saveError })
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { void flushSave(modelRef.current).catch(() => {}) }, 350)
  }

  // Write a snapshot to disk + reflect it locally — the body of undo/redo. Routing
  // through the file keeps undo correct even after the tab is closed and reopened.
  const applySnapshot = async (snapshot: CanvasData): Promise<void> => {
    await flushSave(snapshot)
    setModelBoth(snapshot)
    dirtyRef.current = false
    saveCanvasDraft(relPath, null)
  }

  const pushUndo = (label: string, prev: CanvasData, next: CanvasData): void => {
    api.undo.push({
      label,
      undo: async () => {
        await applySnapshot(prev)
        return { ok: true }
      },
      redo: async () => {
        await applySnapshot(next)
        return { ok: true }
      }
    })
  }

  /** Apply a discrete edit: set + save + register one undo step. */
  const apply = (next: CanvasData, label: string): void => {
    if (readOnlyRef.current) return
    const prev = modelRef.current
    setModelBoth(next)
    scheduleSave(next)
    pushUndo(label, prev, next)
  }

  // ── Load + external-change reload ────────────────────────────────────────────
  React.useEffect(() => {
    let cancelled = false
    loadedRef.current = false
    void api.vault.readFileBaseline(relPath).then((file) => {
      if (cancelled) return
      if (!file) throw new Error(uiText('canvas.error.missing'))
      const draft = canvasDraft(relPath)
      if (draft) {
        baselineRef.current = draft.baseline
        lastWrittenRef.current = draft.lastWritten
        dirtyRef.current = true
        setModelBoth(draft.data)
        setSaveError(draft.error)
      } else adoptDisk(file.content, file.baseline)
      const rect = viewportSize()
      const bounds = boundsOf(parseCanvas(file.content).nodes)
      if (bounds && rect) setViewport(fitView(bounds, rect.width, rect.height))
      loadedRef.current = true
      const pending = pendingCanvasView(relPath)
      if (pending?.viewport) setViewport(pending.viewport)
      if (pending?.nodeIds) setSelection(new Set(pending.nodeIds))
      if (pending?.edgeId !== undefined) setSelectedEdge(pending.edgeId)
    }).catch((reason) => { if (!cancelled) setSaveError(String(reason)) })
    return () => {
      cancelled = true
    }
  }, [relPath, adoptDisk, setModelBoth, viewportSize])

  React.useEffect(() => {
    return api.vault.onChanged(() => {
      // Stay authoritative for our own in-flight edits; only reload a genuinely
      // external write (e.g. sync, or an undo issued while another tab is open).
      if (dirtyRef.current || !loadedRef.current) return
      void api.vault.readFileBaseline(relPath).then((file) => {
        if (!file) throw new Error(uiText('canvas.error.missing'))
        if (dirtyRef.current || file.content === lastWrittenRef.current) return
        adoptDisk(file.content, file.baseline)
      }).catch((reason) => setSaveError(String(reason)))
    })
  }, [relPath, adoptDisk])

  React.useEffect(() => {
    const offBeforeUnload = api.runtime.onBeforeUnload(async () => {
      clearTimeout(saveTimerRef.current)
      await saveChain.current
      const retained = canvasDraft(relPath)
      if (retained?.error) throw new Error(retained.error)
      while (dirtyRef.current) await flushSave(modelRef.current)
    })
    return () => {
      offBeforeUnload()
      clearTimeout(saveTimerRef.current)
      if (dirtyRef.current) void flushSave(modelRef.current).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relPath])

  const bridgeRef = React.useRef<CanvasSession | null>(null)
  bridgeRef.current = {
    get: () => ({ data: modelRef.current, viewport: viewportRef.current, nodeIds: [...selectionRef.current], edgeId: selectedEdgeRef.current, readOnly: readOnlyRef.current, ready: loadedRef.current, revision: serializeCanvas(modelRef.current), error: saveError }),
    commit: async (next, revision) => {
      if (!loadedRef.current || readOnlyRef.current) throw new Error(uiText('canvas.error.readOnly'))
      if (serializeCanvas(modelRef.current) !== revision) throw new Error(uiText('canvas.error.changed'))
      clearTimeout(saveTimerRef.current)
      commandBusyRef.current = true; readOnlyRef.current = true
      try {
        await flushSave(next)
        setModelBoth(next)
        dirtyRef.current = false
        saveCanvasDraft(relPath, null)
      } finally { commandBusyRef.current = false; readOnlyRef.current = readOnly }
    },
    restore: (view) => { if (view.viewport) setViewport(view.viewport); if (view.nodeIds) setSelection(new Set(view.nodeIds)); if (view.edgeId !== undefined) setSelectedEdge(view.edgeId) }
  }
  React.useEffect(() => registerCanvasSession(relPath, { get: () => bridgeRef.current!.get(), commit: (data, revision) => bridgeRef.current!.commit(data, revision), restore: (view) => bridgeRef.current!.restore(view) }), [relPath])
  React.useEffect(notifyCanvas, [model, viewport, selection, selectedEdge, readOnly, saveError])


  const reloadDisk = async (): Promise<void> => {
    const choice = await api.ui.confirm({ title: uiText('canvas.action.reload'), message: uiText('canvas.error.discard'), actions: [{ label: uiText('canvas.action.cancel'), value: 'cancel', variant: 'ghost' }, { label: uiText('canvas.action.reload'), value: 'reload', variant: 'danger' }] })
    if (choice !== 'reload') return
    try {
      clearTimeout(saveTimerRef.current)
      await saveChain.current
      const file = await api.vault.readFileBaseline(relPath)
      if (!file) throw new Error(uiText('canvas.error.missing'))
      const parsed = JSON.parse(file.content)
      if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error(uiText('canvas.error.save'))
      adoptDisk(file.content, file.baseline)
      saveCanvasDraft(relPath, null); dirtyRef.current = false; loadedRef.current = true
      setSaveError(''); setSelection(new Set()); setSelectedEdge(null)
    } catch (reason) { setSaveError(String(reason)) }
  }

  // ── Viewport: wheel (pan / zoom) + space-to-pan tracking ─────────────────────
  const localPoint = React.useCallback((clientX: number, clientY: number): Point => {
    const r = rootRef.current?.getBoundingClientRect()
    const size = viewportSize()
    return {
      x: (clientX - (r?.left ?? 0)) * (r?.width ? (size?.width ?? r.width) / r.width : 1),
      y: (clientY - (r?.top ?? 0)) * (r?.height ? (size?.height ?? r.height) / r.height : 1)
    }
  }, [viewportSize])
  const worldAt = (e: { clientX: number; clientY: number }): Point => {
    const p = localPoint(e.clientX, e.clientY)
    return screenToWorld(viewportRef.current, p.x, p.y)
  }

  React.useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const p = localPoint(e.clientX, e.clientY)
      if (e.ctrlKey || e.metaKey || spaceRef.current) {
        // Obsidian's curve: the wheel moves the zoom by `-deltaY / 300` octaves,
        // doubled for the fractional deltas a macOS trackpad sends, so a pinch
        // covers the same ground as it does there. A per-pixel multiply
        // (1.0015^-deltaY) travels a different distance at each end of the range.
        let octaves = -deltaPixels(e) / 300
        if (isMac && !Number.isInteger(e.deltaY)) octaves *= 2
        setViewport((v) => zoomBy(v, p.x, p.y, octaves))
      } else {
        setViewport((v) => e.shiftKey && !e.deltaX ? panBy(v, -deltaPixels(e), 0) : panBy(v, -e.deltaX, -deltaPixels(e)))
      }
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [localPoint])

  React.useEffect(() => {
    const window = rootRef.current?.ownerDocument.defaultView
    if (!window) return
    const down = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (e.code === 'Space' && rootRef.current?.contains(target) && !(target?.nodeType === 1 && (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName)))) { spaceRef.current = true; rootRef.current?.classList.add('canvas-pan-ready'); e.preventDefault() }
    }
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') { spaceRef.current = false; rootRef.current?.classList.remove('canvas-pan-ready') }
    }
    const blur = (): void => { spaceRef.current = false; rootRef.current?.classList.remove('canvas-pan-ready') }
    window.addEventListener('blur', blur)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('blur', blur)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // ── Selection helpers ────────────────────────────────────────────────────────
  const replaceSelection = (ids: Set<string>): void => {
    selectionRef.current = ids
    setSelection(ids)
  }

  const expandWithGroups = (ids: Set<string>): Set<string> => {
    const data = modelRef.current
    const out = new Set(ids)
    for (const id of ids) {
      const node = nodeById(data, id)
      if (node?.type !== 'group') continue
      const groupRect = nodeRect(node)
      for (const other of data.nodes) {
        if (other.id === id) continue
        if (rectContains(groupRect, nodeRect(other))) out.add(other.id)
      }
    }
    return out
  }

  // ── Gesture: background pointer down ─────────────────────────────────────────
  const onRootPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return
    setEditingId(null)
    setEditingEdgeLabel(null)
    rootRef.current?.focus()
    capturePointer(rootRef.current, e.pointerId)
    const screen = localPoint(e.clientX, e.clientY)
    if (spaceRef.current || e.button === 1) {
      interactionRef.current = { type: 'pan', startScreen: screen, origin: viewportRef.current }
      return
    }
    setSelectedEdge(null)
    if (!e.shiftKey) replaceSelection(new Set())
    interactionRef.current = { type: 'marquee', startScreen: screen, additive: e.shiftKey }
  }

  // ── Gesture: node pointer down (select + start drag) ─────────────────────────
  const onNodePointerDown = (e: React.PointerEvent, node: CanvasNode): void => {
    if (spaceRef.current || e.button === 1) {
      e.preventDefault(); e.stopPropagation(); capturePointer(rootRef.current, e.pointerId)
      interactionRef.current = { type: 'pan', startScreen: localPoint(e.clientX, e.clientY), origin: viewportRef.current }
      return
    }
    if (e.button !== 0) return
    if (editingRef.current === node.id) return
    e.stopPropagation()
    setSelectedEdge(null)
    setEditingEdgeLabel(null)
    rootRef.current?.focus()

    let ids = new Set(selectionRef.current)
    if (e.shiftKey) {
      if (ids.has(node.id)) ids.delete(node.id)
      else ids.add(node.id)
    } else if (!ids.has(node.id)) {
      ids = new Set([node.id])
    }
    replaceSelection(ids)
    capturePointer(rootRef.current, e.pointerId)
    // Read-only: selection is allowed, but never start a move.
    if (readOnlyRef.current) return

    const beforeDuplicate = e.altKey ? modelRef.current : undefined
    if (e.altKey) {
      const duplicated = duplicateNodes(modelRef.current, expandWithGroups(ids), 0)
      setModelBoth(duplicated.data)
      ids = duplicated.ids
      replaceSelection(ids)
    }
    const moving = expandWithGroups(ids)
    const startPositions = new Map<string, Point>()
    for (const n of modelRef.current.nodes) if (moving.has(n.id)) startPositions.set(n.id, { x: n.x, y: n.y })
    gestureStartRef.current = modelRef.current
    interactionRef.current = {
      type: 'drag',
      before: beforeDuplicate,
      ids: moving,
      primary: ids.has(node.id) ? node.id : [...ids][0],
      startWorld: worldAt(e),
      startScreen: localPoint(e.clientX, e.clientY),
      startPositions,
      moved: !!beforeDuplicate
    }
  }

  const onResizeStart = (e: React.PointerEvent, node: CanvasNode, handle: ResizeHandle): void => {
    e.stopPropagation()
    if (readOnlyRef.current || e.button !== 0) return
    e.preventDefault()
    capturePointer(rootRef.current, e.pointerId)
    replaceSelection(new Set([node.id]))
    setSelectedEdge(null)
    gestureStartRef.current = modelRef.current
    interactionRef.current = {
      type: 'resize',
      id: node.id,
      handle,
      startRect: nodeRect(node),
      startWorld: worldAt(e),
      moved: false
    }
  }

  const onConnectStart = (e: React.PointerEvent, node: CanvasNode, side: EdgeSide): void => {
    e.stopPropagation()
    if (readOnlyRef.current || e.button !== 0) return
    e.preventDefault()
    capturePointer(rootRef.current, e.pointerId)
    const anchor = sideAnchor(nodeRect(node), side)
    interactionRef.current = { type: 'connect', fromNode: node.id, fromSide: side, fromAnchor: anchor }
    setPreview({ from: anchor, fromSide: side, to: anchor })
  }

  const onReconnect = (e: React.PointerEvent, edge: CanvasEdge, end: 'from' | 'to'): void => {
    e.stopPropagation()
    if (readOnlyRef.current || e.button !== 0) return
    e.preventDefault()
    const fixed = nodeById(modelRef.current, end === 'from' ? edge.toNode : edge.fromNode)
    const moving = nodeById(modelRef.current, end === 'from' ? edge.fromNode : edge.toNode)
    if (!fixed || !moving) return
    const side = (end === 'from' ? edge.toSide : edge.fromSide) ?? chooseSide(nodeRect(fixed), nodeRect(moving))
    const anchor = sideAnchor(nodeRect(fixed), side)
    capturePointer(rootRef.current, e.pointerId)
    interactionRef.current = { type: 'connect', fromNode: fixed.id, fromSide: side, fromAnchor: anchor, edgeId: edge.id, end }
    setPreview({ from: anchor, fromSide: side, to: worldAt(e) })
  }

  /**
   * Press on a create-menu button. Capture is deliberately NOT taken here: it
   * retargets the compatibility mouse events too, so capturing on press would
   * swallow the button's own `click` and kill the click-to-create fallback
   * (AGENTS.md — the same bug the To-Do swipe row hit). It engages on move.
   */
  const onCreateStart = (e: React.PointerEvent, kind: CanvasNodeType): void => {
    if (e.button !== 0 || readOnlyRef.current) return
    interactionRef.current = { type: 'create', kind, startScreen: localPoint(e.clientX, e.clientY), engaged: false }
  }

  // ── Gesture move ─────────────────────────────────────────────────────────────
  // Snap to the grid you can actually see: the spacing steps with zoom, so a
  // card dropped while zoomed out lands on the coarse dots under the cursor
  // rather than on a fine grid nothing is drawing. Obsidian snaps to its own
  // `gridSpacing` for the same reason, which is why the spacing is no longer a
  // setting — a number the user picks cannot track the zoom.
  const gridSnap = (v: number): number => (
    api.settings.get().snapToGrid && !spaceRef.current ? snapValue(v, gridSpacing(viewportRef.current.zoom)) : v
  )

  const onRootPointerMove = (e: React.PointerEvent): void => {
    const it = interactionRef.current
    if (!it) return
    const screen = localPoint(e.clientX, e.clientY)
    if (it.type === 'create') {
      if (!it.engaged) {
        if (Math.hypot(screen.x - it.startScreen.x, screen.y - it.startScreen.y) <= MOVE_THRESHOLD) return
        it.engaged = true
        capturePointer(rootRef.current, e.pointerId)
      }
      const size = GHOST_SIZE[it.kind]
      setGhost({ kind: it.kind, x: screen.x - (size.width * viewportRef.current.zoom) / 2, y: screen.y - (size.height * viewportRef.current.zoom) / 2 })
      return
    }
    if (it.type === 'pan') {
      setViewport({ ...it.origin, x: it.origin.x + (screen.x - it.startScreen.x), y: it.origin.y + (screen.y - it.startScreen.y) })
      return
    }
    if (it.type === 'marquee') {
      setMarquee(rectFromPoints(it.startScreen, screen))
      return
    }
    const world = screenToWorld(viewportRef.current, screen.x, screen.y)
    if (it.type === 'connect') {
      setPreview({ from: it.fromAnchor, fromSide: it.fromSide, to: world })
      return
    }
    if (it.type === 'drag') {
      if (!it.moved && Math.hypot(screen.x - it.startScreen.x, screen.y - it.startScreen.y) > MOVE_THRESHOLD) {
        it.moved = true
        setDraggingIds(new Set(it.ids))
      }
      if (!it.moved) return
      let dx = world.x - it.startWorld.x
      let dy = world.y - it.startWorld.y
      if (e.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0 }
      // Snap-to-objects: nudge the whole drag so the primary card aligns with a
      // nearby card (takes precedence over grid snap on a snapped axis).
      let sdx = 0
      let sdy = 0
      let guides: SnapGuide[] = []
      if (!spaceRef.current && api.settings.get().snapToObjects !== false) {
        const start = it.startPositions.get(it.primary)
        const prim = nodeById(gestureStartRef.current, it.primary)
        if (start && prim) {
          const dragged = { x: start.x + dx, y: start.y + dy, width: prim.width, height: prim.height }
          const others = gestureStartRef.current.nodes.filter((n) => !it.ids.has(n.id)).map(nodeRect)
          const res = snapToObjects(dragged, others, SNAP_PX / viewportRef.current.zoom)
          sdx = res.dx
          sdy = res.dy
          guides = res.guides
        }
      }
      const positions = new Map<string, Point>()
      for (const [id, p] of it.startPositions) {
        positions.set(id, {
          x: sdx !== 0 ? p.x + dx + sdx : gridSnap(p.x + dx),
          y: sdy !== 0 ? p.y + dy + sdy : gridSnap(p.y + dy)
        })
      }
      setSnapGuides(guides)
      setModelBoth(setNodePositions(gestureStartRef.current, positions))
      return
    }
    if (it.type === 'resize') {
      it.moved = true
      const dx = gridSnap(world.x - it.startWorld.x)
      const dy = gridSnap(world.y - it.startWorld.y)
      const rect = resizeRect(it.startRect, it.handle, dx, dy, MIN_NODE, e.shiftKey)
      setModelBoth(setNodeRect(gestureStartRef.current, it.id, rect))
    }
  }

  // ── Gesture up ───────────────────────────────────────────────────────────────
  const onRootPointerUp = (e: React.PointerEvent): void => {
    const it = interactionRef.current
    interactionRef.current = null
    if (snapGuides.length) setSnapGuides([])
    if (draggingIds.size) setDraggingIds(new Set())
    if (!it) return
    if (it.type === 'create') {
      setGhost(null)
      // Not engaged = a plain click; the button's own onClick creates it centered.
      if (it.engaged) addOfKind(it.kind, worldAt(e))
      return
    }
    if (it.type === 'marquee') {
      const screen = localPoint(e.clientX, e.clientY)
      const a = screenToWorld(viewportRef.current, it.startScreen.x, it.startScreen.y)
      const b = screenToWorld(viewportRef.current, screen.x, screen.y)
      const box = rectFromPoints(a, b)
      setMarquee(null)
      if (box.width < 2 && box.height < 2) return
      const hits = modelRef.current.nodes.filter((n) => rectsIntersect(nodeRect(n), box)).map((n) => n.id)
      replaceSelection(it.additive ? new Set([...selectionRef.current, ...hits]) : new Set(hits))
      return
    }
    if (it.type === 'connect') {
      setPreview(null)
      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest('[data-node-id]')
        ?.getAttribute('data-node-id')
      if (target && target !== it.fromNode) {
        const from = nodeById(modelRef.current, it.fromNode)
        const to = nodeById(modelRef.current, target)
        if (from && to) {
          const edge = {
            id: genId(),
            fromNode: it.fromNode,
            fromSide: it.fromSide,
            toNode: target,
            toSide: chooseSide(nodeRect(to), nodeRect(from))
          }
          if (it.edgeId) {
            const data = modelRef.current
            const hit = e.currentTarget.ownerDocument.elementFromPoint(e.clientX, e.clientY)?.closest('[data-side]')?.getAttribute('data-side')
            const side = (['top', 'right', 'bottom', 'left'].includes(hit ?? '') ? hit : edge.toSide) as EdgeSide
            apply({ ...data, edges: data.edges.map((existing) => existing.id !== it.edgeId ? existing : {
              ...existing,
              ...(it.end === 'from' ? { fromNode: target, fromSide: side } : { toNode: target, toSide: side })
            }) }, 'Reconnect cards')
          } else apply(addEdge(modelRef.current, edge), 'Connect cards')
        }
      } else if (!target && it.edgeId) {
        apply(removeEdges(modelRef.current, new Set([it.edgeId])), 'Detach connection')
        setSelectedEdge(null)
      } else if (!target) {
        const point = worldAt(e)
        const card = createTextNode(point.x, point.y)
        const from = nodeById(modelRef.current, it.fromNode)
        if (from) {
          const next = addNode(modelRef.current, card)
          apply(addEdge(next, { id: genId(), fromNode: it.fromNode, fromSide: it.fromSide, toNode: card.id, toSide: chooseSide(nodeRect(card), nodeRect(from)) }), 'Create connected card')
          replaceSelection(new Set([card.id])); setEditingId(card.id)
        }
      }
      return
    }
    if ((it.type === 'drag' || it.type === 'resize') && it.moved) {
      const label = it.type === 'resize' ? uiText('auto.fd41e3156204') : uiText('auto.7a727a73ce56')
      pushUndo(it.type === 'drag' && it.before ? 'Duplicate cards' : label, it.type === 'drag' && it.before ? it.before : gestureStartRef.current, modelRef.current)
      scheduleSave(modelRef.current)
    }
  }

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

  // Undo runs through the core bus command (the canvas pushes onto that same stack).
  const doUndo = (): void => {
    void api.commands.execute('undo')
  }
  // Paste clipboard text at the cursor: a URL → link card, anything else → text card.
  const doPaste = async (at: Point): Promise<void> => {
    if (readOnlyRef.current) return
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (!text) return
      if (/^https?:\/\//i.test(text)) addLink(at, text)
      else addText(at, text)
    } catch {
      /* clipboard unavailable / permission denied — no-op */
    }
  }
  const toggleSnapToGrid = (): void => {
    void api.settings.set('snapToGrid', !api.settings.get().snapToGrid)
  }
  const toggleSnapToObjects = (): void => {
    void api.settings.set('snapToObjects', api.settings.get().snapToObjects === false)
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

  const cancelInteraction = (): void => {
    const interaction = interactionRef.current
    if (interaction?.type === 'drag' || interaction?.type === 'resize') setModelBoth(interaction.type === 'drag' && interaction.before ? interaction.before : gestureStartRef.current)
    interactionRef.current = null
    setPreview(null); setMarquee(null); setDraggingIds(new Set()); setSnapGuides([]); setGhost(null)
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
    void api.ui.openMenu(selectionMenuItems(), at)
  }

  // Right-click: open the empty-canvas menu, or a node menu when over a card.
  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
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

/**
 * The create menu — bottom centre, like Obsidian's `.canvas-card-menu`. Each
 * button both clicks (card lands at the viewport centre) and drags (card lands
 * where you drop it).
 */
const CardMenu = (props: {
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
const Controls = (props: {
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
const SelectionMenu = (props: {
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
const ColorPicker = (props: {
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

export default CanvasEditor
