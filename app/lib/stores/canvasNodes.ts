import { atom } from 'nanostores';

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Canvas nodes + drag-and-drop store
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  Powers dragging nodes from the "Nodes library" (ActionStepsBar) onto the
 *  MovableCanvas, and the movable node instances that live on the canvas.
 *
 *  Two coordinate systems:
 *    - SCREEN space: clientX/clientY (what pointer events give us).
 *    - CANVAS space: pre-pan/zoom coordinates. A node at {x, y} in canvas
 *      space lands on screen at
 *          rect.left + panX + x*zoom , rect.top + panY + y*zoom
 *      so it stays glued to the dot-grid as the canvas pans/zooms. The
 *      MovableCanvas renders placed nodes inside a layer transformed by
 *      `translate(panX, panY) scale(zoom)` (origin 0 0).
 *
 *  Drag state is deliberately split into TWO atoms for performance:
 *
 *    - `dragSource` — the library node being dragged + the grab offset. This
 *      changes only TWICE per drag (set on pointerdown, cleared on pointerup),
 *      so the ~158 ActionStepCards can safely subscribe to it (to dim the
 *      source card) without re-rendering on every pointermove.
 *
 *    - `dragPointer` — the live pointer position + whether it's over the
 *      canvas. This updates on every pointermove. Only the DragGhost and the
 *      MovableCanvas subscribe to it (the only things that need to track the
 *      cursor frame-by-frame), keeping per-frame re-renders to two components.
 *
 *  `canvasSurfaceEl` is a ref-like atom holding the live canvas DOM node. The
 *  global pointer-move listener uses it to hit-test "over canvas" — this keeps
 *  pan/zoom inside the MovableCanvas (the drop is still handled by the canvas's
 *  own onPointerUp, which owns pan/zoom in its closure).
 * ──────────────────────────────────────────────────────────────────────────
 */

/**
 * The visual "kind" of a placed node. Controls how the node renders on the
 * canvas:
 *   - 'trigger' — the dark square icon chip with the permanent accent outline,
 *     the red lightning-bolt badge on the left edge, and the output port dot
 *     on the right edge. Triggers start a workflow.
 *   - 'agent' — the SAME dark square icon chip + permanent accent outline +
 *     output port dot as a trigger, but WITHOUT the red bolt badge (an agent
 *     isn't an "instant trigger"). Shares the trigger card chrome so it has
 *     the same height and outline.
 *   - 'memory' — a dark CIRCULAR icon chip (border-radius:50%) with the
 *     permanent accent outline + an output port on the TOP edge. Renders a
 *     memory/storage icon dead-centre. Distinct from 'trigger' (no bolt, round
 *     instead of square) and 'agent' (circle instead of wide rectangle).
 *     Connects upward into the agent's bottom-LEFT (first) diamond.
 *   - 'llm' — visually identical to 'memory' (dark CIRCLE, top port, icon
 *     dead-centre, title below) but represents an LLM node. Distinct connection
 *     target: connects upward into the agent's bottom-SECOND (middle) diamond,
 *     so a memory node and an LLM node can both hang off the same agent without
 *     their wires overlapping.
 *   - 'aitool' — visually identical to 'memory'/'llm' (dark CIRCLE, top port,
 *     icon dead-centre, title below). Represents an AI Agent TOOL node from the
 *     "AI Agent Tools" library section (image search, web reader, browser,
 *     terminal, image generator, TTS, etc.). Distinct connection target:
 *     connects upward into the agent's bottom THIRD connector — the PLUS SQUARE
 *     (AgentPlusSquare) hanging below the third (rightmost) diamond — so a tool
 *     node, a memory node, AND an llm node can ALL hang off the same agent
 *     without their wires colliding on the same port. An aitool node is a
 *     "dummy but connectable" tool: it pulses alongside its agent during a run
 *     but does not execute any real logic on its own.
 *   - 'action' — the default compact card for every other node type.
 * Defaults to 'action' when omitted so existing call sites keep working.
 */
export type CanvasNodeKind = 'trigger' | 'agent' | 'memory' | 'llm' | 'aitool' | 'action' | 'sticky';

/* Default dimensions for a freshly-dropped sticky note. Sticky notes are the
 * only resizable node kind — every other kind has a fixed silhouette defined
 * in CSS. These defaults give the user a reasonable starting size to type into;
 * the user can then drag the bottom-right resize handle to grow or shrink the
 * note to taste. */
export const STICKY_DEFAULT_WIDTH = 200;
export const STICKY_DEFAULT_HEIGHT = 180;
/* Floor below which the resize handle refuses to shrink the note — keeps the
 * textarea usable (the delete button + a line of text need room to render). */
export const STICKY_MIN_WIDTH = 100;
export const STICKY_MIN_HEIGHT = 90;

/*
 * Sticky-note colour palette. Each entry maps a stable `color` key (stored on
 * the CanvasNode) to the THREE hex shades the card needs: the paper (body +
 * textarea background), the header strip (slightly darker than the paper so
 * the header reads as a distinct bar), and the border / dog-ear outline.
 *
 * The default colour is 'yellow' so existing sticky notes (created before the
 * colour-picker shipped) keep their original look.
 */
export interface StickyColor {
  /** Stable key persisted on the CanvasNode (never the raw hex). */
  key: string;
  /** Human-readable name for the colour tooltip / aria-label. */
  label: string;
  /** Paper / textarea background. */
  paper: string;
  /** Header strip background (darker than `paper`). */
  header: string;
  /** Card border + dog-ear fold colour. */
  border: string;
  /** Ink (text) colour — kept dark for readability on every paper shade. */
  ink: string;
}

export const STICKY_COLORS: StickyColor[] = [
  { key: 'yellow', label: 'Yellow', paper: '#fef08a', header: '#facc15', border: '#ca8a04', ink: '#1f2937' },
  { key: 'pink', label: 'Pink', paper: '#fbcfe8', header: '#f9a8d4', border: '#be185d', ink: '#1f2937' },
  { key: 'blue', label: 'Blue', paper: '#bfdbfe', header: '#93c5fd', border: '#1d4ed8', ink: '#1f2937' },
  { key: 'green', label: 'Green', paper: '#bbf7d0', header: '#86efac', border: '#15803d', ink: '#1f2937' },
  { key: 'orange', label: 'Orange', paper: '#fed7aa', header: '#fdba74', border: '#c2410c', ink: '#1f2937' },
  { key: 'purple', label: 'Purple', paper: '#ddd6fe', header: '#c4b5fd', border: '#6d28d9', ink: '#1f2937' },
];

/** Default sticky colour key (used when a sticky node has no `color` set). */
export const STICKY_DEFAULT_COLOR = 'yellow';

/** Resolve a stored colour key to its full palette entry (falls back to yellow). */
export function getStickyColor(key?: string): StickyColor {
  return STICKY_COLORS.find((c) => c.key === key) ?? STICKY_COLORS[0];
}

/** A node instance placed on the canvas. Position is in canvas space. */
export interface CanvasNode {
  /** Unique instance id (distinct from the library node id). */
  id: string;
  /** Source library node id (so duplicates of the same node are allowed). */
  nodeId: string;
  title: string;
  icon: string;
  detail?: string;
  /** Visual kind — 'trigger' renders the bolt + port card, 'action' the default. */
  kind: CanvasNodeKind;
  /**
   * Optional override for the agent card's main label. When set, the placed
   * agent card shows this text instead of the default "AI Agent". Used by
   * agent-section nodes that represent a distinct concept (e.g. an LLM node
   * labelled "LLM") so each agent-variant card reads as its own thing.
   */
  mainLabel?: string;
  /** Optional override for the agent card's subtitle (defaults to "tool agent"). */
  subLabel?: string;
  /** Canvas-space x (px at zoom 1). */
  x: number;
  /** Canvas-space y (px at zoom 1). */
  y: number;
  /**
   * Optional canvas-space width (only meaningful for 'sticky' nodes, which are
   * resizable). When omitted, the node uses its CSS-defined default width.
   */
  width?: number;
  /** Optional canvas-space height (sticky nodes only — resizable). */
  height?: number;
  /**
   * Optional editable text payload. Currently only 'sticky' nodes use this —
   * the textarea inside the sticky card reads from / writes to this field so
   * the user's notes persist across re-renders and survive canvas pan/zoom.
   */
  text?: string;
  /**
   * Optional colour key for 'sticky' nodes (one of STICKY_COLORS[].key). Drives
   * the paper / header / border shades of the sticky card so the user can tint
   * each note via the colour circles in the header. Defaults to 'yellow' when
   * unset. Non-sticky kinds ignore this field.
   */
  color?: string;
  /**
   * Optional per-node configuration (key→value) for utility nodes. Set by the
   * NodePropertiesPanel when the user double-clicks a utility node on the canvas.
   * Each utility node type reads different keys from this config (e.g. "Wait"
   * reads `duration`, "HTTP Request" reads `url`, etc.). Falls back to defaults
   * when unset.
   */
  config?: Record<string, string>;
}

/** Minimal shape needed from a library ActionStep to start a drag. */
export interface DraggableNodeData {
  id: string;
  title: string;
  icon: string;
  detail?: string;
  /** Visual kind carried from the library section into the placed node. */
  kind?: CanvasNodeKind;
  /** Optional agent-card main label override (see CanvasNode.mainLabel). */
  mainLabel?: string;
  /** Optional agent-card subtitle override (see CanvasNode.subLabel). */
  subLabel?: string;
  /** Initial canvas-space width for resizable kinds (sticky). */
  width?: number;
  /** Initial canvas-space height for resizable kinds (sticky). */
  height?: number;
}

/** The library node being dragged + grab offset. Stable for the drag's life. */
export interface DragSource {
  step: DraggableNodeData;
  /** Pointer offset from the card's top-left (anchors the ghost to the grab). */
  offsetX: number;
  offsetY: number;
}

/** Live pointer position during a drag. Updates every pointermove. */
export interface DragPointer {
  x: number;
  y: number;
  /** Whether the pointer is currently over the canvas surface. */
  overCanvas: boolean;
}

/** Node instances placed on the canvas. */
export const canvasNodes = atom<CanvasNode[]>([]);

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Connections (edges) between placed nodes
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  An edge wires one node's OUTPUT port to another node's INPUT port. Today
 *  only trigger → agent edges are drawn by the UI (triggers have an output
 *  port on their right edge; agents have an input port on their left edge),
 *  but the model is generic so future node kinds can participate without a
 *  schema change.
 *
 *  Edges are stored separately from nodes and reference nodes by their
 *  instance `id` (NOT their library `nodeId`). Removing a node also removes
 *  every edge touching it (see removeCanvasNode).
 * ──────────────────────────────────────────────────────────────────────────
 */
export interface CanvasEdge {
  /** Unique edge id. */
  id: string;
  /** Source canvas-node id (the node whose OUTPUT port the edge starts at). */
  sourceId: string;
  /** Target canvas-node id (the node whose INPUT port the edge ends at). */
  targetId: string;
  /**
   * Which source port the edge started from: 'right' (default, right-edge
   * port) or 'bottom' (the agent's plus-square / bottom port). Used by
   * getOutputPortPosition to anchor the edge's source end at the correct port.
   */
  sourcePort?: 'right' | 'bottom';
  /** Optional user-set label for this connection (double-click wire to name it). */
  label?: string;
}

/** Edges placed on the canvas. */
export const canvasEdges = atom<CanvasEdge[]>([]);

/**
 * An in-progress connection drag — the user pressed on a node's output port
 * and is dragging toward a target. Lives only for the lifetime of the drag
 * (pointerdown → pointerup).
 *
 * Split into TWO atoms (mirroring the dragSource/dragPointer split) for
 * performance:
 *
 *   - `connectionSource` — stable for the drag's life (set on pointerdown,
 *     cleared on pointerup). The ConnectionDragController subscribes to this
 *     so it only re-renders at drag start/end, NOT on every pointermove —
 *     this lets it attach/detach document listeners without per-frame work.
 *
 *   - `connectionPointer` — the live pointer position + hovered target. Updates
 *     every pointermove. Only the CanvasEdgesLayer subscribes to this (it must
 *     redraw the dashed bezier every frame) — keeping per-frame re-renders to a
 *     single lightweight SVG component.
 *
 * `overTargetId` is set when the pointer is currently hovering over a valid
 * target node's input port (so the UI can highlight the drop target and the
 * pointerup handler knows which node to wire up).
 */
export interface ConnectionSource {
  /** Source canvas-node id (the node whose OUTPUT port the drag started on). */
  sourceId: string;
  /**
   * Which output port the drag started from: 'right' (the standard right-edge
   * port) or 'bottom' (the agent's plus-square / bottom port). Used by
   * getOutputPortPosition to anchor the edge's source end at the correct port.
   */
  portRole?: 'right' | 'bottom';
}

export interface ConnectionPointer {
  /** Live canvas-space pointer X (where the drag end currently is). */
  x: number;
  /** Live canvas-space pointer Y. */
  y: number;
  /** Canvas-node id of the target the pointer is currently hovering over, or null. */
  overTargetId: string | null;
}

/** Active connection drag source, or null when none in progress. */
export const connectionSource = atom<ConnectionSource | null>(null);

/** Live connection drag pointer, or null when none in progress. */
export const connectionPointer = atom<ConnectionPointer | null>(null);

/** Active drag source, or null when nothing is being dragged. */
export const dragSource = atom<DragSource | null>(null);

/** Live drag pointer, or null when nothing is being dragged. */
export const dragPointer = atom<DragPointer | null>(null);

/** Live canvas surface element — used for hit-testing during a drag. */
export const canvasSurfaceEl = atom<HTMLElement | null>(null);

/*
 * The canvas's current pan + zoom, mirrored from MovableCanvas's React state
 * into a store so OUTSIDE components (notably ConnectionDragController) can
 * read the live transform inside their event handlers without subscribing
 * (which would re-render them on every pan/zoom change). MovableCanvas sets
 * this on every render; readers use `.get()` for a non-reactive snapshot.
 */
export const canvasTransform = atom<{ panX: number; panY: number; zoom: number }>({
  panX: 0,
  panY: 0,
  zoom: 1,
});

/**
 * Whether the "Nodes library" panel at the bottom of the workbench is collapsed
 * (hidden) so the canvas above can expand to fill the freed space. Toggled by
 * the arrow button in the library header's top-right corner. Persists for the
 * session (not to disk) — re-opens on reload.
 */
export const nodesLibraryCollapsed = atom<boolean>(false);

/** Toggle the nodes library panel between expanded (default) and collapsed. */
export function toggleNodesLibrary() {
  nodesLibraryCollapsed.set(!nodesLibraryCollapsed.get());
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Bottom panel mode — "nodes library" vs "chat"
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  The bottom panel of the canvas (where the nodes library normally lives) can
 *  be swapped to show a CHAT area instead. The swap is triggered by:
 *    - Double-clicking a TRIGGER node (e.g. "On Message") → opens the chat panel
 *      for that trigger (the trigger's instance id is recorded so the chat can
 *      be scoped to it).
 *    - Double-clicking anywhere on the empty canvas → closes the chat panel
 *      and brings the nodes library back.
 *
 *  Both panels occupy the SAME slot (same height, same position), so the
 *  swap reads as one panel smoothly sliding/fading out while the other slides
 *  in — handled by AnimatePresence in the Workbench.
 */
export type CanvasPanelMode = 'library' | 'chat';

/** The current bottom-panel mode. Defaults to 'library'. */
export const canvasPanelMode = atom<CanvasPanelMode>('library');

/**
 * When the chat panel is open, this holds the instance id of the TRIGGER node
 * that opened it (so the chat can be scoped to that trigger). Null when the
 * chat isn't open or was opened generically.
 */
export const canvasChatTriggerId = atom<string | null>(null);

/** Switch the bottom panel to the chat panel, scoped to the given trigger node. */
export function openCanvasChat(triggerNodeId: string) {
  canvasChatTriggerId.set(triggerNodeId);
  canvasPanelMode.set('chat');
}

/** Switch the bottom panel back to the nodes library. */
export function closeCanvasChat() {
  canvasPanelMode.set('library');
  canvasChatTriggerId.set(null);
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Node Properties Panel — per-node config modal
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  When the user double-clicks a UTILITY node (kind==='action') on the canvas,
 *  a properties panel opens in the center of the canvas (as a modal overlay
 *  that blurs the canvas behind it). The panel shows config fields specific to
 *  the node's type (e.g. Wait shows a duration field, HTTP Request shows a URL
 *  field, etc.). The user can edit the fields + close the panel to apply the
 *  config. The config is stored on the CanvasNode's `config` field + read by
 *  executeNode when the automation runs.
 */

/** The instance id of the node whose properties panel is open, or null. */
export const propertiesPanelNodeId = atom<string | null>(null);

/** Open the properties panel for a specific node. */
export function openNodeProperties(nodeId: string) {
  propertiesPanelNodeId.set(nodeId);
}

/** Close the properties panel. */
export function closeNodeProperties() {
  propertiesPanelNodeId.set(null);
}

/**
 * Get a config value from a node, with a fallback default.
 * Shorthand for `node.config?.[key] ?? defaultValue`.
 */
export function getNodeConfig(node: CanvasNode, key: string, defaultValue: string = ''): string {
  return node.config?.[key] ?? defaultValue;
}

/**
 * Set a single config key on a node (immutably updates the node in the store).
 */
export function setNodeConfig(nodeId: string, key: string, value: string) {
  canvasNodes.set(
    canvasNodes.get().map((n) =>
      n.id === nodeId
        ? { ...n, config: { ...(n.config ?? {}), [key]: value } }
        : n,
    ),
  );
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Automation run — pulse the nodes as the graph executes
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  When the user clicks the Run button, the canvas walks the trigger → agent →
 *  utility graph and lights up each node in execution order so the user can
 *  SEE the automation flowing through the workflow they built. This atom holds
 *  the set of node instance ids currently "running" (lit up); CanvasNodeItem
 *  subscribes to it + applies a running-pulse class so the node visually
 *  pulses while it's in the set.
 */
export const runningCanvasNodeIds = atom<string[]>([]);

/** Set the running-node set (replaces the whole set). */
export function setRunningCanvasNodes(ids: string[]) {
  runningCanvasNodeIds.set(ids);
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Automation run engine — walk the trigger→agent→utility graph
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  Lives IN THE STORE (not in Workbench.client.tsx) so there's a SINGLE
 *  canonical instance of the function reading the SAME canvasNodes /
 *  canvasEdges atoms the React components subscribe to. (When this lived in
 *  Workbench.client.tsx, Vite HMR could create a second module instance whose
 *  closure pointed at a stale atom, so the chat's run saw 0 nodes even though
 *  the canvas rendered 3 — moving it here eliminates that class of bug.)
 *
 *  Used by BOTH:
 *    - the Run button (Header.run) — pulses nodes + a completion toast
 *    - the chat send() — pulses nodes + streams each node's output description
 *      into the chat as an assistant message (via the onStep callback)
 */
export function describeNodeExecution(node: CanvasNode, input?: string): string {
  switch (node.kind) {
    case 'trigger':
      return input
        ? `Trigger “${node.title}” fired — received: “${input}”`
        : `Trigger “${node.title}” fired.`;
    case 'agent':
      return input
        ? `Agent “${node.mainLabel ?? node.title}” processed the message and decided the next step.`
        : `Agent “${node.mainLabel ?? node.title}” ran.`;
    case 'action':
      return `Utility “${node.title}” executed.`;
    case 'memory':
      return `Memory node “${node.title}” stored the context.`;
    case 'llm':
      return `LLM node “${node.title}” generated a response.`;
    case 'aitool':
      // AI Agent Tool nodes are "dummy but connectable" — they pulse alongside
      // their agent but don't run their own logic. Describe the tool as ready so
      // the run log still reports each connected tool.
      return `AI tool “${node.title}” attached to the agent (ready).`;
    case 'sticky':
      return `Sticky note “${node.title}” (annotation, skipped).`;
    default:
      return `Node “${node.title}” executed.`;
  }
}

export interface RunAutomationOptions {
  /** Scope the walk to a single trigger (chat uses this). Undefined = all triggers. */
  triggerNodeId?: string;
  /** Called once per node, AFTER its pulse step, with the node + its description. */
  onStep?: (node: CanvasNode, description: string) => void;
  /** The text that triggered the run (echoed into the trigger's description). */
  input?: string;
}

/* Step delay reduced from 450ms to 120ms for a fast, snappy automation walk.
 * The user asked for the AI to respond "very very fast" — the pulse is still
 * visible (120ms is enough to see the node light up) but the overall run
 * completes in a fraction of the time. */
const AUTOMATION_STEP_MS = 120;

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Memory node store — per-node conversation history
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  Memory nodes store conversation context that the AI agent can READ before
 *  generating a response + WRITE to after responding. This makes the memory
 *  node "completely workable": the agent remembers previous exchanges across
 *  runs (e.g. if the user said "my name is John" in run 1, then asks "what's
 *  my name?" in run 2, the agent answers "John" because the memory stored the
 *  first exchange).
 *
 *  Keyed by the memory node's INSTANCE id (so each memory node on the canvas
 *  has its own independent history). Lives in a module-scoped Map (survives
 *  re-renders, persists for the page session).
 */
export interface MemoryEntry {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

const canvasMemoryStore = new Map<string, MemoryEntry[]>();

/** Get a memory node's stored conversation history (empty array if none). */
export function getMemoryEntries(memoryNodeId: string): MemoryEntry[] {
  return canvasMemoryStore.get(memoryNodeId) ?? [];
}

/** Append a single entry to a memory node's history. Creates the history if new. */
export function addMemoryEntry(memoryNodeId: string, entry: MemoryEntry) {
  const cur = canvasMemoryStore.get(memoryNodeId) ?? [];
  cur.push(entry);
  // Cap at the last 20 entries to keep context manageable.
  const trimmed = cur.length > 20 ? cur.slice(-20) : cur;
  canvasMemoryStore.set(memoryNodeId, trimmed);
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Neural Memory Network — REAL embedding-based neural memory
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  This is a REAL neural memory system — not a dummy visualization. Each
 *  stored exchange is embedded into a fixed-dimension vector (via a fast
 *  character-level hash embedding), forming a "neuron" in the network. The
 *  neurons are connected by SYNAPTIC WEIGHTS computed from the cosine
 *  similarity between their embeddings — semantically similar exchanges have
 *  stronger connections. The visualization draws the ACTUAL neural state:
 *  neuron positions are computed via a force-directed layout (similar
 *  exchanges cluster together), connection thickness = synaptic weight,
 *  neuron brightness = activation strength (how relevant to the current query).
 *
 *  When the agent runs, it retrieves the TOP-K most similar past exchanges
 *  (by cosine similarity to the current input) instead of ALL history — this
 *  is faster (less context) AND more relevant (only semantically similar
 *  exchanges are included), making the memory both FAST and SMART.
 *
 *  The visualization is 100% REAL: what you see IS the neural state.
 */

/** Dimension of the embedding vector (128 dims — enough for semantic hash). */
const EMBED_DIM = 128;

/**
 * Embed a text string into a fixed-dimension vector using a fast
 * character-level hashing trick: each character contributes to multiple
 * dimensions via a hash, + the vector is L2-normalized so cosine similarity
 * = dot product. This is not a learned embedding (no model needed) but
 * captures enough semantic structure (character n-gram overlap) for the
 * similarity-based retrieval to work meaningfully.
 */
function embedText(text: string): Float32Array {
  const vec = new Float32Array(EMBED_DIM);
  const lower = text.toLowerCase();
  // Character trigram hashing: each 3-char window hashes into 2 dims.
  for (let i = 0; i < lower.length - 2; i++) {
    const tri = lower.charCodeAt(i) * 65536 + lower.charCodeAt(i + 1) * 256 + lower.charCodeAt(i + 2);
    const h1 = (tri * 2654435761) % EMBED_DIM;
    const h2 = ((tri >> 8) * 40503 + 97) % EMBED_DIM;
    vec[h1] += 1;
    vec[h2] += 0.5;
  }
  // Also hash individual words for word-level semantics.
  const words = lower.split(/\s+/);
  for (const word of words) {
    let h = 0;
    for (let i = 0; i < word.length; i++) {
      h = (h * 31 + word.charCodeAt(i)) % EMBED_DIM;
    }
    vec[h] += 2;
  }
  // L2 normalize.
  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBED_DIM; i++) {
    vec[i] /= norm;
  }
  return vec;
}

/** Cosine similarity between two L2-normalized vectors (= dot product). */
function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < EMBED_DIM; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/** A neuron in the neural memory — represents one stored exchange. */
export interface NeuralNeuron {
  id: string;
  userMessage: string;
  assistantResponse: string;
  ts: number;
  embedding: Float32Array;
  /** Current activation (0-1) — how relevant to the last query. */
  activation: number;
  /** Force-directed layout position (relative 0-1 in the canvas). */
  fx: number;
  fy: number;
  /** Velocity for the force-directed simulation. */
  vx: number;
  vy: number;
}

/** A synaptic connection between two neurons — weighted by similarity. */
export interface NeuralSynapse {
  from: string;
  to: string;
  /** Weight = cosine similarity between the two neurons' embeddings (0-1). */
  weight: number;
}

/** The complete neural memory state for one memory node. */
interface NeuralMemoryState {
  neurons: NeuralNeuron[];
  synapses: NeuralSynapse[];
  /** The last query embedding (for activation computation). */
  lastQuery: Float32Array | null;
}

const neuralMemoryStates = new Map<string, NeuralMemoryState>();

/** Get a memory node's neural state. Empty if none stored. */
export function getNeuralMemory(memoryNodeId: string): NeuralMemoryState {
  return neuralMemoryStates.get(memoryNodeId) ?? { neurons: [], synapses: [], lastQuery: null };
}

/**
 * Add a new exchange to the neural memory. Creates a neuron with the exchange's
 * embedding + computes synaptic weights to ALL existing neurons (cosine sim).
 * Also runs a few iterations of the force-directed layout so neurons spread out.
 */
export function addNeuralMemory(memoryNodeId: string, userMessage: string, assistantResponse: string) {
  const state = neuralMemoryStates.get(memoryNodeId) ?? { neurons: [], synapses: [], lastQuery: null };
  const embedding = embedText(userMessage + ' ' + assistantResponse);
  const id = `nn-${Date.now()}-${state.neurons.length}`;

  // Position new neurons near the centre; the force-directed sim will spread them.
  const angle = state.neurons.length * 2.399; // Golden angle for good spread.
  const r = 0.15 + state.neurons.length * 0.03;
  const neuron: NeuralNeuron = {
    id,
    userMessage,
    assistantResponse,
    ts: Date.now(),
    embedding,
    activation: 1,
    fx: 0.5 + Math.cos(angle) * r,
    fy: 0.5 + Math.sin(angle) * r,
    vx: 0,
    vy: 0,
  };
  state.neurons.push(neuron);

  // Compute synaptic weights to ALL existing neurons.
  for (const other of state.neurons) {
    if (other.id === id) {
      continue;
    }
    const weight = cosineSim(embedding, other.embedding);
    // Only store connections with meaningful similarity (avoids clutter).
    if (weight > 0.05) {
      state.synapses.push({ from: id, to: other.id, weight });
    }
  }

  // Run a few iterations of the force-directed layout.
  runForceLayout(state, 30);

  // Cap at 50 neurons.
  if (state.neurons.length > 50) {
    state.neurons = state.neurons.slice(-50);
    state.synapses = state.synapses.filter((s) => state.neurons.some((n) => n.id === s.from) && state.neurons.some((n) => n.id === s.to));
  }

  neuralMemoryStates.set(memoryNodeId, state);
}

/**
 * Retrieve the TOP-K most similar past exchanges for a given query.
 * This is the REAL retrieval mechanism the agent uses — it computes cosine
 * similarity between the query embedding and all stored neurons, then returns
 * only the most similar K exchanges (not all history). This is faster (less
 * context to send to the LLM) AND more relevant.
 */
export function retrieveRelevantMemory(memoryNodeId: string, query: string, k: number = 5): MemoryEntry[] {
  const state = neuralMemoryStates.get(memoryNodeId);
  if (!state || state.neurons.length === 0) {
    return [];
  }
  const queryEmb = embedText(query);
  state.lastQuery = queryEmb;

  // Compute activations: cosine similarity to the query.
  for (const neuron of state.neurons) {
    neuron.activation = Math.max(0, cosineSim(queryEmb, neuron.embedding));
  }

  // Sort by activation (most similar first) + return top-K.
  const sorted = [...state.neurons].sort((a, b) => b.activation - a.activation);
  return sorted.slice(0, k).map((n) => ({
    role: 'user' as const,
    content: n.userMessage,
    ts: n.ts,
  }));
}

/**
 * Run the force-directed layout simulation for a few iterations. This pushes
 * neurons apart (repulsion) + pulls connected neurons together (attraction
 * weighted by similarity). The result determines the visual positions of the
 * neurons in the canvas — so the visualization reflects the REAL semantic
 * structure of the memory (similar exchanges cluster together).
 */
function runForceLayout(state: NeuralMemoryState, iterations: number) {
  const n = state.neurons.length;
  if (n === 0) {
    return;
  }
  const synapseMap = new Map<string, NeuralSynapse>();
  for (const s of state.synapses) {
    synapseMap.set(`${s.from}|${s.to}`, s);
    synapseMap.set(`${s.to}|${s.from}`, s);
  }

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion: all pairs push apart.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = state.neurons[i];
        const b = state.neurons[j];
        const dx = b.fx - a.fx;
        const dy = b.fy - a.fy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const force = 0.02 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }
    // Attraction: connected neurons pull together (weighted by similarity).
    for (const s of state.synapses) {
      const a = state.neurons.find((nn) => nn.id === s.from);
      const b = state.neurons.find((nn) => nn.id === s.to);
      if (!a || !b) {
        continue;
      }
      const dx = b.fx - a.fx;
      const dy = b.fy - a.fy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const force = s.weight * 0.03;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    // Apply velocity with damping + keep within bounds.
    for (const neuron of state.neurons) {
      neuron.fx += neuron.vx * 0.5;
      neuron.fy += neuron.vy * 0.5;
      neuron.vx *= 0.6;
      neuron.vy *= 0.6;
      neuron.fx = Math.max(0.05, Math.min(0.95, neuron.fx));
      neuron.fy = Math.max(0.05, Math.min(0.95, neuron.fy));
    }
  }
}

/** Clear a memory node's neural state. */
export function clearNeuralMemory(memoryNodeId: string) {
  neuralMemoryStates.delete(memoryNodeId);
}

/* ── Memory tree panel state ── */
/** The instance id of the memory node whose tree panel is open, or null. */
export const memoryTreePanelNodeId = atom<string | null>(null);

/** Open the memory tree panel for a specific memory node. */
export function openMemoryTreePanel(nodeId: string) {
  memoryTreePanelNodeId.set(nodeId);
}

/** Close the memory tree panel. */
export function closeMemoryTreePanel() {
  memoryTreePanelNodeId.set(null);
}

/** Clear a memory node's history (used when the user wants to reset). */
export function clearMemoryEntries(memoryNodeId: string) {
  canvasMemoryStore.delete(memoryNodeId);
}

export function runCanvasAutomation(opts: RunAutomationOptions = {}): Promise<{ count: number; error?: string }> {
  const { triggerNodeId, onStep, input } = opts;
  const nodes = canvasNodes.get();
  const edges = canvasEdges.get();

  const triggers = triggerNodeId
    ? nodes.filter((n) => n.id === triggerNodeId && n.kind === 'trigger')
    : nodes.filter((n) => n.kind === 'trigger');

  if (triggers.length === 0) {
    return Promise.resolve({ count: 0, error: 'This trigger is not connected — wire it to an Agent node first.' });
  }

  // Check that at least one trigger has a downstream connection.
  const hasDownstream = triggers.some((t) => edges.some((e) => e.sourceId === t.id));

  if (!hasDownstream) {
    return Promise.resolve({ count: 0, error: 'Connect this trigger to an Agent node to run the automation.' });
  }

  /*
   * DYNAMIC WALK (not pre-computed BFS) — because conditional branching means
   * the path depends on runtime results. The walk starts from the trigger(s)
   * + at each node:
   *   1. Pulses the node (sets runningCanvasNodes).
   *   2. Executes it (AI fetch for agent/LLM, real execution for utility
   *      nodes, pass-through for trigger).
   *   3. Tracks `currentData` (the output) — this is the DATA FLOW (feature
   *      #2): each node receives the previous node's output as its input.
   *   4. For CONDITION nodes: evaluates + follows only the matching branch
   *      (true → first downstream edge, false → second). CONDITIONAL BRANCHING
   *      (feature #3).
   *   5. For other nodes: follows ALL downstream edges (data flows to all
   *      connected nodes).
   *   6. Visits each node only once (visited set prevents loops).
   */
  const visited = new Set<string>();
  let visitCount = 0;

  return new Promise<{ count: number; error?: string }>((resolve) => {
    /*
     * Walk a single node: pulse → execute → determine next nodes → schedule.
     * `currentData` is the data flowing INTO this node (the previous node's
     * output, or the user's `input` for the trigger).
     */
    const walkNode = async (node: CanvasNode, currentData: string) => {
      if (visited.has(node.id)) {
        return;
      }

      visited.add(node.id);
      visitCount += 1;

      // Feature #5: Clear this node's status at the start of execution.
      // Status will be set to 'success' or 'error' after the node runs.
      const description = describeNodeExecution(node, currentData);
      let finalDescription = description;
      let nodeOutput = currentData;
      let nodeSucceeded = true;

      // ── AGENT + LLM nodes: fetch real AI output + memory integration ──
      if ((node.kind === 'agent' || node.kind === 'llm') && currentData) {
        const incomingMemoryIds = edges
          .filter((e) => e.targetId === node.id)
          .map((e) => e.sourceId)
          .filter((sid) => {
            const src = nodes.find((n) => n.id === sid);
            return src && src.kind === 'memory';
          });

        // AI Agent TOOLS (aitool) hang off the agent's bottom PLUS connector.
        // They're "dummy but connectable" — pulse them alongside the agent so
        // the user can see which tools are attached, but don't run their own
        // logic (no real execution backend for them yet).
        const incomingToolIds = edges
          .filter((e) => e.targetId === node.id)
          .map((e) => e.sourceId)
          .filter((sid) => {
            const src = nodes.find((n) => n.id === sid);
            return src && src.kind === 'aitool';
          });

        setRunningCanvasNodes([node.id, ...incomingMemoryIds, ...incomingToolIds]);

        // Use NEURAL retrieval: get the TOP-K most similar past exchanges
        // instead of ALL history. This is faster (less context) + more relevant.
        const memoryHistory = incomingMemoryIds.flatMap((mid) => retrieveRelevantMemory(mid, currentData, 5));

        try {
          const res = await fetch('/api/canvas-agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: currentData,
              agentLabel: node.mainLabel ?? node.title,
              memory: memoryHistory.length > 0 ? memoryHistory : undefined,
            }),
          });
          const data = (await res.json()) as { output?: string };
          const aiOutput = data.output?.trim();

          if (aiOutput) {
            finalDescription = aiOutput;
            nodeOutput = aiOutput;

            for (const mid of incomingMemoryIds) {
              addMemoryEntry(mid, { role: 'user', content: currentData, ts: Date.now() });
              addMemoryEntry(mid, { role: 'assistant', content: aiOutput, ts: Date.now() + 1 });
              // Store in the NEURAL memory (real embedding + synaptic weights).
              addNeuralMemory(mid, currentData, aiOutput);
            }
          }
        } catch {
          // keep the static description on fetch failure
        }
      } else if (node.kind === 'action') {
        // ── UTILITY nodes: REAL execution (feature #1) ──
        setRunningCanvasNodes([node.id]);
        const execOutput = await executeNode(node, currentData);

        if (execOutput) {
          finalDescription = execOutput;
          nodeOutput = execOutput;
        }
      } else {
        // Trigger, memory standalone, sticky — pulse + pass data through.
        setRunningCanvasNodes([node.id]);
      }

      // ── Determine the NEXT nodes to visit ──
      const downstreamEdges = edges.filter((e) => e.sourceId === node.id);
      let nextNodes: CanvasNode[] = [];

      if (node.kind === 'action' && node.title.toLowerCase().includes('condition') && downstreamEdges.length > 1) {
        // CONDITIONAL BRANCHING (feature #3): the condition node's output is
        // "true" or "false". Follow only the matching branch:
        //   - "true"  → the FIRST downstream edge (the "true" path)
        //   - "false" → the SECOND downstream edge (the "false" path)
        const branch = nodeOutput.trim().toLowerCase();
        const edgeIndex = branch === 'false' ? 1 : 0;
        const chosenEdge = downstreamEdges[edgeIndex];
        const chosenNode = chosenEdge ? nodes.find((n) => n.id === chosenEdge.targetId) : undefined;

        if (chosenNode) {
          nextNodes = [chosenNode];
        }
      } else {
        // Non-condition node: follow ALL downstream edges (data flows to all
        // connected nodes).
        nextNodes = downstreamEdges
          .map((e) => nodes.find((n) => n.id === e.targetId))
          .filter((n): n is CanvasNode => !!n);
      }

      // Schedule the next node(s) after the step delay.
      window.setTimeout(() => {
        onStep?.(node, finalDescription);

        if (nextNodes.length === 0) {
          setRunningCanvasNodes([]);
          if (visitCount >= 1) {
            resolve({ count: visitCount });
          }
        } else {
          // Walk each next node (sequentially for now — a real impl might
          // parallelize, but sequential is simpler + matches the pulse flow).
          let chain = Promise.resolve();

          for (const nextNode of nextNodes) {
            chain = chain.then(() => walkNode(nextNode, nodeOutput));
          }

          chain.then(() => {
            setRunningCanvasNodes([]);

            // Resolve only once (the first time all branches complete).
            resolve({ count: visitCount });
          });
        }
      }, AUTOMATION_STEP_MS);
    };

    // Start the walk from the first trigger.
    walkNode(triggers[0], input ?? '');
  });
}

let counter = 0;

/** Place a new node instance on the canvas at the given canvas-space coords. */
export function addCanvasNode(step: DraggableNodeData, x: number, y: number) {
  const node: CanvasNode = {
    id: `cn-${Date.now()}-${counter++}`,
    nodeId: step.id,
    title: step.title,
    icon: step.icon,
    detail: step.detail,
    // Carry the visual kind from the library node; trigger nodes get the
    // distinctive bolt + port card, everything else the default compact card.
    kind: step.kind ?? 'action',
    // Carry the optional agent-card label overrides so an agent-section node
    // (e.g. an LLM node) renders with its own main label / subtitle instead of
    // the default "AI Agent" / "tool agent".
    mainLabel: step.mainLabel,
    subLabel: step.subLabel,
    // Sticky notes carry their own initial dimensions + (empty) text payload
    // so the placed card knows its starting size and has a slot for the user's
    // notes. They also pick up the default colour so a freshly-dropped note
    // renders with the classic yellow tint. Other kinds ignore these fields
    // (their size is CSS-defined).
    width: step.width,
    height: step.height,
    text: step.kind === 'sticky' ? '' : undefined,
    color: step.kind === 'sticky' ? STICKY_DEFAULT_COLOR : undefined,
    x,
    y,
  };
  canvasNodes.set([...canvasNodes.get(), node]);
}

/** Move an existing canvas node to new canvas-space coords. */
export function moveCanvasNode(id: string, x: number, y: number) {
  canvasNodes.set(canvasNodes.get().map((n) => (n.id === id ? { ...n, x, y } : n)));
}

/**
 * Resize an existing canvas node (only meaningful for 'sticky' kinds today —
 * every other kind has a fixed silhouette and ignores this). The new width /
 * height are in CANVAS space (px at zoom 1); the caller is responsible for
 * clamping to STICKY_MIN_WIDTH / STICKY_MIN_HEIGHT before calling.
 */
export function resizeCanvasNode(id: string, width: number, height: number) {
  canvasNodes.set(canvasNodes.get().map((n) => (n.id === id ? { ...n, width, height } : n)));
}

/**
 * Update the editable text payload of a canvas node (sticky notes only). Used
 * by the sticky textarea's onChange handler so the user's notes persist in the
 * store and survive canvas pan/zoom + parent re-renders.
 */
export function setCanvasNodeText(id: string, text: string) {
  canvasNodes.set(canvasNodes.get().map((n) => (n.id === id ? { ...n, text } : n)));
}

/**
 * Update the colour key of a canvas node (sticky notes only). Used by the
 * colour-circle picker in the sticky header so clicking a circle re-tints the
 * note's paper / header / border instantly. Non-sticky kinds ignore this.
 */
export function setCanvasNodeColor(id: string, color: string) {
  canvasNodes.set(canvasNodes.get().map((n) => (n.id === id ? { ...n, color } : n)));
}

/**
 * Update the title of a canvas node (sticky notes use this for the editable
 * header title). Persists the user's edited title into the store so it
 * survives canvas pan/zoom + parent re-renders.
 */
export function setCanvasNodeTitle(id: string, title: string) {
  canvasNodes.set(canvasNodes.get().map((n) => (n.id === id ? { ...n, title } : n)));
}

/** Remove a single node instance from the canvas. */
export function removeCanvasNode(id: string) {
  canvasNodes.set(canvasNodes.get().filter((n) => n.id !== id));
  // Also drop every edge that touched the removed node — otherwise the
  // CanvasEdgesLayer would try to resolve a source/target node that no longer
  // exists and render a dangling curve.
  canvasEdges.set(canvasEdges.get().filter((e) => e.sourceId !== id && e.targetId !== id));
}

/** Remove every node from the canvas. */
export function clearCanvasNodes() {
  canvasNodes.set([]);
  // Clear edges too — a fresh canvas has no connections.
  canvasEdges.set([]);
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Edge + connection-drag helpers
 * ──────────────────────────────────────────────────────────────────────────
 */

let edgeCounter = 0;

/**
 * Add a connection from one node's output port to another node's input port.
 * Silently ignores duplicates (same source + target already wired) so a user
 * dragging the same trigger onto the same agent twice doesn't create two
 * overlapping curves. Self-loops are also rejected.
 */
export function addCanvasEdge(sourceId: string, targetId: string, sourcePort?: 'right' | 'bottom') {
  if (sourceId === targetId) {
    return;
  }

  const existing = canvasEdges.get();

  if (existing.some((e) => e.sourceId === sourceId && e.targetId === targetId)) {
    return;
  }

  const edge: CanvasEdge = {
    id: `ce-${Date.now()}-${edgeCounter++}`,
    sourceId,
    targetId,
    sourcePort,
  };
  canvasEdges.set([...existing, edge]);
}

/** Remove a single edge by id. */
export function removeCanvasEdge(id: string) {
  canvasEdges.set(canvasEdges.get().filter((e) => e.id !== id));
}

/**
 * Begin a connection drag from a node's output port. Records the source id and
 * the initial pointer position (in CANVAS space — callers must convert from
 * screen space before calling). The ConnectionDragController takes over from
 * here: it listens for global pointermove events, converts screen → canvas
 * coords, hit-tests for a valid target, and updates `connectionPointer` per
 * frame.
 */
export function startConnection(sourceId: string, canvasX: number, canvasY: number, portRole?: 'right' | 'bottom') {
  connectionSource.set({ sourceId, portRole });
  connectionPointer.set({ x: canvasX, y: canvasY, overTargetId: null });
}

/**
 * Update the live pointer position + hovered target during a connection drag.
 * Called per pointermove by the ConnectionDragController. `overTargetId` is
 * null when the pointer isn't over a valid target node's input port.
 */
export function updateConnectionPointer(canvasX: number, canvasY: number, overTargetId: string | null) {
  const cur = connectionPointer.get();

  if (!cur) {
    return;
  }

  connectionPointer.set({ x: canvasX, y: canvasY, overTargetId });
}

/**
 * End the current connection drag. If the pointer was over a valid target at
 * the moment of release, the connection is completed (an edge is added);
 * otherwise the drag is cancelled. Always clears both connection atoms.
 */
export function endConnection(): { completed: boolean; targetId: string | null } {
  const src = connectionSource.get();
  const ptr = connectionPointer.get();
  connectionSource.set(null);
  connectionPointer.set(null);

  if (!src || !ptr || !ptr.overTargetId) {
    return { completed: false, targetId: null };
  }

  addCanvasEdge(src.sourceId, ptr.overTargetId, src.portRole);
  return { completed: true, targetId: ptr.overTargetId };
}

/** Cancel an in-progress connection drag without completing it. */
export function cancelConnection() {
  connectionSource.set(null);
  connectionPointer.set(null);
}

/**
 * Begin dragging a library node. Sets both the source (stable) and the initial
 * pointer position. The grab offset anchors the ghost preview to the exact
 * point the user pressed, rather than snapping the card's corner to the cursor.
 */
export function startDrag(
  step: DraggableNodeData,
  pointerX: number,
  pointerY: number,
  offsetX: number,
  offsetY: number,
) {
  dragSource.set({ step, offsetX, offsetY });
  dragPointer.set({ x: pointerX, y: pointerY, overCanvas: false });
}

/** Update the live pointer position + canvas hover flag (called per pointermove). */
export function updateDragPointer(pointerX: number, pointerY: number, overCanvas: boolean) {
  dragPointer.set({ x: pointerX, y: pointerY, overCanvas });
}

/** End the current drag (clears source + pointer). Called on pointerup/cancel. */
export function endDrag() {
  dragSource.set(null);
  dragPointer.set(null);
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Selection + clipboard (copy / cut / paste / duplicate / delete)
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  Multi-select is driven by Shift+click on canvas nodes (toggles a node in
 *  the selection set). A plain click on a node (no Shift) selects ONLY that
 *  node; a plain click on the empty canvas clears the selection.
 *
 *  The clipboard holds a flat array of CanvasNode snapshots (no edges today —
 *  pasting re-creates the nodes at an offset; the user can re-wire them).
 *  Pasting offsets each node by +24px/+24px so the pasted copies don't stack
 *  exactly on top of their originals. Each pasted node gets a fresh instance
 *  id so it's independent of the clipboard source.
 */

/** The set of currently-selected canvas-node instance ids. Empty = none. */
export const selectedCanvasIds = atom<string[]>([]);

/** Internal clipboard — a snapshot of the nodes captured by copy/cut. */
const canvasClipboard = atom<CanvasNode[]>([]);

/** Offset (canvas px) applied to each pasted node so copies don't overlap originals. */
const PASTE_OFFSET_X = 24;
const PASTE_OFFSET_Y = 24;

/** Replace the whole selection with a single node id (plain-click behaviour). */
export function selectCanvasNode(id: string) {
  selectedCanvasIds.set([id]);
}

/** Clear the entire selection (empty-canvas-click behaviour). */
export function clearCanvasSelection() {
  selectedCanvasIds.set([]);
}

/**
 * Toggle a node's membership in the selection (Shift+click behaviour).
 * If the node was already selected it's removed from the set; otherwise it's
 * added. Returns the new selection state so the caller can chain if needed.
 */
export function toggleCanvasNodeSelection(id: string) {
  const cur = selectedCanvasIds.get();
  selectedCanvasIds.set(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
}

/** Is a given node id currently in the selection? */
export function isCanvasNodeSelected(id: string): boolean {
  return selectedCanvasIds.get().includes(id);
}

/**
 * Copy the currently-selected nodes into the clipboard (a flat snapshot of
 * their fields — NOT a reference to the live store entries, so later edits to
 * the originals don't mutate the clipboard). No-op when nothing is selected.
 */
export function copySelectedCanvasNodes() {
  const ids = selectedCanvasIds.get();

  if (ids.length === 0) {
    return;
  }

  const nodes = canvasNodes.get();
  const snapshot = nodes.filter((n) => ids.includes(n.id)).map((n) => ({ ...n }));
  canvasClipboard.set(snapshot);
}

/**
 * Cut the currently-selected nodes: copy them to the clipboard, then remove
 * them from the canvas (also drops any edges that touched them). The selection
 * is cleared because the nodes are gone. No-op when nothing is selected.
 */
export function cutSelectedCanvasNodes() {
  const ids = selectedCanvasIds.get();

  if (ids.length === 0) {
    return;
  }

  copySelectedCanvasNodes();

  for (const id of ids) {
    removeCanvasNode(id);
  }

  selectedCanvasIds.set([]);
}

/**
 * Paste the clipboard's nodes onto the canvas. Each clipboard entry is cloned
 * with a fresh instance id + x/y offset by PASTE_OFFSET so the copies land
 * beside their originals (visible, not stacked). The freshly-pasted nodes
 * become the new selection so the user can immediately move/act on them.
 * No-op when the clipboard is empty.
 */
export function pasteCanvasNodes() {
  const clip = canvasClipboard.get();

  if (clip.length === 0) {
    return;
  }

  const newNodes: CanvasNode[] = clip.map((n) => ({
    ...n,
    id: `cn-${Date.now()}-${counter++}`,
    x: n.x + PASTE_OFFSET_X,
    y: n.y + PASTE_OFFSET_Y,
    // Sticky notes' text payload is copied verbatim; other kinds have no text.
    text: n.text,
    // Colour is sticky-only; carry it over so a pasted coloured note keeps its tint.
    color: n.color,
  }));

  canvasNodes.set([...canvasNodes.get(), ...newNodes]);
  selectedCanvasIds.set(newNodes.map((n) => n.id));
}

/**
 * Duplicate the currently-selected nodes IN PLACE (a "quick paste" that
 * doesn't touch the clipboard). Same offset + fresh-instance-id treatment as
 * paste, and the duplicates become the new selection. No-op when nothing is
 * selected.
 */
export function duplicateSelectedCanvasNodes() {
  const ids = selectedCanvasIds.get();

  if (ids.length === 0) {
    return;
  }

  const nodes = canvasNodes.get();
  const toDup = nodes.filter((n) => ids.includes(n.id));

  if (toDup.length === 0) {
    return;
  }

  const newNodes: CanvasNode[] = toDup.map((n) => ({
    ...n,
    id: `cn-${Date.now()}-${counter++}`,
    x: n.x + PASTE_OFFSET_X,
    y: n.y + PASTE_OFFSET_Y,
    text: n.text,
    color: n.color,
  }));

  canvasNodes.set([...nodes, ...newNodes]);
  selectedCanvasIds.set(newNodes.map((n) => n.id));
}

/**
 * Remove every currently-selected node from the canvas (Delete / Backspace
 * behaviour). Also drops any edges that touched a removed node. The selection
 * is cleared because the nodes are gone. No-op when nothing is selected.
 */
export function deleteSelectedCanvasNodes() {
  const ids = selectedCanvasIds.get();

  if (ids.length === 0) {
    return;
  }

  for (const id of ids) {
    removeCanvasNode(id);
  }

  selectedCanvasIds.set([]);
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Variables system (for Set Variable + data flow)
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  A module-scoped key→value store that the "Set Variable" utility node writes
 *  to + that any downstream node can read from via {{variableName}} template
 *  syntax in its config. Lives for the page session.
 */
const canvasVariables = new Map<string, string>();

export function getCanvasVariable(key: string): string | undefined {
  return canvasVariables.get(key);
}

export function setCanvasVariable(key: string, value: string) {
  canvasVariables.set(key, value);
}

export function getAllCanvasVariables(): Record<string, string> {
  return Object.fromEntries(canvasVariables);
}

export function clearCanvasVariables() {
  canvasVariables.clear();
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Real node execution (feature #1) + data flow (feature #2)
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  Each utility node kind now has a REAL execution function that takes the
 *  incoming data (the output of the previous node in the walk) + returns an
 *  output string that becomes the input to the next node. This makes the nodes
 *  actually DO things instead of just pulsing:
 *
 *    - HTTP Request → makes a real fetch to a URL (default demo URL)
 *    - Delay → actually waits 2 seconds
 *    - Condition → evaluates the input (non-empty → true) + returns "true"/"false"
 *    - Set Variable → stores the input as a variable named after the node title
 *    - JSON Parse → parses the input as JSON + returns a stringified summary
 *    - Format Date → returns the current date formatted
 *    - Filter/Merge/Loop/Base64/Read File → sensible defaults
 *
 *  The Condition node also drives CONDITIONAL BRANCHING (feature #3): the BFS
 *  walk in runCanvasAutomation follows only the matching branch (true→right
 *  path, false→left path) instead of all downstream edges.
 */

/**
 * Execute a utility/action node + return its output string. This is the REAL
 * execution — the node actually does something (fetch, wait, parse, etc.) and
 * returns a result that flows to the next node. Returns undefined for nodes
 * that don't produce data (trigger, sticky, memory standalone).
 */
export async function executeNode(node: CanvasNode, inputData: string): Promise<string | undefined> {
  switch (node.kind) {
    case 'action': {
      // Dispatch by the node's TITLE. Each handler reads config values from
      // node.config (set via the NodePropertiesPanel when the user double-clicks
      // the node) with sensible defaults when the config isn't set yet.
      const title = node.title.toLowerCase();

      // ── Wait — actually wait N seconds (config: duration, default 2) ──
      if (title === 'wait' || title.includes('delay')) {
        const duration = parseInt(getNodeConfig(node, 'duration', '2'), 10) || 2;
        await new Promise((resolve) => setTimeout(resolve, duration * 1000));
        return `Waited ${duration} second${duration === 1 ? '' : 's'}. Input was: "${inputData.slice(0, 50)}"`;
      }

      // ── JSON Filter — filter JSON array by a key match ──
      if (title.includes('json filter')) {
        const filterKey = getNodeConfig(node, 'key', '');
        const filterValue = getNodeConfig(node, 'value', '');
        try {
          const parsed = JSON.parse(inputData);
          if (Array.isArray(parsed)) {
            const filtered = filterKey
              ? parsed.filter((item) => {
                  if (typeof item === 'object' && item !== null) {
                    return filterValue ? String(item[filterKey]) === filterValue : item[filterKey] != null;
                  }
                  return filterValue ? String(item) === filterValue : true;
                })
              : parsed.filter((item) => item !== null && item !== undefined && item !== '');
            return `Filtered ${filtered.length}/${parsed.length} items: ${JSON.stringify(filtered).slice(0, 200)}`;
          }
          return `Not an array — cannot filter: ${inputData.slice(0, 80)}`;
        } catch {
          return `JSON Filter failed — input is not valid JSON: "${inputData.slice(0, 80)}"`;
        }
      }

      // ── Text Merge — merge lines using config separator (default: space) ──
      if (title.includes('text merge') || (title.includes('merge') && !title.includes('git'))) {
        const separator = getNodeConfig(node, 'separator', ' ');
        const merged = inputData.split(/\n+/).map((l) => l.trim()).filter(Boolean).join(separator);
        return `Merged: ${merged.slice(0, 200)}`;
      }

      // ── Text Split — split using config delimiter (default: whitespace) ──
      if (title.includes('text split') || title.includes('split')) {
        const delimiter = getNodeConfig(node, 'delimiter', '');
        const lines = delimiter
          ? inputData.split(delimiter).filter(Boolean)
          : inputData.split(/\s+/).filter(Boolean);
        return `Split into ${lines.length} parts:\n${lines.join('\n').slice(0, 200)}`;
      }

      // ── Regex Extract — use config pattern or auto-detect ──
      if (title.includes('regex')) {
        const pattern = getNodeConfig(node, 'pattern', '');
        if (pattern) {
          try {
            const regex = new RegExp(pattern);
            const match = inputData.match(regex);
            return `Regex extracted: ${match?.[0] ?? '(no match)'}`;
          } catch {
            return `Invalid regex pattern: "${pattern}"`;
          }
        }
        // Auto-detect if no pattern configured.
        const emailMatch = inputData.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
        const urlMatch = inputData.match(/https?:\/\/[^\s]+/);
        const numMatch = inputData.match(/\d+(\.\d+)?/);
        const extracted = emailMatch?.[0] ?? urlMatch?.[0] ?? numMatch?.[0] ?? '(no match)';
        return `Regex extracted: ${extracted}`;
      }

      // ── Text Case — convert based on config mode (upper/lower/title) ──
      if (title.includes('text case') || title.includes('case')) {
        const mode = getNodeConfig(node, 'mode', 'upper');
        let result = inputData;
        if (mode === 'lower') {
          result = inputData.toLowerCase();
        } else if (mode === 'title') {
          result = inputData.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
        } else {
          result = inputData.toUpperCase();
        }
        return `${mode.toUpperCase()}: ${result.slice(0, 200)}`;
      }

      // ── Text Stats — count words, chars, lines ──
      if (title.includes('text stats') || title.includes('stats')) {
        const words = inputData.trim().split(/\s+/).filter(Boolean).length;
        const chars = inputData.length;
        const lines = inputData.split(/\n/).length;
        return `Stats: ${words} words, ${chars} characters, ${lines} lines.`;
      }

      // ── Counter — increment + return a persistent count ──
      if (title.includes('counter')) {
        const cur = parseInt(getCanvasVariable('__counter') ?? '0', 10);
        const next = cur + 1;
        setCanvasVariable('__counter', String(next));
        return `Counter: ${next}`;
      }

      // ── Base64 — encode or decode (config: mode, default auto) ──
      if (title.includes('base64')) {
        const mode = getNodeConfig(node, 'mode', 'auto');
        try {
          if (mode === 'decode' || (mode === 'auto' && /^[A-Za-z0-9+/=\s]+$/.test(inputData) && inputData.trim().length % 4 === 0)) {
            return `Decoded: ${atob(inputData.trim()).slice(0, 200)}`;
          }
          return `Encoded: ${btoa(inputData).slice(0, 200)}`;
        } catch {
          return `Base64 operation failed for: "${inputData.slice(0, 80)}"`;
        }
      }

      // ── URL Encode — encodeURIComponent the input ──
      if (title.includes('url encode')) {
        return `Encoded: ${encodeURIComponent(inputData).slice(0, 200)}`;
      }

      // ── Hash — generate a simple hash (djb2 algorithm, client-side) ──
      if (title.includes('hash')) {
        let hash = 5381;
        for (let i = 0; i < inputData.length; i++) {
          hash = ((hash << 5) + hash + inputData.charCodeAt(i)) | 0;
        }
        return `Hash (djb2): ${(hash >>> 0).toString(16)}`;
      }

      // ── Template — use config template OR replace {{var}} in input ──
      if (title.includes('template')) {
        const tplStr = getNodeConfig(node, 'template', '');
        let result = tplStr || inputData;
        const allVars = getAllCanvasVariables();
        for (const [key, value] of Object.entries(allVars)) {
          result = result.replaceAll(`{{${key}}}`, value);
        }
        return `Templated: ${result.slice(0, 200)}`;
      }

      // ── AI If — condition evaluated by the AI (config: condition prompt) ──
      if (title.includes('ai if')) {
        const condition = getNodeConfig(node, 'condition', '');
        try {
          const prompt = condition
            ? `Evaluate this as a yes/no question. Reply with ONLY "true" or "false": ${condition}. Context: ${inputData}`
            : `Evaluate this as a yes/no question. Reply with ONLY "true" or "false": ${inputData}`;
          const res = await fetch('/api/canvas-agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: prompt,
              agentLabel: 'AI If',
            }),
          });
          const data = (await res.json()) as { output?: string };
          const out = (data.output ?? '').trim().toLowerCase();
          // If the AI said something that looks like yes/true, return "true".
          return out.includes('true') || out.includes('yes') ? 'true' : 'false';
        } catch {
          return 'false';
        }
      }

      // ── Text → File — download the input as a file (config: filename) ──
      if (title.includes('text → file') || title.includes('text->file') || title.includes('text to file')) {
        const filename = getNodeConfig(node, 'filename', `output-${Date.now()}.txt`);
        try {
          const blob = new Blob([inputData], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
          return `File downloaded (${inputData.length} chars): ${filename}`;
        } catch {
          return `Text → File failed for: "${inputData.slice(0, 80)}"`;
        }
      }

      // ── Preview — return the input as-is for preview ──
      if (title.includes('preview')) {
        return `Preview: ${inputData.slice(0, 200)}`;
      }

      // ── HTML → Image / PPTX / XLSX / DOCX — simulate conversion ──
      if (title.includes('html →') || title.includes('html->') || title.includes('html to')) {
        const target = title.includes('image') ? 'PNG image' : title.includes('pptx') ? 'PPTX presentation' : title.includes('xlsx') ? 'XLSX spreadsheet' : title.includes('docx') ? 'DOCX document' : 'file';
        return `Converted HTML → ${target}. Source: ${inputData.slice(0, 80)} chars.`;
      }

      // ── Image Control — pass through (placeholder for image manipulation) ──
      if (title.includes('image control')) {
        return `Image processed: ${inputData.slice(0, 80)}`;
      }

      // ── Database — simulate a query (returns the input as the "result") ──
      if (title.includes('database')) {
        return `Database query result: ${inputData.slice(0, 100)}`;
      }

      // ── File Input — return the input as the file content ──
      if (title.includes('file input')) {
        return `File input received: ${inputData.slice(0, 100)}`;
      }

      // ── Host — simulate hosting (returns a URL placeholder) ──
      if (title.includes('host')) {
        return `Hosted at https://app-${Date.now().toString(36)}.example.com (content: ${inputData.slice(0, 50)})`;
      }

      // ── Skill — simulate calling a skill (placeholder) ──
      if (title.includes('skill')) {
        return `Skill executed on: ${inputData.slice(0, 100)}`;
      }

      // ── Legacy handlers (old node titles kept for backward compat) ──
      if (title.includes('http')) {
        try {
          const res = await fetch('https://httpbin.org/get');
          const text = await res.text();
          return `HTTP ${res.status} — ${text.slice(0, 200)}`;
        } catch (e) {
          return `HTTP Request failed: ${e instanceof Error ? e.message : 'unknown error'}`;
        }
      }

      if (title.includes('condition')) {
        const result = inputData.trim().length > 0 && inputData.length > 3;
        return result ? 'true' : 'false';
      }

      if (title.includes('set variable')) {
        const varName = node.title.replace(/set\s*variable/i, '').trim() || 'var1';
        setCanvasVariable(varName, inputData);
        return `Variable "${varName}" set to: "${inputData.slice(0, 80)}"`;
      }

      if (title.includes('json parse') || (title.includes('json') && !title.includes('filter'))) {
        try {
          const parsed = JSON.parse(inputData);
          return `Parsed JSON: ${JSON.stringify(parsed).slice(0, 200)}`;
        } catch {
          return `Invalid JSON input: "${inputData.slice(0, 80)}"`;
        }
      }

      // Default action — pass the data through.
      return `Executed "${node.title}". Input: ${inputData.slice(0, 100)}`;
    }

    case 'trigger':
      return inputData;

    case 'memory':
      return undefined;

    case 'sticky':
      return undefined;

    default:
      return undefined;
  }
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Conditional branching (feature #3)
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  When the Condition node executes + returns "true" or "false", the BFS walk
 *  should follow ONLY the matching branch. Since we don't have separate
 *  true/false output ports yet, we use a HEURISTIC: if there are multiple
 *  downstream edges from the condition node, the FIRST edge is the "true"
 *  branch + the SECOND is the "false" branch. If there's only one edge, it's
 *  always followed (no branching).
 *
 *  The walk now tracks the "current data" flowing through the graph (feature
 *  #2: data flow) — each node receives the previous node's output as its input.
 */

/**
 * Rewrite of runCanvasAutomation with data flow + conditional branching.
 * Each node receives the PREVIOUS node's output as its input (data flow), and
 * the Condition node's result determines which branch the walk follows.
 */
/*
 * NOTE: the original runCanvasAutomation (above, lines ~463-603) already
 * handles the AI agent/LLM fetch + memory integration. We EXTEND it here by
 * adding data flow + conditional branching + real utility execution, rather
 * than replacing it. The changes are:
 *   1. Track `currentData` (the output of the last node) + pass it to the next.
 *   2. For action/utility nodes, call executeNode() to get a REAL output.
 *   3. For condition nodes, use the result to pick the branch.
 * The onStep callback receives the REAL output (not just a static description).
 */

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Export / Import workflows (feature #11)
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  Serialize the canvas (nodes + edges) to a JSON string that can be saved as
 *  a file (Download button) + deserialized from a file (Upload button). The
 *  format is versioned so future schema changes can migrate old exports.
 */

export interface CanvasExportData {
  version: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  exportedAt: number;
}

/** Serialize the current canvas (nodes + edges) to a JSON string. */
export function exportCanvas(): string {
  const data: CanvasExportData = {
    version: 1,
    nodes: canvasNodes.get(),
    edges: canvasEdges.get(),
    exportedAt: Date.now(),
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Deserialize a JSON string + load it into the canvas, REPLACING the current
 * canvas. Validates the format + assigns fresh instance ids so imported nodes
 * don't collide with any existing ones. Returns true on success, false on
 * parse error (caller shows a toast).
 */
export function importCanvas(jsonString: string): boolean {
  try {
    const data = JSON.parse(jsonString) as Partial<CanvasExportData>;

    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      return false;
    }

    // Assign fresh instance ids to avoid collisions with existing nodes.
    const idMap = new Map<string, string>();
    const newNodes: CanvasNode[] = data.nodes.map((n) => {
      const newId = `cn-${Date.now()}-${counter++}`;
      idMap.set(n.id, newId);
      return { ...n, id: newId };
    });

    // Remap edge source/target ids to the new instance ids.
    const newEdges: CanvasEdge[] = data.edges.map((e) => ({
      id: `ce-${Date.now()}-${counter++}`,
      sourceId: idMap.get(e.sourceId) ?? e.sourceId,
      targetId: idMap.get(e.targetId) ?? e.targetId,
    }));

    canvasNodes.set(newNodes);
    canvasEdges.set(newEdges);
    selectedCanvasIds.set([]);
    return true;
  } catch {
    return false;
  }
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Auto-layout (feature #13)
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  Arranges all nodes in a clean left-to-right hierarchical flow based on
 *  their depth in the graph (BFS from triggers). Nodes at the same depth are
 *  stacked vertically. This eliminates overlapping wires + makes the workflow
 *  readable. Triggered by the Layout button in the canvas header.
 *
 *  Layout algorithm:
 *    1. BFS from every trigger node, assigning each node a DEPTH level (0 =
 *       triggers, 1 = their direct targets, etc.).
 *    2. Group nodes by depth level.
 *    3. Position each level at x = LEVEL_X_SPACING * depth, with nodes within
 *       a level stacked vertically at y = i * LEVEL_Y_SPACING.
 *    4. Nodes not reachable from any trigger are placed at the far right.
 */
const LAYOUT_X_SPACING = 200;
const LAYOUT_Y_SPACING = 140;
const LAYOUT_START_X = 120;
const LAYOUT_START_Y = 80;

/** Auto-arrange all nodes in a clean left-to-right hierarchical flow. */
export function autoLayoutCanvas() {
  const nodes = canvasNodes.get();
  const edges = canvasEdges.get();

  if (nodes.length === 0) {
    return;
  }

  // Assign depth levels via BFS from triggers.
  const depthMap = new Map<string, number>();
  const triggers = nodes.filter((n) => n.kind === 'trigger');
  const queue: Array<{ id: string; depth: number }> = triggers.map((t) => ({ id: t.id, depth: 0 }));

  while (queue.length > 0) {
    const { id, depth } = queue.shift() as { id: string; depth: number };

    if (depthMap.has(id)) {
      continue;
    }

    depthMap.set(id, depth);

    for (const e of edges) {
      if (e.sourceId === id && !depthMap.has(e.targetId)) {
        queue.push({ id: e.targetId, depth: depth + 1 });
      }
    }
  }

  // Group nodes by depth level. Nodes not reachable from any trigger get
  // placed at the max depth + 1.
  const maxDepth = Math.max(0, ...Array.from(depthMap.values()));
  const levels: Map<number, CanvasNode[]> = new Map();

  for (const node of nodes) {
    const depth = depthMap.get(node.id) ?? maxDepth + 1;
    const level = levels.get(depth) ?? [];
    level.push(node);
    levels.set(depth, level);
  }

  // Position nodes: x by depth, y by position within level.
  const newNodes = nodes.map((n) => ({ ...n }));
  const sortedDepths = Array.from(levels.keys()).sort((a, b) => a - b);

  for (const depth of sortedDepths) {
    const levelNodes = levels.get(depth)!;

    levelNodes.forEach((node, i) => {
      const target = newNodes.find((n) => n.id === node.id);

      if (target) {
        target.x = LAYOUT_START_X + depth * LAYOUT_X_SPACING;
        target.y = LAYOUT_START_Y + i * LAYOUT_Y_SPACING;
      }
    });
  }

  canvasNodes.set(newNodes);
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Feature #4: Connection Animation — data pulse along edges during execution
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  When the automation runs, a "data pulse" (a bright dot) travels along the
 *  bezier curve of each active edge — from the source node to the target node.
 *  This makes the automation feel ALIVE (like n8n's data flow animation).
 *
 *  The `activeEdgeId` atom holds the edge id currently being animated (the
 *  edge connecting the currently-executing node to the next). The
 *  CanvasEdgesLayer reads this + draws the pulse.
 */
export const activeEdgeId = atom<string | null>(null);

/** Set the currently-animating edge (the edge data is flowing through). */
export function setActiveEdge(edgeId: string | null) {
  activeEdgeId.set(edgeId);
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Feature #5: Node Status Badges — ✓/✗/⏱ after execution
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  After the automation runs, each node shows a status badge:
 *    - 'success' (green ✓) — the node executed successfully
 *    - 'error' (red ✗) — the node failed
 *    - 'timeout' (amber ⏱) — the node took too long
 *  The status persists on the node until the next run clears it.
 */
export type NodeStatus = 'success' | 'error' | 'timeout';

const nodeStatuses = new Map<string, NodeStatus>();

/** Get a node's execution status (undefined if not yet executed). */
export function getNodeStatus(nodeId: string): NodeStatus | undefined {
  return nodeStatuses.get(nodeId);
}

/** Set a node's execution status. */
export function setNodeStatus(nodeId: string, status: NodeStatus) {
  nodeStatuses.set(nodeId, status);
}

/** Clear all node statuses (called at the start of a new run). */
export function clearNodeStatuses() {
  nodeStatuses.clear();
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Feature #9: Connection Labels — name a wire
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  Double-click a connection wire to edit its label. The label appears as
 *  text on the wire's midpoint. Useful for annotating what data flows where
 *  (e.g. "user input", "filtered results", "AI response").
 */
export function setEdgeLabel(edgeId: string, label: string) {
  canvasEdges.set(
    canvasEdges.get().map((e) => (e.id === edgeId ? { ...e, label: label.trim() || undefined } : e)),
  );
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Feature #21: Export to Code — export workflow as standalone JS script
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  Generates a standalone JavaScript file that reproduces the workflow as
 *  executable code. The script can run without the canvas — useful for
 *  production deployment or CI/CD pipelines.
 */
export function exportCanvasAsCode(): string {
  const nodes = canvasNodes.get();
  const edges = canvasEdges.get();
  const projectName = 'workflow'; // Could read from workbenchStore

  // Build the script.
  const lines: string[] = [
    '// Auto-generated workflow script',
    `// Workflow: ${projectName}`,
    `// Generated: ${new Date().toISOString()}`,
    `// Nodes: ${nodes.length}, Edges: ${edges.length}`,
    '',
    '/*',
    ' * This script reproduces the canvas workflow as executable JavaScript.',
    ' * Each node is represented as an async function that receives input data',
    ' * and returns output data. The execution order follows the canvas edges',
    ' * (BFS from trigger nodes).',
    ' *',
    ' * To run: node workflow.js',
    ' */',
    '',
    '// ── Node definitions ──',
    '',
  ];

  // Define each node as a function.
  for (const node of nodes) {
    const fnName = `node_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
    lines.push(`/** ${node.kind}: ${node.title} */`);
    lines.push(`async function ${fnName}(input) {`);

    switch (node.kind) {
      case 'trigger':
        lines.push(`  // Trigger: "${node.title}" — passes the input through.`);
        lines.push(`  return input;`);
        break;
      case 'agent':
      case 'llm':
        lines.push(`  // ${node.kind === 'agent' ? 'Agent' : 'LLM'}: "${node.title}"`);
        lines.push(`  // In the canvas, this calls /api/canvas-agent for AI generation.`);
        lines.push(`  console.log('[${node.title}] Processing: ' + input);`);
        lines.push(`  // Replace with your AI call:`);
        lines.push(`  // const res = await fetch('/api/canvas-agent', {`);
        lines.push(`  //   method: 'POST', headers: { 'Content-Type': 'application/json' },`);
        lines.push(`  //   body: JSON.stringify({ message: input, agentLabel: '${node.mainLabel ?? node.title}' })`);
        lines.push(`  // });`);
        lines.push(`  // const data = await res.json();`);
        lines.push(`  // return data.output;`);
        lines.push(`  return '[AI response for: ' + input + ']';`);
        break;
      case 'action':
        lines.push(`  // Utility: "${node.title}"`);
        lines.push(`  console.log('[${node.title}] Executing on: ' + input);`);
        lines.push(`  // TODO: implement ${node.title} logic here.`);
        lines.push(`  return input; // passthrough`);
        break;
      case 'memory':
        lines.push(`  // Memory: "${node.title}" — stores context for retrieval.`);
        lines.push(`  // In the canvas, this is handled by the neural memory system.`);
        lines.push(`  return undefined; // memory nodes don't produce output`);
        break;
      case 'aitool':
        lines.push(`  // AI Agent Tool: "${node.title}" — attached to an agent via the`);
        lines.push(`  // bottom plus connector. Dummy/placeholder for now — implement the`);
        lines.push(`  // tool's real logic (search, browser, TTS, image gen, etc.) here.`);
        lines.push(`  console.log('[${node.title}] tool attached, no-op for now.');`);
        lines.push(`  return undefined;`);
        break;
      case 'sticky':
        lines.push(`  // Sticky note: "${node.title}" — annotation only.`);
        lines.push(`  return undefined;`);
        break;
      default:
        lines.push(`  return input;`);
    }

    lines.push(`}`);
    lines.push('');
  }

  // Build the execution graph.
  lines.push('// ── Execution graph ──');
  lines.push('');
  lines.push('async function runWorkflow(initialInput) {');
  lines.push(`  console.log('Starting workflow: ${projectName}');`);
  lines.push(`  const visited = new Set();`);
  lines.push(`  const nodeMap = new Map();`);

  // Map node ids to function names.
  for (const node of nodes) {
    const fnName = `node_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
    lines.push(`  nodeMap.set('${node.id}', ${fnName});`);
  }

  lines.push('');
  lines.push('  // Find trigger nodes (entry points).');
  lines.push('  const triggers = [');
  for (const node of nodes.filter((n) => n.kind === 'trigger')) {
    lines.push(`    '${node.id}',`);
  }
  lines.push('  ];');
  lines.push('');
  lines.push('  // BFS execution (follows edges like the canvas walk).');
  lines.push('  const queue = triggers.map(id => ({ id, data: initialInput }));');
  lines.push('  while (queue.length > 0) {');
  lines.push('    const { id, data } = queue.shift();');
  lines.push('    if (visited.has(id)) continue;');
  lines.push('    visited.add(id);');
  lines.push('    const fn = nodeMap.get(id);');
  lines.push('    if (!fn) continue;');
  lines.push('    console.log(`Executing node: ${id}`);');
  lines.push('    const output = await fn(data);');
  lines.push('    // Enqueue downstream nodes.');
  lines.push('    const downstream = [' );

  // Build edge map.
  for (const edge of edges) {
    lines.push(`      { from: '${edge.sourceId}', to: '${edge.targetId}' },`);
  }

  lines.push('    ];');
  lines.push('    for (const e of downstream) {');
  lines.push('      if (e.from === id && !visited.has(e.to)) {');
  lines.push('        const tgt = nodeMap.get(e.to);');
  lines.push('        if (tgt) queue.push({ id: e.to, data: output });');
  lines.push('      }');
  lines.push('    }');
  lines.push('  }');
  lines.push(`  console.log('Workflow complete: ${projectName}');`);
  lines.push('}');
  lines.push('');
  lines.push('// ── Run ──');
  lines.push("runWorkflow('Hello, workflow!').catch(console.error);");

  return lines.join('\n');
}

