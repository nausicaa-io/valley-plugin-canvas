/**
 * Canvas plugin styles, injected once. Uses the real Notes design tokens (on
 * `:root`, so they resolve inside this plugin-injected <style>) — never invented
 * names, never a restated palette hex. Verify both `data-theme` light/dark.
 *
 * The look targets Obsidian's native canvas, matched against its own `app.css`:
 * chrome sits where Obsidian puts it (create-menu bottom-centre, controls
 * top-right, a selection menu floating above the selection), cards use its
 * fill/border/shadow formula, and connectors are quiet greys that thicken on
 * hover.
 *
 * ## `--canvas-chrome`
 *
 * Obsidian positions nodes in screen space and multiplies every chrome dimension
 * by `--zoom-multiplier` so handles, labels and strokes hold their on-screen
 * size at any zoom. Valley's world is one CSS-`transform`ed element, so the
 * equivalent is that scale's **inverse**: the editor sets `--canvas-inv-zoom` on
 * `.canvas-world`, and everything inside that would otherwise shrink with the
 * board multiplies by `--canvas-chrome`. Screen-space chrome (menus, controls)
 * sits outside `.canvas-world` and needs none of it.
 */
const CSS = `
.canvas-root {
  position: absolute;
  inset: 0;
  overflow: hidden;
  /* Obsidian's dot: r = 0.7px, drawn in screen space so it never scales. */
  background-image:
    radial-gradient(circle, var(--border-medium, rgba(128,128,128,.22)) 0.7px, transparent 0.7px);
  /* background-size + background-position are set inline from the viewport. The
     world spacing *steps* with the zoom (see gridSpacing in geometry.ts), so the
     dots hold a roughly constant screen density instead of collapsing into a
     haze when you zoom out — what Obsidian does, and what a fixed spacing
     cannot give. */
  background-size: 20px 20px;
  /* The board is the app's primary surface — white in light, black in dark —
     never the grey card surface the panes use. Obsidian sets its
     --canvas-background to --background-primary for the same reason. */
  background-color: var(--container-color-alt, var(--container-color, #fff));
  user-select: none;
  touch-action: none;
  outline: none;

  --canvas-shadow-card: 0 .5px 1px .5px rgba(0,0,0,.10);
  --canvas-shadow-drag: 0 2px 10px rgba(0,0,0,.14);
  --canvas-shadow-float: 0 2px 10px rgba(0,0,0,.10);
}
.canvas-root.canvas-panning { cursor: grabbing; }
.canvas-root.canvas-connecting { cursor: crosshair; }
.canvas-root.canvas-creating { cursor: copy; }

.canvas-world {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  will-change: transform;
  /* Set inline as clamp(.35, 1/zoom, 2.5) — see the module docstring. */
  --canvas-chrome: var(--canvas-inv-zoom, 1);
}

/* ── Edges (one SVG layer, sized to the node bounds with a matching viewBox). ── */
.canvas-edges { position: absolute; overflow: visible; pointer-events: none; }
.canvas-edges path.canvas-edge-hit {
  pointer-events: stroke;
  stroke: transparent;
  stroke-width: calc(20px * var(--canvas-chrome));
  stroke-linecap: round;
  fill: none;
  cursor: pointer;
}
.canvas-edges path.canvas-edge-line {
  fill: none;
  stroke: var(--canvas-edge-color, var(--text-secondary, #999));
  stroke-width: calc(2px * var(--canvas-chrome));
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: stroke .1s, stroke-width .1s ease-out;
}
/* Obsidian thickens the connector rather than recolouring it on hover. */
.canvas-edges .canvas-edge:hover path.canvas-edge-line,
.canvas-edges .canvas-edge.selected path.canvas-edge-line {
  stroke-width: calc(5.5px * var(--canvas-chrome));
}
.canvas-edges .canvas-edge.selected path.canvas-edge-line { stroke: var(--accent-color, #3b82f6); }
.canvas-edges polygon.canvas-arrow {
  fill: var(--canvas-edge-color, var(--text-secondary, #999));
  transition: fill .1s;
}
.canvas-edges .canvas-edge:hover polygon.canvas-arrow { fill: var(--text-color, #222); }
.canvas-edges .canvas-edge.selected polygon.canvas-arrow { fill: var(--accent-color, #3b82f6); }
.canvas-edge-endpoint {
  pointer-events: all;
  fill: var(--container-color);
  stroke: var(--accent-color);
  stroke-width: calc(2px * var(--canvas-chrome));
  cursor: grab;
}
.canvas-edge-endpoint:active { cursor: grabbing; }
.canvas-edge-preview {
  fill: none;
  stroke: var(--accent-color, #3b82f6);
  stroke-width: calc(2px * var(--canvas-chrome));
  stroke-dasharray: 5 4;
}

/* Edge labels are DOM, not SVG <text>: they need a background plate to stay
   readable over a card, and an inline editor when you double-click one. */
/* Above every unselected card (whose z-index is its array index) but below the
   selected/editing bands — a label with an opaque plate is meant to be read over
   a card, and a short connector always puts one there. */
.canvas-edge-labels { position: absolute; inset: 0; pointer-events: none; z-index: 50000; }
.canvas-path-label-wrapper { position: absolute; width: 0; height: 0; }
.canvas-path-label {
  position: absolute;
  left: 0;
  top: 0;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  /* The wrapper is a 0x0 anchor, so an absolutely-positioned child shrink-wraps
     to MIN-content against it and every label broke one word per line.
     max-content sizes to the text; max-width still caps a long one. */
  width: max-content;
  max-width: calc(17em * var(--canvas-chrome));
  padding: calc(2px * var(--canvas-chrome)) calc(6px * var(--canvas-chrome));
  border-radius: var(--radius-sm, 5px);
  border: 1px solid transparent;
  background: var(--container-color, #fff);
  color: var(--text-color, #222);
  font-size: calc(12px * var(--canvas-chrome));
  line-height: 1.3;
  white-space: pre-wrap;
  text-align: center;
  cursor: pointer;
}
.canvas-edge.selected .canvas-path-label { border-color: var(--accent-color, #3b82f6); }
.canvas-path-label-input {
  font: inherit;
  font-size: calc(12px * var(--canvas-chrome));
  text-align: center;
  border: 1px solid var(--accent-color, #3b82f6);
  border-radius: var(--radius-sm, 5px);
  padding: calc(2px * var(--canvas-chrome)) calc(6px * var(--canvas-chrome));
  background: var(--container-color, #fff);
  color: var(--text-color, #222);
  outline: none;
  min-width: calc(60px * var(--canvas-chrome));
}

/* ── Cards ──────────────────────────────────────────────────────────────────── */
/* Two layers, as in Obsidian: .canvas-node is the positioned box and clips
   nothing, so the label, handles and ports can sit outside the card; the visible
   card is .canvas-node-container, which owns the border, fill and overflow. */
.canvas-node { position: absolute; overflow: visible; }
.canvas-node-container {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  border: 1px solid var(--border-medium, rgba(128,128,128,.35));
  border-radius: var(--radius, 7px);
  background: var(--container-color, #fff);
  color: var(--text-color, #222);
  box-shadow: var(--canvas-shadow-card);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: box-shadow .12s ease, border-color .12s ease;
}
/* Coloured card: Obsidian's formula — a .7 border doubled as an inset hairline
   so the edge reads at any zoom, over a .07 fill of the same colour. */
.canvas-node.with-color .canvas-node-container {
  background: color-mix(in srgb, var(--canvas-node-accent) 7%, var(--container-color, #fff));
  border-color: color-mix(in srgb, var(--canvas-node-accent) 70%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--canvas-node-accent) 70%, transparent), var(--canvas-shadow-card);
}
/* Selection = a single, evenly-thick ring on all four sides; never shifts layout. */
.canvas-node.selected .canvas-node-container {
  border-color: var(--accent-color, #3b82f6);
  box-shadow: var(--canvas-shadow-card), 0 0 0 2px var(--accent-color, #3b82f6);
}
.canvas-node.with-color.selected .canvas-node-container {
  border-color: var(--canvas-node-accent);
  box-shadow: inset 0 0 0 1px var(--canvas-node-accent), 0 0 0 2px var(--canvas-node-accent);
}
.canvas-node.dragging .canvas-node-container { box-shadow: var(--canvas-shadow-drag); }
.canvas-node.selected.dragging .canvas-node-container {
  box-shadow: var(--canvas-shadow-drag), 0 0 0 2px var(--accent-color, #3b82f6);
}

.canvas-node.canvas-group .canvas-node-container {
  background: color-mix(in srgb, var(--canvas-node-accent, var(--text-secondary, #888)) 7%, transparent);
  border: 1px solid color-mix(in srgb, var(--canvas-node-accent, var(--text-secondary, #888)) 40%, transparent);
  border-radius: var(--radius-lg, 12px);
  box-shadow: none;
}
.canvas-node.canvas-group.selected .canvas-node-container {
  border-color: var(--accent-color, #3b82f6);
  box-shadow: 0 0 0 2px var(--accent-color, #3b82f6);
}
/* The group's optional background image sits under its tint, never over it. */
.canvas-group-bg { position: absolute; inset: 0; z-index: 0; background-repeat: no-repeat; background-position: center; }
.canvas-group-bg.cover  { background-size: cover; }
.canvas-group-bg.ratio  { background-size: contain; }
.canvas-group-bg.repeat { background-repeat: repeat; background-position: 0 0; background-size: auto; }

/* The card's title rides ABOVE the card, like Obsidian's .canvas-node-label —
   a header row inside would eat the card's content height at every zoom. */
.canvas-node-label {
  position: absolute;
  left: 0;
  top: calc(-4px * var(--canvas-chrome));
  transform: translate(0, -100%) scale(var(--canvas-chrome));
  transform-origin: bottom left;
  max-width: calc(100% / var(--canvas-chrome));
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-tertiary, #888);
  font: inherit;
  font-size:0.75rem;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.canvas-node-label:hover { color: var(--text-color, #222); }
.canvas-node.selected .canvas-node-label { color: var(--text-secondary, #777); }
.canvas-node-label svg { width: 13px; height: 13px; flex: 0 0 auto; }
.canvas-node-label .canvas-node-title { overflow: hidden; text-overflow: ellipsis; }

.canvas-group-label {
  position: absolute;
  left: 0;
  top: calc(-4px * var(--canvas-chrome));
  transform: translate(0, -100%) scale(var(--canvas-chrome));
  transform-origin: bottom left;
  max-width: calc(100% / var(--canvas-chrome));
  padding: 3px 7px;
  border: 0;
  border-radius: var(--radius-sm, 5px);
  background: color-mix(in srgb, var(--canvas-node-accent, var(--text-secondary, #888)) 12%, transparent);
  color: var(--text-color, #222);
  font-size:0.8125rem;
  /* set below for a themed group */
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: text;
}

/* Once a group carries a colour, Obsidian fills its label solid rather than
   tinting it — the plate becomes the group's identity at a glance. The paired
   foreground comes from the palette, so it stays readable in every theme. */
.canvas-node.canvas-group.with-color .canvas-group-label {
  background: var(--canvas-node-accent);
  color: var(--canvas-node-contrast, var(--title-color));
}

.canvas-node-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px 12px; font-size:0.875rem; position: relative; }
.canvas-node-body.markdown-body { padding: 10px 12px; }
.canvas-node-body img { max-width: 100%; }
.canvas-node-image { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; background: var(--surface-color, #faf9f7); overflow: hidden; }
.canvas-node-image img { max-width: 100%; max-height: 100%; object-fit: contain; }
.canvas-node-placeholder { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; color: var(--text-secondary, #888); font-size:0.8125rem; text-align: center; padding: 12px; }

.canvas-text-edit {
  flex: 1 1 auto; width: 100%; box-sizing: border-box; border: 0; outline: 0; resize: none;
  background: transparent; color: var(--text-color, #222); font: inherit; font-size:0.875rem;
  padding: 10px 12px; line-height: 1.5;
}
.canvas-input {
  width: 100%; box-sizing: border-box; font-size:0.8125rem; padding: 6px 8px;
  background: var(--surface-color, #fff); color: var(--text-color, #222);
  border: 1px solid var(--border-medium, rgba(128,128,128,.35)); border-radius: var(--radius-sm, 5px);
}
.canvas-link-anchor { color: var(--accent-color, #3b82f6); word-break: break-all; text-decoration: none; }
.canvas-link-anchor:hover { text-decoration: underline; }

/* ── Zoom level-of-detail: fade card content to skeleton bars when far out. ──── */
.canvas-node-body,
.canvas-node-image,
.canvas-node-placeholder { transition: opacity .15s ease; }
.canvas-lod-far .canvas-node-body,
.canvas-lod-far .canvas-node-image,
.canvas-lod-far .canvas-node-placeholder { opacity: 0; }
/* Obsidian drops card labels entirely when zoomed out; ours ride the same flag. */
.canvas-lod-far .canvas-node-label { display: none; }
.canvas-node:not(.canvas-group) .canvas-node-container::after {
  content: '';
  position: absolute; left: 12px; right: 12px; top: 14px; height: 44px;
  border-radius: 4px;
  background-image:
    linear-gradient(currentColor 0 0),
    linear-gradient(currentColor 0 0),
    linear-gradient(currentColor 0 0);
  background-repeat: no-repeat;
  background-size: 90% 7px, 70% 7px, 80% 7px;
  background-position: left 0, left 16px, left 32px;
  color: color-mix(in srgb, var(--canvas-node-accent, var(--text-secondary, #888)) 35%, transparent);
  opacity: 0; pointer-events: none; transition: opacity .15s ease;
}
.canvas-lod-far .canvas-node:not(.canvas-group) .canvas-node-container::after { opacity: 1; }

/* ── Resize handles (8) + connection ports (4), shown on the selected node. ──── */
.canvas-handle { position:absolute; z-index:5; background:transparent; touch-action:none; }
.canvas-handle.n, .canvas-handle.s { left:calc(8px * var(--canvas-chrome)); right:calc(8px * var(--canvas-chrome)); height:calc(10px * var(--canvas-chrome)); cursor:ns-resize; }
.canvas-handle.e, .canvas-handle.w { top:calc(8px * var(--canvas-chrome)); bottom:calc(8px * var(--canvas-chrome)); width:calc(10px * var(--canvas-chrome)); cursor:ew-resize; }
.canvas-handle.n { top:calc(-5px * var(--canvas-chrome)); }
.canvas-handle.s { bottom:calc(-5px * var(--canvas-chrome)); }
.canvas-handle.e { right:calc(-5px * var(--canvas-chrome)); }
.canvas-handle.w { left:calc(-5px * var(--canvas-chrome)); }
.canvas-handle.nw, .canvas-handle.ne, .canvas-handle.sw, .canvas-handle.se { width:calc(16px * var(--canvas-chrome)); height:calc(16px * var(--canvas-chrome)); }
.canvas-handle.nw { top:calc(-8px * var(--canvas-chrome)); left:calc(-8px * var(--canvas-chrome)); cursor:nwse-resize; }
.canvas-handle.ne { top:calc(-8px * var(--canvas-chrome)); right:calc(-8px * var(--canvas-chrome)); cursor:nesw-resize; }
.canvas-handle.sw { bottom:calc(-8px * var(--canvas-chrome)); left:calc(-8px * var(--canvas-chrome)); cursor:nesw-resize; }
.canvas-handle.se { bottom:calc(-8px * var(--canvas-chrome)); right:calc(-8px * var(--canvas-chrome)); cursor:nwse-resize; }
.canvas-root.canvas-pan-ready, .canvas-root.canvas-pan-ready * { cursor:grab !important; }

.canvas-port {
  position: absolute;
  width: calc(10px * var(--canvas-chrome));
  height: calc(10px * var(--canvas-chrome));
  border-radius: 50%;
  box-sizing: border-box;
  background: var(--container-color, #fff);
  border: calc(1.5px * var(--canvas-chrome)) solid var(--border-medium, rgba(128,128,128,.5));
  z-index: 6; cursor: crosshair; opacity: 0; transition: opacity .12s, background .12s, border-color .12s;
}
.canvas-node:hover .canvas-port, .canvas-node.selected .canvas-port { opacity: 1; }
.canvas-port:hover { background: var(--accent-color, #3b82f6); border-color: var(--accent-color, #3b82f6); }
.canvas-port.top    { top: calc(-5px * var(--canvas-chrome)); left: calc(50% - 5px * var(--canvas-chrome)); }
.canvas-port.bottom { bottom: calc(-5px * var(--canvas-chrome)); left: calc(50% - 5px * var(--canvas-chrome)); }
.canvas-port.left   { left: calc(-5px * var(--canvas-chrome)); top: calc(50% - 5px * var(--canvas-chrome)); }
.canvas-port.right  { right: calc(-5px * var(--canvas-chrome)); top: calc(50% - 5px * var(--canvas-chrome)); }

/* The ghost that follows the cursor while dragging a card out of the create
   menu — Obsidian's .canvas-node.is-dummy. */
.canvas-drag-ghost {
  position: absolute;
  z-index: 22;
  pointer-events: none;
  box-sizing: border-box;
  border: 3px solid var(--accent-color, #3b82f6);
  border-radius: var(--radius, 7px);
  background: color-mix(in srgb, var(--accent-color, #3b82f6) 18%, transparent);
  box-shadow: var(--canvas-shadow-drag);
}

/* ── Alignment guides (object snapping) — screen-space, constant 1px. ────────── */
.canvas-snap-guide { position: absolute; z-index: 14; pointer-events: none; background: var(--accent-color, #3b82f6); opacity: .7; }

/* ── Screen-space chrome: create menu, controls, selection menu. ─────────────── */
.canvas-card-menu {
  position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); z-index: 20;
  display: flex; align-items: stretch; gap: 2px; padding: 4px;
  background: var(--container-color, #fff); border: 1px solid var(--border-light, rgba(128,128,128,.2));
  border-radius: var(--radius, 7px); box-shadow: var(--canvas-shadow-float);
}
.canvas-card-menu .sep { width: 1px; align-self: stretch; margin: 2px 3px; background: var(--border-light, rgba(128,128,128,.2)); }

.canvas-controls {
  position: absolute; right: 12px; top: 12px; z-index: 20;
  display: flex; flex-direction: column; gap: 8px;
}
.canvas-control-group {
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--container-color, #fff); border: 1px solid var(--border-light, rgba(128,128,128,.2));
  border-radius: var(--radius, 7px); box-shadow: var(--canvas-shadow-float);
}
.canvas-control-group > * + * { border-top: 1px solid var(--border-light, rgba(128,128,128,.2)); }

.canvas-selection-menu {
  position: absolute; z-index: 24;
  display: flex; align-items: center; gap: 1px; padding: 3px;
  background: var(--container-color, #fff); border: 1px solid var(--border-light, rgba(128,128,128,.2));
  border-radius: var(--radius, 7px); box-shadow: var(--canvas-shadow-float);
}
.canvas-selection-menu .sep { width: 1px; align-self: stretch; margin: 2px 3px; background: var(--border-light, rgba(128,128,128,.2)); }

.canvas-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px;
  border: 0; border-radius: var(--radius-sm, 5px); background: transparent;
  color: var(--text-color, #222); cursor: pointer; padding: 0;
}
.canvas-btn:hover { background: var(--hover-bg, rgba(128,128,128,.12)); }
.canvas-btn:disabled { opacity: .4; cursor: default; }
.canvas-btn:disabled:hover { background: transparent; }
.canvas-btn.danger { color: var(--negative-color); }
.canvas-btn.danger:hover { background: color-mix(in srgb, var(--negative-color) 12%, transparent); }
.canvas-btn.draggable { cursor: grab; }
.canvas-btn.draggable:active { cursor: grabbing; }
/* The control group's items square off so the group's own corners do the work. */
.canvas-control-group .canvas-btn { border-radius: 0; }

.canvas-zoom-label {
  min-width: 44px; height: 24px; text-align: center; font-size:0.6875rem;
  font-variant-numeric: tabular-nums; color: var(--text-secondary, #777);
  background: transparent; border: 0; cursor: pointer; padding: 0;
}
.canvas-zoom-label:hover { background: var(--hover-bg, rgba(128,128,128,.12)); color: var(--text-color, #222); }

.canvas-readonly-badge {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 20;
  padding: 3px 10px; border-radius: 999px; pointer-events: none;
  background: var(--container-color, #fff); color: var(--text-secondary, #777);
  border: 1px solid var(--border-light, rgba(128,128,128,.2)); box-shadow: var(--canvas-shadow-float);
  font-size:0.6875rem; font-weight: 600; letter-spacing: .03em;
}

/* ── Colour picker (rendered through api.ui.openPopover, so it is portaled out
      of the canvas and positioned by the host — this styles content only). ──── */
.canvas-color-picker { display: flex; gap: 6px; align-items: center; }
.canvas-swatch {
  width: 22px; height: 22px; border-radius: 50%; padding: 0; cursor: pointer;
  border: 2px solid var(--container-color, #fff);
  box-shadow: 0 0 0 1px var(--border-medium, rgba(128,128,128,.35));
}
.canvas-swatch.none { background: var(--surface-color, #fff); position: relative; overflow: hidden; }
.canvas-swatch.none::after {
  content: ''; position: absolute; left: -2px; right: -2px; top: 50%; height: 1.5px;
  background: var(--negative-color); transform: rotate(-45deg);
}
.canvas-swatch.active { box-shadow: 0 0 0 2px var(--accent-color, #3b82f6); }
/* The 7th swatch: a colour wheel until a custom hex is set, then that hex. */
.canvas-swatch.custom { position: relative; overflow: hidden; }
.canvas-swatch.custom:not(.has-value) {
  background: conic-gradient(
    var(--color-red), var(--color-yellow), var(--color-green),
    var(--color-cyan), var(--color-violet), var(--color-red));
}
.canvas-swatch.custom input[type='color'] {
  position: absolute; inset: -4px; width: calc(100% + 8px); height: calc(100% + 8px);
  opacity: 0; cursor: pointer; padding: 0; border: 0; background: transparent;
}

.canvas-marquee {
  position: absolute; z-index: 15; pointer-events: none;
  background: color-mix(in srgb, var(--accent-color, #3b82f6) 12%, transparent);
  border: 1px solid var(--accent-color, #3b82f6);
}

.canvas-empty-hint {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary, #888); font-size:0.8125rem; pointer-events: none; z-index: 1;
}

.canvas-save-error { position:absolute;top:var(--space-3);left:var(--space-3);right:var(--space-3);z-index:1000;padding:var(--space-3);background:var(--container-color);color:var(--text-color);border:1px solid var(--border-color);border-radius:var(--radius); }
.canvas-save-error button { margin-left:var(--space-3); }
.canvas-property-input { width:100%;min-width:0;background:var(--input-background);color:var(--text-color);border:1px solid var(--border-color);border-radius:var(--radius);padding:var(--space-2); }

.canvas-file-preview { position:relative; width:100%; height:100%; overflow:auto; }
.canvas-link-body { display:flex; flex-direction:column; padding:0; }
.canvas-web-preview { position:relative; flex:1; min-height:0; width:100%; }
.canvas-web-preview webview { position:absolute; inset:0; width:100%; height:100%; }
.canvas-link-body .canvas-link-anchor { padding:6px 10px; flex:none; }
.canvas-node-media { width:100%; height:100%; border:0; }
`

export function injectStyles(): () => void {
  const id = 'canvas-plugin-styles'
  let el = document.getElementById(id) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = id
    document.head.appendChild(el)
  }
  el.textContent = CSS
  return () => {
    if (document.getElementById(id) === el) el.remove()
  }
}
