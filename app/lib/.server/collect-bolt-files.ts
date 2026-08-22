import fs from 'node:fs';
import path from 'node:path';

/**
 * Represents a single file collected from the bolt.diy project,
 * ready to be pushed to GitHub via the Git Database API.
 */
export interface CollectedFile {
  /** Path relative to the project root (POSIX-style with forward slashes). */
  path: string;

  /** File content — base64 for binary, utf-8 string for text. */
  content: string;

  /** Encoding used for `content`. */
  encoding: 'utf-8' | 'base64';
}

/**
 * Directories that should never be exported (build output, deps, secrets, sandbox artifacts).
 *
 * `tool-results`, `agent-ctx`, `skills`, `download`, `upload` are sandbox/agent
 * artifacts produced while building the project — they bloat the export to 60+ MB
 * and cause the git push to exceed the Cloudflare workerd dev-proxy wall-clock
 * limit (which returns an HTML error page instead of JSON, breaking the export).
 */
const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  '.wrangler',
  '.next',
  'dist',
  'build',
  'out',
  '.agent-browser',
  '.cache',
  '.turbo',
  '.output',
  'coverage',
  '.husky',
  '.vscode',
  '.idea',
  'tmp',
  'temp',
  // ── sandbox / agent artifacts (not part of the webapp source) ──
  'tool-results',
  'agent-ctx',
  'skills',
  'download',
  'upload',
]);

/**
 * Exact filenames that must never be exported (secrets, logs, sandbox scripts).
 */
const EXCLUDE_FILES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.env.example',
  'dev-server.log',
  'dev.log',
  'monitor.sh',
  'run-dev.sh',
  'start-persistent.sh',
  'bindings.sh',
  'daemon-dev.sh',
  'TODO',
]);

/**
 * Filename patterns to exclude:
 *  - any .log file
 *  - dev/screenshots scattered in the project root (diag-*.png, preview-*.png,
 *    canvas-*.png, build-*.png, collapsed.png, after-open.png, etc.) — these are
 *    agent capture artefacts, not project assets.
 */
const EXCLUDE_PATTERNS: RegExp[] = [
  /\.log$/,
  /^(diag|preview|canvas|build|collapsed|after-open|header|whatsappbot4)[-_].*\.(png|jpe?g|webp)$/i,
];

/**
 * File extensions that are binary and must be base64-encoded.
 */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.bmp',
  '.tiff',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.rar',
  '.7z',
  '.mp4',
  '.mp3',
  '.wav',
  '.ogg',
  '.webm',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.icns',
]);

/**
 * Maximum file size (10 MB) — files larger than this are skipped to avoid
 * hitting GitHub's blob limits or timing out the request.
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Maximum size for binary/image assets (256 KB). Large dev screenshots and
 * bundled binaries bloat the payload and slow the git push past the dev-proxy
 * timeout, so they are skipped while small icons/illustrations are kept.
 */
const MAX_BINARY_SIZE = 256 * 1024;

function shouldExcludeFile(fileName: string): boolean {
  if (EXCLUDE_FILES.has(fileName)) {
    return true;
  }

  return EXCLUDE_PATTERNS.some((pattern) => pattern.test(fileName));
}

function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Recursively walks the project directory and collects every source file
 * that should be exported to GitHub.
 *
 * @param projectRoot The absolute path to the bolt.diy project root. Defaults to `process.cwd()`.
 * @returns An array of {@link CollectedFile} entries.
 */
export function collectBoltFiles(projectRoot: string = process.cwd()): CollectedFile[] {
  const files: CollectedFile[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // Directory may not be readable — skip silently.
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(projectRoot, fullPath).split(path.sep).join('/');

      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.has(entry.name)) {
          continue;
        }

        walk(fullPath);
      } else if (entry.isFile()) {
        if (shouldExcludeFile(entry.name)) {
          continue;
        }

        // Skip files that are too large.
        let stat: fs.Stats;

        try {
          stat = fs.statSync(fullPath);
        } catch {
          continue;
        }

        const isBinary = isBinaryFile(fullPath);

        // Binary/image assets use a tighter size cap so large dev screenshots
        // don't bloat the export and time out the git push.
        const sizeLimit = isBinary ? MAX_BINARY_SIZE : MAX_FILE_SIZE;

        if (stat.size > sizeLimit) {
          continue;
        }

        let buffer: Buffer;

        try {
          buffer = fs.readFileSync(fullPath);
        } catch {
          continue;
        }

        if (isBinary) {
          files.push({
            path: relativePath,
            content: buffer.toString('base64'),
            encoding: 'base64',
          });
        } else {
          files.push({
            path: relativePath,
            content: buffer.toString('utf-8'),
            encoding: 'utf-8',
          });
        }
      }
    }
  }

  walk(projectRoot);

  // Sort by path for deterministic output.
  files.sort((a, b) => a.path.localeCompare(b.path));

  return files;
}
