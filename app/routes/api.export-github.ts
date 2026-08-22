import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { collectBoltFiles } from '~/lib/.server/collect-bolt-files';
import { exportToGitHub } from '~/lib/.server/github-export';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.export-github');

/**
 * POST /api/export-github
 *
 * Body:
 *   {
 *     "token":      "ghp_xxx",          // GitHub personal access token (repo scope)
 *     "repoName":   "my-bolt-diy",      // Repository name to create
 *     "description":"Exported project", // Optional
 *     "isPrivate":  false               // Optional, defaults to false
 *   }
 *
 * Collects the entire bolt.diy project from the server filesystem and pushes
 * it to a brand-new GitHub repository in a single commit.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, { status: 405 });
  }

  let body: {
    token?: string;
    repoName?: string;
    description?: string;
    isPrivate?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { token, repoName, description, isPrivate } = body;

  if (!token || typeof token !== 'string') {
    return json({ success: false, error: 'A GitHub personal access token is required.' }, { status: 400 });
  }

  if (!repoName || typeof repoName !== 'string') {
    return json({ success: false, error: 'A repository name is required.' }, { status: 400 });
  }

  // GitHub repo names: alphanumeric, dots, hyphens, underscores; max 100 chars.
  if (!/^[a-zA-Z0-9._-]+$/.test(repoName) || repoName.length > 100) {
    return json(
      { success: false, error: 'Invalid repository name. Use only letters, numbers, dots, hyphens, and underscores.' },
      { status: 400 },
    );
  }

  if (repoName.startsWith('.') || repoName.startsWith('-')) {
    return json({ success: false, error: 'Repository name cannot start with a dot or hyphen.' }, { status: 400 });
  }

  // Plain console logs so progress is visible in the dev server terminal.
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  [export-github] Starting export → "${repoName}"`);
  console.log('═══════════════════════════════════════════════════════════');

  try {
    // 0. Collect every source file from the project root.
    console.log('[export-github] Step 0: Collecting project files...');

    const files = collectBoltFiles();

    if (files.length === 0) {
      console.error('[export-github] No files found to export.');
      return json({ success: false, error: 'No files found to export.' }, { status: 500 });
    }

    console.log(`[export-github]   ✓ Collected ${files.length} files`);

    // Quick sanity breakdown of what was collected.
    const totalBytes = files.reduce(
      (sum, f) => sum + Buffer.byteLength(f.content, f.encoding === 'base64' ? 'base64' : 'utf-8'),
      0,
    );
    console.log(`[export-github]   ✓ Total payload size: ${(totalBytes / 1024).toFixed(1)} KB`);

    logger.info(`Exporting ${files.length} files to GitHub as "${repoName}"`);

    // Push everything to a new repository (validate token → create repo → git push).
    const result = await exportToGitHub(
      token.trim(),
      repoName.trim(),
      (description || 'Exported from bolt.diy').slice(0, 350),
      isPrivate ?? false,
      files,
    );

    console.log(`[export-github] ✓ SUCCESS — ${result.fileCount} files → ${result.repoUrl}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    logger.info(`Successfully exported ${result.fileCount} files to ${result.repoUrl}`);

    return json({
      success: true,
      repoUrl: result.repoUrl,
      fileCount: result.fileCount,
      owner: result.owner,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred during export.';

    console.error(`[export-github] ✗ FAILED: ${message}`);
    console.error(error);
    console.log('═══════════════════════════════════════════════════════════\n');

    logger.error('Export failed:', message);

    // Provide a friendlier hint for the most common failures.
    let friendly = message;

    if (/rate limit|secondary rate|abuse/i.test(message)) {
      friendly =
        'GitHub rate limit hit while uploading. Please wait a minute and try again — the export now retries automatically, but GitHub may still throttle very large bursts.';
    } else if (/Bad credentials/i.test(message)) {
      friendly =
        'Your GitHub token was rejected (Bad credentials). Please check the token is valid and has not expired.';
    } else if (/already exists|name already exists/i.test(message)) {
      friendly = `A repository named "${repoName}" already exists on your account. Choose a different name.`;
    } else if (/could not read Username|Authentication failed|403|push/i.test(message)) {
      friendly = `GitHub rejected the push: ${message}. Your token may need the "repo" scope (not just "public_repo"), or it may be expired.`;
    } else if (/visibility|disabled|blocked/i.test(message)) {
      friendly = `GitHub rejected the request: ${message}. Your token may need the "repo" scope, or your account may have a restriction.`;
    }

    return json({ success: false, error: friendly }, { status: 500 });
  }
}
