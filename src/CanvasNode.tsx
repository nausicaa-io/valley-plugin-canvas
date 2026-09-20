import { React, type CanvasOwner } from './runtime'
import { assetUrlForRelPath, classifyFilePath, displayFileTitle } from '@valley/plugin-sdk/fileTypes'
import {
  type CanvasNode,
  type EdgeSide,
  type FileNode,
  type GroupNode,
  type LinkNode,
  type TextNode,
  resolveColor,
  resolveContrast,
  sliceSubpath
} from './canvasModel'
import { RESIZE_HANDLES, type ResizeHandle } from './geometry'
import { FileCardIcon, LinkCardIcon } from './icons'
import { uiText } from './localization'

const SIDES: EdgeSide[] = ['top', 'right', 'bottom', 'left']

/**
 * An `<img>` handed the same `src` string is never re-fetched, so a vault image
 * that changed on disk keeps serving stale pixels. `useAssetUrl` is renderer-only
 * — a plugin busts its own cache, the way `todo/AttachmentCard` does.
 */
function useAssetSrc(relPath: string, owner: CanvasOwner): string {
  const [epoch, setEpoch] = React.useState(0)
  React.useEffect(() => {
    if (!relPath || !owner.isActive()) return
    const off = owner.api.vault.onChanged(event => {
      if (owner.isActive() && (event.full || event.changes.some(change => change.relPath === relPath || change.kind.endsWith('Dir') && relPath.startsWith(`${change.relPath}/`)))) setEpoch(n => n + 1)
    })
    const offOwner = owner.onDispose(off)
    return () => { offOwner(); off() }
  }, [relPath, owner])
  return `${assetUrlForRelPath(relPath)}?v=${epoch}`
}

export interface NodeViewProps {
  owner: CanvasOwner
  previewEnabled: boolean
  node: CanvasNode
  sourcePath?: string
  /**
   * Position in `data.nodes`. The spec makes the array index the z-order
   * ("the first node in the array should be displayed below all other nodes"),
   * so the card's `z-index` is derived from it rather than from its type.
   */
  index: number
  selected: boolean
  singleSelected: boolean
  editing: boolean
  dragging: boolean
  /** Read-only mode: hide ports + resize handles (mutating gestures are gated in the editor). */
  readOnly: boolean
  onNodePointerDown: (e: React.PointerEvent, node: CanvasNode) => void
  onResizeStart: (e: React.PointerEvent, node: CanvasNode, handle: ResizeHandle) => void
  onConnectStart: (e: React.PointerEvent, node: CanvasNode, side: EdgeSide) => void
  onStartEdit: (node: CanvasNode) => void
  onCommit: (node: CanvasNode, patch: Partial<CanvasNode>) => void
  onCancelEdit: () => void
}

/**
 * Bands that sit above every unselected card while still ordering within
 * themselves by array index — so raising a card never reorders its neighbours.
 */
const BAND_SELECTED = 100000
const BAND_EDITING = 200000

/** Async body for a file node: image preview, markdown render, or a placeholder. */
const FileBody = (props: { node: FileNode; sourcePath?: string; owner: CanvasOwner }): ReturnType<typeof React.createElement> => {
  const { node, owner } = props
  const api = owner.api
  const kind = classifyFilePath(node.file)
  const [markdown, setMarkdown] = React.useState<string | null>(null)
  const [error, setError] = React.useState('')
  const imgSrc = useAssetSrc(node.file, owner)

  React.useEffect(() => {
    if (kind !== 'text') {
      setMarkdown(null)
      return
    }
    let cancelled = false
    setError('')
    void owner.run(() => api.vault.readFileBaseline(node.file)).then((file) => {
      if (!file?.baseline) throw new Error(uiText('canvas.error.preview'))
      // A `subpath` narrows the embed to one heading or block — without this the
      // card renders the whole note and the anchor is silently ignored.
      if (!cancelled && owner.isActive()) setMarkdown(sliceSubpath(file.content, node.subpath))
    }).catch(reason => { if (!cancelled && owner.isActive()) setError(reason instanceof Error ? reason.message : uiText('canvas.error.preview')) })
    return () => {
      cancelled = true
    }
  }, [node.file, node.subpath, kind, imgSrc, owner, api])

  if (error) return <p role="alert">{error}</p>

  if (kind === 'base' || /\.canvas$/i.test(node.file)) {
    const Preview = api.ui.FilePreview
    return <div className="canvas-file-preview" onPointerDown={(event) => event.stopPropagation()}><Preview relPath={node.file} sourcePath={props.sourcePath} subpath={node.subpath} /></div>
  }
  if (kind === 'audio') return <audio className="canvas-node-media" controls src={imgSrc} onPointerDown={(event) => event.stopPropagation()} />
  if (kind === 'video') return <video className="canvas-node-media" controls src={imgSrc} onPointerDown={(event) => event.stopPropagation()} />
  if (kind === 'pdf') return <iframe className="canvas-node-media" title={node.file} src={`${imgSrc}${node.subpath ?? ''}`} />
  if (kind === 'image') {
    return (
      <div className="canvas-node-image">
        <img src={imgSrc} alt={node.file} draggable={false} />
      </div>
    )
  }
  if (kind === 'text') {
    const MarkdownView = api.ui.MarkdownView
    return <div className="canvas-node-body markdown-body"><MarkdownView value={markdown ?? ''} context={{ sourcePath: node.file }} /></div>
  }
  return <div className="canvas-node-placeholder">{displayFileTitle(node.file) || uiText('auto.f11b8781300b')}</div>
}

/** The group's optional background image, painted under its colour tint. */
const GroupBackground = (props: { node: GroupNode; owner: CanvasOwner }): ReturnType<typeof React.createElement> | null => {
  const { node } = props
  const src = useAssetSrc(node.background ?? '', props.owner)
  if (!node.background) return null
  const style: React.CSSProperties = { backgroundImage: `url("${src}")` }
  return <div className={`canvas-group-bg ${node.backgroundStyle ?? 'cover'}`} style={style} />
}

/** A one-line editor used to set a file path (resolved via the index) or a URL. */
const InlineInput = (props: {
  placeholder: string
  initial: string
  resolve?: (value: string) => string | null
  onCommit: (value: string) => void
  onCancel: () => void
}): ReturnType<typeof React.createElement> => {
  const [value, setValue] = React.useState(props.initial)
  const commit = (): void => {
    const raw = value.trim()
    if (!raw) {
      props.onCancel()
      return
    }
    props.onCommit(props.resolve ? props.resolve(raw) ?? raw : raw)
  }
  return (
    <input
      className="canvas-input"
      autoFocus
      placeholder={props.placeholder}
      value={value}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          props.onCancel()
        }
      }}
    />
  )
}

export const NodeView = (props: NodeViewProps): ReturnType<typeof React.createElement> => {
  const { node, index, selected, singleSelected, editing, dragging, readOnly } = props
  const root = React.useRef<HTMLDivElement>(null)
  const [visible, setVisible] = React.useState(typeof IntersectionObserver === 'undefined')
  React.useEffect(() => {
    const element = root.current
    if (!element) return
    const document = element.ownerDocument
    const Observer = document.defaultView?.IntersectionObserver
    let intersecting = !Observer
    let active = true
    const update = (): void => { if (active) setVisible(props.owner.isActive() && intersecting && document.visibilityState !== 'hidden') }
    const observer = Observer ? new Observer(records => {
      const record = records.find(record => record.target === element)
      if (record) intersecting = record.isIntersecting
      update()
    }, { root: element.closest('.canvas-root'), rootMargin: '120px' }) : null
    observer?.observe(element)
    document.addEventListener('visibilitychange', update)
    const cleanup = (): void => { active = false; observer?.disconnect(); document.removeEventListener('visibilitychange', update) }
    const offOwner = props.owner.onDispose(() => { update(); cleanup() })
    update()
    return () => { cleanup(); offOwner() }
  }, [props.owner])
  const showBody = editing || node.type === 'file' && !node.file || node.type === 'link' && !node.url || props.previewEnabled && visible
  const accent = resolveColor(node.color)
  const isGroup = node.type === 'group'
  const style: React.CSSProperties = {
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
    zIndex: (editing ? BAND_EDITING : selected ? BAND_SELECTED : 0) + index
  }
  if (accent) {
    const styleVars = style as Record<string, string>
    styleVars['--canvas-node-accent'] = accent
    const contrast = resolveContrast(node.color)
    if (contrast) styleVars['--canvas-node-contrast'] = contrast
  }

  // `with-color` marks "this node has a colour" for every type; the card-fill and
  // group-fill rules are separate and the group ones come later, so a group takes
  // its own fill while still getting the solid label plate.
  const className =
    'canvas-node' +
    (isGroup ? ' canvas-group' : '') +
    (accent ? ' with-color' : '') +
    (selected ? ' selected' : '') +
    (dragging ? ' dragging' : '')

  return (
    <div
      ref={root}
      className={className}
      style={style}
      data-node-id={node.id}
      onPointerDown={(e) => props.onNodePointerDown(e, node)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (node.type === 'text' || node.type === 'group' || node.type === 'link') props.onStartEdit(node)
      }}
    >
      {/* The title rides above the card, so it renders outside the container. */}
      {renderLabel(node, editing, props)}

      <div className="canvas-node-container">{showBody ? renderBody(node, editing, props) : null}</div>

      {/* Connection ports (CSS shows them on hover / when selected). */}
      {!editing &&
        !readOnly &&
        SIDES.map((side) => (
          <div
            key={side}
            className={`canvas-port ${side}`}
            data-side={side}
            onPointerDown={(e) => props.onConnectStart(e, node, side)}
          />
        ))}

      {/* Border hit targets for unselected cards and the single selection. */}
      {(singleSelected || !selected) &&
        !editing &&
        !readOnly &&
        RESIZE_HANDLES.map((h) => (
          <div
            key={h}
            className={`canvas-handle ${h}`}
            onPointerDown={(e) => props.onResizeStart(e, node, h as ResizeHandle)}
          />
        ))}
    </div>
  )
}

/** The card's title line, drawn above the card (Obsidian's `.canvas-node-label`). */
function renderLabel(
  node: CanvasNode,
  editing: boolean,
  props: NodeViewProps
): ReturnType<typeof React.createElement> | null {
  if (node.type === 'group') {
    return <GroupLabel node={node} editing={editing} onCommit={props.onCommit} onCancel={props.onCancelEdit} />
  }
  if (node.type === 'file' && node.file) {
    return (
      <button
        type="button"
        className="canvas-node-label"
        title={node.subpath ? `${node.file}${node.subpath}` : node.file}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { if (props.owner.isActive()) void props.owner.api.workspace.openFile(node.file, undefined, { newTab: props.owner.api.ui.hasModKey(e) }) }}
      >
        <FileCardIcon />
        <span className="canvas-node-title">
          {displayFileTitle(node.file)}
          {node.subpath ? ` ${node.subpath}` : ''}
        </span>
      </button>
    )
  }
  if (node.type === 'link' && node.url && !editing) {
    let domain = node.url
    try {
      domain = new URL(node.url).hostname
    } catch {
      /* keep the raw url as the title */
    }
    return (
      <span className="canvas-node-label">
        <LinkCardIcon />
        <span className="canvas-node-title">{domain}</span>
      </span>
    )
  }
  return null
}

function renderBody(node: CanvasNode, editing: boolean, props: NodeViewProps): ReturnType<typeof React.createElement> {
  switch (node.type) {
    case 'text':
      return <TextBody owner={props.owner} node={node} editing={editing} onCommit={props.onCommit} onCancel={props.onCancelEdit} />
    case 'group':
      return <GroupBackground owner={props.owner} node={node} />
    case 'link':
      return <LinkBody owner={props.owner} node={node} editing={editing} interactive={props.singleSelected} onCommit={props.onCommit} onCancel={props.onCancelEdit} />
    case 'file':
      return <FileCard owner={props.owner} sourcePath={props.sourcePath} node={node} onCommit={props.onCommit} onCancel={props.onCancelEdit} />
  }
}

const TextBody = (props: {
  owner: CanvasOwner
  node: TextNode
  editing: boolean
  onCommit: (node: CanvasNode, patch: Partial<CanvasNode>) => void
  onCancel: () => void
}): ReturnType<typeof React.createElement> => {
  const { node, editing } = props
  const [draft, setDraft] = React.useState(node.text)
  const [html, setHtml] = React.useState('')
  React.useEffect(() => {
    if (editing) return
    let active = true
    setHtml('')
    void props.owner.run(() => props.owner.api.markdown.render(node.text || '*Empty card*')).then((value) => { if (active && props.owner.isActive()) setHtml(value) }).catch(() => { if (active && props.owner.isActive()) setHtml('') })
    return () => { active = false }
  }, [node.text, props.owner, editing])
  React.useEffect(() => {
    if (editing) setDraft(node.text)
  }, [editing, node.text])
  if (editing) {
    return (
      <textarea
        className="canvas-text-edit"
        autoFocus
        value={draft}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => props.onCommit(node, { text: draft } as Partial<TextNode>)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            props.onCommit(node, { text: draft } as Partial<TextNode>)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            props.onCancel()
          }
        }}
      />
    )
  }
  return (
    <div
      className="canvas-node-body markdown-body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

const GroupLabel = (props: {
  node: GroupNode
  editing: boolean
  onCommit: (node: CanvasNode, patch: Partial<CanvasNode>) => void
  onCancel: () => void
}): ReturnType<typeof React.createElement> => {
  const { node, editing } = props
  if (editing) {
    return (
      <InlineInput
        placeholder={uiText('auto.ebb7e14b1c9c')}
        initial={node.label ?? ''}
        onCommit={(label) => props.onCommit(node, { label } as Partial<GroupNode>)}
        onCancel={props.onCancel}
      />
    )
  }
  return <div className="canvas-group-label">{node.label || uiText('auto.171a0606f7c7')}</div>
}

const WebPreview = ({ url, interactive, owner }: { url: string; interactive: boolean; owner: CanvasOwner }): ReturnType<typeof React.createElement> => {
  const host = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!host.current || !owner.isActive() || !/^https?:\/\//i.test(url)) return
    const guest = document.createElement('webview')
    guest.setAttribute('partition', 'web-incognito')
    guest.setAttribute('src', url)
    guest.setAttribute('aria-label', url)
    host.current.append(guest)
    const offOwner = owner.onDispose(() => guest.remove())
    return () => { offOwner(); guest.remove() }
  }, [url, owner])
  return <div ref={host} className="canvas-web-preview" style={{ pointerEvents: interactive ? 'auto' : 'none' }} />
}

const LinkBody = (props: {
  owner: CanvasOwner
  node: LinkNode
  editing: boolean
  interactive: boolean
  onCommit: (node: CanvasNode, patch: Partial<CanvasNode>) => void
  onCancel: () => void
}): ReturnType<typeof React.createElement> => {
  const { node, editing } = props
  if (editing || !node.url) {
    return (
      <InlineInput
        placeholder="https://example.com"
        initial={node.url}
        onCommit={(url) => props.onCommit(node, { url } as Partial<LinkNode>)}
        onCancel={props.onCancel}
      />
    )
  }
  return (
    <div className="canvas-node-body canvas-link-body">
      <WebPreview owner={props.owner} url={node.url} interactive={props.interactive} />
      <a
        className="canvas-link-anchor"
        href={/^https?:\/\//i.test(node.url) ? node.url : undefined}
        target="_blank"
        rel="noreferrer"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {node.url}
      </a>
    </div>
  )
}

const FileCard = (props: {
  owner: CanvasOwner
  sourcePath?: string
  node: FileNode
  onCommit: (node: CanvasNode, patch: Partial<CanvasNode>) => void
  onCancel: () => void
}): ReturnType<typeof React.createElement> => {
  const { node } = props
  if (!node.file) {
    return (
      <InlineInput
        placeholder={uiText('auto.a11d06d5c5ea')}
        initial=""
        resolve={(value) => props.owner.isActive() ? props.owner.api.workspace.resolveWikilink(value) : null}
        onCommit={(file) => props.onCommit(node, { file } as Partial<FileNode>)}
        onCancel={props.onCancel}
      />
    )
  }
  return <FileBody owner={props.owner} node={node} sourcePath={props.sourcePath} />
}
