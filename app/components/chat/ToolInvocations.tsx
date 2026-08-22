import type { ToolInvocationUIPart } from '@ai-sdk/ui-utils';
import { AnimatePresence, motion } from 'framer-motion';
import { memo, useMemo, useState, useEffect } from 'react';
import { createHighlighter, type BundledLanguage, type BundledTheme, type HighlighterGeneric } from 'shiki';
import { classNames } from '~/utils/classNames';
import {
  TOOL_EXECUTION_APPROVAL,
  TOOL_EXECUTION_DENIED,
  TOOL_EXECUTION_ERROR,
  TOOL_NO_EXECUTE_FUNCTION,
} from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { logger } from '~/utils/logger';
import { themeStore, type Theme } from '~/lib/stores/theme';
import { useStore } from '@nanostores/react';
import type { ToolCallAnnotation } from '~/types/context';
import { SdkToolResult } from './SdkToolResult';

const highlighterOptions = {
  langs: ['json'],
  themes: ['light-plus', 'dark-plus'],
};

const jsonHighlighter: HighlighterGeneric<BundledLanguage, BundledTheme> =
  import.meta.hot?.data.jsonHighlighter ?? (await createHighlighter(highlighterOptions));

if (import.meta.hot) {
  import.meta.hot.data.jsonHighlighter = jsonHighlighter;
}

/** Detects whether a tool result comes from an SDK-powered tool (has a `tool` field). */
function isSdkToolResult(result: any): boolean {
  return result !== null && typeof result === 'object' && typeof (result as { tool?: unknown }).tool === 'string';
}

interface JsonCodeBlockProps {
  className?: string;
  code: string;
  theme: Theme;
}

function JsonCodeBlock({ className, code, theme }: JsonCodeBlockProps) {
  let formattedCode = code;

  try {
    if (typeof formattedCode === 'object') {
      formattedCode = JSON.stringify(formattedCode, null, 2);
    } else if (typeof formattedCode === 'string') {
      // Attempt to parse and re-stringify for formatting
      try {
        const parsed = JSON.parse(formattedCode);
        formattedCode = JSON.stringify(parsed, null, 2);
      } catch {
        // Leave as is if not JSON
      }
    }
  } catch (e) {
    // If parsing fails, keep original code
    logger.error('Failed to parse JSON', { error: e });
  }

  return (
    <div
      className={classNames('text-xs rounded-md overflow-hidden mcp-tool-invocation-code', className)}
      dangerouslySetInnerHTML={{
        __html: jsonHighlighter.codeToHtml(formattedCode, {
          lang: 'json',
          theme: theme === 'dark' ? 'dark-plus' : 'light-plus',
        }),
      }}
      style={{
        padding: '0',
        margin: '0',
      }}
    ></div>
  );
}

interface ToolInvocationsProps {
  toolInvocations: ToolInvocationUIPart[];
  toolCallAnnotations: ToolCallAnnotation[];
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
}

export const ToolInvocations = memo(({ toolInvocations, toolCallAnnotations, addToolResult }: ToolInvocationsProps) => {
  const theme = useStore(themeStore);
  const [showDetails, setShowDetails] = useState(true);

  const toggleDetails = () => {
    setShowDetails((prev) => !prev);
  };

  /*
   * Split tool invocations into two groups:
   *
   * 1. SDK tool results — completed results from built-in AI tools (TTS, image
   *    generation, video generation, image search, etc.). These carry rich media
   *    (audio, images, video) that the user needs to see/play immediately. They
   *    are rendered in a prominent, ALWAYS-VISIBLE section — never collapsed.
   *
   * 2. MCP tool invocations — calls and results from user-configured MCP servers.
   *    These include a pending-approval flow ("Run tool" / "Cancel") and are
   *    rendered in a collapsible panel (auto-expanded by default).
   */
  const sdkToolResults = useMemo(
    () =>
      toolInvocations.filter(
        (inv) => inv.toolInvocation.state === 'result' && isSdkToolResult(inv.toolInvocation.result),
      ),
    [toolInvocations],
  );

  const mcpInvocations = useMemo(
    () =>
      toolInvocations.filter((inv) => {
        if (inv.toolInvocation.state === 'call') {
          return true;
        }

        // Result state — only keep if it's NOT an SDK tool result.
        return !isSdkToolResult(inv.toolInvocation.result);
      }),
    [toolInvocations],
  );

  const toolCalls = useMemo(
    () => mcpInvocations.filter((inv) => inv.toolInvocation.state === 'call'),
    [mcpInvocations],
  );

  const toolResults = useMemo(
    () => mcpInvocations.filter((inv) => inv.toolInvocation.state === 'result'),
    [mcpInvocations],
  );

  const hasToolCalls = toolCalls.length > 0;
  const hasToolResults = toolResults.length > 0;
  const hasMcpTools = hasToolCalls || hasToolResults;
  const hasSdkResults = sdkToolResults.length > 0;

  if (!hasMcpTools && !hasSdkResults) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 w-full">
      {hasSdkResults && <SdkToolResultsPanel toolInvocations={sdkToolResults} />}
      {hasMcpTools && (
        <div className="tool-invocation border border-bolt-elements-borderColor flex flex-col overflow-hidden rounded-lg w-full transition-border duration-150">
          <div className="flex">
            <button
              className="flex items-stretch bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-artifacts-backgroundHover w-full overflow-hidden"
              onClick={toggleDetails}
              aria-label={showDetails ? 'Collapse details' : 'Expand details'}
            >
              <div className="p-2.5">
                <div className="i-ph:wrench text-xl text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors"></div>
              </div>
              <div className="p-2.5 w-full text-left">
                <div className="w-full text-bolt-elements-textPrimary font-medium leading-5 text-sm">
                  Tool Invocations{' '}
                  {hasToolResults && (
                    <span className="w-full w-full text-bolt-elements-textSecondary text-xs mt-0.5">
                      ({toolResults.length} tool{hasToolResults ? 's' : ''} used)
                    </span>
                  )}
                </div>
              </div>
            </button>
            <AnimatePresence>
              {hasToolResults && (
                <motion.button
                  initial={{ width: 0 }}
                  animate={{ width: 'auto' }}
                  exit={{ width: 0 }}
                  transition={{ duration: 0.15, ease: cubicEasingFn }}
                  className="bg-bolt-elements-artifacts-background hover:bg-bolt-elements-artifacts-backgroundHover"
                  onClick={toggleDetails}
                >
                  <div className="p-2">
                    <div
                      className={`${showDetails ? 'i-ph:caret-up-bold' : 'i-ph:caret-down-bold'} text-xl text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors`}
                    ></div>
                  </div>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
          <AnimatePresence>
            {hasToolCalls && (
              <motion.div
                className="details"
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                exit={{ height: '0px' }}
                transition={{ duration: 0.15 }}
              >
                <div className="bg-bolt-elements-artifacts-borderColor h-[1px]" />

                <div className="px-3 py-3 text-left bg-bolt-elements-background-depth-2">
                  <ToolCallsList
                    toolInvocations={toolCalls}
                    toolCallAnnotations={toolCallAnnotations}
                    addToolResult={addToolResult}
                    theme={theme}
                  />
                </div>
              </motion.div>
            )}

            {hasToolResults && showDetails && (
              <motion.div
                className="details"
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                exit={{ height: '0px' }}
                transition={{ duration: 0.15 }}
              >
                <div className="bg-bolt-elements-artifacts-borderColor h-[1px]" />

                <div className="p-5 text-left bg-bolt-elements-actions-background">
                  <ToolResultsList
                    toolInvocations={toolResults}
                    toolCallAnnotations={toolCallAnnotations}
                    theme={theme}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
});

/*
 * Maps SDK tool IDs to a human-friendly label + icon for the prominent result
 * panel header. Keeps the UI readable ("Text to Speech" vs the raw id
 * "text_to_speech").
 */
const SDK_TOOL_META: Record<string, { label: string; icon: string }> = {
  text_to_speech: { label: 'Text to Speech', icon: 'i-ph:speaker-high' },
  speech_to_text: { label: 'Speech to Text', icon: 'i-ph:microphone' },
  image_generation: { label: 'Image Generation', icon: 'i-ph:image' },
  image_editing: { label: 'Image Editing', icon: 'i-ph:pencil-simple-line' },
  image_search: { label: 'Image Search', icon: 'i-ph:images-square' },
  video_generation: { label: 'Video Generation', icon: 'i-ph:video-camera' },
  vision_ocr: { label: 'Vision / OCR', icon: 'i-ph:eye' },
  web_search: { label: 'Web Search', icon: 'i-ph:magnifying-glass' },
  page_reader: { label: 'Web Reader', icon: 'i-ph:globe-stand' },
};

interface SdkToolResultsPanelProps {
  toolInvocations: ToolInvocationUIPart[];
}

/*
 * Renders completed SDK tool results (audio, images, video, search results) in
 * a prominent, ALWAYS-VISIBLE section — never collapsed. Each result gets its
 * own labelled card so the user can immediately see and interact with the
 * output (play audio, view image, play video, click search results).
 */
const SdkToolResultsPanel = memo(({ toolInvocations }: SdkToolResultsPanelProps) => {
  return (
    <div className="flex flex-col gap-3 w-full">
      {toolInvocations.map((tool, index) => {
        if (tool.toolInvocation.state !== 'result') {
          return null;
        }

        const { toolName, result } = tool.toolInvocation;
        const meta = SDK_TOOL_META[result?.tool as string] || { label: toolName, icon: 'i-ph:wrench' };

        return (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: cubicEasingFn }}
            className="border border-bolt-elements-borderColor rounded-lg overflow-hidden bg-bolt-elements-background-depth-2"
          >
            <div className="flex items-center gap-2 px-4 py-1.5 bg-bolt-elements-background-depth-3 border-b border-bolt-elements-borderColor">
              <div className={`${meta.icon} text-base text-purple-500`} />
              <span className="text-sm font-medium text-bolt-elements-textPrimary">{meta.label}</span>
              <span className="text-xs text-bolt-elements-textTertiary ml-auto">AI Tool Output</span>
            </div>
            <div className="p-2">
              <SdkToolResult result={result} />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
});

const toolVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

interface ToolResultsListProps {
  toolInvocations: ToolInvocationUIPart[];
  toolCallAnnotations: ToolCallAnnotation[];
  theme: Theme;
}

const ToolResultsList = memo(({ toolInvocations, toolCallAnnotations, theme }: ToolResultsListProps) => {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
      <ul className="list-none space-y-4">
        {toolInvocations.map((tool, index) => {
          const toolCallState = tool.toolInvocation.state;

          if (toolCallState !== 'result') {
            return null;
          }

          const { toolName, toolCallId } = tool.toolInvocation;

          const annotation = toolCallAnnotations.find((annotation) => {
            return annotation.toolCallId === toolCallId;
          });

          const isErrorResult = [TOOL_NO_EXECUTE_FUNCTION, TOOL_EXECUTION_DENIED, TOOL_EXECUTION_ERROR].includes(
            tool.toolInvocation.result,
          );

          return (
            <motion.li
              key={index}
              variants={toolVariants}
              initial="hidden"
              animate="visible"
              transition={{
                duration: 0.2,
                ease: cubicEasingFn,
              }}
            >
              <div className="flex items-center gap-1.5 text-xs mb-1">
                {isErrorResult ? (
                  <div className="text-lg text-bolt-elements-icon-error">
                    <div className="i-ph:x"></div>
                  </div>
                ) : (
                  <div className="text-lg text-bolt-elements-icon-success">
                    <div className="i-ph:check"></div>
                  </div>
                )}
                {annotation?.serverName && (
                  <>
                    <div className="text-bolt-elements-textSecondary text-xs">Server:</div>
                    <div className="text-bolt-elements-textPrimary font-semibold">{annotation.serverName}</div>
                  </>
                )}
              </div>

              <div className="ml-6 mb-2">
                <div className="text-bolt-elements-textSecondary text-xs mb-1">
                  Tool: <span className="text-bolt-elements-textPrimary font-semibold">{toolName}</span>
                </div>
                {annotation?.toolDescription && (
                  <div className="text-bolt-elements-textSecondary text-xs mb-1">
                    Description:{' '}
                    <span className="text-bolt-elements-textPrimary font-semibold">{annotation.toolDescription}</span>
                  </div>
                )}
                <div className="text-bolt-elements-textSecondary text-xs mb-1">Parameters:</div>
                <div className="bg-[#FAFAFA] dark:bg-[#0A0A0A] p-3 rounded-md">
                  <JsonCodeBlock className="mb-0" code={JSON.stringify(tool.toolInvocation.args)} theme={theme} />
                </div>
                <div className="text-bolt-elements-textSecondary text-xs mt-3 mb-1">Result:</div>
                <div className="bg-[#FAFAFA] dark:bg-[#0A0A0A] p-3 rounded-md">
                  {isSdkToolResult(tool.toolInvocation.result) ? (
                    <SdkToolResult result={tool.toolInvocation.result} />
                  ) : (
                    <JsonCodeBlock className="mb-0" code={JSON.stringify(tool.toolInvocation.result)} theme={theme} />
                  )}
                </div>
              </div>
            </motion.li>
          );
        })}
      </ul>
    </motion.div>
  );
});

interface ToolCallsListProps {
  toolInvocations: ToolInvocationUIPart[];
  toolCallAnnotations: ToolCallAnnotation[];
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
  theme: Theme;
}

const ToolCallsList = memo(({ toolInvocations, toolCallAnnotations, addToolResult }: ToolCallsListProps) => {
  const [expanded, setExpanded] = useState<{ [id: string]: boolean }>({});

  // OS detection for shortcut display
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    const expandedState: { [id: string]: boolean } = {};
    toolInvocations.forEach((inv) => {
      if (inv.toolInvocation.state === 'call') {
        expandedState[inv.toolInvocation.toolCallId] = true;
      }
    });
    setExpanded(expandedState);
  }, [toolInvocations]);

  // Keyboard shortcut logic
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in an input/textarea/contenteditable
      const active = document.activeElement as HTMLElement | null;

      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        return;
      }

      if (Object.keys(expanded).length === 0) {
        return;
      }

      const openId = Object.keys(expanded).find((id) => expanded[id]);

      if (!openId) {
        return;
      }

      // Cancel: Cmd/Ctrl + Backspace
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key === 'Backspace') {
        e.preventDefault();
        addToolResult({
          toolCallId: openId,
          result: TOOL_EXECUTION_APPROVAL.REJECT,
        });
      }

      // Run tool: Cmd/Ctrl + Enter
      if ((isMac ? e.metaKey : e.ctrlKey) && (e.key === 'Enter' || e.key === 'Return')) {
        e.preventDefault();
        addToolResult({
          toolCallId: openId,
          result: TOOL_EXECUTION_APPROVAL.APPROVE,
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expanded, addToolResult, isMac]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
      <ul className="list-none space-y-4">
        {toolInvocations.map((tool, index) => {
          const toolCallState = tool.toolInvocation.state;

          if (toolCallState !== 'call') {
            return null;
          }

          const { toolName, toolCallId } = tool.toolInvocation;
          const annotation = toolCallAnnotations.find((annotation) => annotation.toolCallId === toolCallId);

          return (
            <motion.li
              key={index}
              variants={toolVariants}
              initial="hidden"
              animate="visible"
              transition={{ duration: 0.2, ease: cubicEasingFn }}
            >
              <div className="bg-bolt-elements-background-depth-3 rounded-lg p-2">
                <div key={toolCallId} className="flex gap-1">
                  <div className="flex flex-col items-center ">
                    <span className="mr-auto font-light font-normal text-md text-bolt-elements-textPrimary rounded-md">
                      {toolName}
                    </span>
                    <span className="text-xs text-bolt-elements-textSecondary font-light break-words max-w-64">
                      {annotation?.toolDescription}
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-2 ml-auto">
                    <button
                      className={classNames(
                        'h-10 px-2.5 py-1.5 rounded-lg text-xs h-auto',
                        'bg-transparent',
                        'text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary',
                        'transition-all duration-200',
                        'flex items-center gap-2',
                      )}
                      onClick={() =>
                        addToolResult({
                          toolCallId,
                          result: TOOL_EXECUTION_APPROVAL.REJECT,
                        })
                      }
                    >
                      Cancel <span className="opacity-70 text-xs ml-1">{isMac ? '⌘⌫' : 'Ctrl+Backspace'}</span>
                    </button>
                    <button
                      className={classNames(
                        'h-10 inline-flex items-center gap-2 px-3 py-1.5 text-xs font-normal rounded-lg transition-colors',
                        'bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor',
                        'text-accent-500 hover:text-bolt-elements-textPrimary',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                      )}
                      onClick={() =>
                        addToolResult({
                          toolCallId,
                          result: TOOL_EXECUTION_APPROVAL.APPROVE,
                        })
                      }
                    >
                      Run tool <span className="opacity-70 text-xs ml-1">{isMac ? '⌘↵' : 'Ctrl+Enter'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </motion.li>
          );
        })}
      </ul>
    </motion.div>
  );
});
