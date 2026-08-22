import { atom, map, type MapStore, type WritableAtom } from 'nanostores';

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Workbench store (prototype)
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  This build no longer runs a real WebContainer sandbox — the AI backend is
 *  stubbed (see `api.chat.ts`), so no `<boltArtifact>` is ever streamed and no
 *  real files are generated. The workbench UI is therefore a visual prototype:
 *  it shows a fixed set of sample project files (a minimal React + Vite app)
 *  so the panel looks realistic when it opens.
 *
 *  What IS functional:
 *    - `showWorkbench` / `setShowWorkbench()` — drives the slide-in animation.
 *      The chat layer calls `setShowWorkbench(true)` when the user sends their
 *      first message, and the Workbench component subscribes to this atom.
 *    - `currentView` / `setCurrentView()` — switches between the Code and
 *      Preview tabs.
 *    - `selectedFile` / `setSelectedFile()` — tracks which file is open in the
 *      code view. Defaults to the sample `App.tsx`.
 *    - `files` — a static map of sample file paths → { content, type } so the
 *      file tree + code display have something to render.
 *
 *  Everything else (artifacts, actions, terminal, deploy alerts, modified-file
 *  diffing) is retained as a no-op so the chat layer — which still references
 *  `workbenchStore.alert`, `.abortAllActions()`, `.getModifiedFiles()`, etc. —
 *  keeps compiling without touching those code paths.
 * ──────────────────────────────────────────────────────────────────────────
 */

export type WorkbenchViewType = 'code' | 'preview';

export interface ArtifactState {
  id: string;
  title: string;
  type?: string;
  closed: boolean;
  runner: unknown;
}

export type ArtifactUpdateState = Pick<ArtifactState, 'title' | 'closed'>;

type Artifacts = MapStore<Record<string, ArtifactState>>;

/*
 * Sample project files shown in the workbench's Code view. A minimal React +
 * Vite + Tailwind app — enough to populate the file tree and the code display
 * with realistic-looking content. This is static; the stubbed backend never
 * modifies it.
 */
export interface SampleFile {
  /** Full path, e.g. "src/App.tsx". */
  path: string;
  /** Short label for the tree, e.g. "App.tsx". */
  name: string;
  /** Directory path, e.g. "src" — empty string for root-level files. */
  dir: string;
  /** File contents. */
  content: string;
  /** Language for syntax-highlight hinting. */
  language: 'tsx' | 'ts' | 'css' | 'html' | 'json' | 'js' | 'md';
}

const SAMPLE_FILES: SampleFile[] = [
  {
    path: 'package.json',
    name: 'package.json',
    dir: '',
    language: 'json',
    content: `{
  "name": "alphacode-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "tailwindcss": "^3.4.10",
    "typescript": "^5.5.4",
    "vite": "^5.4.2"
  }
}
`,
  },
  {
    path: 'index.html',
    name: 'index.html',
    dir: '',
    language: 'html',
    content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AlphaCode App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  },
  {
    path: 'src/main.tsx',
    name: 'main.tsx',
    dir: 'src',
    language: 'tsx',
    content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`,
  },
  {
    path: 'src/App.tsx',
    name: 'App.tsx',
    dir: 'src',
    language: 'tsx',
    content: `import { useState } from 'react';

function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
      <h1 className="text-5xl font-bold mb-4">AlphaCode App</h1>
      <p className="text-lg mb-8 opacity-90">
        Built with React + Vite + Tailwind
      </p>
      <button
        onClick={() => setCount((c) => c + 1)}
        className="px-6 py-3 rounded-lg bg-white/20 hover:bg-white/30 backdrop-blur transition-all text-xl font-semibold"
      >
        Count: {count}
      </button>
    </div>
  );
}

export default App;
`,
  },
  {
    path: 'src/index.css',
    name: 'index.css',
    dir: 'src',
    language: 'css',
    content: `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: Inter, system-ui, sans-serif;
}

body {
  margin: 0;
  min-height: 100vh;
}
`,
  },
  {
    path: 'README.md',
    name: 'README.md',
    dir: '',
    language: 'md',
    content: `# AlphaCode App

Generated by AlphaCode. This is a prototype project structure shown in the
workbench panel. Run \`npm install\` then \`npm run dev\` to start the dev server.
`,
  },
];

/** Build a lookup map of path → SampleFile for quick access. */
const FILE_MAP: Record<string, SampleFile> = Object.fromEntries(
  SAMPLE_FILES.map((f) => [f.path, f]),
);

const WORKBENCH_WIDTH_KEY = 'bolt_workbench_width';
const WORKBENCH_PROJECT_NAME_KEY = 'bolt_workbench_project_name';

/*
 * Default project name shown in the header's editable name field before the
 * user types anything. Mirrors the sample app's title.
 */
const DEFAULT_PROJECT_NAME = 'AlphaCode App';

/*
 * Resizable workbench width bounds (px). MIN keeps the chat usable; MAX
 * stops the workbench from swallowing the whole window.
 */
export const WORKBENCH_WIDTH_MIN = 360;
export const WORKBENCH_WIDTH_MAX = 2400;

function initWorkbenchWidth(): number | null {
  if (import.meta.env.SSR) {
    return null;
  }

  try {
    const raw = localStorage.getItem(WORKBENCH_WIDTH_KEY);

    if (raw) {
      const n = Number(raw);

      if (Number.isFinite(n) && n >= WORKBENCH_WIDTH_MIN && n <= WORKBENCH_WIDTH_MAX) {
        return n;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function initProjectName(): string {
  if (import.meta.env.SSR) {
    return DEFAULT_PROJECT_NAME;
  }

  try {
    const raw = localStorage.getItem(WORKBENCH_PROJECT_NAME_KEY);

    if (raw && raw.trim().length > 0) {
      return raw;
    }
  } catch {
    // ignore
  }

  return DEFAULT_PROJECT_NAME;
}

export class WorkbenchStore {
  /** Whether the workbench panel should show. Drives the slide-in animation. */
  showWorkbench: WritableAtom<boolean> = atom(false);

  /*
   * User-controlled workbench width (in px). When non-null, both the
   * Workbench panel and the chat container's right padding use this value
   * instead of the default `--workbench-width` CSS variable, so the user can
   * drag the divider between the chat and the workbench to resize them.
   * Persisted to localStorage under `bolt_workbench_width`.
   */
  workbenchWidth: WritableAtom<number | null> = atom(initWorkbenchWidth());

  /*
   * True while the user is actively dragging the resize handle. Subscribed
   * to by BaseChat so it can disable its padding transition during the drag
   * (otherwise the chat lags behind the pointer by the transition duration).
   */
  workbenchResizing: WritableAtom<boolean> = atom(false);

  /** Current workbench view — 'code' (file tree + editor) or 'preview'. */
  currentView: WritableAtom<WorkbenchViewType> = atom('code');

  /*
   * Whether the simulated dev server has been started by clicking Run.
   * When true, the Preview view renders a mock running app instead of the
   * "live preview will appear here" empty-state placeholder. Reset to false
   * only by reloading the page (intentional — once "started", it stays
   * "started" for the session, mirroring a real dev server you'd stop/restart
   * manually rather than one that stops when you switch tabs).
   */
  previewRunning: WritableAtom<boolean> = atom(false);

  /** Selected file path (key into the files map). Defaults to undefined (no file shown). */
  selectedFile: WritableAtom<string | undefined> = atom(undefined);

  /*
   * Editable project name shown in the workbench header's left side.
   * Initialized from localStorage (or DEFAULT_PROJECT_NAME) and persisted on
   * every change via setProjectName().
   */
  projectName: WritableAtom<string> = atom(initProjectName());

  /*
   * Whether the canvas dot-grid is visible. Toggled from the header's
   * More-menu ("Hide grid" / "Show grid"). The MovableCanvas subscribes to
   * this and shows/hides its radial-gradient dot pattern accordingly.
   */
  canvasGridVisible: WritableAtom<boolean> = atom(true);

  /*
   * Command signal for the MovableCanvas. The header's More-menu writes a
   * command here (with a fresh nonce so repeated identical commands still
   * trigger an effect); the MovableCanvas subscribes via useEffect and
   * executes the action. This avoids lifting all canvas state into a shared
   * parent — the menu just dispatches intent, the canvas owns its own state.
   *
   * Commands:
   *   'fit'     — reset zoom to 100% and pan to {0,0}
   *   'export'  — render the canvas (bg + dot grid) to a PNG and download it
   *   'undo'    — revert pan/zoom to the previous history entry
   *   'redo'    — re-apply the next history entry
   */
  canvasCommand: WritableAtom<{ action: 'fit' | 'export' | 'undo' | 'redo'; nonce: number } | null> = atom(null);

  /** Artifact registry. Always empty (no real AI artifacts in this build). */
  artifacts: Artifacts = map({});

  /** First artifact, if any. Always undefined. */
  get firstArtifact(): ArtifactState | undefined {
    return undefined;
  }

  /** File map — static sample files for the Code view. */
  files: WritableAtom<Record<string, SampleFile>> = atom(FILE_MAP);

  /** Previews list. Always empty (no WebContainer in this build). */
  previews: WritableAtom<any[]> = atom([]);

  /** Alert / deploy-alert / action-alert atoms. Inert. */
  alert: WritableAtom<any> = atom(undefined);
  actionAlert: WritableAtom<any> = atom(undefined);
  deployAlert: WritableAtom<any> = atom(undefined);
  supabaseAlert: WritableAtom<any> = atom(undefined);

  setShowWorkbench(show: boolean) {
    this.showWorkbench.set(show);
  }

  /**
   * Set a custom workbench width (px). Clamped to [MIN, MAX]. Persisted to
   * localStorage so it survives reloads. Pass null to clear the override and
   * fall back to the default `--workbench-width` CSS variable.
   */
  setWorkbenchWidth(width: number | null) {
    if (width === null) {
      this.workbenchWidth.set(null);

      if (!import.meta.env.SSR) {
        try {
          localStorage.removeItem(WORKBENCH_WIDTH_KEY);
        } catch {
          // ignore
        }
      }

      return;
    }

    const clamped = Math.max(WORKBENCH_WIDTH_MIN, Math.min(WORKBENCH_WIDTH_MAX, Math.round(width)));
    this.workbenchWidth.set(clamped);

    if (!import.meta.env.SSR) {
      try {
        localStorage.setItem(WORKBENCH_WIDTH_KEY, String(clamped));
      } catch {
        // ignore
      }
    }
  }

  setCurrentView(view: WorkbenchViewType) {
    this.currentView.set(view);
  }

  setPreviewRunning(running: boolean) {
    this.previewRunning.set(running);
  }

  setSelectedFile(filePath: string | undefined) {
    this.selectedFile.set(filePath);
  }

  /**
   * Set the project name shown in the header. Trims whitespace; falls back to
   * the default when emptied. Persisted to localStorage so it survives reloads.
   */
  setProjectName(name: string) {
    const trimmed = (name ?? '').trim();
    const next = trimmed.length > 0 ? trimmed : DEFAULT_PROJECT_NAME;
    this.projectName.set(next);

    if (!import.meta.env.SSR) {
      try {
        localStorage.setItem(WORKBENCH_PROJECT_NAME_KEY, next);
      } catch {
        // ignore
      }
    }
  }

  /** Toggle the canvas dot-grid visibility (from the More-menu "Hide grid"). */
  setCanvasGridVisible(visible: boolean) {
    this.canvasGridVisible.set(visible);
  }

  /** Toggle the canvas dot-grid visibility (flips the current value). */
  toggleCanvasGrid() {
    this.canvasGridVisible.set(!this.canvasGridVisible.get());
  }

  /**
   * Dispatch a command to the MovableCanvas. Uses a monotonic nonce so that
   * clicking the same menu item twice in a row still triggers the effect
   * (otherwise React's useEffect would see an equal value and skip).
   */
  dispatchCanvasCommand(action: 'fit' | 'export' | 'undo' | 'redo') {
    const prev = this.canvasCommand.get();
    const nonce = prev ? prev.nonce + 1 : 1;
    this.canvasCommand.set({ action, nonce });
  }

  setReloadedMessages(_ids: string[]) {}
  setDocuments(_files: Record<string, any>) {}
  setCurrentDocumentContent(_content: string) {}
  setCurrentDocumentScrollPosition(_position: any) {}
  toggleTerminal(_show: boolean) {}
  abortAllActions() {}
  clearAlert() {}
  clearSupabaseAlert() {}
  clearDeployAlert() {}
  addArtifact(_data: any) {}
  updateArtifact(_data: any, _state: Partial<ArtifactUpdateState>) {}
  addAction(_data: any) {}
  runAction(_data: any, _stream?: boolean) {}
  getModifiedFiles() {
    return undefined;
  }
  resetAllFileModifications() {}
  async saveCurrentDocument() {}
  async resetCurrentDocument() {}
  async downloadZip() {}
  async syncFiles(_directoryHandle: any) {}
}

export const workbenchStore = new WorkbenchStore();

/** Static list of sample files — used by the Workbench file-tree component. */
export const SAMPLE_FILE_LIST = SAMPLE_FILES;
