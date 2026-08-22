import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { CollectedFile } from './collect-bolt-files';

/**
 * This module pushes the entire bolt.diy project to a **new** GitHub
 * repository using native `git` commands for maximum reliability.
 *
 * Strategy:
 *   1. Validate the personal access token via the REST API (GET /user).
 *   2. Create a new empty repository (POST /user/repos, auto_init: false).
 *   3. Write every collected file into a fresh temp directory.
 *   4. `git init` → `git add -A` → `git commit` → `git push` with token auth.
 *   5. Verify the push succeeded by checking the repo via the REST API.
 *   6. Clean up the temp directory.
 *
 * Using native git avoids GitHub's secondary rate limit (which kills the
 * blob-per-file approach) and the inline-content tree API quirks (which can
 * silently leave a repo empty). A single `git push` is how every real tool
 * pushes to GitHub.
 */

const GITHUB_API = 'https://api.github.com';

/** GitHub user object returned by GET /user. */
interface GitHubUser {
  login: string;
  name: string | null;
}

/** Result of a successful export. */
export interface ExportResult {
  /** Full HTML URL of the newly created repository. */
  repoUrl: string;

  /** Number of files that were pushed. */
  fileCount: number;

  /** Owner (username) of the repository. */
  owner: string;
}

/**
 * Low-level helper that performs an authenticated GitHub REST API request
 * and returns the parsed JSON body (or throws on non-2xx).
 */
async function githubRequest<T = any>(endpoint: string, token: string, options: RequestInit = {}): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${GITHUB_API}${endpoint}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    let message = `GitHub API error (${res.status})`;

    try {
      const body = (await res.json()) as any;

      if (body?.message) {
        message = body.message;
      }
    } catch {
      // Response body wasn't JSON.
    }

    throw new Error(message);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

/** Validates the token and returns the authenticated user. */
export async function validateToken(token: string): Promise<GitHubUser> {
  return githubRequest<GitHubUser>('/user', token);
}

/** Creates a brand-new empty repository for the authenticated user. */
async function createRepo(
  token: string,
  name: string,
  description: string,
  isPrivate: boolean,
): Promise<{ full_name: string; html_url: string; default_branch: string }> {
  return githubRequest('/user/repos', token, {
    method: 'POST',
    body: JSON.stringify({
      name,
      description,
      private: isPrivate,
      auto_init: false,
    }),
  });
}

/**
 * Runs a git command synchronously in the given directory and returns stdout.
 * Throws an Error with stderr if the command fails.
 *
 * `GIT_TERMINAL_PROMPT=0` prevents git from hanging on a credential prompt —
 * if auth fails, git exits immediately instead of waiting for input.
 */
function runGit(args: string[], cwd: string, timeoutMs = 60_000): string {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10 MB — large enough for git output
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0', // Never prompt — fail instead of hanging
        GIT_AUTHOR_NAME: 'bolt.diy Export',
        GIT_AUTHOR_EMAIL: 'bot@bolt.diy',
        GIT_COMMITTER_NAME: 'bolt.diy Export',
        GIT_COMMITTER_EMAIL: 'bot@bolt.diy',
      },
    });

    return stdout.trim();
  } catch (err: any) {
    const stderr = err?.stderr?.toString() || '';
    const stdout = err?.stdout?.toString() || '';
    const detail = stderr || stdout || err?.message || 'unknown error';

    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
}

/**
 * Orchestrates the full export: validate → create repo → write files → git push.
 *
 * @returns The repository URL and file count on success.
 * @throws  Error with a human-readable message on any failure.
 */
export async function exportToGitHub(
  token: string,
  repoName: string,
  description: string,
  isPrivate: boolean,
  files: CollectedFile[],
): Promise<ExportResult> {
  // ── Step 1: Validate the token and discover the username. ──
  console.log('[export-github] Step 1/6: Validating GitHub token...');

  const user = await validateToken(token);
  const owner = user.login;
  console.log(`[export-github]   ✓ Authenticated as @${owner}`);

  // ── Step 2: Create a fresh empty repository. ──
  console.log(`[export-github] Step 2/6: Creating repository "${repoName}"...`);

  const repo = await createRepo(token, repoName, description, isPrivate);
  const branch = repo.default_branch || 'main';
  console.log(`[export-github]   ✓ Created at ${repo.html_url} (default branch: ${branch})`);

  // ── Step 3: Write all files into a temp directory. ──
  console.log(`[export-github] Step 3/6: Writing ${files.length} files to temp directory...`);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-export-'));
  console.log(`[export-github]   Temp dir: ${tempDir}`);

  try {
    let written = 0;

    for (const file of files) {
      /*
       * Skip .gitignore so every file is committed (git add -A would otherwise
       * respect .gitignore patterns and silently skip files we want to include).
       */
      if (file.path === '.gitignore') {
        continue;
      }

      const destPath = path.join(tempDir, file.path);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });

      if (file.encoding === 'base64') {
        fs.writeFileSync(destPath, Buffer.from(file.content, 'base64'));
      } else {
        fs.writeFileSync(destPath, file.content, 'utf-8');
      }

      written++;
    }

    console.log(`[export-github]   ✓ Wrote ${written} files`);

    // ── Step 4: Initialise git, add, and commit. ──
    console.log('[export-github] Step 4/6: Creating git commit...');
    runGit(['init'], tempDir);
    runGit(['config', 'user.email', 'bot@bolt.diy'], tempDir);
    runGit(['config', 'user.name', 'bolt.diy Export'], tempDir);
    runGit(['add', '-A'], tempDir);

    // Verify something was staged.
    const status = runGit(['status', '--porcelain'], tempDir);

    if (!status) {
      throw new Error('No files were staged for commit — the project appears to be empty.');
    }

    const stagedCount = status.split('\n').length;
    console.log(`[export-github]   ✓ ${stagedCount} files staged`);

    runGit(['commit', '-m', 'Initial export from bolt.diy'], tempDir);
    runGit(['branch', '-M', branch], tempDir);
    console.log(`[export-github]   ✓ Committed on branch "${branch}"`);

    // ── Step 5: Push to GitHub. ──
    console.log('[export-github] Step 5/6: Pushing to GitHub (this may take 30–90 seconds)...');

    /*
     * Token goes in the URL for HTTP basic auth. The temp dir is deleted
     * immediately after, so the token does not persist anywhere.
     */
    const pushUrl = `https://${owner}:${token}@github.com/${owner}/${repoName}.git`;

    runGit(['push', '--set-upstream', pushUrl, branch], tempDir, 180_000); // 3 min timeout
    console.log('[export-github]   ✓ Push complete!');

    // ── Step 6: Verify the repository has content. ──
    console.log('[export-github] Step 6/6: Verifying repository...');

    try {
      const repoInfo = (await githubRequest<any>(`/repos/${owner}/${repoName}`, token)) as any;

      if (repoInfo.size === 0) {
        console.warn('[export-github]   ⚠ Repository reports size 0 — push may not have completed');
      } else {
        console.log(`[export-github]   ✓ Repository size: ${repoInfo.size} KB`);
      }
    } catch {
      // Verification is best-effort — the push itself already succeeded.
      console.warn('[export-github]   Could not verify (non-critical)');
    }

    return {
      repoUrl: repo.html_url,
      fileCount: written,
      owner,
    };
  } finally {
    // ── Clean up the temp directory. ──
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log('[export-github]   ✓ Cleaned up temp dir');
    } catch {
      // Non-critical — the OS will clean up /tmp eventually.
    }
  }
}
