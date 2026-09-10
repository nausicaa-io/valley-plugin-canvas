import type { ValleyPluginApi } from '@valley/plugin-sdk'

/**
 * Module-global handles to the host's React instance and plugin API, set once in
 * `register(api)` before any view renders — the same pattern as the Music,
 * GraphView and SideNotes plugins. Components import these instead of bundling
 * their own `react`; JSX compiles to `React.createElement` (classic transform),
 * resolving to this binding. Never evaluate JSX at module top level — `React` is
 * unset until `initRuntime` runs (see icons.tsx).
 */
export let React!: typeof import('react')
export let api!: ValleyPluginApi

export function initRuntime(a: ValleyPluginApi): void {
  api = a
  React = a.React
}
