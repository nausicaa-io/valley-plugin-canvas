/**
 * Canvas — an Obsidian-style infinite canvas that owns the `.canvas` file type
 * (JSONCanvas, https://jsoncanvas.org). The plugin claims the extension via its
 * manifest `fileViews` map (`{ '.canvas': 'canvas.editor' }`); the host mounts
 * `CanvasEditor` as a full workspace tab whenever a `.canvas` file is opened,
 * passing the vault-relative `relPath`. The editor reads/writes the file through
 * `api.vault` and owns its own debounced persistence + ⌘Z integration.
 *
 * Text/markdown, file & image embed, URL and group cards; connections (edges with
 * arrowheads + colors); pan/zoom/select/marquee/drag/resize/recolour/delete. The
 * surface is fully event-driven — no perpetual rAF — so it profiles at 0% CPU idle.
 */
import type { ValleyPluginApi, ValleyPluginModule } from '@valley/plugin-sdk'
import { NEW_TAB_ENTRY_V1 } from '@valley/plugin-sdk'
import { initRuntime } from './runtime'
import { injectStyles } from './styles'
import { registerCanvasSurfaces } from './surfaces'
import { registerCanvasCommands } from './commands'
import { canvasNewTabEntry } from './newTabEntry'
import CanvasEditor from './CanvasEditor'
import { initLocalization } from './localization'

export function register(api: ValleyPluginApi): () => void {
  initLocalization(api)
  initRuntime(api)
  const disposeStyles = injectStyles()

  // The host mounts this file view with a `relPath` prop (see TabView); cast
  // through the registry's propless `ComponentType` slot.
  api.registerView('canvas.editor', CanvasEditor as unknown as Parameters<typeof api.registerView>[1])
  const offCommands = registerCanvasCommands(api)
  const offSurfaces = registerCanvasSurfaces(api)
  // The owner-scoped bus applies the same guard policy as the palette, CLI and
  // assistant without embedding this package's id in its own implementation.
  const offNewTab = api.interop.extensions.provide(
    NEW_TAB_ENTRY_V1,
    canvasNewTabEntry(() => void api.commands.executeOwn('create'))
  )

  return () => {
    offNewTab()
    offCommands()
    offSurfaces()
    disposeStyles()
  }
}

const plugin: ValleyPluginModule = { register }
export default plugin
