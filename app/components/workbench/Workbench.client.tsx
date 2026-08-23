import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import {
  workbenchStore,
  WORKBENCH_WIDTH_MIN,
  WORKBENCH_WIDTH_MAX,
  type WorkbenchViewType,
} from '~/lib/stores/workbench';
import {
  canvasNodes,
  canvasEdges,
  connectionSource,
  connectionPointer,
  dragSource,
  dragPointer,
  canvasSurfaceEl,
  canvasTransform,
  nodesLibraryCollapsed,
  toggleNodesLibrary,
  addCanvasNode,
  addCanvasEdge,
  moveCanvasNode,
  removeCanvasNode,
  removeCanvasEdge,
  resizeCanvasNode,
  setCanvasNodeText,
  setCanvasNodeColor,
  setCanvasNodeTitle,
  startConnection,
  updateConnectionPointer,
  endConnection,
  startDrag,
  updateDragPointer,
  endDrag,
  selectedCanvasIds,
  selectCanvasNode,
  clearCanvasSelection,
  toggleCanvasNodeSelection,
  copySelectedCanvasNodes,
  cutSelectedCanvasNodes,
  pasteCanvasNodes,
  duplicateSelectedCanvasNodes,
  deleteSelectedCanvasNodes,
  canvasPanelMode,
  canvasChatTriggerId,
  openCanvasChat,
  closeCanvasChat,
  runningCanvasNodeIds,
  setRunningCanvasNodes,
  runCanvasAutomation,
  exportCanvas,
  importCanvas,
  autoLayoutCanvas,
  executeNode,
  propertiesPanelNodeId,
  openNodeProperties,
  closeNodeProperties,
  getNodeConfig,
  setNodeConfig,
  memoryTreePanelNodeId,
  openMemoryTreePanel,
  closeMemoryTreePanel,
  getNeuralMemory,
  addNeuralMemory,
  retrieveRelevantMemory,
  setEdgeLabel,
  exportCanvasAsCode,
  STICKY_DEFAULT_WIDTH,
  STICKY_DEFAULT_HEIGHT,
  STICKY_MIN_WIDTH,
  STICKY_MIN_HEIGHT,
  STICKY_COLORS,
  getStickyColor,
  type CanvasNode,
  type CanvasNodeKind,
} from '~/lib/stores/canvasNodes';
import styles from './Workbench.module.scss';

/*
 * Workbench — the right-hand coding panel.
 *
 * This is a visual prototype: the AI backend is stubbed, so no real files are
 * streamed. The panel shows a fixed set of sample project files (a minimal
 * React + Vite app) so the Code view looks realistic. The Preview view shows
 * a placeholder since there's no WebContainer running.
 *
 * The panel slides in from the right when `workbenchStore.showWorkbench`
 * becomes true (set by Chat.client.tsx when the user sends their first
 * message). It is positioned `fixed` on the right. Its width defaults to the
 * `--workbench-width` CSS variable but can be resized by dragging the
 * `WorkbenchResizer` handle on the panel's left edge — the chosen width is
 * stored in `workbenchStore.workbenchWidth` and persisted to localStorage.
 */
export function Workbench() {
  const show = useStore(workbenchStore.showWorkbench);
  const view = useStore(workbenchStore.currentView);
  const selectedPath = useStore(workbenchStore.selectedFile);
  const width = useStore(workbenchStore.workbenchWidth);
  const libraryCollapsed = useStore(nodesLibraryCollapsed);

  return (
    <AnimatePresence>
      {show && (
        <>
          <WorkbenchResizer />
          <motion.div
            key="workbench"
            initial={{ x: '100%', opacity: 0.4 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0.4 }}
            transition={{ duration: 0.32, ease: cubicEasingFn }}
            className={classNames(styles.Workbench, 'z-workbench')}
            data-workbench-view={view}
            data-nodes-library={libraryCollapsed ? 'collapsed' : 'expanded'}
            style={width !== null ? { width: `${width}px` } : undefined}
          >
            <Header view={view} />
            <div className={styles.WorkbenchBody}>
              {view === 'code' ? (
                <CodeView selectedPath={selectedPath} />
              ) : (
                <PreviewView />
              )}
            </div>
            {/*
              * CanvasBottomPanel — the swap container for the bottom of the
              * canvas. Renders EITHER the nodes library (ActionStepsBar) OR the
              * chat (CanvasChatPanel), cross-fading smoothly via AnimatePresence.
              * Double-click a trigger node → chat; double-click empty canvas →
              * library. Both panels occupy the same slot so the swap is smooth.
              */}
            <CanvasBottomPanel />
            {/*
              * MemoryTreePanel: mounted INSIDE the workbench motion.div (not
              * inside CodeView) so its position:absolute overlay covers the
              * COMPLETE CANVAS (header + canvas + nodes library), NOT just the
              * canvas area. This matches the user's request: "the memory node
              * property panel will open on the complete canvas."
              */}
            <MemoryTreePanel />
          </motion.div>
          <DragController />
          <DragGhost />
          {/* ConnectionDragController: global pointer listeners for trigger→agent
              connection drags. No-op unless connectionSource is non-null. */}
          <ConnectionDragController />
          {/* CanvasKeyboardShortcuts: global keydown listener for copy/cut/paste/
              duplicate/delete on the selected canvas nodes. No-op unless nodes are
              selected (or the clipboard has something to paste). */}
          <CanvasKeyboardShortcuts />
        </>
      )}
    </AnimatePresence>
  );
}

/*
 * DragController — owns the GLOBAL pointer listeners that track a library→canvas
 * drag. It has no visual output.
 *
 * Why global listeners (and no setPointerCapture on the card)?
 *  - If the card captured the pointer, pointerup would fire on the CARD, never
 *    on the canvas — so the canvas couldn't handle the drop. By NOT capturing,
 *    pointerup fires on whatever element is under the cursor at release. When
 *    that's the canvas, the canvas's own onPointerUp handles the drop (it owns
 *    pan/zoom in its closure, so it can convert screen→canvas coords).
 *  - This controller only tracks the ghost position + hit-tests "over canvas"
 *    so the ghost can reflect the drop target. On pointerup it just clears the
 *    drag (the canvas handler, if it ran, already cleared it — endDrag is a
 *    no-op when dragState is already null).
 *
 * Listeners are attached only while a drag is active (dragState !== null) to
 * avoid overhead when the user is just clicking around.
 */
function DragController() {
  const source = useStore(dragSource);

  useEffect(() => {
    if (!source) {
      return undefined;
    }

    // While dragging, prevent text selection and show a grabbing cursor app-wide.
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    const onMove = (e: PointerEvent) => {
      const surface = canvasSurfaceEl.get();
      let overCanvas = false;

      if (surface) {
        const r = surface.getBoundingClientRect();
        overCanvas = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      }

      updateDragPointer(e.clientX, e.clientY, overCanvas);
    };

    const onUp = () => {
      endDrag();
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);

    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [source !== null]); // re-run when a drag starts or stops

  return null;
}

/*
 * DragGhost — the floating preview that follows the cursor during a drag.
 * Rendered at the workbench root (outside the canvas) so it floats above
 * everything. `pointer-events: none` ensures it never intercepts the pointer —
 * pointermove/up always reach the element (or document) underneath, so the
 * canvas can receive the drop.
 *
 * Subscribes to both atoms: `dragSource` for the stable step/offset (re-renders
 * only at drag start/end) and `dragPointer` for the live position (re-renders
 * per move — but this is the one element that must move every frame).
 */
function DragGhost() {
  const source = useStore(dragSource);
  const pointer = useStore(dragPointer);

  /*
   * Wrapped in AnimatePresence so the ghost fades out smoothly when the drag
   * ends (on drop or cancel) instead of vanishing instantly — the spring exit
   * hands off nicely to the node springing in at the drop point.
   */
  return (
    <AnimatePresence>
      {source && pointer && (
        <motion.div
          key="drag-ghost"
          className={classNames(styles.DragGhost, pointer.overCanvas && styles.DragGhostOverCanvas)}
          initial={{ scale: 0.85, opacity: 0, y: 6 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.85, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 520, damping: 32, mass: 0.6 }}
          style={{
            left: pointer.x - source.offsetX,
            top: pointer.y - source.offsetY,
          }}
          aria-hidden
        >
          <div className={styles.DragGhostIcon}>
            <span className={source.step.icon} />
          </div>
          <div className={styles.DragGhostBody}>
            <div className={styles.DragGhostTitle}>{source.step.title}</div>
            {source.step.detail && <div className={styles.DragGhostDetail}>{source.step.detail}</div>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/*
 * WorkbenchResizer — a thin vertical handle on the workbench's left edge.
 *
 * Drag it left/right to resize the workbench (and inversely the chat area).
 * While dragging, a `col-resize` cursor is forced over the whole document so
 * the pointer stays grabbed even when it strays off the thin handle. The new
 * width is clamped to [WORKBENCH_WIDTH_MIN, WORKBENCH_WIDTH_MAX] and committed
 * to `workbenchStore.workbenchWidth` (which persists to localStorage).
 */
function WorkbenchResizer() {
  const width = useStore(workbenchStore.workbenchWidth);
  const draggingRef = useRef(false);
  const startRef = useRef({ x: 0, width: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    const current = workbenchStore.workbenchWidth.get();

    // Fall back to the rendered pixel width if no override is set yet.
    let baseWidth = current;

    if (baseWidth === null) {
      const el = document.querySelector(`.${styles.Workbench}`) as HTMLElement | null;
      baseWidth = el ? el.getBoundingClientRect().width : 0;
    }

    startRef.current = { x: e.clientX, width: baseWidth };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    workbenchStore.workbenchResizing.set(true);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) {
      return;
    }

    /*
     * Dragging LEFT (negative dx) should make the workbench WIDER, because
     * the workbench is anchored to the right edge — moving the left edge
     * leftward expands it. Hence width = baseWidth - dx.
     */
    const dx = e.clientX - startRef.current.x;
    const next = startRef.current.width - dx;
    const clamped = Math.max(WORKBENCH_WIDTH_MIN, Math.min(WORKBENCH_WIDTH_MAX, next));
    workbenchStore.setWorkbenchWidth(clamped);
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    workbenchStore.workbenchResizing.set(false);

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  const onDoubleClick = useCallback(() => {
    // Double-click resets to the default (CSS-variable) width.
    workbenchStore.setWorkbenchWidth(null);
    toast.info('Reset workbench width');
  }, []);

  return (
    <div
      className={styles.WorkbenchResizer}
      style={width !== null ? { right: `${width}px` } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat and workbench"
      title="Drag to resize · Double-click to reset"
    />
  );
}

function Header({ view: _view }: { view: WorkbenchViewType }) {
  const [isRunning, setIsRunning] = useState(false);
  const projectName = useStore(workbenchStore.projectName);
  const [draftName, setDraftName] = useState(projectName);

  /*
   * More-menu (three-dot) dropdown state.
   *  - menuOpen: whether the dropdown panel is visible.
   *  - showGrid: canvas dot-grid visibility, sourced from workbenchStore so
   *    the MovableCanvas (a sibling component) can read the same value.
   *    When true the grid is ON, so the menu item reads "Hide grid" with a
   *    green active dot. Toggling flips the label to "Show grid" and the dot.
   */
  const [menuOpen, setMenuOpen] = useState(false);
  const showGrid = useStore(workbenchStore.canvasGridVisible);
  const menuRef = useRef<HTMLDivElement>(null);
  // Hidden file input ref for the Upload (import) button.
  const fileInputRef = useRef<HTMLInputElement>(null);

  /*
   * Keep the local draft in sync with the store until the user starts editing.
   * Once focused/edited, the input owns the value; it commits to the store on
   * blur or Enter (so typing doesn't re-render the whole workbench each keystroke).
   */
  useEffect(() => {
    if (draftName !== projectName && document.activeElement?.tagName !== 'INPUT') {
      setDraftName(projectName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName]);

  // Close the more-menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const commitName = useCallback(() => {
    if (draftName.trim().length === 0) {
      setDraftName(projectName);
    } else {
      workbenchStore.setProjectName(draftName);
    }
  }, [draftName, projectName]);

  const run = useCallback(() => {
    if (isRunning) {
      return;
    }

    /*
     * RUN THE CANVAS AUTOMATION (not a dev server / preview switch).
     *
     * Delegates to the shared runCanvasAutomation engine, which BFS-walks the
     * trigger → agent → utility graph and pulses each node in execution order.
     * The Run button doesn't pass an onStep callback (it just wants the pulse +
     * the completion toast) — the chat send() passes onStep to stream each
     * node's output description into the chat. The view does NOT switch — the
     * canvas stays in place the whole time (the old Preview-UI switch was
     * removed per the user's request).
     */
    const nodes = canvasNodes.get();
    const triggers = nodes.filter((n) => n.kind === 'trigger');

    if (triggers.length === 0) {
      toast.info('Add a Trigger node to run the automation');
      return;
    }

    setIsRunning(true);
    toast.info('Running automation…');

    runCanvasAutomation().then((result) => {
      setIsRunning(false);

      if (result.error) {
        toast.info(result.error);
      } else {
        toast.success(`Automation complete — ${result.count} node${result.count === 1 ? '' : 's'} executed`);
      }
    });
  }, [isRunning]);

  return (
    <div className={styles.WorkbenchHeader}>
      <div className={styles.ProjectNameField}>
        <input
          type="text"
          className={styles.ProjectNameInput}
          value={draftName}
          spellCheck={false}
          autoComplete="off"
          aria-label="Project name"
          title="Project name"
          placeholder="Project name"
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            }
            if (e.key === 'Escape') {
              setDraftName(projectName);
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
        />
      </div>
      <div className={styles.HeaderActions}>
        <div className={styles.MenuWrap} ref={menuRef}>
          <button
            type="button"
            className={classNames(styles.HeaderIconButton, menuOpen && styles.active)}
            onClick={() => setMenuOpen((o) => !o)}
            title="More actions"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="i-ph:dots-three text-base" />
          </button>
          {menuOpen && (
            <MoreMenu
              showGrid={showGrid}
              onToggleGrid={() => workbenchStore.toggleCanvasGrid()}
              onUndo={() => workbenchStore.dispatchCanvasCommand('undo')}
              onRedo={() => workbenchStore.dispatchCanvasCommand('redo')}
              onFitView={() => workbenchStore.dispatchCanvasCommand('fit')}
              onAutoLayout={() => {
                autoLayoutCanvas();
                toast.success('Auto-layout applied');
              }}
              onDownload={() => {
                const json = exportCanvas();
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                // Use the project name from the text field as the filename.
                // Fallback to "workflow" if the name is empty. Sanitize the
                // name so it's safe as a filename (strip slashes, etc.).
                const rawName = (draftName || projectName || 'workflow').trim();
                const safeName = rawName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'workflow';
                a.download = `${safeName}.json`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success(`Exported as "${safeName}.json"`);
              }}
              onUpload={() => {
                fileInputRef.current?.click();
              }}
              onExportCode={() => {
                const code = exportCanvasAsCode();
                const blob = new Blob([code], { type: 'text/javascript' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${(draftName || projectName || 'workflow').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'workflow'}.js`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success('Workflow exported as code');
              }}
              onExportImage={() => {
                /*
                  * Export the canvas as a PNG image. Draws the nodes + edges
                  * programmatically onto a <canvas> element (NOT via DOM cloning
                  * — that approach has CORS/tainting issues). Each node is drawn
                  * as a rounded rectangle with its title + icon-kind color; each
                  * edge is drawn as a bezier curve. The resulting PNG is then
                  * downloaded.
                  */
                const nodes = canvasNodes.get();
                const edges = canvasEdges.get();

                if (nodes.length === 0) {
                  toast.info('Canvas is empty — add nodes first');
                  return;
                }

                // Compute the bounding box of all nodes (in canvas space).
                const minX = Math.min(...nodes.map((n) => n.x)) - 40;
                const minY = Math.min(...nodes.map((n) => n.y)) - 60;
                const maxX = Math.max(...nodes.map((n) => n.x + (n.width ?? 64))) + 40;
                const maxY = Math.max(...nodes.map((n) => n.y + (n.height ?? 64))) + 80;
                const w = Math.round(maxX - minX);
                const h = Math.round(maxY - minY);

                const cnv = document.createElement('canvas');
                cnv.width = w * 2;
                cnv.height = h * 2;
                const ctx = cnv.getContext('2d');

                if (!ctx) {
                  toast.error('Canvas export failed');
                  return;
                }

                ctx.scale(2, 2);

                // Background.
                ctx.fillStyle = '#0d0d0d';
                ctx.fillRect(0, 0, w, h);

                // Helper: translate canvas-space → image-space.
                const tx = (x: number) => x - minX;
                const ty = (y: number) => y - minY;

                // Draw edges (bezier curves).
                ctx.strokeStyle = '#6b7280';
                ctx.lineWidth = 2;

                for (const e of edges) {
                  const src = nodes.find((n) => n.id === e.sourceId);
                  const tgt = nodes.find((n) => n.id === e.targetId);

                  if (!src || !tgt) {
                    continue;
                  }

                  const sx = tx(src.x + (src.width ?? 64));
                  const sy = ty(src.y + (src.height ?? 64) / 2);
                  const tx2 = tx(tgt.x);
                  const ty2 = ty(tgt.y + (tgt.height ?? 64) / 2);
                  const cx = (sx + tx2) / 2;
                  ctx.beginPath();
                  ctx.moveTo(sx, sy);
                  ctx.bezierCurveTo(cx, sy, cx, ty2, tx2, ty2);
                  ctx.stroke();
                }

                // Draw nodes.
                for (const node of nodes) {
                  const nx = tx(node.x);
                  const ny = ty(node.y);
                  const nw = node.width ?? 64;
                  const nh = node.height ?? 64;

                  // Node background (dark) + border (accent).
                  ctx.fillStyle = '#171717';
                  // Circular kinds (memory / llm / aitool) get the teal accent + a
                  // fully-round radius (32 = half of 64 → a circle); triggers get
                  // amber; everything else green. Matches the placed-card silhouettes.
                  const isCircularKind = node.kind === 'memory' || node.kind === 'llm' || node.kind === 'aitool';
                  ctx.strokeStyle = node.kind === 'trigger' ? '#f59e0b' : isCircularKind ? '#10b981' : '#4ade80';
                  ctx.lineWidth = 2;
                  ctx.beginPath();
                  ctx.roundRect(nx, ny, nw, nh, isCircularKind ? 32 : 4);
                  ctx.fill();
                  ctx.stroke();

                  // Title text.
                  ctx.fillStyle = '#e5e7eb';
                  ctx.font = '12px sans-serif';
                  ctx.textAlign = 'center';
                  ctx.fillText(node.title, nx + nw / 2, ny + nh + 16);
                }

                // Download the PNG.
                cnv.toBlob((blob) => {
                  if (blob) {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `canvas-${Date.now()}.png`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success('Canvas exported as image');
                  }
                }, 'image/png');
              }}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
        <button
          type="button"
          className={styles.HeaderIconButton}
          onClick={() => toast.info('Search')}
          title="Search"
          aria-label="Search"
        >
          <span className="i-ph:magnifying-glass text-base" />
        </button>
        <button
          type="button"
          className={styles.HeaderIconButton}
          onClick={() => toast.info('Keyboard shortcuts')}
          title="Keyboard shortcuts"
          aria-label="Keyboard shortcuts"
        >
          <span className="i-ph:keyboard text-base" />
        </button>
        <button
          type="button"
          className={classNames(styles.RunButton, isRunning && styles.running)}
          onClick={run}
          disabled={isRunning}
          title={isRunning ? 'Running…' : 'Run the app'}
          aria-label={isRunning ? 'Running…' : 'Run the app'}
        >
          <span className={classNames(isRunning ? 'i-ph:spinner-gap' : 'i-ph:play-fill', styles.RunButtonIcon)} />
          {isRunning ? 'Running' : 'Run'}
        </button>
        {/*
          * Hidden file input for the Upload (import) menu item. Kept outside
          * the visible button group — it's triggered programmatically by the
          * MoreMenu's onUpload callback.
          */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];

            if (!file) {
              return;
            }

            const reader = new FileReader();
            reader.onload = () => {
              const text = reader.result as string;
              const ok = importCanvas(text);

              if (ok) {
                toast.success('Workflow imported');
              } else {
                toast.error('Invalid workflow file');
              }
            };
            reader.readAsText(file);
            // Reset the input so the same file can be re-imported.
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

/*
 * MoreMenu — the dropdown panel that opens from the three-dot button.
 *
 * Grouped layout matching the reference design:
 *   HISTORY      → Undo (⌘Z), Redo (⇧⌘Z)
 *   CANVAS VIEW  → Fit view, Hide/Show grid (toggle)
 *   EXPORT       → Export as image
 *
 * Toggle items keep the menu open; action items fire their callback then close.
 */
function MoreMenu({
  showGrid,
  onToggleGrid,
  onUndo,
  onRedo,
  onFitView,
  onAutoLayout,
  onDownload,
  onUpload,
  onExportImage,
  onExportCode,
  onClose,
}: {
  showGrid: boolean;
  onToggleGrid: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFitView: () => void;
  onAutoLayout: () => void;
  onDownload: () => void;
  onUpload: () => void;
  onExportImage: () => void;
  onExportCode: () => void;
  onClose: () => void;
}) {
  // Action items: run the callback, then close the menu.
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div className={styles.MoreMenu} role="menu">
      <div className={styles.MenuGroup}>
        <div className={styles.MenuGroupLabel}>History</div>
        <MenuItem icon="i-ph:arrow-counter-clockwise" label="Undo" shortcut="⌘Z" onClick={act(onUndo)} />
        <MenuItem icon="i-ph:arrow-clockwise" label="Redo" shortcut="⇧⌘Z" onClick={act(onRedo)} />
      </div>
      <div className={styles.MenuDivider} />
      <div className={styles.MenuGroup}>
        <div className={styles.MenuGroupLabel}>Canvas view</div>
        <MenuItem icon="i-ph:frame-corners" label="Fit view" onClick={act(onFitView)} />
        <MenuItem
          icon="i-ph:squares-four"
          label={showGrid ? 'Hide grid' : 'Show grid'}
          active={showGrid}
          onClick={onToggleGrid}
        />
        <MenuItem icon="i-ph:layout" label="Auto-layout" onClick={act(onAutoLayout)} />
      </div>
      <div className={styles.MenuDivider} />
      <div className={styles.MenuGroup}>
        <div className={styles.MenuGroupLabel}>Workflow</div>
        <MenuItem icon="i-ph:download-simple" label="Download (export JSON)" onClick={act(onDownload)} />
        <MenuItem icon="i-ph:upload-simple" label="Upload (import JSON)" onClick={act(onUpload)} />
      </div>
      <div className={styles.MenuDivider} />
      <div className={styles.MenuGroup}>
        <div className={styles.MenuGroupLabel}>Export</div>
        <MenuItem icon="i-ph:camera" label="Export as image (PNG)" onClick={act(onExportImage)} />
        <MenuItem icon="i-ph:file-code" label="Export as code (JS)" onClick={act(onExportCode)} />
      </div>
    </div>
  );
}

/*
 * MenuItem — a single row in the MoreMenu.
 *
 * `active` marks a toggle as ON: icon + label turn the accent color and a
 * solid accent dot is shown on the right (instead of a keyboard shortcut).
 */
function MenuItem({
  icon,
  label,
  shortcut,
  active = false,
  onClick,
}: {
  icon: string;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={classNames(styles.MenuItem, active && styles.MenuItemActive)}
      role="menuitem"
      onClick={onClick}
    >
      <span className={classNames(icon, styles.MenuItemIcon)} />
      <span className={styles.MenuItemLabel}>{label}</span>
      {shortcut && <span className={styles.MenuItemShortcut}>{shortcut}</span>}
      {active && <span className={styles.MenuItemDot} aria-hidden />}
    </button>
  );
}

/* ── Code view: movable canvas ───────────────────────────────────────────── */

function CodeView({ selectedPath: _selectedPath }: { selectedPath: string | undefined }) {
  return (
    <div className={styles.CodeView}>
      <div className={styles.EditorPane}>
        <MovableCanvas />
        {/*
          * NodePropertiesPanel: modal overlay for configuring utility nodes.
          * Mounted INSIDE the EditorPane so the overlay is scoped to the canvas
          * area only (not the nodes library panel below).
          */}
        <NodePropertiesPanel />
      </div>
    </div>
  );
}

/*
 * MovableCanvas — a pannable, zoomable canvas surface.
 *
 * Drag on the canvas background → pans the whole canvas (the dot-grid
 * background moves with it). The canvas is intentionally empty.
 *
 * Zoom:
 *  - Ctrl/Cmd + mouse wheel zooms in/out (the dot grid scales).
 *  - The vertical ZoomControls group in the bottom-left corner exposes
 *    zoom-in, fit-to-canvas (reset), and zoom-out buttons plus a live
 *    percentage readout.
 *
 * Shared state (via workbenchStore):
 *  - canvasGridVisible: whether the dot grid is drawn. Toggled from the
 *    header's More-menu "Hide grid" / "Show grid" item.
 *  - canvasCommand: a signal atom the More-menu writes to (fit / export /
 *    undo / redo). This component subscribes and executes the action.
 *
 * Undo/redo:
 *  - A debounced effect snapshots {pan, zoom} into a history stack whenever
 *    the user stops panning/zooming (400ms of inactivity). Undo moves the
 *    pointer back; redo moves it forward. Restoring from history sets a
 *    suppress flag so the restore itself doesn't create a new entry.
 *
 * Export as image:
 *  - Renders the current canvas (background colour + dot grid, respecting
 *    pan/zoom/grid visibility) to an offscreen <canvas> at 2× resolution and
 *    triggers a PNG download. Does NOT capture the ZoomControls overlay —
 *    only the canvas surface itself.
 */
function MovableCanvas() {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1); // 1 = 100%

  // Shared canvas state from the store.
  const gridVisible = useStore(workbenchStore.canvasGridVisible);
  const command = useStore(workbenchStore.canvasCommand);

  // Live drag state — drives the drop-target highlight + the drop preview that
  // follows the cursor while a library node is dragged over the canvas.
  const dragP = useStore(dragPointer);
  const dragSrc = useStore(dragSource);

  // Zoom limits and step (multiplicative). Max capped at 150%.
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 1.5;
  const ZOOM_STEP = 1.2;

  const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

  /*
   * Undo/redo history. Each entry is a {pan, zoom} snapshot. The index points
   * at the currently-active entry. New actions truncate any redo tail.
   */
  const historyRef = useRef<{ pan: { x: number; y: number }; zoom: number }[]>([{ pan: { x: 0, y: 0 }, zoom: 1 }]);
  const historyIndexRef = useRef(0);
  const suppressHistoryRef = useRef(false);

  const commitHistory = useCallback((state: { pan: { x: number; y: number }; zoom: number }) => {
    const hist = historyRef.current;
    const idx = historyIndexRef.current;

    // Truncate any redo entries that come after the current position.
    hist.splice(idx + 1);

    // Don't push a duplicate of the current entry.
    const last = hist[idx];

    if (last && last.pan.x === state.pan.x && last.pan.y === state.pan.y && last.zoom === state.zoom) {
      return;
    }

    hist.push(state);
    historyIndexRef.current = hist.length - 1;
  }, []);

  /*
   * Debounced history commit: whenever pan or zoom changes, wait 400ms for
   * the interaction to settle, then snapshot. During a drag this means only
   * one entry is created per drag (not one per mousemove). The suppress flag
   * is set by undo/redo so their restore doesn't create a spurious entry.
   */
  useEffect(() => {
    if (suppressHistoryRef.current) {
      suppressHistoryRef.current = false;

      return undefined;
    }

    const t = window.setTimeout(() => {
      commitHistory({ pan, zoom });
    }, 400);

    return () => window.clearTimeout(t);
  }, [pan, zoom, commitHistory]);

  const zoomIn = useCallback(() => setZoom((z) => clampZoom(z * ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(z / ZOOM_STEP)), []);

  const fitToCanvas = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    toast.success('Fit to canvas');
  }, []);

  const undo = useCallback(() => {
    const idx = historyIndexRef.current;

    if (idx <= 0) {
      toast.info('Nothing to undo');

      return;
    }

    const prev = historyRef.current[idx - 1];
    historyIndexRef.current = idx - 1;
    suppressHistoryRef.current = true;
    setPan(prev.pan);
    setZoom(prev.zoom);
    toast.info('Undo');
  }, []);

  const redo = useCallback(() => {
    const idx = historyIndexRef.current;

    if (idx >= historyRef.current.length - 1) {
      toast.info('Nothing to redo');

      return;
    }

    const next = historyRef.current[idx + 1];
    historyIndexRef.current = idx + 1;
    suppressHistoryRef.current = true;
    setPan(next.pan);
    setZoom(next.zoom);
    toast.info('Redo');
  }, []);

  /*
   * Export the canvas surface as a PNG. Draws the background colour (read from
   * the DOM's computed style) and, if the grid is visible, the dot pattern
   * (same colour/size as the CSS radial-gradient) at 2× resolution for
   * sharpness. Then triggers a download — the ZoomControls overlay is excluded
   * because we render to a fresh offscreen <canvas>, not a DOM snapshot.
   */
  const exportAsImage = useCallback(() => {
    const el = canvasRef.current;

    if (!el) {
      return;
    }

    const rect = el.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const dpr = 2; // render at 2× for retina sharpness

    const out = document.createElement('canvas');
    out.width = w * dpr;
    out.height = h * dpr;

    const ctx = out.getContext('2d');

    if (!ctx) {
      toast.error('Could not export canvas');

      return;
    }

    ctx.scale(dpr, dpr);

    // Background: read the computed background-color so it matches the theme.
    const computedBg = getComputedStyle(el).backgroundColor;
    ctx.fillStyle = computedBg || '#1e1e2e';
    ctx.fillRect(0, 0, w, h);

    // Dot grid — only if the grid is currently visible.
    if (gridVisible) {
      const tileSize = 24 * zoom;

      // Matches the SCSS: rgba(40, 20, 55, 0.92), ~1.2px radius.
      ctx.fillStyle = 'rgba(40, 20, 55, 0.92)';

      const dotRadius = Math.max(0.6, 1.2 * Math.max(zoom, 0.5));

      /*
       * Normalise the pan offset into [0, tileSize) so the pattern tiles from
       * the correct origin regardless of how far the canvas has been panned.
       */
      const startX = ((pan.x % tileSize) + tileSize) % tileSize;
      const startY = ((pan.y % tileSize) + tileSize) % tileSize;

      for (let x = startX; x < w; x += tileSize) {
        for (let y = startY; y < h; y += tileSize) {
          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    out.toBlob((blob) => {
      if (!blob) {
        toast.error('Could not export canvas');

        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `canvas-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Canvas exported as PNG');
    }, 'image/png');
  }, [gridVisible, pan, zoom]);

  /*
   * Keep the latest action handlers in a ref so the command-signal effect
   * below can call them without them appearing in its dependency array (which
   * would cause the effect to re-fire whenever pan/zoom change — we only want
   * it to fire when a NEW command is dispatched).
   */
  const handlersRef = useRef({ fitToCanvas, exportAsImage, undo, redo });
  handlersRef.current = { fitToCanvas, exportAsImage, undo, redo };

  /*
   * Command signal: when workbenchStore.canvasCommand changes (the More-menu
   * dispatched fit/export/undo/redo), run the matching handler. Depends only
   * on `command` so it fires once per dispatch, not on every pan/zoom change.
   */
  useEffect(() => {
    if (!command) {
      return;
    }

    const { action } = command;

    if (action === 'fit') {
      handlersRef.current.fitToCanvas();
    } else if (action === 'export') {
      handlersRef.current.exportAsImage();
    } else if (action === 'undo') {
      handlersRef.current.undo();
    } else if (action === 'redo') {
      handlersRef.current.redo();
    }
  }, [command]);

  // Pan interaction state.
  const panningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const canvasRef = useRef<HTMLDivElement>(null);

  /*
   * Attach a non-passive wheel listener so Ctrl/Cmd+wheel can zoom the canvas
   * without the browser also zooming the whole page. React's synthetic onWheel
   * is passive by default, which would make preventDefault() a no-op.
   */
  useEffect(() => {
    const el = canvasRef.current;

    if (!el) {
      return undefined;
    }

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        return;
      }

      e.preventDefault();

      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setZoom((z) => clampZoom(z * factor));
    };

    el.addEventListener('wheel', handleWheel, { passive: false });

    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  /*
   * Publish the canvas DOM node so the global DragController can hit-test
   * "pointer over canvas" during a library→canvas drag. Cleared on unmount so a
   * stale reference is never used.
   */
  useEffect(() => {
    canvasSurfaceEl.set(canvasRef.current);

    return () => canvasSurfaceEl.set(null);
  }, []);

  /*
   * Mirror pan + zoom into the canvasTransform store so OUTSIDE components
   * (notably ConnectionDragController) can read the live transform inside their
   * document-level event handlers via `.get()` — without subscribing (which
   * would re-render them on every pan/zoom tick). Re-runs whenever pan or zoom
   * changes; the .set is a cheap nanostores write.
   */
  useEffect(() => {
    canvasTransform.set({ panX: pan.x, panY: pan.y, zoom });
  }, [pan, zoom]);

  const onCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    panningRef.current = true;
    panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.currentTarget.classList.add(styles.Panning);

    // A plain click (no Shift) on the empty canvas clears the node selection —
    // the standard "click away to deselect" affordance. Shift+click on empty
    // canvas leaves the selection alone (Shift is for ADDING to a selection,
    // and clicking empty space with Shift does nothing in most editors).
    if (!e.shiftKey) {
      clearCanvasSelection();
    }
  };

  const onCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panningRef.current) {
      return;
    }

    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
  };

  const endInteraction = (e: React.PointerEvent<HTMLDivElement>) => {
    /*
     * Library→canvas drop. If a drag is active, this pointerup landed on the
     * canvas (otherwise the global DragController's pointerup handles cleanup).
     * Convert the release point from screen space to canvas space by undoing
     * the pan and zoom, then place a node instance there.
     *
     * React's onPointerUp fires before the document-level pointerup listener,
     * so dragSource is still set when we get here — we read it via .get() (not
     * the reactive subscription) so this handler is self-contained.
     */
    const src = dragSource.get();

    if (src) {
      const el = canvasRef.current;

      if (el) {
        const r = el.getBoundingClientRect();
        const cx = (e.clientX - r.left - pan.x) / zoom;
        const cy = (e.clientY - r.top - pan.y) / zoom;

        /*
         * Sub Agent System special drop: when the "Sub Agent System" node is
         * dropped, create TWO agent nodes stacked vertically (one UP, one DOWN)
         * + connect them with an edge (top agent → bottom agent). This gives the
         * user a pre-wired two-agent system they can immediately build on.
         */
        if (src.step.title === 'Sub Agent System') {
          const VERTICAL_GAP = 120;
          const topStep = { ...src.step, title: 'Sub Agent (Top)', mainLabel: 'Sub Agent', subLabel: 'top agent' };
          const bottomStep = { ...src.step, title: 'Sub Agent (Bottom)', mainLabel: 'Sub Agent', subLabel: 'bottom agent' };
          addCanvasNode(topStep, cx, cy - VERTICAL_GAP);
          addCanvasNode(bottomStep, cx, cy + VERTICAL_GAP);

          // Connect the top agent's output to the bottom agent's input. The
          // two node ids are the last two in the canvasNodes store.
          const allNodes = canvasNodes.get();

          if (allNodes.length >= 2) {
            const topId = allNodes[allNodes.length - 2].id;
            const bottomId = allNodes[allNodes.length - 1].id;
            addCanvasEdge(topId, bottomId);
          }

          toast.success('Added “Sub Agent System” — 2 agents created');
        } else {
          addCanvasNode(src.step, cx, cy);
          toast.success(`Added “${src.step.title}” to canvas`);
        }
      }

      endDrag();
      panningRef.current = false;
      e.currentTarget.classList.remove(styles.Panning);

      return;
    }

    panningRef.current = false;
    e.currentTarget.classList.remove(styles.Panning);
  };

  // Scale the dot-grid tile size with zoom so the pattern visibly grows/shrinks.
  const tileSize = 24 * zoom;

  /*
   * Whether a trigger→agent connection drag is currently in progress. Drives
   * the [data-connection-drag-active] attribute on the canvas root, which CSS
   * uses to add a glow to every agent card (signalling valid drop targets).
   * Subscribes to connectionSource (NOT connectionPointer) so this component
   * only re-renders at drag start/end, NOT on every pointermove.
   */
  const connActive = useStore(connectionSource) !== null;

  /*
   * Drop preview — where the dragged node WOULD land, in canvas space. Shown
   * as a translucent ghost node glued to the dot-grid (it lives inside the
   * transformed layer, so it pans/zooms with the canvas). Computed by undoing
   * pan + zoom on the live pointer position.
   */
  const surfaceRect = canvasRef.current?.getBoundingClientRect();
  const dropPreview =
    dragP && dragSrc && dragP.overCanvas && surfaceRect
      ? {
          x: (dragP.x - surfaceRect.left - pan.x) / zoom,
          y: (dragP.y - surfaceRect.top - pan.y) / zoom,
          title: dragSrc.step.title,
          icon: dragSrc.step.icon,
          detail: dragSrc.step.detail,
          kind: (dragSrc.step.kind ?? 'action') as
            | 'trigger'
            | 'agent'
            | 'memory'
            | 'llm'
            | 'aitool'
            | 'action'
            | 'sticky',
          // Carry the agent-card label overrides so the dashed drop preview
          // shows the node's own label (e.g. "LLM") while dragging.
          mainLabel: dragSrc.step.mainLabel,
          subLabel: dragSrc.step.subLabel,
          // Carry the initial width/height for resizable kinds (sticky) so the
          // dashed drop preview matches the size the placed node will land at.
          width: dragSrc.step.width,
          height: dragSrc.step.height,
        }
      : null;

  return (
    <div
      ref={canvasRef}
      className={classNames(
        styles.MovableCanvas,
        !gridVisible && styles.MovableCanvasNoGrid,
        dragP?.overCanvas && styles.MovableCanvasDropTarget,
      )}
      style={{
        backgroundPosition: `${pan.x}px ${pan.y}px`,
        backgroundSize: `${tileSize}px ${tileSize}px`,
      }}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
      /*
       * DOUBLE-CLICK on the empty canvas → close the chat panel and bring the
       * nodes library panel back. (Double-clicking a NODE stops propagation so
       * this handler only fires for genuine empty-canvas double-clicks.) This
       * is the "dismiss" affordance the user asked for: "when i double click
       * any where in the canvas the chat panel will goes and again shows the
       * nodes library panel."
       */
      onDoubleClick={() => {
        closeCanvasChat();
      }}
      data-connection-drag-active={connActive ? 'true' : 'false'}
    >
      <CanvasNodesLayer pan={pan} zoom={zoom} dropPreview={dropPreview} />
      <CanvasEmptyHint />
      <ZoomControls
        zoom={zoom}
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFit={fitToCanvas}
      />
    </div>
  );
}

/*
 * RobotAgentIcon — the custom robot SVG used as the AI agent node's icon. A
 * dedicated inline SVG (not a UnoCSS/Phosphor icon-class glyph) so the exact
 * provided artwork renders. Sized in em units (width/height 1em) and uses
 * fill="currentColor", so it inherits font-size + color from its container —
 * the same sizing model as the Phosphor `i-ph:*` icon spans, meaning it drops
 * into the same slots without any layout changes.
 *
 * `className` is forwarded so callers can override size/color via CSS.
 */
function RobotAgentIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 191 178"
      fill="currentColor"
      aria-label="robot for ai"
      role="img"
      width="1em"
      height="1em"
      className={className}
    >
      <path d="M88.2 9.7A16 16 0 0 0 81 29c1.6 3.7 7.4 9 10 9 1.8 0 2 .7 2 5.9v5.8l-4.6.7c-2.6.3-13.1.6-23.4.6H46.3l-6.1 3.1A28 28 0 0 0 24 78.7c0 5.2 0 5.3-3 5.3-4.6 0-8.5 2.5-10.4 6.5-1.5 3-1.7 6.2-1.4 20.1l.3 16.6 3.7 3.4c2.8 2.5 4.7 3.4 7.3 3.4H24v6.8c0 11.2 6.5 21.3 16.9 26.4 4.6 2.3 4.6 2.3 55.1 2.3 57.7 0 54 .5 63.2-9.3a29 29 0 0 0 7.8-20.7v-5.2l4.1-.6c4.7-.6 8.4-3.7 9.8-8.1.6-1.7.9-10.2.7-18.9l-.3-15.9-3-3a13 13 0 0 0-7-3.5l-4-.5-.5-6.2A29 29 0 0 0 150 53.3c-2.9-1.5-7.3-1.9-27.4-2.3l-24-.5-.4-5.7-.4-5.6 4.6-2.1q8.7-3.6 8.6-13.6c0-12-11.9-19.2-22.8-13.8m12.9 4.8c5.6 2.9 6.6 10.9 2 15.5-3.7 3.8-7 4.5-11.5 2.6a10 10 0 0 1-2.4-17.1q5.2-4.3 11.9-1m44.2 42.6a28 28 0 0 1 14 12.3c2.1 3.9 2.2 5.4 2.5 37.6q.3 33.5-.8 38.7a25 25 0 0 1-11.7 16l-4.8 2.8-45.5.3c-31.3.2-47.1 0-50.7-.8a25 25 0 0 1-16-11.7l-2.8-4.8v-37c0-36.3 0-37.1 2.2-41.1 2.8-5.3 9.4-11 14.1-12.2 5.2-1.4 94.6-1.5 99.5-.1M23.5 109v19.5l-2.9-.2c-5.7-.4-6.1-1.7-6.1-19.4 0-15.8.1-16.1 2.4-18.1 1.4-1 3.4-1.8 4.5-1.6 2 .3 2.1.8 2.1 19.8m150.3-18.4c2.1 1.5 2.2 2.1 2.2 17.7 0 8.9-.4 16.7-.8 17.3-1.2 1.8-5.2 3.6-6.8 3-1.1-.4-1.4-4.1-1.4-20.1V89h2.3c1.2 0 3.3.7 4.5 1.6" />
      <path d="M58.4 86.4a11 11 0 0 0-1.9 13.5c1.4 2.8 6.8 6.1 10 6.1 3.1 0 8.1-3 9.8-5.9 2.8-4.8 2.2-9.8-1.7-13.7-2.9-2.9-4.1-3.4-8.1-3.4s-5.2.5-8.1 3.4m61 0c-2.7 2.7-3.4 4.2-3.4 7.2 0 11.9 12.9 16.3 20.6 7.1 2.2-2.6 2.5-3.8 2.1-7.6-.7-6.3-4.9-10.1-11.3-10.1-3.9 0-5.1.5-8 3.4m-45.1 42.3c-2.4.9-1.3 4.2 2.1 6.8a33 33 0 0 0 30.6 4.6c6.4-2.5 12-6.6 12-9 0-3.1-2.7-3.1-6.6 0-3.8 3-11.8 5.9-16.4 5.9s-12.6-2.9-16.5-6c-2.1-1.6-3.8-3-3.9-2.9z" />
    </svg>
  );
}

/*
 * NodeIcon — the single renderer for a node's `icon` string. The string is
 * EITHER a UnoCSS/Phosphor icon class (e.g. 'i-ph:chat-circle') OR a sentinel
 * of the form 'svg:<name>' that maps to an inline SVG component. This lets the
 * agent node use its bespoke robot SVG while every other node keeps using the
 * Phosphor icon font — through one uniform call site.
 *
 * The SVG inherits size (1em) + color (currentColor) from its container, so it
 * drop-in matches the Phosphor span's sizing model.
 */
function NodeIcon({ icon, className }: { icon: string; className?: string }) {
  if (icon === 'svg:robot-agent') {
    return <RobotAgentIcon className={className} />;
  }
  return <span className={classNames(icon, className)} />;
}

/* ──────────────────────────────────────────────────────────────────────────
 *  Connections (edges) between placed nodes
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  Trigger nodes have an OUTPUT port on their right edge; agent nodes have an
 *  INPUT port on their left edge. Dragging from a trigger's output port toward
 *  an agent draws a dashed bezier "pending" curve that follows the cursor; if
 *  the user releases over an agent node, the connection is committed as an edge
 *  (a solid bezier curve drawn between the two ports). Edges persist until the
 *  user clicks them (to delete) or removes one of the endpoint nodes.
 *
 *  Coordinate spaces: ports + edges live in CANVAS space (the same space as
 *  node {x, y}). The CanvasEdgesLayer is rendered INSIDE CanvasNodesLayer, so
 *  it inherits the pan/zoom transform and the curves stay glued to the nodes as
 *  the canvas pans/zooms.
 * ──────────────────────────────────────────────────────────────────────────
 */

/*
 * Card body dimensions — kept here as constants so the port-position helpers +
 * the edges layer agree on exactly where each port sits. These MUST match the
 * SCSS widths/heights for .CanvasNodeTrigger / .CanvasNodeAgent / .TriggerIconArea
 * / .AgentBody (the visual card body, NOT the outer .CanvasNode wrapper which
 * has its own padding for the default 'action' card).
 */
const TRIGGER_CARD_WIDTH = 64;
const TRIGGER_CARD_HEIGHT = 64;
const AGENT_CARD_WIDTH = 168;
const AGENT_CARD_HEIGHT = 64;
/* Action / utility card is a 64×64 SQUARE (same footprint as the trigger
 * node) — used by getOutputPortPosition / getInputPortPosition to place the
 * connector ports on the card's right + left edges. */
const ACTION_CARD_SIZE = 64;
/*
 * Memory nodes render as a CIRCLE inscribed in a 64×64 bounding box (same
 * footprint as the trigger's square). The output port sits at the circle's
 * rightmost point (node.x + 64, vertically centred) — identical geometry to
 * the trigger, just visualised against a round silhouette.
 */
const MEMORY_CARD_SIZE = 64;

/*
 * describeNodeExecution + runCanvasAutomation + RunAutomationOptions live in
 * the canvasNodes STORE now (imported below), not in this file. They were
 * moved to the store so there's a single canonical instance reading the same
 * canvasNodes / canvasEdges atoms the React components subscribe to (avoids the
 * Vite-HMR double-module-instance gotcha where the chat's run could see a
 * stale atom while the canvas rendered the live one).
 */

/** Canvas-space position of a node's OUTPUT port center. */
function getOutputPortPosition(node: CanvasNode, sourcePort?: 'right' | 'bottom'): { x: number; y: number } {
  /*
   * The bottom-port (plus square) is a SEPARATE connector. It must NOT affect
   * or change any other connector — each edge anchors at ITS OWN source port.
   *
   * - For COMMITTED edges: the edge's `sourcePort` field is passed as the
   *   `sourcePort` parameter. Use ONLY that (don't read the global atom — a
   *   pending drag from the bottom port must NOT re-route existing right-port
   *   edges).
   * - For the PENDING DRAG: `sourcePort` is undefined, so fall back to the
   *   global `connectionSource.get()?.portRole` (which reflects the current
   *   drag's port).
   */
  let port: 'right' | 'bottom' | undefined = sourcePort;

  if (!port) {
    // Pending drag — read from the global connection source.
    const connSrc = connectionSource.get();
    port = connSrc?.portRole;
  }

  if (node.kind === 'agent' && port === 'bottom') {
    // The plus square hangs below the THIRD diamond. Its centre is at:
    //   x: 149px from the agent's left edge.
    //   y: 90px below the agent's top edge.
    // Measured empirically from the rendered DOM for pixel-perfect anchoring.
    return { x: node.x + 149, y: node.y + 90 };
  }

  if (node.kind === 'trigger') {
    // Right edge, vertically centred.
    return { x: node.x + TRIGGER_CARD_WIDTH, y: node.y + TRIGGER_CARD_HEIGHT / 2 };
  }

  if (node.kind === 'agent') {
    // Right edge, vertically centred.
    return { x: node.x + AGENT_CARD_WIDTH, y: node.y + AGENT_CARD_HEIGHT / 2 };
  }

  if (node.kind === 'memory' || node.kind === 'llm' || node.kind === 'aitool') {
    // TOP edge, horizontally centred — the memory / llm / aitool node's output
    // port sits at the topmost point of the circle (not the right edge like
    // trigger/agent), so a node placed below an agent connects UPWARD into one
    // of the agent's bottom connectors (diamond for memory/llm, plus-square for
    // aitool).
    return { x: node.x + MEMORY_CARD_SIZE / 2, y: node.y };
  }

  // Sticky notes don't have an output port — they're decorative annotations,
  // not part of the node graph. Fall back to the right edge midpoint anyway so
  // any accidental connection drag from a sticky resolves to a sane point
  // rather than (0,0).
  if (node.kind === 'sticky') {
    return { x: node.x + (node.width ?? STICKY_DEFAULT_WIDTH), y: node.y + (node.height ?? STICKY_DEFAULT_HEIGHT) / 2 };
  }

  // Action / utility nodes ARE 64×64 SQUARES with connector ports on both
  // edges. The output port sits centred on the card's RIGHT edge (mirrors the
  // trigger's output port geometry) so an edge leaving a utility node leaves
  // flush against its right edge.
  return { x: node.x + ACTION_CARD_SIZE, y: node.y + ACTION_CARD_SIZE / 2 };
}

/**
 * Canvas-space position of a node's INPUT port center — the point where an
 * incoming edge's arrowhead lands.
 *
 * Defaults to the left edge, vertically centred (the trigger→agent attachment
 * point). But when the SOURCE is a memory, llm, or aitool node connecting INTO
 * an agent, the edge lands on one of the agent's BOTTOM connectors instead:
 *   - llm    → BOTTOM-LEFT (FIRST) diamond, at left:14px (centre +4px = 18px
 *     from the card's left edge).
 *   - memory → BOTTOM-SECOND (MIDDLE) diamond — the "right inner" diamond,
 *     shifted slightly left to right:36px (centre = 168 - 36 - 4 = 128px from
 *     the card's left edge). The second of three when counted left-to-right.
 *   - aitool → BOTTOM-THIRD PLUS connector — the AgentPlusSquare ("+" chip)
 *     dangling below the third (rightmost) diamond (centre = 149px from the
 *     card's left edge, 90px below the top edge). Distinct from both diamonds
 *     so a tool, a memory node, AND an llm node can all hang off one agent.
 * (Previously memory hit the FIRST diamond and llm hit the SECOND — the two
 * were SWAPPED so the memory node's wire now lands on the middle diamond.)
 * Both diamonds straddle the bottom edge, so their vertical centre is exactly
 * at the card's bottom edge (y = AGENT_CARD_HEIGHT).
 */
function getInputPortPosition(node: CanvasNode, source?: CanvasNode): { x: number; y: number } {
  if (source?.kind === 'aitool' && node.kind === 'agent') {
    // THIRD bottom connector — the AgentPlusSquare (the "+"-shaped interactive
    // chip) that hangs BELOW the third (rightmost) diamond. AI Agent TOOL nodes
    // connect UPWARD into this plus connector (distinct from memory → 2nd
    // diamond and llm → 1st diamond), so all three can hang off the same agent.
    // The plus-square's centre sits 149px from the agent's left edge and 90px
    // below its top edge (measured empirically — it dangles below the card's
    // 64px-tall body via the AgentDiamondTail). Matches the source port used by
    // getOutputPortPosition for an agent's 'bottom' (plus) port.
    return { x: node.x + 149, y: node.y + 90 };
  }

  if (source?.kind === 'memory' && node.kind === 'agent') {
    // Second (middle) bottom diamond — AgentDiamondRightInner, now at right:36px
    // (shifted slightly left of its original right:28px spot). Card width 168px
    // → diamond centre at 168 - 36 - 4 = 128px from the card's left edge.
    return { x: node.x + 128, y: node.y + AGENT_CARD_HEIGHT };
  }

  if (source?.kind === 'llm' && node.kind === 'agent') {
    // First (leftmost) bottom diamond — AgentDiamondLeft at left:14px.
    // Diamond centre = 14 + 4 = 18px from the card's left edge.
    return { x: node.x + 18, y: node.y + AGENT_CARD_HEIGHT };
  }

  // Agent + action/utility nodes have an input port on their left edge today.
  // The geometry (left edge, vertical midpoint) is the same for every kind — the
  // input port always sits on the card's left edge regardless of card width.
  // Memory nodes use the same 64px height as triggers (the circle's bounding
  // box); action nodes use the same 64px height (the square's bounding box).
  const height = node.kind === 'agent' ? AGENT_CARD_HEIGHT : TRIGGER_CARD_HEIGHT;

  return { x: node.x, y: node.y + height / 2 };
}

/*
 * Build a smooth cubic-bezier path between two canvas-space points. The curve
 * is ADAPTIVE: when the connection is roughly horizontal (|dx| >= |dy|) it
 * produces the classic horizontal "S-curve" wire used by every node editor
 * (n8n, React Flow) — control points offset horizontally by ~half the
 * horizontal distance, pulled TOWARD the midpoint. When the connection is
 * roughly vertical (|dy| > |dx|) — e.g. a memory node's top port connecting
 * upward into an agent's bottom diamond — it uses VERTICAL control points
 * instead, with a sign multiplier so the control points always sit BETWEEN the
 * source and target on the Y axis (never beyond them). This keeps the wire
 * leaving the port straight along its axis and arriving at the target straight
 * along its axis, with no outward bow. Both branches clamp the control-point
 * offset to a minimum so very short edges still curve nicely.
 */
function edgePath(sx: number, sy: number, tx: number, ty: number): string {
  const dx = tx - sx;
  const dy = ty - sy;

  if (Math.abs(dy) > Math.abs(dx)) {
    // Vertical-dominant connection: control points offset along the Y axis,
    // pulled toward the midpoint (sign = direction from source to target).
    // Without the sign, an UPWARD connection (ty < sy) would push the first
    // control point BELOW the start and the second ABOVE the end, bowing the
    // curve outward and making the line leave the port going the wrong way.
    const sign = Math.sign(ty - sy);
    const cy = Math.max(40, Math.abs(dy) * 0.5);

    return `M ${sx} ${sy} C ${sx} ${sy + sign * cy}, ${tx} ${ty - sign * cy}, ${tx} ${ty}`;
  }

  // Horizontal-dominant connection: classic horizontal S-curve.
  const cx = Math.max(40, Math.abs(dx) * 0.5);

  return `M ${sx} ${sy} C ${sx + cx} ${sy}, ${tx - cx} ${ty}, ${tx} ${ty}`;
}

/*
 * OutputPort — the interactive connector on a node's right edge. Pressing on
 * it (pointerdown) starts a connection drag: stopPropagation so the node's own
 * pointerdown (which would start a node move) doesn't fire, read the port's
 * rendered screen position via getBoundingClientRect, convert to canvas space
 * using the live canvasTransform, and call startConnection.
 *
 * The ConnectionDragController (rendered at the workbench root) takes over from
 * here — it attaches global pointermove/pointerup listeners that update the
 * live pointer position + hit-test the target, then complete or cancel the
 * connection on pointerup.
 *
 * Reads the port's ACTUAL rendered position at pointerdown time (not the node's
 * stored {x, y}) so it stays correct even if the node was just dragged and the
 * store hasn't been read yet — getBoundingClientRect is always live.
 */
function OutputPort({ nodeId }: { nodeId: string }) {
  const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    // Critical: prevent the node's own pointerdown handler (which starts a node
    // move) from also firing. Without this, pressing the port would both start
    // a connection drag AND start dragging the node — chaos.
    e.stopPropagation();

    const surface = canvasSurfaceEl.get();
    const { panX, panY, zoom } = canvasTransform.get();

    if (!surface) {
      return;
    }

    // Port center in screen space → canvas space (undo pan + zoom).
    const portRect = e.currentTarget.getBoundingClientRect();
    const canvasRect = surface.getBoundingClientRect();
    const portScreenX = portRect.left + portRect.width / 2;
    const portScreenY = portRect.top + portRect.height / 2;
    const canvasX = (portScreenX - canvasRect.left - panX) / zoom;
    const canvasY = (portScreenY - canvasRect.top - panY) / zoom;

    startConnection(nodeId, canvasX, canvasY);
  };

  return (
    <span
      className={classNames(styles.TriggerPort, styles.OutputPort)}
      onPointerDown={onPointerDown}
      data-port-role="output"
      aria-label="Output port — drag to connect"
      title="Drag to connect"
    />
  );
}

/*
 * InputPort — the passive connector on a utility/action node's LEFT edge. A
 * light vertical RECTANGULAR BAR (6px × 19px) that straddles the left edge,
 * matching the agent node's .AgentLeftBar exactly — the user asked for the
 * utility nodes' left connector to be a rectangle, not a circle dot.
 *
 * Purely a visual anchor marking where incoming connections land; it has no
 * pointer handlers (the whole card is the drop target, so the user doesn't have
 * to be precise). The ConnectionDragController hit-tests by walking up to the
 * nearest [data-canvas-node-id] ancestor, so this element just needs to exist
 * visually. Reuses the agent's .AgentLeftBar class so the two stay visually
 * identical automatically.
 */
function InputPort() {
  return (
    <span
      className={styles.AgentLeftBar}
      data-port-role="input"
      aria-hidden
    />
  );
}

/*
 * CanvasEdgesLayer — an SVG layer that renders every committed edge as a solid
 * bezier curve between the source's output port and the target's input port,
 * plus (while a connection drag is in progress) a dashed "pending" bezier from
 * the source port to the live cursor position.
 *
 * Rendered INSIDE CanvasNodesLayer (which applies the pan/zoom transform), so
 * all path coordinates are in canvas space and the curves stay glued to the
 * nodes as the canvas pans/zooms. The SVG itself has overflow:visible + a 1×1
 * viewport anchored at (0,0); paths render outside that box freely.
 *
 * Each committed edge renders TWO paths:
 *   - a wide transparent "hit area" (stroke-width ~16, pointer-events:stroke)
 *     so the edge is easy to click for deletion,
 *   - a thin visible stroke (stroke-width 2) drawn on top.
 *
 * Clicking the hit area removes the edge (with a toast). The hit area is
 * disabled (pointer-events:none) while a connection drag is in progress so it
 * never interferes with hit-testing the node beneath.
 *
 * Performance: subscribes to canvasEdges (re-renders on edge add/remove),
 * canvasNodes (re-renders on node move — necessary so curves track moved
 * endpoints), connectionSource (re-renders at drag start/end), and
 * connectionPointer (re-renders every pointermove — but this is the ONLY
 * component that subscribes to connectionPointer, so per-frame work stays
 * confined to this lightweight SVG).
 */
function CanvasEdgesLayer() {
  const nodes = useStore(canvasNodes);
  const edges = useStore(canvasEdges);
  const connSrc = useStore(connectionSource);
  const connPtr = useStore(connectionPointer);

  // Build a id→node lookup so each edge can resolve its endpoints in O(1).
  const nodeById = new Map<string, CanvasNode>();

  for (const n of nodes) {
    nodeById.set(n.id, n);
  }

  // Pending connection: source node + live pointer (canvas space).
  const pendingSource = connSrc ? nodeById.get(connSrc.sourceId) : null;
  const pendingPath =
    pendingSource && connPtr
      ? (() => {
          const sp = getOutputPortPosition(pendingSource);

          return edgePath(sp.x, sp.y, connPtr.x, connPtr.y);
        })()
      : null;

  return (
    <svg
      className={classNames(styles.CanvasEdgesLayer, connSrc && styles.CanvasEdgesLayerDragging)}
      aria-hidden
    >
      {/*
        Arrowhead marker placed at the END of every committed edge — the target
        end that meets the agent node's input port — so each connection visibly
        "points into" the agent node. The fill is hardcoded to the same gray as
        the .EdgePath stroke (#9ca3af) rather than context-stroke, because
        context-stroke has spotty cross-browser support and would render the
        arrow invisibly (default black on a dark canvas) where unsupported.
        markerUnits="userSpaceOnUse" keeps the head a fixed size in canvas
        space (it scales with zoom like the rest of the graph). refX=10 aligns
        the arrow's TIP with the path endpoint (the agent's input port) so the
        arrowhead sits flush against the port and points into the agent card.
        markerWidth/Height=12 (lightly reduced further from 14) keeps the head
        visible against the dark canvas while feeling a touch lighter — viewBox
        stays 10×10 so the triangle geometry is unchanged, only its rendered
        scale shrinks slightly.
      */}
      <defs>
        <marker
          id="edge-arrow"
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="12"
          markerHeight="12"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af" />
        </marker>
      </defs>
      {edges.map((edge) => {
        const src = nodeById.get(edge.sourceId);
        const tgt = nodeById.get(edge.targetId);

        // Skip dangling edges (an endpoint was removed). removeCanvasNode
        // already cleans these up, but this guards against any race.
        if (!src || !tgt) {
          return null;
        }

        const sp = getOutputPortPosition(src, edge.sourcePort);
        // Pass the source so getInputPortPosition can route the edge to the
        // agent's bottom-left diamond when the source is a memory node.
        const tp = getInputPortPosition(tgt, src);
        const d = edgePath(sp.x, sp.y, tp.x, tp.y);

        // Memory + LLM →agent edges connect cleanly to the centre of an agent's
        // bottom diamond with NO arrowhead (per the user's request: the line
        // should just meet the diamond's centre, not carry an arrow).
        // Trigger→agent edges keep the arrowhead that points into the agent.
        const showArrow = src.kind !== 'memory' && src.kind !== 'llm';

        return (
          <g key={edge.id} className={styles.EdgeGroup}>
            {/* Wide transparent hit area — easy to click for deletion. */}
            <path
              className={styles.EdgeHitArea}
              d={d}
              onClick={() => {
                removeCanvasEdge(edge.id);
                toast.info('Connection removed');
              }}
              onDoubleClick={(e) => {
                // Feature #9: Double-click to label the connection.
                e.stopPropagation();
                const newLabel = window.prompt('Connection label:', edge.label ?? '');
                if (newLabel !== null) {
                  setEdgeLabel(edge.id, newLabel);
                }
              }}
            >
              <title>Click to remove · Double-click to label</title>
            </path>
            {/* Visible thin stroke drawn on top. */}
            <path className={styles.EdgePath} d={d} markerEnd={showArrow ? 'url(#edge-arrow)' : undefined} />

            {/* Feature #9: Connection label (if set). */}
            {edge.label && (
              <text
                x={(sp.x + tp.x) / 2}
                y={(sp.y + tp.y) / 2 - 8}
                textAnchor="middle"
                className={styles.EdgeLabel}
              >
                {edge.label}
              </text>
            )}
          </g>
        );
      })}
      {pendingPath && <path className={classNames(styles.EdgePath, styles.EdgePathPending)} d={pendingPath} />}
    </svg>
  );
}

/*
 * ConnectionDragController — owns the GLOBAL pointer listeners that track a
 * connection drag (started by pressing a node's OutputPort). It has no visual
 * output.
 *
 * Why global listeners (not setPointerCapture on the port)?
 *  - If the port captured the pointer, pointermove would fire on the PORT, and
 *    document.elementFromPoint (used for hit-testing the drop target) would
 *    still work — but pointerup would also fire on the port, never on the
 *    target node. By NOT capturing, pointermove/pointerup fire on whatever is
 *    under the cursor, and we use document.elementFromPoint for hit-testing
 *    (which is independent of pointer capture anyway).
 *  - This mirrors the DragController pattern for library→canvas drags.
 *
 * Listeners are attached only while a connection drag is active
 * (connectionSource !== null) to avoid overhead when the user is just clicking
 * around. Reads the live canvasTransform + canvasSurfaceEl via .get() (non-
 * reactive) so it always has the current pan/zoom without re-rendering on every
 * pan/zoom tick.
 *
 * Hit-testing: document.elementFromPoint → walk up to the nearest
 * [data-canvas-node-id] ancestor → check [data-canvas-node-kind] === 'agent' →
 * exclude the source node itself (no self-loops). Sets overTargetId on the
 * connectionPointer store; the pointerup handler reads it via endConnection()
 * which completes the edge if a target was hovered, else cancels.
 */
function ConnectionDragController() {
  const source = useStore(connectionSource);

  useEffect(() => {
    if (!source) {
      return undefined;
    }

    // While dragging a connection, prevent text selection + show a crosshair
    // cursor app-wide so the user knows they're in "wire drawing" mode.
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'crosshair';

    const onMove = (e: PointerEvent) => {
      const surface = canvasSurfaceEl.get();
      const { panX, panY, zoom } = canvasTransform.get();

      if (!surface) {
        return;
      }

      const r = surface.getBoundingClientRect();

      // Screen → canvas space.
      const canvasX = (e.clientX - r.left - panX) / zoom;
      const canvasY = (e.clientY - r.top - panY) / zoom;

      // Hit-test: what canvas node is under the cursor right now?
      let overTargetId: string | null = null;
      const el = document.elementFromPoint(e.clientX, e.clientY);

      if (el) {
        const nodeEl = (el as HTMLElement).closest('[data-canvas-node-id]') as HTMLElement | null;

        if (nodeEl) {
          const id = nodeEl.getAttribute('data-canvas-node-id');
          const kind = nodeEl.getAttribute('data-canvas-node-kind');

          // AGENT + ACTION (utility) nodes are valid drop targets. Originally
          // only agents were connectable (per an earlier request: "make all
          // trigger nodes connectable to the agent node"). The user later asked
          // for connector ports on every utility node too, so utility nodes now
          // participate in the node graph as both a connection SOURCE (their
          // right-edge OutputPort) and a connection TARGET (the whole card).
          // Reject self-loops (can't connect a node to itself).
          //
          // EXCEPTION: an AI Agent TOOL (kind 'aitool') may ONLY connect to an
          // AGENT — its wire routes upward into the agent's bottom PLUS
          // connector (getInputPortPosition handles the routing). Wiring an
          // aitool into a utility/action node is rejected so tools stay
          // semantically attached to the agent they serve.
          if (id && id !== source.sourceId) {
            const sourceNode = canvasNodes.get().find((n) => n.id === source.sourceId);
            const sourceIsTool = sourceNode?.kind === 'aitool';

            if (sourceIsTool) {
              // Tools → agent ONLY.
              if (kind === 'agent') {
                overTargetId = id;
              }
            } else if (kind === 'agent' || kind === 'action') {
              overTargetId = id;
            }
          }
        }
      }

      updateConnectionPointer(canvasX, canvasY, overTargetId);
    };

    const onUp = () => {
      const result = endConnection();

      if (result.completed) {
        // The target may now be an agent OR a utility/action node (both are
        // valid drop targets), and the source may be a trigger, memory, llm,
        // or another utility node, so use a fully source/target-agnostic
        // message rather than hard-coding "Connected to agent".
        toast.success('Nodes connected');
      }
      // else: cancelled (released over empty canvas or a non-agent node) —
      // silently discard; no toast needed for a cancelled drag.
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);

    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [source !== null]); // re-run only when a connection drag starts or stops

  return null;
}

/*
 * CanvasKeyboardShortcuts — a headless component (renders nothing) that owns
 * the GLOBAL keydown listener for the canvas node clipboard + selection ops:
 *   - Ctrl/Cmd+C  → copy selected nodes
 *   - Ctrl/Cmd+X  → cut selected nodes
 *   - Ctrl/Cmd+V  → paste clipboard nodes
 *   - Ctrl/Cmd+D  → duplicate selected nodes (prevents the browser's bookmark
 *                   dialog via preventDefault)
 *   - Delete / Backspace → remove selected nodes
 *
 * Mounted once inside the Workbench (next to ConnectionDragController). The
 * listener is gated by `selectedIds.length > 0` for most ops so the canvas
 * doesn't swallow Delete/Backspace while the user is doing nothing with nodes;
 * Paste is always available once the clipboard has something.
 *
 * Ignores keydown when the user is typing in an input/textarea (the canvas's
 * sticky-note title input + textarea, the chat box, etc.) so the shortcuts
 * never clobber text entry — UNLESS a Ctrl/Cmd modifier is held (so Ctrl+C
 * still works to copy text in an input).
 */
function CanvasKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Typing in an input/textarea? Bail unless a Ctrl/Cmd modifier is held
      // (so copy/cut/paste/duplicate still fire for text-editing contexts, and
      // Delete/Backspace just edits text normally instead of removing nodes).
      const ae = document.activeElement;
      const inEditable =
        ae &&
        (ae.tagName === 'INPUT' ||
          ae.tagName === 'TEXTAREA' ||
          (ae as HTMLElement).isContentEditable);

      if (inEditable && !e.ctrlKey && !e.metaKey) {
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Copy: Ctrl/Cmd+C
      if (mod && key === 'c' && !e.shiftKey && !e.altKey) {
        const ids = selectedCanvasIds.get();

        if (ids.length > 0) {
          e.preventDefault();
          copySelectedCanvasNodes();
          toast.success(`Copied ${ids.length} node${ids.length === 1 ? '' : 's'}`);
        }

        return;
      }

      // Cut: Ctrl/Cmd+X
      if (mod && key === 'x' && !e.shiftKey && !e.altKey) {
        const ids = selectedCanvasIds.get();

        if (ids.length > 0) {
          e.preventDefault();
          cutSelectedCanvasNodes();
          toast.success(`Cut ${ids.length} node${ids.length === 1 ? '' : 's'}`);
        }

        return;
      }

      // Paste: Ctrl/Cmd+V
      if (mod && key === 'v' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        pasteCanvasNodes();
        return;
      }

      // Duplicate: Ctrl/Cmd+D (prevent the browser's bookmark-this-page dialog)
      if (mod && key === 'd' && !e.shiftKey && !e.altKey) {
        const ids = selectedCanvasIds.get();

        if (ids.length > 0) {
          e.preventDefault();
          duplicateSelectedCanvasNodes();
          toast.success(`Duplicated ${ids.length} node${ids.length === 1 ? '' : 's'}`);
        }

        return;
      }

      // Delete / Backspace: remove selected nodes
      if ((key === 'delete' || key === 'backspace') && !mod && !e.shiftKey && !e.altKey) {
        const ids = selectedCanvasIds.get();

        if (ids.length > 0) {
          e.preventDefault();
          deleteSelectedCanvasNodes();
          toast.info(`Removed ${ids.length} node${ids.length === 1 ? '' : 's'}`);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return null;
}

/*
 * TriggerNodeBody — the inner visual of a trigger/agent node card, shared
 * between the placed node (CanvasNodeItem) and the drop preview so both render
 * the exact same distinctive design.
 *
 * Design: a single-colour DARK rounded card. The whole card is one solid dark
 * background with a single uniform border colour (no two-tone split). The icon
 * is centred inside the card body. The title text sits OUTSIDE the card, below
 * it, so the card itself is a pure icon "chip" and the label is a separate
 * caption beneath. A circular output port sits centred on the right edge.
 *
 * The `kind` prop controls ONE thing: whether the red lightning-bolt badge
 * straddles the left edge. Only 'trigger' nodes get the bolt (the bolt means
 * "instant trigger"); 'agent' nodes skip it but otherwise share the exact same
 * dark square + outline + port + caption layout, so agents have the same height
 * and outline as triggers.
 *
 * Purely presentational — no pointer handlers. The parent wraps it (placed
 * nodes get drag handlers + a delete button; the preview gets a dashed ring).
 */
function TriggerNodeBody({
  kind,
  icon,
  title,
  nodeId,
}: {
  kind: 'trigger' | 'agent';
  icon: string;
  title: string;
  /**
   * The placed canvas-node id — passed through to OutputPort so it can call
   * startConnection(nodeId, ...) on pointerdown. Required when this body
   * represents a PLACED node (CanvasNodeItem); omitted (undefined) for the
   * drop preview, which renders the port decoratively (no pointer handlers).
   */
  nodeId?: string;
}) {
  return (
    <>
      {/* Red "instant trigger" bolt badge — ONLY on trigger nodes. Agent nodes
           share the card chrome but don't carry the trigger badge. */}
      {kind === 'trigger' && (
        <span className={styles.TriggerBolt} aria-hidden>
          <span className="i-ph:lightning-fill" />
        </span>
      )}

      {/* Dark icon-only card body — single colour, single border. */}
      <div className={styles.TriggerIconArea}>
        <span className={icon} />
      </div>

      {/*
        * Output connector port, centred on the card's right edge. On a PLACED
        * node (nodeId provided) this is the interactive OutputPort — press +
        * drag to start a connection. On the drop preview (no nodeId) it renders
        * as a plain decorative span (no pointer handlers, so the preview never
        * starts a connection drag).
        */}
      {nodeId ? (
        <OutputPort nodeId={nodeId} />
      ) : (
        <span className={styles.TriggerPort} aria-hidden />
      )}

      {/* Title caption — OUTSIDE the card, below it. */}
      <div className={styles.TriggerTitle}>{title}</div>
    </>
  );
}

/*
 * AgentNodeBody — the inner visual of an AGENT node card. DISTINCT from the
 * trigger body: instead of a centred icon chip with a caption below, the agent
 * card is a HORIZONTAL layout — icon on the LEFT, a two-line text block on the
 * RIGHT (main label "AI Agent" + subtitle "tool agent"). The text lives INSIDE
 * the card (not below it as a caption).
 *
 * Shares with the trigger: the same dark #171717 body, the same permanent
 * accent outline, and the output connector port on the right edge. Does NOT
 * carry the red lightning-bolt badge (that's trigger-only).
 *
 * The output port is INTERACTIVE when placed (nodeId provided) — press + drag
 * to start a connection to another node (agent → agent or agent → utility).
 * The drop preview (no nodeId) renders the port decoratively.
 */
function AgentNodeBody({
  icon,
  nodeId,
  mainLabel,
  subLabel,
}: {
  icon: string;
  nodeId?: string;
  /**
   * Optional override for the card's primary label. Defaults to "AI Agent" so
   * the Autonomous Agent card keeps its established appearance. Agent-section
   * nodes that represent a distinct concept (e.g. the LLM node) pass their own
   * label so each agent-variant card reads as its own thing.
   */
  mainLabel?: string;
  /** Optional subtitle override (defaults to "tool agent"). */
  subLabel?: string;
}) {
  return (
    <>
      {/* Light vertical bar straddling the LEFT edge, vertically centred —
           the agent node's left-side accent marker (analogous to the trigger's
           red bolt, but a light vertical rectangle instead of a red circle).
           Positioned absolutely relative to the .CanvasNodeAgent wrapper, so it
           sits half-inside / half-outside the card's left edge. */}
      <span className={styles.AgentLeftBar} aria-hidden />

      {/* Horizontal body: icon on the left, text block on the right.

           NOTE: the agent node no longer renders a circular input-port dot on
           its left edge — only the AgentLeftBar vertical accent remains. The
           connection drop target is still the WHOLE card (the
           ConnectionDragController hit-tests via [data-canvas-node-id], not via
           any port element), and the edge's landing point is still the left
           edge midpoint (computed from the node's {x, y} in getInputPortPosition),
           so removing the dot does not affect connection behaviour — the
           arrowhead still lands flush against the card's left edge. */}
      <div className={styles.AgentBody}>
        <div className={styles.AgentIconArea}>
          <NodeIcon icon={icon} />
        </div>
        <div className={styles.AgentTextBlock}>
          <span className={styles.AgentMainLabel}>{mainLabel ?? 'AI Agent'}</span>
          <span className={styles.AgentSubLabel}>{subLabel ?? 'tool agent'}</span>
        </div>
      </div>

      {/*
        * Output connector port, centred on the card's right edge. On a PLACED
        * agent node (nodeId provided) this is the INTERACTIVE OutputPort —
        * press + drag to start a connection to another node (an agent's output
        * can wire into another agent or a utility/action node, just like the
        * trigger's output port). On the drop preview (no nodeId) it renders as
        * a plain decorative span (no pointer handlers, so the preview never
        * starts a connection drag). Same conditional pattern the trigger node
        * uses for its output port.
        */}
      {nodeId ? (
        <OutputPort nodeId={nodeId} />
      ) : (
        <span className={styles.TriggerPort} aria-hidden />
      )}

      {/*
        * Three decorative diamonds straddling the card's BOTTOM edge: ONE on
        * the left side, TWO on the right side. Mirrors the AgentLeftBar
        * treatment (light fill + dark ring) so they read as accent markers
        * against the dark card body. Each diamond is a small square rotated
        * 45°, positioned absolutely relative to the .CanvasNodeAgent wrapper
        * so it sits half-inside / half-outside the card's bottom edge.
        */}
      <div className={styles.AgentBottomDiamonds}>
        <span className={classNames(styles.AgentDiamond, styles.AgentDiamondLeft)} aria-hidden />
        <span className={classNames(styles.AgentDiamond, styles.AgentDiamondRightOuter)} aria-hidden />
        <span className={classNames(styles.AgentDiamond, styles.AgentDiamondRightInner)} aria-hidden />
        {/*
          * The tail line + plus-square hanging off the THIRD (rightmost) diamond.
          * On a PLACED agent (nodeId provided), the plus-square is an
          * INTERACTIVE output port — press + drag from it to start a connection
          * to another node (same behaviour as the right-edge OutputPort). On the
          * drop preview (no nodeId), it renders as a plain decorative span.
          * This makes the agent's bottom "+" connector fully workable: the user
          * can wire nodes to/from it like every other port.
          */}
        <span className={styles.AgentDiamondTail} aria-hidden />
        {nodeId ? (
          <span
            className={classNames(styles.AgentPlusSquare, styles.AgentPlusSquareInteractive)}
            onPointerDown={(e) => {
              // Same logic as OutputPort's onPointerDown: stop the node drag,
              // read the port's screen position, convert to canvas space, +
              // start a connection drag.
              e.stopPropagation();
              const surface = canvasSurfaceEl.get();
              const { panX, panY, zoom } = canvasTransform.get();

              if (!surface) {
                return;
              }

              const portRect = e.currentTarget.getBoundingClientRect();
              const canvasRect = surface.getBoundingClientRect();
              const portScreenX = portRect.left + portRect.width / 2;
              const portScreenY = portRect.top + portRect.height / 2;
              const canvasX = (portScreenX - canvasRect.left - panX) / zoom;
              const canvasY = (portScreenY - canvasRect.top - panY) / zoom;
              startConnection(nodeId, canvasX, canvasY, 'bottom');
            }}
            data-port-role="output"
            aria-label="Agent bottom port — drag to connect"
            title="Drag to connect"
          >
            <span className="i-ph:plus" />
          </span>
        ) : (
          <span className={styles.AgentPlusSquare} aria-hidden>
            <span className="i-ph:plus" />
          </span>
        )}
      </div>
    </>
  );
}

/*
 * MemoryNodeBody — the inner visual of a MEMORY node card. DISTINCT from both
 * the trigger and the agent: the card is a perfect CIRCLE (border-radius:50%
 * on a 64×64 box) with the memory/storage icon dead-centre. Shares with the
 * trigger: the dark #171717 body, the permanent accent outline, and the title
 * caption rendered OUTSIDE / below the card. DISTINCT port placement: the
 * output connector sits on the circle's TOP edge (not the right edge like
 * trigger/agent), so a memory node placed below an agent connects UPWARD into
 * the agent's bottom-left diamond. Does NOT carry the red bolt (that's
 * trigger-only) and is NOT a connection drop target (only agents are).
 *
 * Purely presentational — the output port's pointer handler is the only
 * interactive piece, and only when `nodeId` is provided (placed node). On the
 * drop preview (no nodeId) the port renders as a plain decorative span.
 */
function MemoryNodeBody({ icon, title, nodeId }: { icon: string; title: string; nodeId?: string }) {
  return (
    <>
      {/* Circular dark icon-only card body — the memory icon sits dead-centre. */}
      <div className={styles.MemoryIconArea}>
        <span className={icon} />
      </div>

      {/*
        * Output connector port, centred on the circle's TOP edge (the topmost
        * point of the 64px circle). The SCSS (.CanvasNodeMemory .TriggerPort)
        * repositions the port from the default right edge to the top, so a
        * memory node placed BELOW an agent connects upward into the agent's
        * bottom-left diamond. On a PLACED node (nodeId provided) this is the
        * interactive OutputPort — press + drag to start a connection. On the
        * drop preview (no nodeId) it renders as a plain decorative span.
        */}
      {nodeId ? <OutputPort nodeId={nodeId} /> : <span className={styles.TriggerPort} aria-hidden />}

      {/* Title caption — OUTSIDE the circle, below it. */}
      <div className={styles.TriggerTitle}>{title}</div>
    </>
  );
}

/*
 * StickyNodeBody — the inner visual of a STICKY NOTE node card. DISTINCT from
 * every other kind: sharp corners (border-radius:0), warm yellow paper colour,
 * dark ink text, and a fully-editable textarea that fills the card body. A
 * small triangular "dog-ear" fold sits in the bottom-right corner as a visual
 * affordance; the resize handle overlays the bottom-right edge so the user can
 * drag it to grow / shrink the note. The header strip across the top carries
 * the note's title (defaulting to "Sticky Note") in a slightly darker band so
 * the user can tell notes apart when several are on the canvas.
 *
 * Props:
 *   - title: rendered in the header strip (not editable today — the body text
 *     is the editable surface). Distinct notes can share the same title.
 *   - width / height: passed through so the textarea + header strip can size
 *     themselves to the card's actual dimensions (the parent motion.div sets
 *     these on its style; the body just fills 100% / 100%).
 *   - nodeId: when provided, the textarea is live and writes back to the store
 *     on every keystroke. When omitted (drop preview), the textarea is
 *     rendered read-only + dimmed so the preview reads as a placeholder.
 *   - initialText: the text payload to seed the textarea with (read from the
 *     placed node's `text` field). Only meaningful when nodeId is set.
 */
function StickyNodeBody({
  title,
  nodeId,
  initialText,
  color,
}: {
  title: string;
  nodeId?: string;
  initialText?: string;
  color?: string;
}) {
  /*
   * Local mirror of the text payload so the textarea stays responsive to
   * typing without round-tripping through the store on every keystroke (the
   * store update fires too, but React batches + the textarea's own state keeps
   * input latency at zero). On store-driven re-renders (e.g. canvas pan) the
   * useEffect syncs local state back to the persisted value when the store
   * value changes from the outside (undo, etc.) — but only when it actually
   * differs, to avoid clobbering the user's in-progress typing.
   */
  const [text, setText] = useState(initialText ?? '');

  /*
   * Local mirror of the editable header title — same pattern as `text` above.
   * Kept in local state so typing is lag-free; commits to the store on each
   * change so the new title survives canvas pan/zoom + parent re-renders.
   */
  const [titleText, setTitleText] = useState(title);

  useEffect(() => {
    if (nodeId && initialText !== undefined && initialText !== text) {
      setText(initialText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText, nodeId]);

  useEffect(() => {
    setTitleText(title);
  }, [title]);

  // Resolve the active colour palette once per render (cheap).
  const palette = getStickyColor(color);

  /*
   * Stop pointer-down bubbling into the parent CanvasNodeItem drag handler.
   *
   * The HEADER itself intentionally does NOT stop propagation — pressing on the
   * header bubbles up to CanvasNodeItem.onPointerDown, which starts a node
   * drag so the whole sticky note can be MOVED around the canvas like every
   * other node kind. Only the interactive children of the header (the title
   * input and the colour circles) stop propagation, so interacting with them
   * never kicks off a drag. The textarea also stops propagation so clicking in
   * to type / select text doesn't pan the canvas.
   */
  const stop = (e: React.PointerEvent | React.MouseEvent | React.KeyboardEvent) => e.stopPropagation();

  return (
    <>
      {/*
        * Header strip — DRAG HANDLE for the whole note (does not stop
        * propagation, so pressing + dragging here moves the note). Carries the
        * editable title on the LEFT and the colour picker circles on the RIGHT.
        * The header's background is tinted by the active palette via inline
        * style so changing colour re-tints the strip instantly.
        */}
      <div
        className={styles.StickyHeader}
        style={{ backgroundColor: palette.header, borderBottomColor: palette.border }}
      >
        <span className={styles.StickyHeaderIcon} aria-hidden style={{ color: palette.border }}>
          <span className="i-ph:note" />
        </span>
        {/*
          * Editable title (left side of the header). An inline text input that
          * looks like a label but becomes editable on focus. pointer-down is
          * stopped so clicking into the input to edit never starts a drag.
          */}
        <input
          className={styles.StickyHeaderTitle}
          value={titleText}
          placeholder="Sticky Note"
          spellCheck={false}
          readOnly={!nodeId}
          onPointerDown={stop}
          onPointerMove={stop}
          onKeyDown={stop}
          onChange={(e) => {
            setTitleText(e.target.value);

            if (nodeId) {
              setCanvasNodeTitle(nodeId, e.target.value);
            }
          }}
          aria-label="Sticky note title"
        />
        {/*
          * Colour picker circles (right side of the header). One button per
          * palette entry; clicking sets the note's colour via setCanvasNodeColor.
          * The active colour gets a darker ring so the user can see which colour
          * is selected. pointer-down is stopped so clicking a circle never
          * starts a drag.
          */}
        <div className={styles.StickyColorPicker} onPointerDown={stop} onPointerMove={stop} role="group" aria-label="Sticky note colour">
          {STICKY_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              className={classNames(
                styles.StickyColorDot,
                c.key === palette.key ? styles.StickyColorDotActive : null,
              )}
              style={{ backgroundColor: c.paper, borderColor: c.border }}
              onPointerDown={stop}
              onClick={(e) => {
                e.stopPropagation();

                if (nodeId) {
                  setCanvasNodeColor(nodeId, c.key);
                }
              }}
              title={c.label}
              aria-label={`Set colour to ${c.label}`}
              aria-pressed={c.key === palette.key}
            />
          ))}
        </div>
      </div>
      <textarea
        className={styles.StickyTextarea}
        value={text}
        placeholder="Type your note…"
        spellCheck={false}
        readOnly={!nodeId}
        onPointerDown={stop}
        onPointerMove={stop}
        onKeyDown={stop}
        onChange={(e) => {
          setText(e.target.value);

          if (nodeId) {
            setCanvasNodeText(nodeId, e.target.value);
          }
        }}
      />
      {/*
        * Decorative dog-ear fold in the bottom-right corner — a small darker
        * triangle that gives the note its classic "sticky" silhouette. Tinted
        * by the active palette's border shade so it matches the chosen colour.
        * Sits UNDER the resize handle (lower z-index) so the handle is always
        * grabbable. aria-hidden + pointer-events:none so it never intercepts
        * interaction.
        */}
      <span className={styles.StickyDogEar} aria-hidden style={{ borderBottomColor: palette.border }} />
    </>
  );
}

/*
 * CanvasNodesLayer — the transformed container that holds every node placed on
 * the canvas. Translated by pan and scaled by zoom (origin 0 0) so the nodes
 * stay glued to the dot-grid as the canvas is panned/zoomed.
 *
 * The layer itself has `pointer-events: none` so clicks on empty canvas pass
 * through to the background (for panning); each node re-enables
 * `pointer-events: auto` so it can be grabbed and moved.
 */
function CanvasNodesLayer({
  pan,
  zoom,
  dropPreview,
}: {
  pan: { x: number; y: number };
  zoom: number;
  dropPreview: {
    x: number;
    y: number;
    title: string;
    icon: string;
    detail?: string;
    kind: 'trigger' | 'agent' | 'memory' | 'llm' | 'aitool' | 'action' | 'sticky';
    mainLabel?: string;
    subLabel?: string;
    width?: number;
    height?: number;
  } | null;
}) {
  const nodes = useStore(canvasNodes);

  return (
    <div
      className={styles.CanvasNodesLayer}
      style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
    >
      {/*
        * Edges render BEHIND the nodes (drawn first, lower z-order) so the
        * curve endpoints visually tuck under the port circles rather than
        * crossing over them. Lives inside the transformed layer so paths in
        * canvas space stay glued to the nodes during pan/zoom.
        */}
      <CanvasEdgesLayer />
      <AnimatePresence>
        {nodes.map((node) => (
          <CanvasNodeItem key={node.id} node={node} zoom={zoom} />
        ))}
      </AnimatePresence>
      {dropPreview && (
        <div
          className={classNames(
            styles.CanvasNodePreview,
            dropPreview.kind === 'trigger'
              ? styles.CanvasNodePreviewTrigger
              : dropPreview.kind === 'agent'
                ? styles.CanvasNodePreviewAgent
                : dropPreview.kind === 'memory'
                  ? styles.CanvasNodePreviewMemory
                  : dropPreview.kind === 'llm'
                    ? styles.CanvasNodePreviewLlm
                    : dropPreview.kind === 'aitool'
                      ? styles.CanvasNodePreviewMemory
                      : dropPreview.kind === 'sticky'
                        ? styles.CanvasNodePreviewSticky
                        : styles.CanvasNodePreviewAction,
          )}
          style={{
            left: dropPreview.x,
            top: dropPreview.y,
            ...(dropPreview.kind === 'sticky'
              ? {
                  width: dropPreview.width ?? STICKY_DEFAULT_WIDTH,
                  height: dropPreview.height ?? STICKY_DEFAULT_HEIGHT,
                }
              : null),
          }}
          aria-hidden
        >
          {dropPreview.kind === 'trigger' ? (
            <TriggerNodeBody kind="trigger" icon={dropPreview.icon} title={dropPreview.title} />
          ) : dropPreview.kind === 'agent' ? (
            <AgentNodeBody
              icon={dropPreview.icon}
              mainLabel={dropPreview.mainLabel}
              subLabel={dropPreview.subLabel}
            />
          ) : dropPreview.kind === 'memory' ? (
            <MemoryNodeBody icon={dropPreview.icon} title={dropPreview.title} />
          ) : dropPreview.kind === 'llm' ? (
            <MemoryNodeBody icon={dropPreview.icon} title={dropPreview.title} />
          ) : dropPreview.kind === 'aitool' ? (
            <MemoryNodeBody icon={dropPreview.icon} title={dropPreview.title} />
          ) : dropPreview.kind === 'sticky' ? (
            <StickyNodeBody title={dropPreview.title} />
          ) : (
            // Drop-preview action/utility card — same square + ports layout as
            // the placed card, but the ports are decorative (no nodeId so the
            // OutputPort can't start a drag). The preview is a transient ghost
            // so the ports just need to read visually consistent with the
            // placed node.
            <>
              <InputPort />
              <div className={styles.ActionIconArea}>
                <span className={dropPreview.icon} />
              </div>
              <div className={styles.ActionTitle}>{dropPreview.title}</div>
              <span className={styles.TriggerPort} aria-hidden />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/*
 * CanvasNodeItem — a single node instance on the canvas. Draggable: pointerdown
 * captures the pointer to this node, then pointermove translates the screen
 * delta into canvas space (dividing by zoom) and updates the node's position.
 *
 * `stopPropagation` on pointerdown prevents the canvas background from starting
 * a pan. A small × button in the corner removes the node; its pointerdown is
 * also stopped so it never initiates a drag.
 */
function CanvasNodeItem({ node, zoom }: { node: CanvasNode; zoom: number }) {
  const draggingRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0, nx: 0, ny: 0 });

  /*
   * Selection subscription — re-renders this node card when its membership in
   * the selection set changes, so the selection ring (CanvasNodeSelected
   * class) appears/disappears instantly on Shift+click. Subscribing per-node
   * (rather than in the layer) keeps the per-frame cost minimal: only the
   * nodes whose selection state actually changed re-render.
   */
  const selectedIds = useStore(selectedCanvasIds);
  const isSelected = selectedIds.includes(node.id);

  /*
   * Running subscription — re-renders this node when it enters/leaves the
   * running set (during a Run-button automation walk). While in the set, the
   * node gets a CanvasNodeRunning class that pulses it (an animated accent
   * ring + a bright fill wash) so the user can SEE the automation flowing
   * through the graph in execution order.
   */
  const runningIds = useStore(runningCanvasNodeIds);
  const isRunningNode = runningIds.includes(node.id);

  /*
   * Resize state — only used by 'sticky' nodes (the only resizable kind).
   * resizingRef gates pointermove so a resize drag doesn't also trigger a node
   * move; resizeStartRef holds the pointer's initial screen position + the
   * node's initial canvas-space width/height so the delta computation has a
   * stable baseline to subtract from.
   */
  const resizingRef = useRef(false);
  const resizeStartRef = useRef({ px: 0, py: 0, w: 0, h: 0 });
  /*
   * Multi-selection drag baseline — lazily captured on the first pointermove
   * of a drag when this node is part of a multi-selection. Maps each selected
   * node id → its pre-drag {x, y}. Null when no multi-drag is in progress.
   * Cleared on pointerup so the next drag snapshots fresh positions.
   */
  const multiSelStartRef = useRef<Map<string, { x: number; y: number }> | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();

    /*
     * SELECTION on pointerdown (before dragging).
     *   - Shift+click → TOGGLE this node in the selection (multi-select).
     *     Does NOT start a drag (the user is curating a selection set, not
     *     moving the node). Return early so the move handler stays dormant.
     *   - Plain click (no Shift) → if this node isn't already the sole
     *     selection, make it so (replaces any multi-selection with just this
     *     node). If it IS already the sole selection, leave the selection
     *     alone (so the user can drag a multi-selection by grabbing any one of
     *     them without collapsing the selection first). Then fall through to
     *     start the drag.
     */
    if (e.shiftKey) {
      toggleCanvasNodeSelection(node.id);
      draggingRef.current = false;
      return;
    }

    const cur = selectedCanvasIds.get();

    if (!cur.includes(node.id)) {
      // Not selected → make it the sole selection.
      selectCanvasNode(node.id);
    } else if (cur.length > 1) {
      // Already selected alongside others → keep the multi-selection so the
      // drag moves ALL selected nodes together. (Single-node selection stays as
      // is.)
    }

    draggingRef.current = true;
    startRef.current = { x: e.clientX, y: e.clientY, nx: node.x, ny: node.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) {
      return;
    }

    // Screen-space delta → canvas-space delta (undo zoom).
    const dx = (e.clientX - startRef.current.x) / zoom;
    const dy = (e.clientY - startRef.current.y) / zoom;

    /*
     * Multi-node drag: if this node is part of a multi-selection, move EVERY
     * selected node by the same canvas-space delta so the selection stays
     * together. Each selected node needs its OWN pre-drag baseline, so we
     * snapshot the selection's starting positions here on the first move (via
     * a ref) and reuse them for the rest of the drag. Single-node drags (no
     * selection OR this node isn't in it) just move this node alone — same as
     * before the selection feature shipped.
     */
    const sel = selectedCanvasIds.get();

    if (sel.length > 1 && sel.includes(node.id)) {
      // Lazily capture the selection's starting positions on the first move of
      // this drag (multiSelStartRef is cleared on pointerup).
      if (!multiSelStartRef.current) {
        const all = canvasNodes.get();
        multiSelStartRef.current = new Map(
          sel.map((id) => {
            const n = all.find((x) => x.id === id);
            return [id, n ? { x: n.x, y: n.y } : { x: 0, y: 0 }];
          }),
        );
      }

      for (const [id, start] of multiSelStartRef.current) {
        moveCanvasNode(id, start.x + dx, start.y + dy);
      }
    } else {
      moveCanvasNode(node.id, startRef.current.nx + dx, startRef.current.ny + dy);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    // Clear the multi-selection drag baseline so the next drag snapshots fresh.
    multiSelStartRef.current = null;

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  /*
   * Resize handle pointer handlers (sticky nodes only). The handle lives in
   * the bottom-right corner of the card. pointerdown stops propagation so it
   * does NOT start a node drag (the parent CanvasNodeItem's onPointerDown is
   * never reached) and captures the pointer so subsequent pointermove events
   * keep firing on the handle even when the cursor leaves it. pointermove
   * converts the screen delta into a canvas-space delta, clamps to the
   * minimum size, and pushes the new width/height into the store.
   */
  const onResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) {
      return;
    }

    e.stopPropagation();
    resizingRef.current = true;
    resizeStartRef.current = {
      px: e.clientX,
      py: e.clientY,
      w: node.width ?? STICKY_DEFAULT_WIDTH,
      h: node.height ?? STICKY_DEFAULT_HEIGHT,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) {
      return;
    }

    const dx = (e.clientX - resizeStartRef.current.px) / zoom;
    const dy = (e.clientY - resizeStartRef.current.py) / zoom;
    const nextW = Math.max(STICKY_MIN_WIDTH, resizeStartRef.current.w + dx);
    const nextH = Math.max(STICKY_MIN_HEIGHT, resizeStartRef.current.h + dy);
    resizeCanvasNode(node.id, nextW, nextH);
  };

  const onResizePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    resizingRef.current = false;

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  /*
   * Each kind gets its OWN card silhouette + body:
   *   - 'trigger' → .CanvasNodeTrigger + TriggerNodeBody: 64×64 square, LEFT
   *     corners smoothly curved + RIGHT corners lightly curved (asymmetric
   *     "tag"), centred icon, title caption BELOW the card, red bolt badge.
   *   - 'agent'   → .CanvasNodeAgent + AgentNodeBody: wide rectangle (168×64),
   *     ALL FOUR corners lightly curved (4px uniform), HORIZONTAL layout — icon
   *     on the LEFT, "AI Agent" main + "tool agent" subtitle text on the RIGHT
   *     (inside the card). Same dark body + permanent accent outline, NO bolt.
   *   - 'memory'  → .CanvasNodeMemory + MemoryNodeBody: 64×64 CIRCLE
   *     (border-radius:50%), centred memory icon, title caption BELOW the card.
   *     Same dark body + permanent accent outline + output port as the trigger,
   *     but round and bolt-less.
   *   - 'aitool'  → .CanvasNodeMemory + MemoryNodeBody: visually IDENTICAL to
   *     'memory' (64×64 circle, top port, centred icon, title below) but
   *     represents an AI Agent TOOL. Distinct connection target: routes
   *     upward into the agent's bottom THIRD connector (the plus-square) so a
   *     tool, a memory node, AND an llm node can all hang off one agent.
   *   - 'sticky'  → .CanvasNodeSticky + StickyNodeBody: warm-yellow rectangle
   *     with SHARP corners (border-radius:0), editable textarea body, header
   *     strip with title, decorative dog-ear fold, and a bottom-right resize
   *     handle. The only resizable kind — width/height come from the node's
   *     own fields (defaults applied when missing).
   *   - 'action'  → default compact card (.CanvasNode only).
   */
  const variantClass =
    node.kind === 'trigger'
      ? styles.CanvasNodeTrigger
      : node.kind === 'agent'
        ? styles.CanvasNodeAgent
        : node.kind === 'memory'
          ? styles.CanvasNodeMemory
          : node.kind === 'llm'
            ? styles.CanvasNodeLlm
            : node.kind === 'aitool'
              ? styles.CanvasNodeMemory
              : node.kind === 'sticky'
                ? styles.CanvasNodeSticky
                : styles.CanvasNodeAction;

  /*
   * Sticky notes carry their own width/height; every other kind is sized by
   * CSS. We merge the dimensions onto the inline style only when sticky so
   * the CSS-defined silhouettes stay authoritative for trigger/agent/memory/llm.
   * Sticky notes ALSO carry their colour palette — the paper (background) and
   * border shades are applied as inline styles so clicking a colour circle
   * re-tints the whole card instantly without a re-render of the SCSS.
   */
  const stickyPalette = node.kind === 'sticky' ? getStickyColor(node.color) : null;

  const nodeStyle: React.CSSProperties =
    node.kind === 'sticky' && stickyPalette
      ? {
          left: node.x,
          top: node.y,
          width: node.width ?? STICKY_DEFAULT_WIDTH,
          height: node.height ?? STICKY_DEFAULT_HEIGHT,
          backgroundColor: stickyPalette.paper,
          borderColor: stickyPalette.border,
          color: stickyPalette.ink,
        }
      : { left: node.x, top: node.y };

  return (
    <motion.div
      className={classNames(styles.CanvasNode, variantClass, isSelected && styles.CanvasNodeSelected, isRunningNode && styles.CanvasNodeRunning)}
      style={nodeStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.6, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      /*
       * DOUBLE-CLICK: on a TRIGGER node, opens the chat panel at the bottom of
       * the canvas (replacing the nodes library panel there). The trigger's
       * instance id is recorded so the chat can be scoped to it. On an ACTION
       * (utility) node, opens the NodePropertiesPanel modal overlay instead so
       * the user can configure that node's behaviour (duration, key, value,
       * template, etc.). stopPropagation so the canvas-background double-click
       * handler (which CLOSES the chat) doesn't also fire when double-clicking
       * a node. Other kinds (agent, memory, llm, sticky) do nothing on
       * double-click.
       */
      onDoubleClick={(e) => {
        e.stopPropagation();

        if (node.kind === 'trigger') {
          openCanvasChat(node.id);
        } else if (node.kind === 'action') {
          openNodeProperties(node.id);
        } else if (node.kind === 'memory') {
          openMemoryTreePanel(node.id);
        }
      }}
      /*
       * Data attributes consumed by ConnectionDragController's hit-testing:
       * on pointermove during a connection drag, document.elementFromPoint
       * returns whatever element is under the cursor; we walk up to the nearest
       * [data-canvas-node-id] to identify which canvas node (if any) is the
       * drop target, then check [data-canvas-node-kind] to accept only agent
       * nodes. These attributes MUST live on the outermost node element so the
       * hit-test resolves correctly regardless of which child (icon, text, bar,
       * port) the pointer is actually over.
       */
      data-canvas-node-id={node.id}
      data-canvas-node-kind={node.kind}
    >
      <button
        type="button"
        className={styles.CanvasNodeDelete}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          removeCanvasNode(node.id);
          toast.info(`Removed “${node.title}”`);
        }}
        title="Remove node"
        aria-label={`Remove ${node.title}`}
      >
        <span className="i-ph:x" />
      </button>
      {/*
        * NodeSpinner — a circular rotating icon overlaid on the node center
        * when this node is the one currently executing (isRunningNode). The
        * spinner is a light cyan/teal circular rotating loader (two curved
        * arrows in a refresh/sync pattern, like n8n's active-node indicator)
        * positioned dead-centre on the node + rotates continuously via CSS
        * animation. It reads as "this node is actively processing" — the
        * same affordance n8n shows when a node is executing.
        */}
      {isRunningNode && (
        <div className={styles.NodeSpinner} aria-hidden>
          <span className="i-ph:arrows-clockwise" />
        </div>
      )}
      {node.kind === 'trigger' ? (
        <TriggerNodeBody kind="trigger" icon={node.icon} title={node.title} nodeId={node.id} />
      ) : node.kind === 'agent' ? (
        <AgentNodeBody
          icon={node.icon}
          nodeId={node.id}
          mainLabel={node.mainLabel}
          subLabel={node.subLabel}
        />
      ) : node.kind === 'memory' ? (
        <MemoryNodeBody icon={node.icon} title={node.title} nodeId={node.id} />
      ) : node.kind === 'llm' ? (
        <MemoryNodeBody icon={node.icon} title={node.title} nodeId={node.id} />
      ) : node.kind === 'aitool' ? (
        <MemoryNodeBody icon={node.icon} title={node.title} nodeId={node.id} />
      ) : node.kind === 'sticky' ? (
        <>
          <StickyNodeBody
            title={node.title}
            nodeId={node.id}
            initialText={node.text}
            color={node.color}
          />
          {/*
            * Resize handle — bottom-right corner. Sticky notes are the only
            * resizable kind, so this handle renders ONLY for sticky. The
            * handle's pointerdown stops propagation so the parent drag handler
            * never fires; the handle then drives its own pointer capture loop
            * (onResizePointerMove / onResizePointerUp) to grow / shrink the
            * note. The double-headed diagonal arrow cursor (nwse-resize) is the
            * conventional affordance for a corner resize.
            */}
          <div
            className={styles.StickyResizeHandle}
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
            onPointerCancel={onResizePointerUp}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sticky note"
            title="Drag to resize"
          />
        </>
      ) : (
        // Default 'action' (utility) card — a true 64×64 SQUARE with lightly
        // curved (4px) corners, themed to match the agent + trigger node
        // family: dark #171717 body, permanent accent outline. Layout mirrors
        // the trigger node: the icon sits dead-centre in the square, and the
        // title renders as a caption BELOW the card. This makes every utility
        // node (HTTP Request, Delay, Condition, …) read as part of the same
        // dark-squared family as the trigger node.
        //
        // CONNECTOR PORTS — the user asked for connector points on the LEFT
        // and RIGHT edges of every utility node, matching the agent node.
        //   - LEFT  (InputPort):  a passive light vertical RECTANGULAR BAR
        //     (6px × 19px) straddling the left edge — the same .AgentLeftBar
        //     treatment the agent node uses (the user asked for it to be a
        //     rectangle, not a circle dot). Marks where incoming connections
        //     land. The whole card is the drop target (hit-tested via
        //     [data-canvas-node-id] in ConnectionDragController, which now
        //     accepts kind==='action' as well as kind==='agent'), so the port
        //     is purely visual.
        //   - RIGHT (OutputPort): an INTERACTIVE 12px circle straddling the
        //     right edge. Pressing on it starts a connection drag (drag to
        //     another node to wire them up) — same behaviour as the trigger
        //     node's output port. Utility nodes can now be both a connection
        //     SOURCE (right port) and a connection TARGET (whole card).
        <>
          <InputPort />
          <div className={styles.ActionIconArea}>
            <span className={node.icon} />
          </div>
          <div className={styles.ActionTitle}>{node.title}</div>
          <OutputPort nodeId={node.id} />
        </>
      )}
    </motion.div>
  );
}

/*
 * CanvasEmptyHint — a faint centered prompt shown only when the canvas has no
 * placed nodes (and nothing is being dragged). Points the user toward dragging
 * a node up from the library. Disappears the moment the first node lands.
 */
function CanvasEmptyHint() {
  const nodes = useStore(canvasNodes);
  const dragP = useStore(dragPointer);

  if (nodes.length > 0 || dragP) {
    return null;
  }

  return (
    <div className={styles.CanvasEmptyHint} aria-hidden>
      <span className={classNames('i-ph:hand-grabbing', styles.CanvasEmptyHintIcon)} />
      <div className={styles.CanvasEmptyHintText}>
        Drag a node from the library below to place it on the canvas
      </div>
    </div>
  );
}

/*
 * ZoomControls — a vertical button group pinned to the bottom-left corner of
 * the canvas.
 *
 *   ┌────┐
 *   │ +  │  zoom in
 *   ├────┤
 *   │ ⊞  │  fit to canvas (reset zoom + pan) — shows the live zoom %
 *   │100%│
 *   ├────┤
 *   │ −  │  zoom out
 *   └────┘
 *
 * Styled as a single elevated "pill" control group matching the header's
 * squircle-button design language.
 */
function ZoomControls({
  zoom,
  min,
  max,
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  zoom: number;
  min: number;
  max: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  const pct = Math.round(zoom * 100);

  /*
   * Stop pointer-down from bubbling to the MovableCanvas pan handler — the
   * canvas calls setPointerCapture() on pointer-down, which would hijack the
   * pointer and prevent these buttons from ever receiving a click. Stopping
   * propagation here keeps clicks on the buttons. Wheel events are also
   * stopped so Ctrl+scroll over the controls zooms the canvas, not the page.
   */
  const stopPropagation = (e: React.PointerEvent | React.WheelEvent) => e.stopPropagation();

  return (
    <div
      className={styles.ZoomControls}
      role="group"
      aria-label="Canvas zoom controls"
      onPointerDown={stopPropagation}
      onWheel={stopPropagation}
    >
      <button
        type="button"
        className={styles.ZoomBtn}
        onClick={onZoomIn}
        disabled={zoom >= max - 0.001}
        title="Zoom in (Ctrl + scroll)"
        aria-label="Zoom in"
      >
        <span className="i-ph:plus-bold" />
      </button>
      <div className={styles.ZoomDivider} aria-hidden />
      <button
        type="button"
        className={classNames(styles.ZoomBtn, styles.ZoomFit)}
        onClick={onFit}
        title="Fit to canvas (reset zoom & pan)"
        aria-label="Fit to canvas"
      >
        <span className="i-ph:frame-corners" />
        <span className={styles.ZoomLabel}>{pct}%</span>
      </button>
      <div className={styles.ZoomDivider} aria-hidden />
      <button
        type="button"
        className={styles.ZoomBtn}
        onClick={onZoomOut}
        disabled={zoom <= min + 0.001}
        title="Zoom out (Ctrl + scroll)"
        aria-label="Zoom out"
      >
        <span className="i-ph:minus-bold" />
      </button>
    </div>
  );
}

/* ── Preview view: toolbar + (running app | placeholder) ─────────────────── */

function PreviewView() {
  const running = useStore(workbenchStore.previewRunning);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className={styles.PreviewView}>
      <div className={styles.PreviewToolbar}>
        <div className={styles.AddressBar}>
          <span className={classNames('i-ph:globe', styles.AddressIcon)} />
          <span>{running ? 'localhost:5173' : 'localhost:5173 — not running'}</span>
        </div>
        <button
          type="button"
          className={styles.PreviewRefreshButton}
          onClick={() => setRefreshKey((k) => k + 1)}
          title={running ? 'Refresh preview' : 'Preview not running'}
          aria-label="Refresh preview"
          disabled={!running}
        >
          <span className="i-ph:arrow-clockwise text-sm" />
        </button>
      </div>
      {running ? (
        <MockAppPreview key={refreshKey} />
      ) : (
        <div className={styles.PreviewBody}>
          <span className={classNames('i-ph:browser', styles.PreviewIcon)} />
          <div className={styles.PreviewTitle}>Preview</div>
          <div className={styles.PreviewText}>
            The live preview will appear here once the dev server is running. Click the
            <span className={styles.PreviewTextAccent}> Run </span>
            button in the header to start the app.
          </div>
        </div>
      )}
    </div>
  );
}

/*
 * MockAppPreview — a realistic-looking running app shown in the Preview view
 * after the user clicks Run. It mirrors the sample `src/App.tsx` from the
 * workbench's static file set (an emerald→teal gradient page with a heading,
 * subtitle, and a working counter button), so what the user sees in the
 * preview matches what they'd see in the "code" they're told is running.
 *
 * This is a pure visual prototype — there's no real WebContainer executing
 * the React app. The counter uses local React state so the button is
 * interactive, reinforcing the illusion that a live app is rendered.
 */
function MockAppPreview() {
  const [count, setCount] = useState(0);

  return (
    <div className={styles.MockAppFrame}>
      <div className={styles.MockAppRoot}>
        <h1 className={styles.MockAppTitle}>AlphaCode App</h1>
        <p className={styles.MockAppSubtitle}>Built with React + Vite + Tailwind</p>
        <button type="button" className={styles.MockAppButton} onClick={() => setCount((c) => c + 1)}>
          Count: {count}
        </button>
      </div>
    </div>
  );
}

/* ── Action steps bar (bottom horizontal scroll) ────────────────────────── */

/*
 * A long horizontal strip pinned to the bottom of the workbench, below the
 * files + code area. It contains a row of "build step" boxes (setup, install,
 * file writes, compile, deploy, …) that overflow horizontally and can be
 * scrolled to the right with the chevron buttons on either edge.
 *
 * The data is a static sample list — the stubbed AI backend never streams real
 * actions, so this is purely visual. The statuses (done / running / queued /
 * failed) are pre-set to make the row look like a real build in progress.
 */
export type ActionStepStatus = 'done' | 'running' | 'queued' | 'failed';

export interface ActionStep {
  id: string;
  title: string;
  status: ActionStepStatus;
  icon: string;
  detail?: string;
  /**
   * Optional override for the placed node's visual kind. When set, this step
   * renders as the given kind on the canvas (e.g. 'memory' → circular card)
   * INSTEAD of the kind inferred from its section. Used by the Memory node in
   * the Utility section, which needs a distinct circular silhouette that the
   * section-based inference (trigger / agent / action) can't express.
   */
  kind?: CanvasNodeKind;
  /**
   * Optional override for the placed AGENT card's main label. When set, the
   * agent card shows this text as its primary label instead of the default
   * "AI Agent". Used by agent-section nodes that represent a distinct concept
   * (e.g. an LLM node labelled "LLM") so each agent-variant card reads as its
   * own thing. Only honoured for kind 'agent'.
   */
  mainLabel?: string;
  /** Optional override for the placed agent card's subtitle (default "tool agent"). */
  subLabel?: string;
  /** Optional initial canvas-space width for resizable kinds (sticky). */
  width?: number;
  /** Optional initial canvas-space height for resizable kinds (sticky). */
  height?: number;
}

/*
 * The nodes library is divided into horizontal sections. Each section has a
 * label (rendered as a vertical divider on the left of its group of cards)
 * and a list of nodes. The three sections are:
 *   1. Trigger node — nodes that start a workflow
 *   2. AI           — language-model / AI nodes
 *   3. Utility node — helper / integration nodes
 *
 * `label` is the full name (used for the tooltip + aria-label). `shortLabel`
 * is the compact text drawn vertically on the divider — it is intentionally
 * short so it fits in a single vertical column without wrapping into the
 * overlapping "line in line" effect that longer text produced.
 */
export interface ActionStepSection {
  id: string;
  label: string;
  shortLabel: string;
  icon: string;
  steps: ActionStep[];
}

const SAMPLE_ACTION_SECTIONS: ActionStepSection[] = [
  {
    id: 'trigger',
    label: 'Trigger node',
    shortLabel: 'Trigger',
    icon: 'i-ph:lightning',
    steps: [
      { id: 't1', title: 'On Message', status: 'done', icon: 'i-ph:chat-circle', detail: 'incoming msg' },
      { id: 't2', title: 'Schedule', status: 'done', icon: 'i-ph:calendar-blank', detail: 'cron 5m' },
      { id: 't3', title: 'Webhook', status: 'done', icon: 'i-ph:link', detail: 'POST /hook' },
      { id: 't4', title: 'Manual Start', status: 'done', icon: 'i-ph:hand-tap', detail: 'on click' },
      { id: 't5', title: 'On Reply', status: 'done', icon: 'i-ph:arrow-bend-up-left', detail: 'reply event' },
      { id: 't6', title: 'On Mention', status: 'done', icon: 'i-ph:at', detail: '@mention' },
      { id: 't7', title: 'On Join', status: 'done', icon: 'i-ph:user-plus', detail: 'member join' },
      { id: 't8', title: 'On Upload', status: 'done', icon: 'i-ph:upload-simple', detail: 'ready' },
      { id: 't9', title: 'On Reaction', status: 'done', icon: 'i-ph:smiley', detail: 'ready' },
      { id: 't10', title: 'RSS Feed', status: 'done', icon: 'i-ph:rss', detail: 'ready' },
    ],
  },
  {
    id: 'agent',
    label: 'Agent node',
    shortLabel: 'Agent',
    icon: 'svg:robot-agent',
    steps: [
      { id: 'g1', title: 'Autonomous Agent', status: 'done', icon: 'svg:robot-agent', detail: 'ready' },
      {
        id: 'g2',
        title: 'LLM',
        status: 'done',
        icon: 'i-ph:brain',
        detail: 'ready',
        // Render as a CIRCULAR node (visually identical to the memory node:
        // 64×64 disc, icon dead-centre, output port on the TOP edge, title
        // caption below) — NOT the wide agent rectangle. The explicit kind
        // override 'llm' bypasses the section-based inference (which would
        // default to 'agent'). The 'llm' kind connects upward into the agent's
        // bottom-LEFT (FIRST) diamond, while 'memory' now hits the bottom-SECOND
        // (middle) diamond — so both can hang off the same agent without
        // colliding on the same port.
        kind: 'llm',
      },
      {
        // Sub Agent System — when dropped on the canvas, creates TWO agent
        // nodes stacked vertically (one up, one down) connected by an edge.
        // The library card renders like a normal agent card (kind:'agent'), but
        // the drop handler in endInteraction detects the title "Sub Agent
        // System" + creates the pair instead of a single node.
        id: 'g3',
        title: 'Sub Agent System',
        status: 'done',
        icon: 'i-ph:stack',
        detail: 'ready',
        kind: 'agent',
      },
    ],
  },
  {
    // ── AI Agent Tools ───────────────────────────────────────────────────
    //  A dedicated section of TOOL nodes that attach to an AI agent. Every
    //  node here renders as a CIRCULAR card (kind:'aitool' — visually identical
    //  to the LLM / memory node: 64×64 disc, icon dead-centre, output port on
    //  the TOP edge, title caption below). Distinct connection target: an
    //  aitool node's wire routes UPWARD into the agent's bottom THIRD
    //  connector — the PLUS SQUARE (AgentPlusSquare) — so a tool, a memory
    //  node (→ 2nd diamond), AND an llm node (→ 1st diamond) can ALL hang off
    //  the same agent without colliding. Tools are "dummy but connectable":
    //  they pulse alongside their agent during a run but don't run their own
    //  logic yet (real backends can be wired in later per node title).
    id: 'aiagenttools',
    label: 'AI Agent Tools',
    shortLabel: 'AI Tools',
    icon: 'i-ph:wrench',
    steps: [
      { id: 'at1', title: 'Image Search', status: 'done', icon: 'i-ph:magnifying-glass', detail: 'ready', kind: 'aitool' },
      { id: 'at2', title: 'Online Search', status: 'done', icon: 'i-ph:globe', detail: 'ready', kind: 'aitool' },
      { id: 'at3', title: 'Web Reader', status: 'done', icon: 'i-ph:book-open', detail: 'ready', kind: 'aitool' },
      { id: 'at4', title: 'Web Scraper', status: 'done', icon: 'i-ph:code', detail: 'ready', kind: 'aitool' },
      { id: 'at5', title: 'Browser', status: 'done', icon: 'i-ph:browser', detail: 'ready', kind: 'aitool' },
      { id: 'at6', title: 'Terminal', status: 'done', icon: 'i-ph:terminal-window', detail: 'ready', kind: 'aitool' },
      { id: 'at7', title: 'Host', status: 'done', icon: 'i-ph:hard-drive', detail: 'ready', kind: 'aitool' },
      { id: 'at8', title: 'Database', status: 'done', icon: 'i-ph:hard-drives', detail: 'ready', kind: 'aitool' },
      { id: 'at9', title: 'Image Editor', status: 'done', icon: 'i-ph:pencil-simple', detail: 'ready', kind: 'aitool' },
      { id: 'at10', title: 'Image Generator', status: 'done', icon: 'i-ph:image', detail: 'ready', kind: 'aitool' },
      { id: 'at11', title: 'Text to Speech', status: 'done', icon: 'i-ph:speaker-high', detail: 'ready', kind: 'aitool' },
      { id: 'at12', title: 'Video Generator', status: 'done', icon: 'i-ph:video', detail: 'ready', kind: 'aitool' },
      { id: 'at13', title: 'Skills', status: 'done', icon: 'i-ph:sparkle', detail: 'ready', kind: 'aitool' },
      { id: 'at14', title: 'MCP', status: 'done', icon: 'i-ph:plugs', detail: 'ready', kind: 'aitool' },
      { id: 'at15', title: 'Memory', status: 'done', icon: 'i-ph:database', detail: 'ready', kind: 'aitool' },
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    shortLabel: 'AI',
    icon: 'i-ph:brain',
    steps: [
      { id: 'a1', title: 'LLM Call', status: 'done', icon: 'i-ph:brain', detail: 'ready' },
      { id: 'a2', title: 'Classify Intent', status: 'done', icon: 'i-ph:funnel', detail: 'ready' },
      { id: 'a3', title: 'Generate Text', status: 'done', icon: 'i-ph:pencil-simple-line', detail: 'ready' },
      { id: 'a4', title: 'Summarize', status: 'done', icon: 'i-ph:text-align-left', detail: 'ready' },
      { id: 'a5', title: 'Embed', status: 'done', icon: 'i-ph:vector-two', detail: 'ready' },
      { id: 'a6', title: 'Translate', status: 'done', icon: 'i-ph:translate', detail: 'ready' },
      { id: 'a7', title: 'Sentiment', status: 'done', icon: 'i-ph:smiley-sad', detail: 'ready' },
      { id: 'a8', title: 'Extract Entities', status: 'done', icon: 'i-ph:magnifying-glass', detail: 'ready' },
      { id: 'a9', title: 'Code Review', status: 'done', icon: 'i-ph:code', detail: 'ready' },
      { id: 'a10', title: 'Image Caption', status: 'done', icon: 'i-ph:image', detail: 'ready' },
      { id: 'a11', title: 'Transcribe Audio', status: 'done', icon: 'i-ph:microphone', detail: 'ready' },
      { id: 'a12', title: 'RAG Query', status: 'done', icon: 'i-ph:books', detail: 'ready' },
    ],
  },
  {
    id: 'utility',
    label: 'Utility node',
    shortLabel: 'Utility',
    icon: 'i-ph:wrench',
    steps: [
      { id: 'u1', title: 'Wait', status: 'done', icon: 'i-ph:clock', detail: 'ready' },
      { id: 'u2', title: 'HTML → Image', status: 'done', icon: 'i-ph:image', detail: 'ready' },
      { id: 'u3', title: 'Preview', status: 'done', icon: 'i-ph:eye', detail: 'ready' },
      { id: 'u4', title: 'Image Control', status: 'done', icon: 'i-ph:image-broken', detail: 'ready' },
      { id: 'u5', title: 'HTML → PPTX', status: 'done', icon: 'i-ph:presentation', detail: 'ready' },
      { id: 'u6', title: 'HTML → XLSX', status: 'done', icon: 'i-ph:table', detail: 'ready' },
      { id: 'u7', title: 'HTML → DOCX', status: 'done', icon: 'i-ph:file-doc', detail: 'ready' },
      { id: 'u8', title: 'JSON Filter', status: 'done', icon: 'i-ph:funnel-simple', detail: 'ready' },
      { id: 'u9', title: 'Text → File', status: 'done', icon: 'i-ph:file-text', detail: 'ready' },
      // Memory node — renders as a CIRCULAR card on the canvas (kind:'memory'
      // overrides the section-based 'action' inference). Uses the database icon
      // as the universal "memory / persistent storage" glyph.
      { id: 'u10', title: 'Memory', status: 'done', icon: 'i-ph:database', detail: 'ready', kind: 'memory' },
      { id: 'u11', title: 'Text Merge', status: 'done', icon: 'i-ph:git-merge', detail: 'ready' },
      { id: 'u12', title: 'Text Split', status: 'done', icon: 'i-ph:scissors', detail: 'ready' },
      { id: 'u13', title: 'Regex Extract', status: 'done', icon: 'i-ph:regex', detail: 'ready' },
      { id: 'u14', title: 'Text Case', status: 'done', icon: 'i-ph:text-aa', detail: 'ready' },
      { id: 'u15', title: 'Text Stats', status: 'done', icon: 'i-ph:chart-bar', detail: 'ready' },
      { id: 'u16', title: 'Counter', status: 'done', icon: 'i-ph:hash', detail: 'ready' },
      { id: 'u17', title: 'Base64', status: 'done', icon: 'i-ph:lock-simple', detail: 'ready' },
      { id: 'u18', title: 'URL Encode', status: 'done', icon: 'i-ph:link', detail: 'ready' },
      { id: 'u19', title: 'Hash', status: 'done', icon: 'i-ph:fingerprint', detail: 'ready' },
      { id: 'u20', title: 'Template', status: 'done', icon: 'i-ph:file-code', detail: 'ready' },
      { id: 'u21', title: 'AI If', status: 'done', icon: 'i-ph:brain', detail: 'ready' },
      { id: 'u22', title: 'Database', status: 'done', icon: 'i-ph:hard-drives', detail: 'ready' },
      { id: 'u23', title: 'File Input', status: 'done', icon: 'i-ph:upload-simple', detail: 'ready' },
      { id: 'u24', title: 'Host', status: 'done', icon: 'i-ph:hard-drive', detail: 'ready' },
      { id: 'u25', title: 'Skill', status: 'done', icon: 'i-ph:sparkle', detail: 'ready' },
    ],
  },
  {
    id: 'canvas',
    label: 'Canvas tool node',
    shortLabel: 'Canvas',
    icon: 'i-ph:paint-brush',
    steps: [
      // Sticky Note — the ONLY node in the Canvas section. Renders as a
      // sharp-cornered yellow sticky note on the canvas (kind:'sticky' overrides
      // the section-based 'action' inference). Unlike every other kind, sticky
      // notes are RESIZABLE: the user can drag the bottom-right resize handle
      // to grow / shrink the note, and the body is an editable textarea so they
      // can type notes directly onto it. No output / input port — sticky notes
      // are decorative annotations, not part of the node graph.
      {
        id: 'c2',
        title: 'Sticky Note',
        status: 'done',
        icon: 'i-ph:note',
        detail: 'ready',
        kind: 'sticky',
        width: STICKY_DEFAULT_WIDTH,
        height: STICKY_DEFAULT_HEIGHT,
      },
    ],
  },
  {
    id: 'app',
    label: 'App action node',
    shortLabel: 'App action',
    icon: 'i-ph:app-window',
    steps: [
      // ── Messaging & chat (9) ──────────────────────────────────────────
      //    Brand logos via @iconify-json/simple-icons (i-simple-icons:*).
      //    Apps without an official Simple Icons entry fall back to a
      //    category-appropriate Phosphor icon (i-ph:*).
      { id: 'p1', title: 'Discord', status: 'done', icon: 'i-simple-icons:discord', detail: 'ready' },
      { id: 'p2', title: 'Discord Bot', status: 'done', icon: 'i-simple-icons:discord', detail: 'ready' },
      { id: 'p3', title: 'Slack', status: 'done', icon: 'i-simple-icons:slack', detail: 'ready' },
      { id: 'p4', title: 'Slackbot', status: 'done', icon: 'i-simple-icons:slack', detail: 'ready' },
      { id: 'p5', title: 'Microsoft Teams', status: 'done', icon: 'i-simple-icons:microsoftteams', detail: 'ready' },
      { id: 'p6', title: 'Webex', status: 'done', icon: 'i-simple-icons:cisco', detail: 'ready' },
      { id: 'p7', title: 'WhatsApp Business', status: 'done', icon: 'i-simple-icons:whatsapp', detail: 'ready' },
      { id: 'p8', title: 'Dialpad', status: 'done', icon: 'i-ph:phone', detail: 'ready' },
      { id: 'p9', title: 'Lark / Feishu', status: 'done', icon: 'i-ph:chats-circle', detail: 'ready' },
      // ── Social (7) ────────────────────────────────────────────────────
      { id: 'p10', title: 'Facebook', status: 'done', icon: 'i-simple-icons:facebook', detail: 'ready' },
      { id: 'p11', title: 'Instagram', status: 'done', icon: 'i-simple-icons:instagram', detail: 'ready' },
      { id: 'p12', title: 'LinkedIn', status: 'done', icon: 'i-simple-icons:linkedin', detail: 'ready' },
      { id: 'p13', title: 'Reddit', status: 'done', icon: 'i-simple-icons:reddit', detail: 'ready' },
      { id: 'p14', title: 'Reddit Ads', status: 'done', icon: 'i-simple-icons:reddit', detail: 'ready' },
      { id: 'p15', title: 'YouTube', status: 'done', icon: 'i-simple-icons:youtube', detail: 'ready' },
      { id: 'p16', title: 'Stack Exchange', status: 'done', icon: 'i-simple-icons:stackexchange', detail: 'ready' },
      // ── Google (16) ───────────────────────────────────────────────────
      { id: 'p17', title: 'Gmail', status: 'done', icon: 'i-simple-icons:gmail', detail: 'ready' },
      { id: 'p18', title: 'Google Calendar', status: 'done', icon: 'i-simple-icons:googlecalendar', detail: 'ready' },
      { id: 'p19', title: 'Google Drive', status: 'done', icon: 'i-simple-icons:googledrive', detail: 'ready' },
      { id: 'p20', title: 'Google Docs', status: 'done', icon: 'i-simple-icons:googledocs', detail: 'ready' },
      { id: 'p21', title: 'Google Sheets', status: 'done', icon: 'i-simple-icons:googlesheets', detail: 'ready' },
      { id: 'p22', title: 'Google Slides', status: 'done', icon: 'i-simple-icons:googleslides', detail: 'ready' },
      { id: 'p23', title: 'Google Tasks', status: 'done', icon: 'i-simple-icons:googletasks', detail: 'ready' },
      { id: 'p24', title: 'Google Classroom', status: 'done', icon: 'i-simple-icons:googleclassroom', detail: 'ready' },
      { id: 'p25', title: 'Google Meet', status: 'done', icon: 'i-simple-icons:googlemeet', detail: 'ready' },
      { id: 'p26', title: 'Google Photos', status: 'done', icon: 'i-simple-icons:googlephotos', detail: 'ready' },
      { id: 'p27', title: 'Google Maps', status: 'done', icon: 'i-simple-icons:googlemaps', detail: 'ready' },
      { id: 'p28', title: 'Google Search Console', status: 'done', icon: 'i-simple-icons:googlesearchconsole', detail: 'ready' },
      { id: 'p29', title: 'Google Ads', status: 'done', icon: 'i-simple-icons:googleads', detail: 'ready' },
      { id: 'p30', title: 'Google Analytics', status: 'done', icon: 'i-simple-icons:googleanalytics', detail: 'ready' },
      { id: 'p31', title: 'Google BigQuery', status: 'done', icon: 'i-simple-icons:googlebigquery', detail: 'ready' },
      { id: 'p32', title: 'Google Super', status: 'done', icon: 'i-ph:sparkle', detail: 'ready' },
      // ── Microsoft Office (4) ──────────────────────────────────────────
      { id: 'p33', title: 'Excel', status: 'done', icon: 'i-simple-icons:microsoftexcel', detail: 'ready' },
      { id: 'p34', title: 'Outlook', status: 'done', icon: 'i-simple-icons:microsoftoutlook', detail: 'ready' },
      { id: 'p35', title: 'OneDrive', status: 'done', icon: 'i-simple-icons:microsoftonedrive', detail: 'ready' },
      { id: 'p36', title: 'SharePoint', status: 'done', icon: 'i-simple-icons:microsoftsharepoint', detail: 'ready' },
      // ── Cloud storage (2) ─────────────────────────────────────────────
      { id: 'p37', title: 'Box', status: 'done', icon: 'i-simple-icons:box', detail: 'ready' },
      { id: 'p38', title: 'Dropbox', status: 'done', icon: 'i-simple-icons:dropbox', detail: 'ready' },
      // ── Productivity & project management (12) ────────────────────────
      { id: 'p39', title: 'Notion', status: 'done', icon: 'i-simple-icons:notion', detail: 'ready' },
      { id: 'p40', title: 'Trello', status: 'done', icon: 'i-simple-icons:trello', detail: 'ready' },
      { id: 'p41', title: 'Asana', status: 'done', icon: 'i-simple-icons:asana', detail: 'ready' },
      { id: 'p42', title: 'Basecamp', status: 'done', icon: 'i-simple-icons:basecamp', detail: 'ready' },
      { id: 'p43', title: 'ClickUp', status: 'done', icon: 'i-simple-icons:clickup', detail: 'ready' },
      { id: 'p44', title: 'Linear', status: 'done', icon: 'i-simple-icons:linear', detail: 'ready' },
      { id: 'p45', title: 'Jira', status: 'done', icon: 'i-simple-icons:jira', detail: 'ready' },
      { id: 'p46', title: 'Confluence', status: 'done', icon: 'i-simple-icons:confluence', detail: 'ready' },
      { id: 'p47', title: 'Monday', status: 'done', icon: 'i-ph:calendar-blank', detail: 'ready' },
      { id: 'p48', title: 'Wrike', status: 'done', icon: 'i-ph:target', detail: 'ready' },
      { id: 'p49', title: 'Miro', status: 'done', icon: 'i-simple-icons:miro', detail: 'ready' },
      { id: 'p50', title: 'Mural', status: 'done', icon: 'i-simple-icons:mural', detail: 'ready' },
      // ── Scheduling & design (6) ───────────────────────────────────────
      { id: 'p51', title: 'Cal', status: 'done', icon: 'i-simple-icons:caldotcom', detail: 'ready' },
      { id: 'p52', title: 'Calendly', status: 'done', icon: 'i-simple-icons:calendly', detail: 'ready' },
      { id: 'p53', title: 'Typeform', status: 'done', icon: 'i-simple-icons:typeform', detail: 'ready' },
      { id: 'p54', title: 'Figma', status: 'done', icon: 'i-simple-icons:figma', detail: 'ready' },
      { id: 'p55', title: 'Todoist', status: 'done', icon: 'i-simple-icons:todoist', detail: 'ready' },
      { id: 'p56', title: 'Ticktick', status: 'done', icon: 'i-simple-icons:ticktick', detail: 'ready' },
      // ── Platform / Developer (11) ─────────────────────────────────────
      { id: 'p57', title: 'GitHub', status: 'done', icon: 'i-simple-icons:github', detail: 'ready' },
      { id: 'p58', title: 'GitLab', status: 'done', icon: 'i-simple-icons:gitlab', detail: 'ready' },
      { id: 'p59', title: 'Bitbucket', status: 'done', icon: 'i-simple-icons:bitbucket', detail: 'ready' },
      { id: 'p60', title: 'DigitalOcean', status: 'done', icon: 'i-simple-icons:digitalocean', detail: 'ready' },
      { id: 'p61', title: 'Contentful', status: 'done', icon: 'i-simple-icons:contentful', detail: 'ready' },
      { id: 'p62', title: 'Supabase', status: 'done', icon: 'i-simple-icons:supabase', detail: 'ready' },
      { id: 'p63', title: 'Convex', status: 'done', icon: 'i-simple-icons:convex', detail: 'ready' },
      { id: 'p64', title: 'Prisma', status: 'done', icon: 'i-simple-icons:prisma', detail: 'ready' },
      { id: 'p65', title: 'Sentry', status: 'done', icon: 'i-simple-icons:sentry', detail: 'ready' },
      { id: 'p66', title: 'Hugging Face', status: 'done', icon: 'i-simple-icons:huggingface', detail: 'ready' },
      { id: 'p67', title: 'Crowdin', status: 'done', icon: 'i-simple-icons:crowdin', detail: 'ready' },
      // ── CRM, finance & business (44) ──────────────────────────────────
      { id: 'p68', title: 'Airtable', status: 'done', icon: 'i-simple-icons:airtable', detail: 'ready' },
      { id: 'p69', title: 'Apaleo', status: 'done', icon: 'i-ph:credit-card', detail: 'ready' },
      { id: 'p70', title: 'Attio', status: 'done', icon: 'i-ph:users', detail: 'ready' },
      { id: 'p71', title: 'Blackbaud', status: 'done', icon: 'i-ph:hand-heart', detail: 'ready' },
      { id: 'p72', title: 'Boldsign', status: 'done', icon: 'i-ph:pen-nib', detail: 'ready' },
      { id: 'p73', title: 'Canva', status: 'done', icon: 'i-simple-icons:canva', detail: 'ready' },
      { id: 'p74', title: 'Capsule CRM', status: 'done', icon: 'i-ph:users-three', detail: 'ready' },
      { id: 'p75', title: 'Dart', status: 'done', icon: 'i-ph:target', detail: 'ready' },
      { id: 'p76', title: 'Dub', status: 'done', icon: 'i-ph:link', detail: 'ready' },
      { id: 'p77', title: 'Dynamics 365', status: 'done', icon: 'i-simple-icons:dynamics365', detail: 'ready' },
      { id: 'p78', title: 'Eventbrite', status: 'done', icon: 'i-simple-icons:eventbrite', detail: 'ready' },
      { id: 'p79', title: 'Exist', status: 'done', icon: 'i-ph:chart-bar', detail: 'ready' },
      { id: 'p80', title: 'Fathom', status: 'done', icon: 'i-simple-icons:fathom', detail: 'ready' },
      { id: 'p81', title: 'Freeagent', status: 'done', icon: 'i-ph:briefcase', detail: 'ready' },
      { id: 'p82', title: 'FreshBooks', status: 'done', icon: 'i-ph:book-open', detail: 'ready' },
      { id: 'p83', title: 'Gorgias', status: 'done', icon: 'i-ph:headset', detail: 'ready' },
      { id: 'p84', title: 'Gumroad', status: 'done', icon: 'i-simple-icons:gumroad', detail: 'ready' },
      { id: 'p85', title: 'Harvest', status: 'done', icon: 'i-ph:clock-countdown', detail: 'ready' },
      { id: 'p86', title: 'HubSpot', status: 'done', icon: 'i-simple-icons:hubspot', detail: 'ready' },
      { id: 'p87', title: 'Intercom', status: 'done', icon: 'i-simple-icons:intercom', detail: 'ready' },
      { id: 'p88', title: 'Kit', status: 'done', icon: 'i-ph:toolbox', detail: 'ready' },
      { id: 'p89', title: 'Linkhut', status: 'done', icon: 'i-ph:link', detail: 'ready' },
      { id: 'p90', title: 'Mailchimp', status: 'done', icon: 'i-simple-icons:mailchimp', detail: 'ready' },
      { id: 'p91', title: 'Moneybird', status: 'done', icon: 'i-ph:money', detail: 'ready' },
      { id: 'p92', title: 'Omnisend', status: 'done', icon: 'i-ph:paper-plane-tilt', detail: 'ready' },
      { id: 'p93', title: 'PagerDuty', status: 'done', icon: 'i-simple-icons:pagerduty', detail: 'ready' },
      { id: 'p94', title: 'Productboard', status: 'done', icon: 'i-ph:presentation', detail: 'ready' },
      { id: 'p95', title: 'Pushbullet', status: 'done', icon: 'i-simple-icons:pushbullet', detail: 'ready' },
      { id: 'p96', title: 'QuickBooks', status: 'done', icon: 'i-simple-icons:quickbooks', detail: 'ready' },
      { id: 'p97', title: 'Roam', status: 'done', icon: 'i-simple-icons:roamresearch', detail: 'ready' },
      { id: 'p98', title: 'Salesforce', status: 'done', icon: 'i-simple-icons:salesforce', detail: 'ready' },
      { id: 'p99', title: 'Servicem8', status: 'done', icon: 'i-ph:wrench', detail: 'ready' },
      { id: 'p100', title: 'Shippo', status: 'done', icon: 'i-ph:truck', detail: 'ready' },
      { id: 'p101', title: 'Splitwise', status: 'done', icon: 'i-ph:divide', detail: 'ready' },
      { id: 'p102', title: 'Square', status: 'done', icon: 'i-simple-icons:square', detail: 'ready' },
      { id: 'p103', title: 'Strava', status: 'done', icon: 'i-simple-icons:strava', detail: 'ready' },
      { id: 'p104', title: 'Stripe', status: 'done', icon: 'i-simple-icons:stripe', detail: 'ready' },
      { id: 'p105', title: 'Ticketmaster', status: 'done', icon: 'i-simple-icons:ticketmaster', detail: 'ready' },
      { id: 'p106', title: 'Timely', status: 'done', icon: 'i-ph:clock', detail: 'ready' },
      { id: 'p107', title: 'Toneden', status: 'done', icon: 'i-ph:music-note', detail: 'ready' },
      { id: 'p108', title: 'WakaTime', status: 'done', icon: 'i-simple-icons:wakatime', detail: 'ready' },
      { id: 'p109', title: 'Yandex', status: 'done', icon: 'i-simple-icons:yandexcloud', detail: 'ready' },
      { id: 'p110', title: 'YNAB', status: 'done', icon: 'i-ph:wallet', detail: 'ready' },
      { id: 'p111', title: 'Zendesk', status: 'done', icon: 'i-simple-icons:zendesk', detail: 'ready' },
      // ── Zoho (7) ──────────────────────────────────────────────────────
      { id: 'p112', title: 'Zoho', status: 'done', icon: 'i-simple-icons:zoho', detail: 'ready' },
      { id: 'p113', title: 'Zoho Bigin', status: 'done', icon: 'i-simple-icons:zoho', detail: 'ready' },
      { id: 'p114', title: 'Zoho Books', status: 'done', icon: 'i-simple-icons:zoho', detail: 'ready' },
      { id: 'p115', title: 'Zoho Desk', status: 'done', icon: 'i-simple-icons:zoho', detail: 'ready' },
      { id: 'p116', title: 'Zoho Inventory', status: 'done', icon: 'i-simple-icons:zoho', detail: 'ready' },
      { id: 'p117', title: 'Zoho Invoice', status: 'done', icon: 'i-simple-icons:zoho', detail: 'ready' },
      { id: 'p118', title: 'Zoho Mail', status: 'done', icon: 'i-simple-icons:zoho', detail: 'ready' },
      // ── Video conferencing (1) ────────────────────────────────────────
      { id: 'p119', title: 'Zoom', status: 'done', icon: 'i-simple-icons:zoom', detail: 'ready' },
    ],
  },
];

/*
 * CanvasChatPanel — a chat area that replaces the nodes library at the bottom
 * of the canvas when the user double-clicks a TRIGGER node (e.g. "On Message").
 * The chat is scoped to the trigger that opened it (canvasChatTriggerId) so
 * each trigger can carry its own conversation. A header strip shows the trigger
 * name + a back button to return to the nodes library; the body is a scrollable
 * message list; the footer is a text input + send button.
 *
 * The chat is purely client-side for now (no LLM wired up) — sending a message
 * echoes an acknowledgement so the user can see the round-trip work. The
 * messages persist for the panel's lifetime (per trigger id) in a ref so
 * switching away and back keeps the conversation.
 *
 * The panel occupies the SAME height + position as ActionStepsBar (var
 * --nodes-library-height) so the swap reads as one panel sliding/fading out
 * while the other slides in — the AnimatePresence in CanvasBottomPanel drives
 * the smooth cross-fade.
 */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
}

/*
 * Per-trigger message history. Keyed by trigger instance id so each trigger's
 * chat is independent. Lives in a module-scoped Map (not React state) so it
 * survives the panel being unmounted/remounted during the library↔chat swap —
 * React state would be lost on unmount.
 */
const canvasChatHistories = new Map<string, ChatMessage[]>();

function CanvasChatPanel() {
  const triggerId = useStore(canvasChatTriggerId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  /*
   * Re-entry guard ref. React state (isRunning) isn't updated synchronously,
   * so a second send() call in the same tick (e.g. a synthetic keydown firing
   * twice, or a double-click on the send button) would pass the isRunning
   * check + kick off a SECOND runCanvasAutomation — doubling every message.
   * The ref flips synchronously on entry, so the second call bails immediately.
   */
  const sendingRef = useRef(false);

  // Load the trigger's history when the trigger id changes.
  useEffect(() => {
    if (triggerId) {
      setMessages(canvasChatHistories.get(triggerId) ?? []);
    }
  }, [triggerId]);

  // Persist messages to the history map + autoscroll to the latest message.
  useEffect(() => {
    if (triggerId) {
      canvasChatHistories.set(triggerId, messages);
    }

    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, triggerId]);

  /*
   * send — runs the automation. The typed text is the trigger's INPUT: it's
   * appended as a user message, then runCanvasAutomation is invoked scoped to
   * the trigger that opened this chat. Each node's execution lights up the
   * node on the canvas (pulse) AND streams an assistant message into the chat
   * describing what that node did — so the user sees the automation's output
   * appear in the chat area as it flows through the graph.
   *
   * If the automation isn't wired (no trigger, or trigger not connected to a
   * downstream node), a single assistant error message is appended instead.
   * The input is cleared after the user message is appended; isRunning gates
   * re-entry so a second send can't start while the walk is still running.
   */
  const send = () => {
    const text = input.trim();

    // Synchronous re-entry guard FIRST. React state (isRunning) isn't updated
    // until React commits, so a same-tick second send() (e.g. a synthetic
    // keydown firing twice, or a button click + a form submit) would pass the
    // state check + kick off a SECOND runCanvasAutomation — doubling every
    // message. The ref flips synchronously here, so the second call bails
    // immediately.
    if (!text || !triggerId || isRunning || sendingRef.current) {
      return;
    }

    sendingRef.current = true;

    /*
     * Accumulate the run's messages in a ref array + replace the WHOLE messages
     * state on each step (not append). This makes the setMessages updater
     * idempotent — React 18 dev double-invokes functional updaters with the same
     * prev, so an append would double every message. Replacing with the full
     * accumulated array is stable across the double-invoke (same input → same
     * output), so React keeps one result + no duplication.
     */
    const accumulated: ChatMessage[] = [
      { id: `m-${Date.now()}-u`, role: 'user', text, ts: Date.now() },
    ];
    setMessages((prev) => [...prev, ...accumulated]);
    setInput('');
    setIsRunning(true);

    runCanvasAutomation({
      triggerNodeId: triggerId,
      input: text,
      onStep: (node, description) => {
        /*
         * Only show messages for AI-powered nodes (agent + llm) — these are
         * the nodes that generate the REAL AI output the user wants to see.
         * Skip the trigger's "fired — received" echo, utility nodes' "executed"
         * line, memory/sticky placeholders — the user asked for ONLY the exact
         * AI output to appear in the chat, not the per-node execution trace.
         */
        if (node.kind !== 'agent' && node.kind !== 'llm') {
          return;
        }

        accumulated.push({ id: `m-${Date.now()}-${accumulated.length}-a`, role: 'assistant', text: description, ts: Date.now() });
        // Replace the whole state with prev + accumulated. Idempotent: the same
        // accumulated array is produced regardless of how many times the updater
        // runs, so React's double-invoke in dev doesn't duplicate messages.
        setMessages((prev) => {
          // Find where the accumulated block starts in prev (right after the
          // last message that's NOT in accumulated). Simpler: drop any prior
          // accumulated messages (by id prefix) + re-append the full accumulated.
          const base = prev.filter((m) => !accumulated.some((a) => a.id === m.id));
          return [...base, ...accumulated];
        });
      },
    }).then((result) => {
      setIsRunning(false);
      sendingRef.current = false;

      /*
       * Only append a message on ERROR (e.g. "trigger not connected"). On
       * success, DON'T append the "✓ Automation complete" status — the user
       * asked for ONLY the AI output to show in the chat, not the per-run
       * execution status. The user sees the AI's response + nothing else.
       */
      if (result.error) {
        accumulated.push({ id: `m-${Date.now()}-${accumulated.length}-err`, role: 'assistant', text: result.error, ts: Date.now() });
        setMessages((prev) => {
          const base = prev.filter((m) => !accumulated.some((a) => a.id === m.id));
          return [...base, ...accumulated];
        });
      }
    });
  };

  return (
    <div className={styles.CanvasChatPanel}>
      <div className={styles.CanvasChatHeader}>
        <span className={styles.CanvasChatHeaderIcon} aria-hidden>
          <span className="i-ph:chats-circle" />
        </span>
        <span className={styles.CanvasChatHeaderTitle}>
          Trigger chat{triggerId ? ` · ${triggerId.slice(-6)}` : ''}
        </span>
        <button
          type="button"
          className={styles.CanvasChatCloseBtn}
          onClick={() => closeCanvasChat()}
          aria-label="Close chat — show nodes library"
          title="Close chat — show nodes library"
        >
          <span className="i-ph:x" />
        </button>
      </div>
      <div ref={scrollRef} className={styles.CanvasChatBody}>
        {messages.length === 0 ? (
          <div className={styles.CanvasChatEmpty}>
            <span className="i-ph:chat-teardrop-dots" aria-hidden />
            <span>Double-click sent messages here. This chat is scoped to the trigger you opened.</span>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={classNames(styles.CanvasChatMessage, m.role === 'user' ? styles.CanvasChatMessageUser : styles.CanvasChatMessageAssistant)}
            >
              <span className={styles.CanvasChatMessageText}>{m.text}</span>
            </div>
          ))
        )}
      </div>
      <div className={styles.CanvasChatFooter}>
        <input
          className={styles.CanvasChatInput}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          // Disable input while the automation is running so the user can't
          // queue a second send mid-walk.
          disabled={isRunning}
          placeholder={isRunning ? 'Running automation…' : 'Type a message + Enter to run the automation…'}
          aria-label="Message for this trigger"
        />
        <button
          type="button"
          className={classNames(styles.CanvasChatSendBtn, isRunning && styles.CanvasChatSendBtnRunning)}
          onClick={send}
          disabled={!input.trim() || isRunning}
          aria-label={isRunning ? 'Running…' : 'Send message'}
          title={isRunning ? 'Running…' : 'Send'}
        >
          <span className={isRunning ? 'i-ph:spinner-gap animate-spin' : 'i-ph:paper-plane-tilt'} />
        </button>
      </div>
    </div>
  );
}

/*
 * CanvasBottomPanel — the swap container for the bottom of the canvas. Renders
 * EITHER the nodes library (ActionStepsBar) OR the chat (CanvasChatPanel),
 * cross-fading between them with AnimatePresence so the swap is smooth (the
 * outgoing panel fades/slides out while the incoming one fades/slides in).
 *
 * Both panels occupy the SAME slot (same height via var
 * --nodes-library-height, same position) so there's no layout jump — only the
 * content cross-fades. The canvas above stays put.
 */
function CanvasBottomPanel() {
  const mode = useStore(canvasPanelMode);

  return (
    <div className={styles.CanvasBottomPanel}>
      <AnimatePresence initial={false} mode="popLayout">
        {mode === 'chat' ? (
          <motion.div
            key="chat"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -24 }}
            transition={{ duration: 0.22, ease: cubicEasingFn }}
            className={styles.CanvasBottomPanelLayer}
          >
            <CanvasChatPanel />
          </motion.div>
        ) : (
          <motion.div
            key="library"
            initial={{ opacity: 0, y: -24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.22, ease: cubicEasingFn }}
            className={styles.CanvasBottomPanelLayer}
          >
            <ActionStepsBar />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/*
 * NodePropertiesPanel — a modal overlay that opens when the user double-clicks
 * a UTILITY node (kind==='action') on the canvas. Appears in the CENTER of the
 * canvas as a modal that BLURS the canvas behind it (backdrop-filter: blur).
 * Shows config fields specific to the node's type (e.g. Wait shows a duration
 * field, JSON Filter shows key/value fields, etc.). The user can edit the
 * fields + close the panel (× button, Done button, or Escape) to apply the
 * config. The config is stored on the CanvasNode's `config` field + read by
 * executeNode when the automation runs.
 *
 * Each utility node type has a different set of config fields. The fields are
 * defined inline below — a helper returns the field schema for a given node
 * title, and the panel renders them dynamically.
 */
interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select';
  default?: string;
  options?: string[];
  placeholder?: string;
}

function getConfigFields(nodeTitle: string): ConfigField[] {
  const t = nodeTitle.toLowerCase();

  if (t === 'wait' || t.includes('delay')) {
    return [{ key: 'duration', label: 'Duration (seconds)', type: 'text', default: '2' }];
  }

  if (t.includes('html → image') || t.includes('html to image')) {
    return [{ key: 'html', label: 'HTML content', type: 'textarea', placeholder: '<div>Hello</div>' }];
  }

  if (t.includes('image control')) {
    return [
      { key: 'action', label: 'Action', type: 'text', default: 'resize', placeholder: 'resize / crop / filter' },
      { key: 'width', label: 'Width (px)', type: 'text', default: '100' },
      { key: 'height', label: 'Height (px)', type: 'text', default: '100' },
    ];
  }

  if (t.includes('html → pptx') || t.includes('html to pptx')) {
    return [{ key: 'html', label: 'HTML content', type: 'textarea' }];
  }

  if (t.includes('html → xlsx') || t.includes('html to xlsx')) {
    return [{ key: 'html', label: 'HTML content', type: 'textarea' }];
  }

  if (t.includes('html → docx') || t.includes('html to docx')) {
    return [{ key: 'html', label: 'HTML content', type: 'textarea' }];
  }

  if (t.includes('json filter')) {
    return [
      { key: 'key', label: 'Filter key (optional)', type: 'text', placeholder: 'name' },
      { key: 'value', label: 'Filter value (optional)', type: 'text', placeholder: 'John' },
    ];
  }

  if (t.includes('text → file') || t.includes('text to file')) {
    return [{ key: 'filename', label: 'Filename', type: 'text', default: 'output.txt' }];
  }

  if (t.includes('text merge')) {
    return [{ key: 'separator', label: 'Separator', type: 'text', default: ' ', placeholder: ' ' }];
  }

  if (t.includes('text split')) {
    return [{ key: 'delimiter', label: 'Delimiter (empty = whitespace)', type: 'text', placeholder: ',' }];
  }

  if (t.includes('regex')) {
    return [{ key: 'pattern', label: 'Regex pattern (empty = auto-detect)', type: 'text', placeholder: '\\d+' }];
  }

  if (t.includes('text case')) {
    return [{ key: 'mode', label: 'Case mode', type: 'select', default: 'upper', options: ['upper', 'lower', 'title'] }];
  }

  if (t.includes('counter')) {
    return [{ key: 'varName', label: 'Variable name', type: 'text', default: '__counter' }];
  }

  if (t.includes('base64')) {
    return [{ key: 'mode', label: 'Mode', type: 'select', default: 'auto', options: ['auto', 'encode', 'decode'] }];
  }

  if (t.includes('hash')) {
    return [{ key: 'algorithm', label: 'Algorithm', type: 'select', default: 'djb2', options: ['djb2'] }];
  }

  if (t.includes('template')) {
    return [{ key: 'template', label: 'Template (use {{varName}})', type: 'textarea', placeholder: 'Hello {{name}}!' }];
  }

  if (t.includes('ai if')) {
    return [{ key: 'condition', label: 'Condition prompt', type: 'textarea', placeholder: 'Is the input a question?' }];
  }

  if (t.includes('database')) {
    return [{ key: 'query', label: 'Query', type: 'textarea', placeholder: 'SELECT * FROM users' }];
  }

  if (t.includes('file input')) {
    return [{ key: 'accept', label: 'Accept', type: 'text', default: '*/*' }];
  }

  if (t.includes('host')) {
    return [{ key: 'port', label: 'Port', type: 'text', default: '3000' }];
  }

  if (t.includes('skill')) {
    return [{ key: 'skillName', label: 'Skill name', type: 'text', placeholder: 'web-search' }];
  }

  // Preview, Text Stats, URL Encode — no config needed.
  return [];
}

function NodePropertiesPanel() {
  const panelNodeId = useStore(propertiesPanelNodeId);
  const nodes = useStore(canvasNodes);

  // Close on Escape.
  useEffect(() => {
    if (!panelNodeId) {
      return undefined;
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeNodeProperties();
      }
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [panelNodeId]);

  if (!panelNodeId) {
    return null;
  }

  const node = nodes.find((n) => n.id === panelNodeId);

  if (!node) {
    return null;
  }

  const fields = getConfigFields(node.title);

  return (
    <div
      className={styles.NodePropertiesOverlay}
      onPointerDown={(e) => {
        // Close when clicking the backdrop (not the panel itself).
        if (e.target === e.currentTarget) {
          closeNodeProperties();
        }
      }}
    >
      <div className={styles.NodePropertiesPanel}>
        {/* Header */}
        <div className={styles.NodePropertiesHeader}>
          <span className={styles.NodePropertiesHeaderIcon} aria-hidden>
            <span className={node.icon} />
          </span>
          <span className={styles.NodePropertiesHeaderTitle}>{node.title}</span>
          <button
            type="button"
            className={styles.NodePropertiesCloseBtn}
            onClick={() => closeNodeProperties()}
            aria-label="Close properties"
            title="Close (Esc)"
          >
            <span className="i-ph:x" />
          </button>
        </div>

        {/* Body — config fields */}
        <div className={styles.NodePropertiesBody}>
          {fields.length === 0 ? (
            <div className={styles.NodePropertiesHint}>
              This node has no configuration. It processes its input automatically.
            </div>
          ) : (
            fields.map((field) => (
              <div key={field.key} className={styles.NodePropertiesField}>
                <label className={styles.NodePropertiesLabel} htmlFor={`cfg-${field.key}`}>
                  {field.label}
                </label>
                {field.type === 'textarea' ? (
                  <textarea
                    id={`cfg-${field.key}`}
                    className={styles.NodePropertiesTextarea}
                    value={getNodeConfig(node, field.key, field.default ?? '')}
                    placeholder={field.placeholder ?? ''}
                    onChange={(e) => setNodeConfig(node.id, field.key, e.target.value)}
                  />
                ) : field.type === 'select' ? (
                  <select
                    id={`cfg-${field.key}`}
                    className={styles.NodePropertiesSelect}
                    value={getNodeConfig(node, field.key, field.default ?? '')}
                    onChange={(e) => setNodeConfig(node.id, field.key, e.target.value)}
                  >
                    {field.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`cfg-${field.key}`}
                    type="text"
                    className={styles.NodePropertiesInput}
                    value={getNodeConfig(node, field.key, field.default ?? '')}
                    placeholder={field.placeholder ?? ''}
                    onChange={(e) => setNodeConfig(node.id, field.key, e.target.value)}
                  />
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className={styles.NodePropertiesFooter}>
          <button
            type="button"
            className={styles.NodePropertiesDoneBtn}
            onClick={() => closeNodeProperties()}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/*
 * MemoryTreePanel — a modal overlay that opens when the user double-clicks a
 * MEMORY node on the canvas. Draws a NEURAL NETWORK on an HTML <canvas> that
 * GROWS as memory increases — each stored exchange adds new neurons + synaptic
 * connections to the network. The visualization shows:
 *   - Glowing cyan neurons (circles) arranged in layers (input → hidden → output)
 *   - Synaptic connections (lines) between neurons in adjacent layers
 *   - Each exchange adds a new "hidden layer" of neurons + connects it to the
 *     previous layer, so the network gets DEEPER as memory grows
 *   - Pulsing/animated connections on active paths
 *
 * The panel contains ONLY the neural network visualization — no message cards
 * or text content. The user sees the network structure grow as the AI
 * accumulates memory, like watching a brain form new synaptic connections.
 */
function MemoryTreePanel() {
  const panelNodeId = useStore(memoryTreePanelNodeId);
  const nodes = useStore(canvasNodes);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);

  // Close on Escape.
  useEffect(() => {
    if (!panelNodeId) {
      return undefined;
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMemoryTreePanel();
      }
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [panelNodeId]);

  // Draw the radial neural network + animate.
  useEffect(() => {
    if (!panelNodeId || !canvasRef.current) {
      return;
    }

    const cnv = canvasRef.current;
    const ctx = cnv.getContext('2d');

    if (!ctx) {
      return;
    }

    const neuralState = getNeuralMemory(panelNodeId);
    const exchangeCount = neuralState.neurons.length;

    const rect = cnv.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    cnv.width = w * 2;
    cnv.height = h * 2;
    ctx.scale(2, 2);

    // White background (matching the reference image).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    if (exchangeCount === 0) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Neural memory is empty.', w / 2, h / 2);
      ctx.fillText('Run the automation to form synaptic connections.', w / 2, h / 2 + 20);
      return;
    }

    // ── Draw the REAL neural memory as a RADIAL DENDRITIC NETWORK ──
    //
    // Matching the reference image: a RADIAL pattern with a CONCENTRIC CORE
    // (nested rings of nodes acting as the "soma"/nucleus) + DENDRITIC
    // BRANCHES radiating outward in ALL directions (360°). Pure black on
    // pure white. STRAIGHT lines (not curved). Dots at every node.
    //
    // Structure:
    //   - Core: 1 centre node → ring 1 (~8 nodes) → ring 2 (~16) → ring 3 (~24)
    //     → ring 4 (~32). Adjacent rings connected by straight lines.
    //     Adjacent nodes within each ring connected (forming closed loops).
    //   - Outer dendrites: from ring 4, ~16-20 primary branches radiate
    //     outward. Each splits into 2-3 sub-branches (recursive, 3-4 levels)
    //     ending in terminal node dots.
    //   - The core + ring count scales with memory (more exchanges = more
    //     rings + more dendritic branches).
    //   - STRAIGHT lines only (geometric, not organic).
    //   - Solid black dots at every junction + tip.
    //   - NO cross-connections between outer branches (strictly radial).
    //   - NO glow, NO gradient — flat, stark, vector-like.

    const cx = w / 2;
    const cy = h / 2;
    const maxRadius = Math.min(w, h) * 0.45;

    // Core ring count: grows with memory (base 3 + 1 per exchange, max 5).
    const coreRings = Math.min(3 + Math.floor(exchangeCount / 2), 5);

    // ── Build the CONCENTRIC CORE ──
    interface CoreNode { x: number; y: number; r: number; ring: number; idx: number; }
    const coreNodes: CoreNode[] = [];
    const rings: CoreNode[][] = [];

    for (let ring = 0; ring < coreRings; ring++) {
      const ringNodes: CoreNode[] = [];
      const count = ring === 0 ? 1 : Math.min(4 + ring * 6 + exchangeCount, 40);
      const radius = ring === 0 ? 0 : (maxRadius * 0.25 / coreRings) * ring;

      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        const nodeR = ring === 0 ? 3 : Math.max(1.5, 3 - ring * 0.4);
        const node: CoreNode = { x, y, r: nodeR, ring, idx: i };
        ringNodes.push(node);
        coreNodes.push(node);
      }
      rings.push(ringNodes);
    }

    // ── Draw core connections ──
    // Between adjacent rings (radial spokes).
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 0.6;
    ctx.lineCap = 'round';

    for (let ring = 1; ring < rings.length; ring++) {
      const current = rings[ring];
      const prev = rings[ring - 1];

      for (const node of current) {
        // Connect to 1-2 closest nodes in previous ring.
        const dists = prev
          .map((p) => ({ node: p, dist: Math.hypot(p.x - node.x, p.y - node.y) }))
          .sort((a, b) => a.dist - b.dist);
        const connectCount = Math.min(dists.length, ring === 1 ? 1 : 2);
        for (let i = 0; i < connectCount; i++) {
          ctx.beginPath();
          ctx.moveTo(dists[i].node.x, dists[i].node.y);
          ctx.lineTo(node.x, node.y);
          ctx.stroke();
        }
      }
    }

    // Within each ring (closed loop connections).
    for (let ring = 1; ring < rings.length; ring++) {
      const ringNodes = rings[ring];
      for (let i = 0; i < ringNodes.length; i++) {
        const a = ringNodes[i];
        const b = ringNodes[(i + 1) % ringNodes.length];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Draw core node dots.
    ctx.fillStyle = '#000000';
    for (const node of coreNodes) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Build + draw OUTER DENDRITIC BRANCHES ──
    // Radiating outward from the outermost core ring in ALL directions (360°).
    const outerRing = rings[rings.length - 1];
    const dendriteCount = Math.min(12 + exchangeCount * 2, 24);
    const dendriteRadius = maxRadius * 0.75;

    // Recursive dendrite drawing (STRAIGHT lines, fractal splitting).
    const drawDendrite = (
      x: number,
      y: number,
      angle: number,
      length: number,
      thickness: number,
      depth: number,
      seed: number,
    ) => {
      // Terminal: draw a small node dot.
      if (depth <= 0 || length < 3) {
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
        return;
      }

      // Seeded PRNG.
      let s = seed;
      const rnd = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return (s >>> 16) / 65536;
      };

      // STRAIGHT line to branch end (not curved — geometric, matching ref).
      const endX = x + Math.cos(angle) * length;
      const endY = y + Math.sin(angle) * length;

      ctx.strokeStyle = '#000000';
      ctx.lineWidth = thickness;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      // Node dot at junction.
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(endX, endY, Math.max(1, thickness * 0.5), 0, Math.PI * 2);
      ctx.fill();

      // Sub-branches: 2-3 (binary or ternary split).
      const subCount = depth > 2 ? 2 + Math.floor(rnd() * 2) : 2;
      const spread = 0.3 + rnd() * 0.2;

      for (let i = 0; i < subCount; i++) {
        const t = subCount === 1 ? 0 : (i / (subCount - 1) - 0.5) * 2;
        const subAngle = angle + t * spread + (rnd() - 0.5) * 0.15;
        const subLength = length * (0.55 + rnd() * 0.2);
        const subThickness = thickness * 0.6;
        const subSeed = (s + i * 7919 + depth * 31) & 0x7fffffff;
        drawDendrite(endX, endY, subAngle, subLength, subThickness, depth - 1, subSeed);
      }
    };

    // Draw primary dendrites radiating from the outer ring.
    // Each real exchange adds a "dominant" dendrite (angled by its semantic position).
    // Additional filler dendrites fill the gaps between them.
    for (let i = 0; i < dendriteCount; i++) {
      // Angle: evenly distributed + slight jitter.
      const angle = (i / dendriteCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.1;

      // Find the closest node on the outer ring to start from.
      let startNode = outerRing[0];
      let minDist = Infinity;
      for (const node of outerRing) {
        const d = Math.hypot(node.x - (cx + Math.cos(angle) * 10), node.y - (cy + Math.sin(angle) * 10));
        if (d < minDist) {
          minDist = d;
          startNode = node;
        }
      }

      // Check if this dendrite corresponds to a real exchange.
      let isExchangeDendrite = false;
      let act = 0.5;
      if (i < neuralState.neurons.length) {
        isExchangeDendrite = true;
        const n = neuralState.neurons[i];
        act = n.activation;
        // Use the neuron's semantic position for a more organic angle.
        // Map fx (0-1) to angle 0-2π.
        // But keep it roughly at position i for even distribution.
      }

      const length = dendriteRadius * (0.6 + (isExchangeDendrite ? act * 0.4 : Math.random() * 0.3));
      const thickness = isExchangeDendrite ? 1.5 + act * 1.5 : 0.8 + Math.random() * 0.8;
      const depth = isExchangeDendrite ? 4 : 3;
      const seed = Math.floor(Math.random() * 0x7fffffff);

      drawDendrite(startNode.x, startNode.y, angle, length, thickness, depth, seed);
    }
  }, [panelNodeId]);

  if (!panelNodeId) {
    return null;
  }

  const node = nodes.find((n) => n.id === panelNodeId);

  if (!node) {
    return null;
  }

  return (
    <div
      className={styles.MemoryTreeOverlay}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          closeMemoryTreePanel();
        }
      }}
    >
      {/*
        * The panel is a PURE WHITE canvas with the neural network drawn in
        * black. NO header, NO footer, NO border, NO title, NO buttons — just
        * the white surface + the black neural network. Closes on Escape or
        * clicking the overlay backdrop.
        */}
      <canvas
        ref={canvasRef}
        className={styles.MemoryTreeCanvas}
      />
    </div>
  );
}

function ActionStepsBar() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);
  const collapsed = useStore(nodesLibraryCollapsed);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;

    if (!el) {
      return;
    }

    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = scrollRef.current;

    if (!el) {
      return;
    }

    el.addEventListener('scroll', updateScrollState, { passive: true });

    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);

    return () => {
      el.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState]);

  const scrollBy = (dir: 'left' | 'right') => {
    const el = scrollRef.current;

    if (!el) {
      return;
    }

    el.scrollBy({ left: dir === 'right' ? 260 : -260, behavior: 'smooth' });
  };

  return (
    <div className={styles.ActionStepsBar}>
      <div className={styles.ActionStepsHeader}>
        <span className={styles.ActionStepsTitle}>Nodes library</span>
        <div className={styles.ActionStepsHeaderRight}>
          <span className={styles.ActionStepsCount}>
            {SAMPLE_ACTION_SECTIONS.reduce((n, s) => n + s.steps.length, 0)} nodes
          </span>
          {/*
           * Collapse/expand toggle. A simple caret arrow in the top-right of the
           * nodes library header. Clicking collapses the whole library panel
           * downward (hides the scroll area) so the canvas above expands to fill
           * the freed space. Clicking again re-expands it. The caret points down
           * when expanded (click to collapse down) and up when collapsed.
           */}
          <button
            type="button"
            className={styles.LibraryCollapseToggle}
            onClick={toggleNodesLibrary}
            aria-label={collapsed ? 'Expand nodes library' : 'Collapse nodes library'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand nodes library' : 'Collapse nodes library'}
          >
            <span className={collapsed ? 'i-ph:caret-up text-base' : 'i-ph:caret-down text-base'} />
          </button>
        </div>
      </div>
      <div className={styles.ActionStepsScrollWrap}>
        <button
          type="button"
          className={classNames(styles.ScrollBtn, styles.ScrollLeft)}
          onClick={() => scrollBy('left')}
          disabled={!canLeft}
          aria-label="Scroll steps left"
          title="Scroll left"
        >
          <span className="i-ph:caret-left text-base" />
        </button>
        <div
          ref={scrollRef}
          className={classNames(styles.ActionStepsScroll, 'modern-scrollbar')}
        >
          {SAMPLE_ACTION_SECTIONS.map((section) => (
            <Fragment key={section.id}>
              <div
                className={styles.SectionDivider}
                role="separator"
                aria-label={section.label}
                title={section.label}
              >
                <span className={styles.SectionDividerIcon}>
                  <NodeIcon icon={section.icon} />
                </span>
                <span className={styles.SectionDividerLabel}>{section.shortLabel}</span>
              </div>
              {section.steps.map((step) => (
                <ActionStepCard key={step.id} step={step} sectionId={section.id} />
              ))}
            </Fragment>
          ))}
        </div>
        <button
          type="button"
          className={classNames(styles.ScrollBtn, styles.ScrollRight)}
          onClick={() => scrollBy('right')}
          disabled={!canRight}
          aria-label="Scroll steps right"
          title="Scroll right"
        >
          <span className="i-ph:caret-right text-base" />
        </button>
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<ActionStepStatus, string> = {
  done: 'Done',
  running: 'Running',
  queued: 'Queued',
  failed: 'Failed',
};

function ActionStepCard({ step, sectionId }: { step: ActionStep; sectionId: string }) {
  const statusClass = (styles as any)[`status_${step.status}`];
  const source = useStore(dragSource);
  const isDragging = source?.step.id === step.id;

  // Trigger-section nodes render as the distinctive bolt + port card once
  // placed on the canvas. Agent-section nodes share the same dark-square icon
  // chip + outline as triggers (minus the red bolt badge). Every other section
  // uses the default compact card.
  const kind = step.kind ?? (sectionId === 'trigger' ? 'trigger' : sectionId === 'agent' ? 'agent' : 'action');

  /*
   * Begin a library→canvas drag. We do NOT call setPointerCapture here: if we
   * did, pointerup would fire on the card instead of the canvas, and the
   * canvas could never receive the drop. Instead the global DragController
   * tracks pointermove, and the canvas's own onPointerUp handles the drop.
   *
   * The offset (pointer position relative to the card's top-left) is recorded
   * so the DragGhost stays anchored to the exact grab point rather than
   * snapping its corner to the cursor. The `kind` is carried on the step so
   * the placed node knows which card variant to render.
   */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) {
      return; // ignore non-primary buttons
    }

    const rect = e.currentTarget.getBoundingClientRect();
    startDrag(
      { ...step, kind },
      e.clientX,
      e.clientY,
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
    e.preventDefault();
  };

  return (
    <div
      className={classNames(
        styles.ActionStepCard,
        statusClass,
        styles.DraggableCard,
        isDragging && styles.DraggableCardDragging,
      )}
      onPointerDown={onPointerDown}
      title={`Drag "${step.title}" onto the canvas`}
    >
      <div className={styles.ActionStepIcon}>
        <NodeIcon icon={step.icon} />
      </div>
      <div className={styles.ActionStepBody}>
        <div className={styles.ActionStepTitle}>{step.title}</div>
        {step.detail && <div className={styles.ActionStepDetail}>{step.detail}</div>}
      </div>
      <div className={styles.ActionStepStatus}>
        <span className={classNames(styles.ActionStepStatusIcon)}>
          {step.status === 'done' && <span className="i-ph:check" />}
          {step.status === 'running' && (
            <span className={classNames('i-ph:spinner-gap', styles.spin)} />
          )}
          {step.status === 'queued' && <span className="i-ph:clock" />}
          {step.status === 'failed' && <span className="i-ph:x" />}
        </span>
        {STATUS_LABELS[step.status]}
      </div>
    </div>
  );
}
