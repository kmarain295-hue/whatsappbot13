import { memo, useCallback, useEffect, useRef, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { Dialog, DialogTitle, DialogDescription } from '~/components/ui/Dialog';
import { Button } from '~/components/ui/Button';
import { Input } from '~/components/ui/Input';
import { Label } from '~/components/ui/Label';
import { Switch } from '~/components/ui/Switch';
import { classNames } from '~/utils/classNames';
import { toast } from 'react-toastify';

type Status = 'idle' | 'exporting' | 'success' | 'error';

/** Rotating status messages shown while the export runs. */
const PROGRESS_STAGES = [
  'Collecting project files...',
  'Validating GitHub token...',
  'Creating repository...',
  'Building file tree & committing...',
  'Finalising repository...',
] as const;

interface ExportResponse {
  success: boolean;
  repoUrl?: string;
  fileCount?: number;
  owner?: string;
  error?: string;
}

function ExportGitHubButtonImpl() {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [token, setToken] = useState('');
  const [repoName, setRepoName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [fileCount, setFileCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [progressStage, setProgressStage] = useState(0);
  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Rotate the progress message every 2.5s while exporting so the user sees activity.
  useEffect(() => {
    if (status === 'exporting') {
      setProgressStage(0);
      stageTimerRef.current = setInterval(() => {
        setProgressStage((prev) => (prev + 1) % PROGRESS_STAGES.length);
      }, 2500);
    } else if (stageTimerRef.current) {
      clearInterval(stageTimerRef.current);
      stageTimerRef.current = null;
    }

    return () => {
      if (stageTimerRef.current) {
        clearInterval(stageTimerRef.current);
        stageTimerRef.current = null;
      }
    };
  }, [status]);

  const resetForm = useCallback(() => {
    setStatus('idle');
    setToken('');
    setRepoName('');
    setDescription('');
    setIsPrivate(false);
    setRepoUrl('');
    setFileCount(0);
    setErrorMsg('');
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);

    // Defer the reset so the close animation isn't interrupted.
    window.setTimeout(resetForm, 250);
  }, [resetForm]);

  const handleExport = useCallback(async () => {
    if (!token.trim() || !repoName.trim()) {
      setErrorMsg('Please fill in your GitHub token and repository name.');
      setStatus('error');

      return;
    }

    setStatus('exporting');
    setErrorMsg('');

    // Generous 5-minute timeout — the export uploads hundreds of files.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);

    try {
      const res = await fetch('/api/export-github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token.trim(),
          repoName: repoName.trim(),
          description: description.trim(),
          isPrivate,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      /*
       * Defensive parsing: the export can take 30–90+ seconds, and if the
       * Cloudflare workerd dev-proxy (or any gateway) times out, it returns an
       * HTML error page instead of JSON. Calling `res.json()` on that HTML
       * throws the cryptic "Unexpected token '<', "<html> <h"... is not valid
       * JSON" — so we inspect the content-type / status first and surface a
       * clear, actionable message.
       */
      const contentType = res.headers.get('content-type') || '';

      if (!contentType.includes('application/json')) {
        // The server almost certainly timed out while the export was still
        // running. The repo may still have been created/pushed server-side.
        let hint = 'The server returned an HTML page instead of JSON.';

        if (res.status === 502 || res.status === 504 || res.status === 524) {
          hint =
            'The export request timed out at the gateway (the project is large). The repository may still have been created on GitHub — please check your account before retrying.';
        } else if (res.status === 404) {
          hint =
            'The /api/export-github endpoint was not found (404). The dev server may need to be restarted so the route is picked up.';
        }

        setStatus('error');
        setErrorMsg(hint);
        toast.error(hint);

        return;
      }

      let data: ExportResponse;

      try {
        data = (await res.json()) as ExportResponse;
      } catch {
        // Body claimed to be JSON but failed to parse — treat like a timeout.
        const msg =
          'Could not read the server response. The export likely timed out — please check your GitHub account to see if the repository was created, then retry if needed.';

        setStatus('error');
        setErrorMsg(msg);
        toast.error(msg);

        return;
      }

      if (data.success && data.repoUrl) {
        setStatus('success');
        setRepoUrl(data.repoUrl);
        setFileCount(data.fileCount ?? 0);
        toast.success(`Exported ${data.fileCount} files to GitHub!`);
      } else {
        setStatus('error');
        setErrorMsg(data.error || 'Export failed. Please check your token and try again.');
        toast.error(data.error || 'Export failed.');
      }
    } catch (err) {
      clearTimeout(timeoutId);

      let msg: string;

      if (err instanceof Error && err.name === 'AbortError') {
        msg = 'The export timed out after 5 minutes. Please try again — GitHub may be slow right now.';
      } else {
        msg = err instanceof Error ? err.message : 'Network error during export.';
      }

      setStatus('error');
      setErrorMsg(msg);
      toast.error(msg);
    }
  }, [token, repoName, description, isPrivate]);

  const canClose = status !== 'exporting';

  return (
    <>
      {/* Floating Action Button — bottom-right corner. Uses the active
          color scheme's accent (see lib/stores/theme.ts) so it recolours
          with the chosen theme. */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={classNames(
          'fixed bottom-6 right-6 z-[998]',
          'flex items-center justify-center',
          'w-12 h-12 rounded-full',
          'scheme-accent-solid',
          'border border-white/10',
          'transition-all duration-200 hover:scale-110 active:scale-95',
          'group',
        )}
        style={{ boxShadow: '0 10px 30px -8px rgba(var(--scheme-accent-rgb), 0.6)' }}
        title="Export project to GitHub"
        aria-label="Export project to GitHub"
      >
        <div className="i-ph:github-logo text-2xl transition-transform group-hover:rotate-12" />
      </button>

      {/* Dialog */}
      <RadixDialog.Root
        open={isOpen}
        onOpenChange={(open) => {
          if (!open && canClose) {
            handleClose();
          }
        }}
      >
        <Dialog onClose={canClose ? handleClose : undefined} showCloseButton={canClose} className="max-w-[480px]">
          <div className="p-6 bg-white dark:bg-gray-950">
            {/* Header */}
            <div className="flex items-center gap-2 mb-1">
              <div className="i-ph:github-logo text-2xl text-bolt-elements-textPrimary" />
              <DialogTitle>Export to GitHub</DialogTitle>
            </div>
            <DialogDescription className="mb-5">
              Push the entire AlphaCode project to a new GitHub repository in a single commit.
            </DialogDescription>

            {/* ── Exporting state ── */}
            {status === 'exporting' && (
              <div className="flex flex-col items-center py-10 gap-4">
                <div className="i-ph:spinner-gap-bold animate-spin text-4xl text-purple-500" />
                <div className="text-center">
                  <p className="text-sm font-medium text-bolt-elements-textPrimary">Exporting project...</p>
                  <p className="text-xs text-purple-500 font-medium mt-2 transition-all duration-300">
                    {PROGRESS_STAGES[progressStage]}
                  </p>
                  <p className="text-xs text-bolt-elements-textSecondary mt-2">
                    Uploading ~500+ files to GitHub. This usually takes 30–90 seconds — please keep this tab open.
                  </p>
                </div>
              </div>
            )}

            {/* ── Success state ── */}
            {status === 'success' && (
              <div className="flex flex-col items-center py-6 gap-4">
                <div className="i-ph:check-circle-bold text-5xl text-green-500" />
                <div className="text-center">
                  <p className="text-base font-semibold text-bolt-elements-textPrimary">
                    Successfully exported {fileCount} files!
                  </p>
                  <p className="text-xs text-bolt-elements-textTertiary mt-1 break-all max-w-[380px]">{repoUrl}</p>
                </div>

                {/*
                  Small dedicated file-count stat (added per request).
                  Does NOT change the form, buttons, export flow, or existing
                  text above — only adds this compact badge so the total number
                  of AlphaCode files saved to GitHub is shown as its own element.
                */}
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20">
                  <div className="i-ph:files-bold text-purple-500 text-sm" />
                  <span className="text-sm font-semibold text-purple-600 dark:text-purple-400">
                    {fileCount} {fileCount === 1 ? 'file' : 'files'} exported to GitHub
                  </span>
                </div>

                <div className="flex items-center gap-2 mt-2">
                  <a
                    href={repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg scheme-accent-solid text-sm font-medium transition-colors"
                  >
                    <div className="i-ph:arrow-square-out text-base" />
                    Open Repository
                  </a>
                  <Button variant="outline" onClick={handleClose}>
                    Close
                  </Button>
                </div>
              </div>
            )}

            {/* ── Form state (idle or error) ── */}
            {(status === 'idle' || status === 'error') && (
              <div className="flex flex-col gap-4">
                {/* Token */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="gh-token">GitHub Personal Access Token</Label>
                  <Input
                    id="gh-token"
                    type="password"
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="text-xs text-bolt-elements-textTertiary leading-relaxed">
                    Needs the{' '}
                    <code className="px-1 py-0.5 rounded bg-bolt-elements-background-depth-2 text-bolt-elements-textSecondary">
                      repo
                    </code>{' '}
                    scope. Create one at{' '}
                    <a
                      href="https://github.com/settings/tokens/new?scopes=repo&description=bolt.diy%20export"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-purple-500 hover:underline"
                    >
                      github.com/settings/tokens
                    </a>
                    .
                  </p>
                </div>

                {/* Repo name */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="gh-repo">Repository Name</Label>
                  <Input
                    id="gh-repo"
                    type="text"
                    placeholder="my-bolt-diy-project"
                    value={repoName}
                    onChange={(e) => setRepoName(e.target.value)}
                    spellCheck={false}
                  />
                </div>

                {/* Description */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="gh-desc">Description (optional)</Label>
                  <Input
                    id="gh-desc"
                    type="text"
                    placeholder="Exported from AlphaCode"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                {/* Private toggle */}
                <div className="flex items-center justify-between py-1">
                  <div className="flex flex-col gap-0.5">
                    <Label>Private repository</Label>
                    <span className="text-xs text-bolt-elements-textTertiary">Only you can see this repository.</span>
                  </div>
                  <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
                </div>

                {/* Error message */}
                {status === 'error' && errorMsg && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                    <div className="i-ph:warning-circle-bold text-red-500 text-lg shrink-0 mt-0.5" />
                    <p className="text-sm text-red-600 dark:text-red-400">{errorMsg}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-2 mt-1">
                  <Button variant="outline" onClick={handleClose}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleExport}
                    disabled={!token.trim() || !repoName.trim()}
                    className="scheme-accent-solid"
                  >
                    <div className="i-ph:upload-simple-bold text-base" />
                    Save to GitHub
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Dialog>
      </RadixDialog.Root>
    </>
  );
}

export const ExportGitHubButton = memo(ExportGitHubButtonImpl);
export default ExportGitHubButton;
