import { METADATA_PANEL_SEGMENT_V1, PLUGIN_SURFACE_V1, type PluginInspectionSubject, type PluginProperty, type ValleyPluginApi } from '@valley/plugin-sdk'
import type { PluginLinkState } from '@valley/plugin-sdk/paths'
import { React, api } from './runtime'
import { canvasSession, restoreCanvasView, subscribeCanvas, notifyCanvas } from './session'
import { canvasEdgeFields, canvasNodeFields, editCanvasTarget, readCanvasTarget } from './commands'
import type { CanvasData } from './canvasModel'
import { uiText } from './localization'

function target(subject?: PluginInspectionSubject, fallback = '') {
  const state = subject?.item?.state ?? subject?.view
  const path = typeof state?.path === 'string' ? state.path : fallback
  const current = canvasSession(path)?.get()
  const nodeIds = Array.isArray(state?.nodeIds) ? state.nodeIds.filter((id): id is string => typeof id === 'string') : current?.nodeIds ?? []
  const edgeId = typeof state?.edgeId === 'string' ? state.edgeId : current?.edgeId ?? null
  return { path, nodeIds, edgeId }
}
function properties(data: CanvasData, nodeIds: string[], edgeId: string | null, readOnly = false): PluginProperty[] {
  const entry = edgeId ? data.edges.find((edge) => edge.id === edgeId) : nodeIds.length === 1 ? data.nodes.find((node) => node.id === nodeIds[0]) : undefined
  if (!entry) return [
    { id: 'cards', label: uiText('canvas.property.cards'), value: data.nodes.length, readOnly: true },
    { id: 'connections', label: uiText('canvas.property.connections'), value: data.edges.length, readOnly: true },
    { id: 'selected', label: uiText('canvas.property.selected'), value: nodeIds.length, readOnly: true }
  ]
  const editable = edgeId ? canvasEdgeFields : canvasNodeFields
  return Object.entries(entry).filter(([id]) => id === 'id' || id === 'type' || id in editable).map(([id, value]) => ({ id, label: uiText(`canvas.field.${id}`), value: JSON.parse(JSON.stringify(value ?? null)), readOnly: readOnly || !(id in editable), type: typeof value === 'number' ? 'number' : typeof value === 'string' ? 'text' : 'json' }))
}
function parseView(raw: PluginLinkState) {
  if (raw.v !== 1 || typeof raw.path !== 'string' || !raw.path.endsWith('.canvas')) throw new Error('Unsupported Canvas bookmark.')
  if (raw.nodeIds !== undefined && (!Array.isArray(raw.nodeIds) || raw.nodeIds.some((id) => typeof id !== 'string'))) throw new Error('Expected canvas card ids.')
  if (raw.edgeId !== undefined && raw.edgeId !== null && typeof raw.edgeId !== 'string') throw new Error('Expected a canvas connection id.')
  const nodeIds = Array.isArray(raw.nodeIds) ? raw.nodeIds.filter((id): id is string => typeof id === 'string') : []
  const edgeId = typeof raw.edgeId === 'string' && raw.edgeId ? raw.edgeId : null
  const value = raw.viewport as { x?: unknown; y?: unknown; zoom?: unknown } | undefined
  if (value && (typeof value.x !== 'number' || !Number.isFinite(value.x) || typeof value.y !== 'number' || !Number.isFinite(value.y) || typeof value.zoom !== 'number' || !Number.isFinite(value.zoom) || value.zoom <= 0)) throw new Error('Invalid canvas viewport.')
  const viewport = value && typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y) && typeof value.zoom === 'number' && Number.isFinite(value.zoom) && value.zoom > 0 ? { x: value.x, y: value.y, zoom: Math.max(0.05, Math.min(8, value.zoom)) } : undefined
  return { path: raw.path, nodeIds, edgeId, viewport }
}
function PropertyEditor({ subject, path: fallback }: { subject?: PluginInspectionSubject; path: string }): React.ReactElement {
  const selected = target(subject, fallback)
  const [rows, setRows] = React.useState<PluginProperty[]>([])
  const [error, setError] = React.useState('')
  const [revision, setRevision] = React.useState('')
  const nodeIdsJson = JSON.stringify(selected.nodeIds)
  const refresh = React.useCallback(() => {
    void readCanvasTarget(api, selected.path).then((value) => { setRevision(value.revision); setRows(properties(value.data, JSON.parse(nodeIdsJson) as string[], selected.edgeId, canvasSession(selected.path)?.get().readOnly)) }).catch((reason) => setError(String(reason)))
  }, [selected.path, selected.edgeId, nodeIdsJson])
  React.useEffect(() => { refresh(); return subscribeCanvas(refresh) }, [refresh])
  return <div className="right-panel-body props-info">
    {error && <p role="alert">{error}</p>}
    <dl className="props-info-table">{rows.map((row) => <div className="props-info-row" key={`${selected.path}:${selected.edgeId ?? selected.nodeIds.join(',')}:${row.id}`}><dt className="props-info-key">{row.label}</dt><dd className="props-info-value">{row.readOnly || !['x', 'y', 'width', 'height', 'color', 'label', 'fromEnd', 'toEnd'].includes(row.id) ? typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value ?? '') : <CanvasPropertyInput row={row} selected={selected} revision={revision} refresh={refresh} />}</dd></div>)}</dl>
  </div>
}

interface PropertyDraft { value: string; revision: string; error: string; busy: boolean }
function propertyDrafts(): Map<string, PropertyDraft> { return api.runtime.getOrCreate('canvas.propertyDrafts', () => new Map()) }
function CanvasPropertyInput({ row, selected, revision, refresh }: { row: PluginProperty; selected: ReturnType<typeof target>; revision: string; refresh: () => void }): React.ReactElement {
  const key = `${selected.path}:${selected.edgeId ?? selected.nodeIds.join(',')}:${row.id}`
  const read = React.useCallback(() => propertyDrafts().get(key), [key])
  const draft = React.useSyncExternalStore(subscribeCanvas, read, read)
  const value = draft?.value ?? String(row.value ?? '')
  const update = (next: PropertyDraft | undefined): void => { if (next) propertyDrafts().set(key, next); else propertyDrafts().delete(key); notifyCanvas() }
  const save = async (): Promise<void> => {
    if (!draft || draft.busy || draft.value === String(row.value ?? '')) return
    update({ ...draft, busy: true })
    try {
      const result = await editCanvasTarget(api, selected.path, { type: selected.edgeId ? 'update-edge' : 'update-node', id: selected.edgeId ?? selected.nodeIds[0], values: { [row.id]: row.type === 'number' ? Number(draft.value) : draft.value } }, draft.revision)
      api.undo.push({ label: uiText('canvas.command.edit'), undo: async () => { try { await result.revert.run(); return { ok: true } } catch (reason) { return { ok: false, message: String(reason) } } }, redo: async () => { try { await result.revert.reapply(); return { ok: true } } catch (reason) { return { ok: false, message: String(reason) } } } })
      update(undefined); refresh()
    } catch (reason) { update({ ...draft, busy: false, error: `${uiText('canvas.error.save')} ${String(reason)}` }) }
  }
  return <span><input className="canvas-property-input" aria-label={row.label} type={row.type === 'number' ? 'number' : 'text'} value={value} disabled={draft?.busy} onChange={(event) => update({ value: event.currentTarget.value, revision: draft?.revision ?? revision, error: '', busy: false })} onBlur={() => void save()} />{draft?.error && <span role="alert">{draft.error}</span>}</span>
}

export function registerCanvasSurfaces(pluginApi: ValleyPluginApi): () => void {
  const restore = async (raw: PluginLinkState, _instanceId?: string, options?: { background?: boolean }): Promise<void> => {
    const view = parseView(raw)
    const { data } = await readCanvasTarget(pluginApi, view.path)
    if (view.nodeIds.some((id) => !data.nodes.some((node) => node.id === id)) || (view.edgeId && !data.edges.some((edge) => edge.id === view.edgeId))) throw new Error('The bookmarked canvas selection no longer exists.')
    restoreCanvasView(view.path, view)
    if (!options?.background) pluginApi.workspace.openFile(view.path)
  }
  const offs = [pluginApi.interop.extensions.provide(PLUGIN_SURFACE_V1, {
    id: 'canvas.editor', surface: 'main_workspace', subscribe: subscribeCanvas,
    getSnapshot: (instanceId) => {
      const path = instanceId ?? pluginApi.getState().activePath ?? ''
      const snapshot = canvasSession(path)?.get()
      const view: PluginLinkState = { v: 1, path, ...(snapshot ? { viewport: { ...snapshot.viewport } } : {}) }
      const selected = snapshot?.nodeIds ?? []
      const edgeId = snapshot?.edgeId ?? null
      return { title: path.split('/').pop() ?? uiText('manifest.name'), view, ...(selected.length || edgeId ? { item: { id: edgeId ?? selected.join(','), title: edgeId ? uiText('canvas.property.connection') : selected.length > 1 ? uiText('canvas.property.selection', { count: selected.length }) : uiText('canvas.property.card'), state: { ...view, nodeIds: selected, edgeId } } } : {}) }
    },
    restore
  }), pluginApi.interop.extensions.provide(METADATA_PANEL_SEGMENT_V1, {
    id: 'canvas.properties', label: 'Canvas', labelKey: 'manifest.name', icon: 'layout-dashboard', extensions: ['.canvas'], pluginSurfaces: ['main_workspace'], editCommand: 'properties-edit',
    inspect: async ({ subject, relPath }) => { const selected = target(subject, relPath); const { data } = await readCanvasTarget(pluginApi, selected.path); return properties(data, selected.nodeIds, selected.edgeId, canvasSession(selected.path)?.get().readOnly) },
    render: ({ subject, relPath }) => <PropertyEditor subject={subject} path={relPath} />
  }), pluginApi.commands.register({ id: 'properties-edit', label: 'Canvas: Edit properties', labelKey: 'canvas.command.editProperties', paletteSafe: false, sideEffect: 'write', input: {
    schema: { type: 'object', properties: { subject: { type: 'object' }, values: { type: 'object', properties: { ...canvasNodeFields, ...canvasEdgeFields }, additionalProperties: false } }, required: ['subject', 'values'], additionalProperties: false },
    parse: (raw) => { const input = raw as { subject?: PluginInspectionSubject; values?: unknown }; if (!input?.subject) throw new Error('Expected a canvas subject.'); const selected = target(input.subject); if (!selected.path || (!selected.edgeId && selected.nodeIds.length !== 1)) throw new Error('Select one canvas card or connection.'); return { ...selected, values: input.values } }
  }, revision: async ({ path }) => (await readCanvasTarget(pluginApi, path)).revision, preview: ({ path, nodeIds, edgeId, values }) => ({ path, nodeIds, edgeId, values }), run: ({ path, nodeIds, edgeId, values }) => editCanvasTarget(pluginApi, path, { type: edgeId ? 'update-edge' : 'update-node', id: edgeId ?? nodeIds[0], values }) })]
  offs.push(pluginApi.commands.register({ id: 'open', label: 'Canvas: Open selection', labelKey: 'canvas.command.openSelection', paletteSafe: false, sideEffect: 'read', input: {
    schema: { type: 'object', properties: { path: { type: 'string' }, nodeIds: { type: 'array', items: { type: 'string' } }, edgeId: { type: ['string', 'null'] }, viewport: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, zoom: { type: 'number', exclusiveMinimum: 0 } }, required: ['x', 'y', 'zoom'], additionalProperties: false } }, required: ['path'], additionalProperties: false },
    parse: (raw) => { const input = raw as PluginLinkState; parseView({ ...input, v: 1 }); return { ...input, v: 1 } }
  }, run: async (view) => { await restore(view); return view } }))
  return () => offs.forEach((off) => off())
}
