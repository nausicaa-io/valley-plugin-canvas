import type { RefObject } from 'react'
import { React } from './runtime'
import { panBy, screenToWorld, zoomBy, type Point, type Viewport } from './geometry'

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
export function useCanvasViewport(rootRef: RefObject<HTMLDivElement>) {
  const [viewport, setViewport] = React.useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const viewportRef = React.useRef(viewport)
  const spaceRef = React.useRef(false)
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 })
  viewportRef.current = viewport

  const viewportSize = React.useCallback((): { width: number; height: number } | null => {
    const root = rootRef.current
    if (!root) return null
    const rect = root.getBoundingClientRect()
    return { width: root.clientWidth || rect.width, height: root.clientHeight || rect.height }
  }, [rootRef])

  React.useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const update = (): void => {
      const next = viewportSize()
      if (next) setDimensions(previous => previous.width === next.width && previous.height === next.height ? previous : next)
    }
    const Observer = root.ownerDocument.defaultView?.ResizeObserver
    const observer = Observer ? new Observer(update) : null
    observer?.observe(root)
    update()
    return () => observer?.disconnect()
  }, [rootRef, viewportSize])

  // ── Viewport: wheel (pan / zoom) + space-to-pan tracking ─────────────────────
  const localPoint = React.useCallback((clientX: number, clientY: number): Point => {
    const r = rootRef.current?.getBoundingClientRect()
    const size = viewportSize()
    return {
      x: (clientX - (r?.left ?? 0)) * (r?.width ? (size?.width ?? r.width) / r.width : 1),
      y: (clientY - (r?.top ?? 0)) * (r?.height ? (size?.height ?? r.height) / r.height : 1)
    }
  }, [rootRef, viewportSize])
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
  }, [localPoint, rootRef])

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
  }, [rootRef])

  return { viewport, setViewport, viewportRef, spaceRef, viewportSize, dimensions, localPoint, worldAt }
}
