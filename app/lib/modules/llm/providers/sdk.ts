import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { LanguageModelV1 } from 'ai';
import type { ModelInfo } from '~/lib/modules/llm/types';
import { createOpenAI } from '@ai-sdk/openai';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * SDK Provider — auto-connected, no user API key required.
 *
 * This provider uses the `z-ai-web-dev-sdk` configuration file
 * (`/etc/.z-ai-config`, `~/.z-ai-config`, or `./.z-ai-config`) which
 * contains a `baseUrl` + `apiKey` pair. The endpoint is OpenAI-compatible,
 * so we wrap it with `@ai-sdk/openai`'s `createOpenAI`.
 *
 * Because `getModelInstance` is synchronous, the config is read once with
 * `readFileSync` and cached for the lifetime of the process.
 */

interface ZaiConfig {
  baseUrl: string;
  apiKey: string;
  chatId?: string;
  userId?: string;
  token?: string;
}

let cachedConfig: ZaiConfig | null = null;

/**
 * Reads the z-ai-web-dev-sdk configuration file synchronously.
 * Searches the same priority list as the SDK itself:
 *   1. <cwd>/.z-ai-config
 *   2. <home>/.z-ai-config
 *   3. /etc/.z-ai-config
 *
 * The result is cached so subsequent calls are free.
 */
function loadConfig(): ZaiConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPaths = [
    path.join(process.cwd(), '.z-ai-config'),
    path.join(os.homedir(), '.z-ai-config'),
    '/etc/.z-ai-config',
  ];

  for (const configPath of configPaths) {
    try {
      const configStr = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configStr) as ZaiConfig;

      if (config.baseUrl && config.apiKey) {
        cachedConfig = config;

        return config;
      }
    } catch {
      // File doesn't exist or is invalid — try the next path.
    }
  }

  throw new Error(
    'SDK provider configuration not found. Please create a .z-ai-config file with { "baseUrl": "...", "apiKey": "..." } in your project, home directory, or /etc/.z-ai-config.',
  );
}

/**
 * Vision-capable model used when image/multimodal content is detected.
 *
 * The Z.ai standard chat endpoint (`/chat/completions`) only accepts text
 * content. Vision must go through `/chat/completions/vision` with a
 * vision-capable model. By switching to `glm-4.5v` here, VLM works
 * regardless of which model the user selected.
 */
const VISION_MODEL = 'glm-4.5v';

/**
 * Creates a custom `fetch` wrapper for the OpenAI-compatible client.
 *
 * The Z.ai API has two separate endpoints:
 *   - `/chat/completions`        — text-only (rejects image parts with
 *                                  "messages.content.type 参数非法，取值范围 ['text']")
 *   - `/chat/completions/vision` — multimodal (text + image_url + video_url)
 *
 * This wrapper inspects every chat-completions request body. When image or
 * other multimodal content parts are found, it transparently rewrites the
 * URL to the vision endpoint and switches the model to a vision-capable one
 * (`glm-4.5v`). Text-only requests pass through unchanged.
 *
 * As a result, uploading an image and asking "what is in this image?" works
 * no matter which SDK model the user has selected.
 */
function createVisionAwareFetch(): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: string;

    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else {
      url = input.url;
    }

    let body = init?.body;

    /*
     * Only intercept chat-completions requests with a JSON string body.
     * Model-listing and other requests pass through untouched.
     */
    if (typeof body === 'string' && url.includes('/chat/completions') && !url.includes('/chat/completions/vision')) {
      try {
        const parsed = JSON.parse(body) as { messages?: Array<{ content?: unknown }> };
        const messages = parsed.messages;

        if (Array.isArray(messages)) {
          const hasMultimodal = messages.some(
            (msg) =>
              Array.isArray(msg.content) &&
              msg.content.some(
                (part) =>
                  part !== null &&
                  typeof part === 'object' &&
                  ['image_url', 'image', 'video_url', 'file_url'].includes((part as { type?: string }).type || ''),
              ),
          );

          if (hasMultimodal) {
            /*
             * CRITICAL: The Z.ai API has two endpoints with incompatible
             * capabilities:
             *   - /chat/completions        → supports `tools` (function
             *                                calling) but REJECTS image
             *                                content (HTTP 400).
             *   - /chat/completions/vision → accepts image content but does
             *                                NOT support `tools` (the model
             *                                outputs tool calls as plain
             *                                text instead of proper function
             *                                calls).
             *
             * This means if we redirect an image-editing request to the
             * vision endpoint, the AI's `image_editing` tool call is never
             * executed — it appears as text like
             * `[image_editing prompt="..."]` and no edit happens.
             *
             * Solution: when the request includes `tools` (function-calling
             * capabilities), strip image parts from the messages, insert a
             * text note telling the model an image was uploaded, and keep
             * the request on the STANDARD endpoint so tools work. The
             * image_editing / vision_ocr tools access the uploaded image
             * via `contextImages` (passed from the backend), so the model
             * does not need the raw base64 data.
             *
             * When no tools are present, fall back to the vision endpoint
             * so the model can see and describe the image directly.
             */
            const hasTools = Array.isArray((parsed as { tools?: unknown }).tools) &&
              ((parsed as { tools?: unknown[] }).tools?.length ?? 0) > 0;

            if (hasTools) {
              /*
               * Strip image / video / file parts from every message and
               * replace them with a text note. The standard endpoint only
               * accepts `text` content parts, so leaving image parts in
               * would cause a 400 error.
               */
              (parsed as { messages: Array<{ content?: unknown }> }).messages = messages.map((msg) => {
                if (!Array.isArray(msg.content)) {
                  return msg;
                }

                const imageCount = msg.content.filter(
                  (part) =>
                    part !== null &&
                    typeof part === 'object' &&
                    ['image_url', 'image', 'video_url', 'file_url'].includes((part as { type?: string }).type || ''),
                ).length;

                if (imageCount === 0) {
                  return msg;
                }

                /*
                 * Keep text parts; replace media parts with a note.
                 * If no text parts exist, create a string content.
                 */
                const textParts = msg.content.filter(
                  (part) =>
                    part === null ||
                    typeof part !== 'object' ||
                    (part as { type?: string }).type === 'text',
                );

                const textContent = textParts
                  .map((p) => (typeof p === 'object' && p !== null ? (p as { text?: string }).text || '' : ''))
                  .join('');

                const note =
                  imageCount > 1
                    ? `\n\n[The user has uploaded ${imageCount} images in this message. The images are available to your tools — call the \`image_editing\` tool (omit the \`image\` parameter) to edit the most recent one, or call the \`vision_ocr\` tool (omit the \`imageUrl\` parameter) to analyse it.]`
                    : '\n\n[The user has uploaded an image in this message. The image is available to your tools — call the `image_editing` tool (omit the `image` parameter) to edit it, or call the `vision_ocr` tool (omit the `imageUrl` parameter) to analyse it.]';

                return {
                  ...msg,
                  content: textContent + note,
                };
              });

              body = JSON.stringify(parsed);
              // Stay on the standard /chat/completions endpoint (do NOT redirect to vision).
            } else {
              /*
               * No tools in the request → route to the vision endpoint so
               * the model can see and describe the image directly. The
               * model is overridden so VLM works regardless of the user's
               * selected model (glm-4.6, glm-4.5, glm-4.5-flash, etc.).
               */
              url = url.replace('/chat/completions', '/chat/completions/vision');
              (parsed as { model?: string }).model = VISION_MODEL;
              body = JSON.stringify(parsed);
            }
          }
        }
      } catch {
        // Body isn't valid JSON — pass the request through unchanged.
      }
    }

    return fetch(url, { ...init, body });
  };
}

export default class SdkProvider extends BaseProvider {
  name = 'SDK';

  /**
   * No API key link — the provider is auto-connected via the config file.
   * Setting this to undefined hides the "Get API Key" button in the UI.
   */
  getApiKeyLink = undefined;
  labelForGetApiKey = 'Auto-connected (no key needed)';

  /**
   * Empty config — no env var keys are needed because the provider reads
   * directly from the .z-ai-config file.
   */
  config = {};

  staticModels: ModelInfo[] = [
    /*
     * Complete GLM model lineup via the auto-connected SDK provider.
     * Ordered latest (top) → oldest (bottom).
     */
    // GLM-4.6 (2025) — latest flagship, 200K context
    {
      name: 'glm-4.6',
      label: 'GLM-4.6 (200K) · SDK',
      provider: 'SDK',
      maxTokenAllowed: 200000,
      maxCompletionTokens: 65536,
    },

    // GLM-4.5 family
    {
      name: 'glm-4.5',
      label: 'GLM-4.5 (128K) · SDK',
      provider: 'SDK',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 65536,
    },
    {
      name: 'glm-4.5-air',
      label: 'GLM-4.5 Air (128K) · SDK',
      provider: 'SDK',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 65536,
    },
    {
      name: 'glm-4.5-flash',
      label: 'GLM-4.5 Flash (128K) · SDK',
      provider: 'SDK',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 65536,
    },
    {
      name: 'glm-4.5v',
      label: 'GLM-4.5V Vision (128K) · SDK',
      provider: 'SDK',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 65536,
    },

    // GLM-4 family (older)
    {
      name: 'glm-4-plus',
      label: 'GLM-4 Plus (128K) · SDK',
      provider: 'SDK',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 4096,
    },
    {
      name: 'glm-4-long',
      label: 'GLM-4 Long (1M) · SDK',
      provider: 'SDK',
      maxTokenAllowed: 1000000,
      maxCompletionTokens: 4096,
    },
    {
      name: 'glm-4-flash',
      label: 'GLM-4 Flash (128K) · SDK',
      provider: 'SDK',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 4096,
    },
    {
      name: 'glm-4',
      label: 'GLM-4 (128K) · SDK',
      provider: 'SDK',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 4096,
    },

    // GLM-3 (oldest)
    {
      name: 'glm-3-turbo',
      label: 'GLM-3 Turbo (128K) · SDK',
      provider: 'SDK',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 4096,
    },
  ];

  getModelInstance(options: {
    model: string;
    serverEnv?: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, any>;
  }): LanguageModelV1 {
    const { model } = options;

    const config = loadConfig();

    /*
     * Build the OpenAI-compatible client with the SDK's config.
     * Custom headers mirror what z-ai-web-dev-sdk sends internally.
     */
    const sdkClient = createOpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,

      /*
       * Custom fetch that routes image/multimodal requests to the Z.ai vision
       * endpoint. Without this, uploading an image and asking about it fails
       * with "messages.content.type 参数非法，取值范围 ['text']" because the
       * standard chat endpoint only accepts text content.
       */
      fetch: createVisionAwareFetch(),
      headers: {
        'X-Z-AI-From': 'Z',
        ...(config.chatId ? { 'X-Chat-Id': config.chatId } : {}),
        ...(config.userId ? { 'X-User-Id': config.userId } : {}),
        ...(config.token ? { 'X-Token': config.token } : {}),
      },
    });

    return sdkClient(model);
  }
}
