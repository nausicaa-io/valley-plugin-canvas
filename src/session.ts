import type { FileBaseline } from '@valley/plugin-sdk/types'
import type { CanvasData } from './canvasModel'
import type { Viewport } from './geometry'
import { api } from './runtime'

export interface CanvasSnapshot {
  data: CanvasData
  viewport: Viewport
  nodeIds: string[]
  edgeId: string | null
  readOnly: boolean
  ready: boolean
  revision: string
  error: string
}
export interface CanvasSession {
  get(): CanvasSnapshot
  commit(data: CanvasData, revision: string): Promise<void>
  restore(view: { viewport?: Viewport; nodeIds?: string[]; edgeId?: string | null }): void
}
interface CanvasRuntime {
  sessions: Map<string, CanvasSession>
  drafts: Map<string, { data: CanvasData; baseline: FileBaseline | null; lastWritten: string | null; error: string }>
  views: Map<string, { viewport?: Viewport; nodeIds?: string[]; edgeId?: string | null }>
  listeners: Set<() => void>
}
function state(): CanvasRuntime { return api.runtime.getOrCreate('canvas.sessions', () => ({ sessions: new Map(), drafts: new Map(), views: new Map(), listeners: new Set() })) }
export function canvasSession(path: string): CanvasSession | undefined { return state().sessions.get(path) }
export function canvasDraft(path: string) { return state().drafts.get(path) }
export function saveCanvasDraft(path: string, draft: NonNullable<ReturnType<typeof canvasDraft>> | null): void { if (draft) state().drafts.set(path, draft); else state().drafts.delete(path) }
export function notifyCanvas(): void { for (const listener of state().listeners) listener() }
export function subscribeCanvas(listener: () => void): () => void {
  const listeners = state().listeners
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function registerCanvasSession(path: string, session: CanvasSession): () => void {
  const current = state()
  current.sessions.set(path, session)
  notifyCanvas()
  return () => {
    if (current.sessions.get(path) === session) current.sessions.delete(path)
    for (const listener of current.listeners) listener()
  }
}
export function restoreCanvasView(path: string, view: { viewport?: Viewport; nodeIds?: string[]; edgeId?: string | null }): void {
  state().views.set(path, view)
  const session = canvasSession(path)
  if (session?.get().ready) { session.restore(view); state().views.delete(path) }
  notifyCanvas()
}
export function pendingCanvasView(path: string) { const view = state().views.get(path); state().views.delete(path); return view }
