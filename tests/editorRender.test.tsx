import * as React from 'react'
import { registerCanvasSurfaces } from '../src/surfaces'
import { PLUGIN_SURFACE_V1 } from '@valley/plugin-sdk'
import { canvasSession, canvasDraft } from '../src/session'
import { editCanvasTarget } from '../src/commands'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMockValleyApi, type MockValleyApi } from '@valley/plugin-testkit'
import { initRuntime } from '../src/runtime'
import CanvasEditor from '../src/CanvasEditor'
import { parseCanvas, serializeCanvas, type CanvasData } from '../src/canvasModel'

const oneCard: CanvasData = {
  nodes: [{ id: 'a', type: 'text', text: 'Hello canvas', x: 0, y: 0, width: 250, height: 120 }],
  edges: []
}

// Two cards wired by three edges exercising every arrowhead combination.
const wired: CanvasData = {
  nodes: [
    { id: 'a', type: 'text', text: 'Node A', x: 0, y: 0, width: 200, height: 100 },
    { id: 'b', type: 'text', text: 'Node B', x: 400, y: 0, width: 200, height: 100 }
  ],
  edges: [
    { id: 'e1', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left' }, // default → 1 arrow (to)
    { id: 'e2', fromNode: 'a', toNode: 'b', fromSide: 'bottom', toSide: 'bottom', fromEnd: 'arrow', toEnd: 'arrow' }, // 2
    { id: 'e3', fromNode: 'a', toNode: 'b', fromSide: 'top', toSide: 'top', toEnd: 'none' } // 0
  ]
}

describe('CanvasEditor', () => {
  let mock: MockValleyApi

  function mountWith(files: Record<string, string>): ReturnType<typeof render> {
    mock = createMockValleyApi({ manifest: { id: 'canvas' }, files })
    initRuntime(mock.api)
    return render(<CanvasEditor relPath="Test.canvas" />)
  }

  beforeEach(() => {
    // The editor mounts a non-passive wheel listener via addEventListener.
    // jsdom supports it; nothing else to stub.
  })

  it('keeps a command selection queued before the file editor first mounts', async () => {
    mock = createMockValleyApi({ manifest: { id: 'canvas' }, files: { 'Test.canvas': serializeCanvas(oneCard) } })
    initRuntime(mock.api)
    const off = registerCanvasSurfaces(mock.api)
    const result = await mock.api.commands.execute('canvas:open', { path: 'Test.canvas', nodeIds: ['a'] })
    expect(result.ok).toBe(true)
    render(<CanvasEditor relPath="Test.canvas" />)
    await waitFor(() => expect(canvasSession('Test.canvas')?.get().nodeIds).toEqual(['a']))
    const provider = mock.api.interop.extensions.providers(PLUGIN_SURFACE_V1)[0].extension
    expect(provider.getSnapshot('Test.canvas').item).toMatchObject({ id: 'a', state: { path: 'Test.canvas', nodeIds: ['a'] } })
    off()
  })

  it('renders the cards from a .canvas file', async () => {
    mountWith({ 'Test.canvas': serializeCanvas(oneCard) })
    expect(await screen.findByText('Hello canvas')).toBeTruthy()
  })

  it('offers eight border resize targets before selection and cancels a gesture without writing', async () => {
    const { container } = mountWith({ 'Test.canvas': serializeCanvas(oneCard) })
    await screen.findByText('Hello canvas')
    const handles = container.querySelectorAll('.canvas-handle')
    expect(handles).toHaveLength(8)
    const root = container.querySelector('.canvas-root')!
    fireEvent.pointerDown(handles[0], { button: 0, pointerId: 1, clientX: 20, clientY: 20 })
    fireEvent.pointerMove(root, { pointerId: 1, clientX: 60, clientY: 60 })
    fireEvent.pointerCancel(root, { pointerId: 1 })
    expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
    expect(canvasSession('Test.canvas')?.get().data).toEqual(oneCard)
  })

  it('pans with Space over a card without moving it and releases the cursor on blur', async () => {
    const { container } = mountWith({ 'Test.canvas': serializeCanvas(oneCard) })
    await screen.findByText('Hello canvas')
    const root = container.querySelector('.canvas-root')!
    const card = container.querySelector('[data-node-id="a"]')!
    fireEvent.keyDown(root, { code: 'Space', key: ' ' })
    expect(root.classList.contains('canvas-pan-ready')).toBe(true)
    fireEvent.pointerDown(card, { button: 0, pointerId: 2, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(root, { pointerId: 2, clientX: 80, clientY: 50 })
    fireEvent.pointerUp(root, { pointerId: 2, clientX: 80, clientY: 50 })
    expect(canvasSession('Test.canvas')?.get().data).toEqual(oneCard)
    expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
    fireEvent.blur(window)
    expect(root.classList.contains('canvas-pan-ready')).toBe(false)
  })

  it('tracks pan keys and blur in the visible iframe and removes its listeners on unmount', async () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const owner = frame.contentWindow!
    const container = frame.contentDocument!.body.appendChild(frame.contentDocument!.createElement('div'))
    mock = createMockValleyApi({ manifest: { id: 'canvas' }, files: { 'Test.canvas': serializeCanvas(oneCard) } })
    initRuntime(mock.api)
    const remove = vi.spyOn(owner, 'removeEventListener')
    const mounted = render(<CanvasEditor relPath="Test.canvas" />, { container })
    try {
      await waitFor(() => expect(container.textContent).toContain('Hello canvas'))
      const root = container.querySelector('.canvas-root')!
      fireEvent.keyDown(root, { code: 'Space', key: ' ' })
      expect(root).toHaveClass('canvas-pan-ready')
      fireEvent.blur(window)
      expect(root).toHaveClass('canvas-pan-ready')
      fireEvent.blur(owner)
      expect(root).not.toHaveClass('canvas-pan-ready')
      fireEvent.keyDown(root, { code: 'Space', key: ' ' })
      fireEvent.keyUp(owner, { code: 'Space', key: ' ' })
      expect(root).not.toHaveClass('canvas-pan-ready')
      mounted.unmount()
      expect(remove.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(['blur', 'keydown', 'keyup']))
    } finally { mounted.unmount(); remove.mockRestore(); frame.remove() }
  })

  it('uses local dimensions when panning inside a scaled parent Canvas', async () => {
    const { container } = mountWith({ 'Test.canvas': serializeCanvas(oneCard) })
    await screen.findByText('Hello canvas')
    const root = container.querySelector('.canvas-root') as HTMLElement
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 400 })
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, toJSON: () => ({}) })
    const before = canvasSession('Test.canvas')!.get().viewport
    fireEvent.keyDown(root, { code: 'Space', key: ' ' })
    fireEvent.pointerDown(root, { button: 0, pointerId: 7, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(root, { pointerId: 7, clientX: 30, clientY: 20 })
    fireEvent.pointerUp(root, { pointerId: 7, clientX: 30, clientY: 20 })
    expect(canvasSession('Test.canvas')!.get().viewport).toMatchObject({ x: before.x + 40, y: before.y + 20 })
    expect(canvasSession('Test.canvas')!.get().data).toEqual(oneCard)
  })

  it('keeps one wheel subscription across rerenders and reads current scaled geometry for zoom pivots', async () => {
    const { container, rerender, unmount } = mountWith({ 'Test.canvas': serializeCanvas(oneCard) })
    await screen.findByText('Hello canvas')
    const root = container.querySelector('.canvas-root') as HTMLElement
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 400 })
    let left = 10
    vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => ({ x: left, y: 20, left, top: 20, right: left + 400, bottom: 220, width: 400, height: 200, toJSON: () => ({}) }))
    const add = vi.spyOn(root, 'addEventListener')
    const remove = vi.spyOn(root, 'removeEventListener')
    for (const offset of [10, 100]) {
      left = offset
      rerender(<CanvasEditor relPath="Test.canvas" />)
      const before = canvasSession('Test.canvas')!.get().viewport
      fireEvent.wheel(root, { clientX: left + 50, clientY: 45, ctrlKey: true, deltaY: 30 })
      const after = canvasSession('Test.canvas')!.get().viewport
      expect((100 - after.x) / after.zoom).toBeCloseTo((100 - before.x) / before.zoom)
      expect((50 - after.y) / after.zoom).toBeCloseTo((50 - before.y) / before.zoom)
    }
    expect(add.mock.calls.filter(([type]) => type === 'wheel')).toHaveLength(0)
    expect(remove.mock.calls.filter(([type]) => type === 'wheel')).toHaveLength(0)
    unmount()
    expect(remove.mock.calls.filter(([type]) => type === 'wheel')).toHaveLength(1)
  })

  it('passes the containing Canvas as the context of an embedded Base', async () => {
    const data: CanvasData = { nodes: [{ id: 'base', type: 'file', file: 'Context.base', subpath: '#Same date', x: 0, y: 0, width: 500, height: 300 }], edges: [] }
    mock = createMockValleyApi({ manifest: { id: 'canvas' }, files: { 'Test.canvas': serializeCanvas(data) } })
    const preview = vi.fn((_props: { relPath: string; sourcePath?: string; subpath?: string }) => React.createElement('div', null, 'Base preview'))
    mock.api.ui.FilePreview = preview
    initRuntime(mock.api)
    render(<CanvasEditor relPath="Test.canvas" />)
    await screen.findByText('Base preview')
    expect(preview.mock.calls[0][0]).toMatchObject({ relPath: 'Context.base', sourcePath: 'Test.canvas', subpath: '#Same date' })
  })

  it.each(['from', 'to'] as const)('reconnects the %s endpoint, preserves edge attributes, and can detach and undo', async (end) => {
    const data: CanvasData = { ...wired, nodes: [...wired.nodes, { id: 'c', type: 'text', text: 'Node C', x: 800, y: 0, width: 200, height: 100 }] }
    const { container } = mountWith({ 'Test.canvas': serializeCanvas(data) })
    await screen.findByText('Node C')
    const root = container.querySelector('.canvas-root')!
    const hit = vi.fn(() => container.querySelector('[data-node-id="c"]'))
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit })
    fireEvent.pointerDown(container.querySelector('.canvas-edge-hit')!, { button: 0 })
    fireEvent.pointerDown(container.querySelector(`[data-edge-end="${end}"]`)!, { button: 0, pointerId: 3, clientX: 20, clientY: 20 })
    fireEvent.pointerUp(root, { pointerId: 3, clientX: 800, clientY: 20 })
    expect(canvasSession('Test.canvas')?.get().data.edges[0]).toMatchObject({ ...data.edges[0], [end + 'Node']: 'c', [end + 'Side']: 'left' })
    hit.mockReturnValue(null)
    fireEvent.pointerDown(container.querySelector(`[data-edge-end="${end}"]`)!, { button: 0, pointerId: 4 })
    fireEvent.pointerUp(root, { pointerId: 4, clientX: 1000, clientY: 1000 })
    expect(canvasSession('Test.canvas')?.get().data.edges).toHaveLength(2)
    await act(async () => { expect(await mock.undoActions.at(-1)!.undo()).toMatchObject({ ok: true }) })
    expect(canvasSession('Test.canvas')?.get().data.edges).toHaveLength(3)
  })

  it('creates a card and connection together when releasing a port onto empty space', async () => {
    const { container } = mountWith({ 'Test.canvas': serializeCanvas(oneCard) })
    await screen.findByText('Hello canvas')
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null })
    await act(async () => {
      fireEvent.pointerDown(container.querySelector('.canvas-port.right')!, { button: 0, pointerId: 5 })
      fireEvent.pointerUp(container.querySelector('.canvas-root')!, { pointerId: 5, clientX: 800, clientY: 400 })
    })
    const data = canvasSession('Test.canvas')!.get().data
    expect(data.nodes).toHaveLength(2)
    expect(data.edges).toMatchObject([{ fromNode: 'a', toNode: data.nodes[1].id }])
    expect(mock.undoActions).toHaveLength(1)
  })

  it('embeds HTTP pages in an isolated guest and ignores executable URLs', async () => {
    const { container, unmount } = mountWith({ 'Test.canvas': serializeCanvas({ nodes: [
      { id: 'web', type: 'link', url: 'https://obsidian.md/canvas', x: 0, y: 0, width: 400, height: 300 },
      { id: 'invalid', type: 'link', url: 'javascript:alert(1)', x: 500, y: 0, width: 400, height: 300 }
    ], edges: [] }) })
    await waitFor(() => expect(container.querySelectorAll('webview')).toHaveLength(1))
    const guest = container.querySelector('webview')!
    expect(guest.getAttribute('partition')).toBe('web-incognito')
    expect(guest.getAttribute('src')).toBe('https://obsidian.md/canvas')
    unmount()
    expect(guest.isConnected).toBe(false)
  })

  it('renders note cards through the host Markdown view with their own file context', async () => {
    mock = createMockValleyApi({ manifest: { id: 'canvas' }, files: { 'Test.canvas': serializeCanvas({ nodes: [{ id: 'note', type: 'file', file: 'Review.md', x: 0, y: 0, width: 400, height: 300 }], edges: [] }), 'Review.md': '# Review\nEmbedded content' } })
    const view = vi.fn((props: { value: string; context: { sourcePath?: string } }) => React.createElement('div', null, props.value))
    mock.api.ui.MarkdownView = view
    initRuntime(mock.api)
    render(<CanvasEditor relPath="Test.canvas" />)
    await screen.findByText(/Embedded content/)
    expect(view.mock.calls.at(-1)![0]).toMatchObject({ value: '# Review\nEmbedded content', context: { sourcePath: 'Review.md' } })
  })

  it('awaits the newest dirty scene before allowing unload and performs no revoked-session save', async () => {
    const mounted = mountWith({ 'Test.canvas': serializeCanvas(oneCard) })
    const editText = async (previous: string, next: string): Promise<void> => {
      fireEvent.doubleClick(await screen.findByText(previous))
      const textarea = await screen.findByDisplayValue(previous)
      await act(async () => {
        fireEvent.change(textarea, { target: { value: next } })
        fireEvent.blur(textarea)
      })
      expect(await screen.findByText(next)).toBeTruthy()
    }
    await editText('Hello canvas', 'Pending scene')
    const write = vi.mocked(mock.api.vault.writeFileGuarded).getMockImplementation()!
    let finish!: () => void
    const blocked = new Promise<void>((resolve) => { finish = resolve })
    vi.mocked(mock.api.vault.writeFileGuarded).mockImplementationOnce(async (...args) => { await blocked; return write(...args) })
    let completed = false
    const unload = mock.runBeforeUnload().then(() => { completed = true })
    await waitFor(() => expect(mock.api.vault.writeFileGuarded).toHaveBeenCalledTimes(1))
    expect(completed).toBe(false)
    await editText('Pending scene', 'Newest scene')
    await act(async () => { finish(); await unload })
    expect(parseCanvas(await mock.api.vault.readFile('Test.canvas')).nodes[0]).toMatchObject({ text: 'Newest scene' })
    expect(canvasDraft('Test.canvas')).toBeUndefined()
    expect(mock.api.vault.writeFileGuarded).toHaveBeenCalledTimes(2)
    const runtime = vi.spyOn(mock.api.runtime, 'getOrCreate').mockImplementation(() => { throw new Error('Plugin session is no longer active') })
    try { mounted.unmount(); expect(runtime).not.toHaveBeenCalled() } finally { runtime.mockRestore() }
    expect(mock.api.vault.writeFileGuarded).toHaveBeenCalledTimes(2)
  })

  it('rejects unload on a save conflict and keeps the editable draft without an implicit retry', async () => {
    mountWith({ 'Test.canvas': serializeCanvas(oneCard) })
    fireEvent.doubleClick(await screen.findByText('Hello canvas'))
    const textarea = await screen.findByDisplayValue('Hello canvas')
    fireEvent.change(textarea, { target: { value: 'Retained scene' } })
    fireEvent.blur(textarea)
    vi.mocked(mock.api.vault.writeFileGuarded).mockResolvedValueOnce({ ok: false, reason: 'conflict', current: null })
    await act(async () => { await expect(mock.runBeforeUnload()).rejects.toThrow('changed on disk') })
    expect(canvasDraft('Test.canvas')?.data.nodes[0]).toMatchObject({ text: 'Retained scene' })
    expect(screen.getByText('Retained scene')).toBeTruthy()
    expect(parseCanvas(await mock.api.vault.readFile('Test.canvas'))).toEqual(oneCard)
    await expect(mock.runBeforeUnload()).rejects.toThrow('changed on disk')
    expect(mock.api.vault.writeFileGuarded).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Retry save'))
    await waitFor(() => expect(canvasDraft('Test.canvas')).toBeUndefined())
    await expect(mock.runBeforeUnload()).resolves.toBeUndefined()
  })

  it('renders edges with arrowheads that honor fromEnd/toEnd', async () => {
    const { container } = mountWith({ 'Test.canvas': serializeCanvas(wired) })
    await screen.findByText('Node A')

    // Every edge draws a visible line with a real path.
    const lines = container.querySelectorAll('path.canvas-edge-line')
    expect(lines).toHaveLength(3)
    lines.forEach((line) => expect(line.getAttribute('d')).toBeTruthy())

    // Arrowheads: default(1) + double(2) + none(0) = 3 — direction is honored.
    expect(container.querySelectorAll('polygon.canvas-arrow')).toHaveLength(3)

    // The edge SVG is sized to the node bounds with a viewBox (not the old 0×0
    // box that culled every edge) — this is the invisible-edges bug fix.
    const svg = container.querySelector('svg.canvas-edges') as SVGSVGElement
    expect(svg.getAttribute('viewBox')).toBeTruthy()
    expect(Number(svg.getAttribute('width'))).toBeGreaterThan(0)
  })

  it('persists an edited text card back to the file as valid JSONCanvas', async () => {
    mountWith({ 'Test.canvas': serializeCanvas(oneCard) })
    const body = await screen.findByText('Hello canvas')

    // Double-click enters edit mode (a textarea seeded with the card text).
    fireEvent.doubleClick(body)
    const textarea = (await screen.findByDisplayValue('Hello canvas')) as HTMLTextAreaElement

    fireEvent.change(textarea, { target: { value: 'Updated text' } })
    fireEvent.blur(textarea)

    // The debounced save writes parseable JSONCanvas with the new text.
    await waitFor(async () => {
      const text = await mock.api.vault.readFile('Test.canvas')
      const data = parseCanvas(text)
      expect(data.nodes).toHaveLength(1)
      expect((data.nodes[0] as { text: string }).text).toBe('Updated text')
    })
  })

  it('applies an API edit through the live guarded session and refuses read-only writes', async () => {
    mountWith({ 'Test.canvas': serializeCanvas(oneCard) })
    await screen.findByText('Hello canvas')
    await act(async () => { await editCanvasTarget(mock.api, 'Test.canvas', { type: 'update-node', id: 'a', values: { text: 'Agent edit' } }) })
    expect(await screen.findByText('Agent edit')).toBeTruthy()
    expect(parseCanvas(await mock.api.vault.readFile('Test.canvas')).nodes[0]).toMatchObject({ text: 'Agent edit' })
    const menu = vi.spyOn(mock.api.ui, 'openMenu')
    fireEvent.contextMenu(document.querySelector('.canvas-root')!)
    const items = menu.mock.calls.at(-1)?.[0] ?? []
    const lock = items.find((item) => 'label' in item && item.label === 'Read-only')
    await act(async () => { if (lock && 'onSelect' in lock) await lock.onSelect?.() })
    await expect(editCanvasTarget(mock.api, 'Test.canvas', { type: 'delete-nodes', ids: ['a'] })).rejects.toThrow('read-only')
  })

  it('keeps the live scene and external file intact when an API save conflicts', async () => {
    mountWith({ 'Test.canvas': serializeCanvas(oneCard) })
    await screen.findByText('Hello canvas')
    vi.mocked(mock.api.vault.writeFileGuarded).mockResolvedValueOnce({ ok: false, reason: 'conflict', current: null })
    await act(async () => { await expect(editCanvasTarget(mock.api, 'Test.canvas', { type: 'delete-nodes', ids: ['a'] })).rejects.toThrow('changed on disk') })
    expect(canvasSession('Test.canvas')?.get().data).toEqual(oneCard)
    expect(canvasDraft('Test.canvas')?.data).toEqual(oneCard)
    expect(parseCanvas(await mock.api.vault.readFile('Test.canvas'))).toEqual(oneCard)
    expect(screen.getByRole('alert').textContent).toContain('draft is preserved')
    expect(mock.api.vault.writeFileGuarded).toHaveBeenCalledTimes(1)
  })

  it('shows the empty hint and adds a card from the toolbar', async () => {
    mountWith({ 'Test.canvas': '{ "nodes": [], "edges": [] }' })
    expect(await screen.findByText(/Empty canvas/)).toBeTruthy()

    fireEvent.click(screen.getByTitle('Add text card'))

    // The hint is gone and the new card is in edit mode (an empty textbox).
    await waitFor(() => expect(screen.queryByText(/Empty canvas/)).toBeNull())
    expect(screen.getByRole('textbox')).toBeTruthy()
  })
})

/**
 * The Obsidian-parity chrome. jsdom has no layout, so every assertion here is on
 * classes, attributes and what actually reaches the file — never on a measured
 * rect (AGENTS.md).
 */
describe('CanvasEditor chrome', () => {
  let mock: MockValleyApi

  function mountWith(files: Record<string, string>): ReturnType<typeof render> {
    mock = createMockValleyApi({ manifest: { id: 'canvas' }, files })
    initRuntime(mock.api)
    return render(<CanvasEditor relPath="Test.canvas" />)
  }

  const overlapping: CanvasData = {
    nodes: [
      { id: 'under', type: 'text', text: 'Under', x: 0, y: 0, width: 200, height: 100 },
      { id: 'over', type: 'text', text: 'Over', x: 20, y: 20, width: 200, height: 100 }
    ],
    edges: []
  }

  const labelled: CanvasData = {
    nodes: [
      { id: 'a', type: 'text', text: 'Node A', x: 0, y: 0, width: 200, height: 100 },
      { id: 'b', type: 'text', text: 'Node B', x: 400, y: 0, width: 200, height: 100 }
    ],
    edges: [{ id: 'e1', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left', label: 'because' }]
  }

  const nodeEl = (container: HTMLElement, id: string): HTMLElement =>
    container.querySelector(`[data-node-id="${id}"]`) as HTMLElement

  it('puts the create menu and the controls where Obsidian puts them', async () => {
    const { container } = mountWith({ 'Test.canvas': serializeCanvas(oneCard) })
    await screen.findByText('Hello canvas')
    // Create menu (bottom centre) carries all four card types, each draggable.
    const cardMenu = container.querySelector('.canvas-card-menu') as HTMLElement
    expect(cardMenu).toBeTruthy()
    expect(cardMenu.querySelectorAll('button.draggable')).toHaveLength(4)
    // Controls (top right) are grouped, not one flat strip.
    expect(container.querySelectorAll('.canvas-controls .canvas-control-group').length).toBeGreaterThan(1)
    // The old toolbar/zoom-cluster classes are gone for good.
    expect(container.querySelector('.canvas-toolbar')).toBeNull()
    expect(container.querySelector('.canvas-zoom-cluster')).toBeNull()
  })

  it('counteracts zoom on the world so chrome holds its on-screen size', async () => {
    const { container } = mountWith({ 'Test.canvas': serializeCanvas(oneCard) })
    await screen.findByText('Hello canvas')
    const world = container.querySelector('.canvas-world') as HTMLElement
    expect(world.style.getPropertyValue('--canvas-inv-zoom')).toBeTruthy()
  })

  it('renders the card in its own container so the label can sit outside it', async () => {
    const { container } = mountWith({ 'Test.canvas': serializeCanvas(oneCard) })
    await screen.findByText('Hello canvas')
    expect(container.querySelector('.canvas-node > .canvas-node-container')).toBeTruthy()
  })

  it('stacks nodes by array index, per the spec z-order rule', async () => {
    const { container } = mountWith({ 'Test.canvas': serializeCanvas(overlapping) })
    await screen.findByText('Over')
    const under = Number(nodeEl(container, 'under').style.zIndex)
    const over = Number(nodeEl(container, 'over').style.zIndex)
    expect(over).toBeGreaterThan(under)
  })

  it('brings a card to the front by moving it in the written file', async () => {
    const { container } = mountWith({ 'Test.canvas': serializeCanvas(overlapping) })
    await screen.findByText('Under')

    await act(async () => fireEvent.pointerDown(nodeEl(container, 'under'), { button: 0 }))
    await act(async () => fireEvent.click(screen.getByTitle('More options')))

    // `openMenu` is the host's shared presenter, so the mock records the items
    // rather than rendering them — drive the entry the way the presenter would.
    const items = mock.menus[mock.menus.length - 1]
    const bringToFront = items.find((i) => i.label === 'Bring to front')
    expect(bringToFront).toBeTruthy()
    await act(async () => bringToFront!.onSelect!())

    await waitFor(async () => {
      const data = parseCanvas(await mock.api.vault.readFile('Test.canvas'))
      expect(data.nodes.map((n) => n.id)).toEqual(['over', 'under'])
    })
  })

  it('offers the colour picker through the host popover, with a custom swatch', async () => {
    const { container } = mountWith({ 'Test.canvas': serializeCanvas(oneCard) })
    await screen.findByText('Hello canvas')

    fireEvent.pointerDown(nodeEl(container, 'a'), { button: 0 })
    fireEvent.click(screen.getByTitle(/color/i))

    // No hand-rolled positioned div: the picker goes through api.ui.openPopover.
    expect(container.querySelector('.canvas-color-popover')).toBeNull()
    expect(mock.popovers).toHaveLength(1)

    const { container: picker } = render(<>{mock.popovers[0].node}</>)
    // Six presets + clear + the custom swatch.
    expect(picker.querySelectorAll('.canvas-swatch')).toHaveLength(8)
    expect(picker.querySelector('.canvas-swatch.custom input[type="color"]')).toBeTruthy()

    // Presets render as palette variables, never a frozen hex.
    const preset = picker.querySelectorAll('.canvas-swatch:not(.none):not(.custom)')[0] as HTMLElement
    expect(preset.style.background).toContain('--color-red')

    fireEvent.click(preset)
    await waitFor(async () => {
      const data = parseCanvas(await mock.api.vault.readFile('Test.canvas'))
      expect(data.nodes[0].color).toBe('1')
    })
  })

  it('shows a selection menu over the selected card, and none with nothing selected', async () => {
    const { container } = mountWith({ 'Test.canvas': serializeCanvas(oneCard) })
    await screen.findByText('Hello canvas')
    expect(container.querySelector('.canvas-selection-menu')).toBeNull()

    fireEvent.pointerDown(nodeEl(container, 'a'), { button: 0 })
    expect(container.querySelector('.canvas-selection-menu')).toBeTruthy()
    expect(screen.getByTitle('Duplicate')).toBeTruthy()
  })

  it('duplicates the selection into the file with a fresh id', async () => {
    const { container } = mountWith({ 'Test.canvas': serializeCanvas(oneCard) })
    await screen.findByText('Hello canvas')

    fireEvent.pointerDown(nodeEl(container, 'a'), { button: 0 })
    fireEvent.click(screen.getByTitle('Duplicate'))

    await waitFor(async () => {
      const data = parseCanvas(await mock.api.vault.readFile('Test.canvas'))
      expect(data.nodes).toHaveLength(2)
      expect(new Set(data.nodes.map((n) => n.id)).size).toBe(2)
      expect((data.nodes[1] as { text: string }).text).toBe('Hello canvas')
    })
  })

  it('renders an edge label as DOM, not SVG text, and commits an edit', async () => {
    const { container } = mountWith({ 'Test.canvas': serializeCanvas(labelled) })
    await screen.findByText('Node A')

    const label = container.querySelector('.canvas-path-label') as HTMLElement
    expect(label.textContent).toBe('because')
    expect(container.querySelector('svg.canvas-edges text')).toBeNull()

    fireEvent.doubleClick(label)
    const input = (await screen.findByDisplayValue('because')) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'therefore' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(async () => {
      const data = parseCanvas(await mock.api.vault.readFile('Test.canvas'))
      expect(data.edges[0].label).toBe('therefore')
    })
  })

  it('cycles an edge through all four arrow-end states', async () => {
    const { container } = mountWith({ 'Test.canvas': serializeCanvas(labelled) })
    await screen.findByText('Node A')

    fireEvent.pointerDown(container.querySelector('path.canvas-edge-hit') as Element, { button: 0 })

    // The edge starts at the spec defaults (from: none, to: arrow), written as
    // neither key. Each click advances one step of EDGE_END_CYCLE, and a value
    // equal to its spec default is omitted from the file rather than written.
    const ends = async (): Promise<[unknown, unknown]> => {
      const e = parseCanvas(await mock.api.vault.readFile('Test.canvas')).edges[0]
      return [e.fromEnd, e.toEnd]
    }

    fireEvent.click(screen.getByTitle('Arrow ends'))
    await waitFor(async () => expect(await ends()).toEqual(['arrow', 'none']))

    fireEvent.click(screen.getByTitle('Arrow ends'))
    await waitFor(async () => expect(await ends()).toEqual(['arrow', undefined]))

    fireEvent.click(screen.getByTitle('Arrow ends'))
    await waitFor(async () => expect(await ends()).toEqual([undefined, 'none']))

    fireEvent.click(screen.getByTitle('Arrow ends'))
    await waitFor(async () => expect(await ends()).toEqual([undefined, undefined]))
  })

  it('paints a group background image in the declared style', async () => {
    const withGroup: CanvasData = {
      nodes: [
        {
          id: 'g',
          type: 'group',
          label: 'Frame',
          background: 'Images/braun.jpg',
          backgroundStyle: 'ratio',
          x: 0,
          y: 0,
          width: 400,
          height: 300
        }
      ],
      edges: []
    }
    const { container } = mountWith({ 'Test.canvas': serializeCanvas(withGroup) })
    await screen.findByText('Frame')
    const bg = container.querySelector('.canvas-group-bg') as HTMLElement
    expect(bg).toBeTruthy()
    expect(bg.className).toContain('ratio')
    // The asset URL percent-encodes the vault path, so match the encoded form.
    expect(bg.style.backgroundImage).toContain(encodeURIComponent('Images/braun.jpg'))
  })

  it('renders a file card title above the card, not as a header row inside it', async () => {
    const fileCard: CanvasData = {
      nodes: [{ id: 'f', type: 'file', file: 'Design/The Enclosure.md', x: 0, y: 0, width: 300, height: 200 }],
      edges: []
    }
    const { container } = mountWith({
      'Test.canvas': serializeCanvas(fileCard),
      'Design/The Enclosure.md': '# The Enclosure\n\nBody.\n'
    })
    const label = (await screen.findByTitle('Design/The Enclosure.md')) as HTMLElement
    expect(label.className).toContain('canvas-node-label')
    // The label is a sibling of the container, so nothing clips it.
    expect(label.parentElement?.className).toContain('canvas-node')
    expect(container.querySelector('.canvas-node-container .canvas-node-label')).toBeNull()
    expect(container.querySelector('.canvas-node-header')).toBeNull()
  })

  it('embeds only the addressed section when a file node carries a subpath', async () => {
    const subCard: CanvasData = {
      nodes: [
        {
          id: 'f',
          type: 'file',
          file: 'Note.md',
          subpath: '#Simplicity',
          x: 0,
          y: 0,
          width: 300,
          height: 200
        }
      ],
      edges: []
    }
    const { container } = mountWith({
      'Test.canvas': serializeCanvas(subCard),
      'Note.md': '# Note\n\nIntro.\n\n## Simplicity\n\nSay no.\n\n## Taste\n\nEdit.\n'
    })
    // The mock's markdown.render is the identity, so assert on the card's text
    // rather than on rendered elements.
    await waitFor(() => {
      const body = container.querySelector('.canvas-node-body') as HTMLElement
      expect(body?.textContent).toContain('Say no.')
    })
    const body = container.querySelector('.canvas-node-body') as HTMLElement
    expect(body.textContent).toContain('## Simplicity')
    expect(body.textContent).not.toContain('Intro.')
    expect(body.textContent).not.toContain('Edit.')
  })
})
