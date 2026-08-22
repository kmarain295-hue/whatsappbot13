import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

export default class XAIProvider extends BaseProvider {
  name = 'xAI';
  getApiKeyLink = 'https://docs.x.ai/docs/quickstart#creating-an-api-key';

  config = {
    apiTokenKey: 'XAI_API_KEY',
  };

  staticModels: ModelInfo[] = [
    // ===== Grok 4.1 Fast (Latest - November 2025) =====
    {
      name: 'grok-4.1-fast',
      label: 'xAI Grok 4.1 Fast',
      provider: 'xAI',
      maxTokenAllowed: 2000000,
      maxCompletionTokens: 100000,
    },

    // ===== Grok 4 Series (July 2025) =====
    {
      name: 'grok-4-0709',
      label: 'xAI Grok 4 (07-09)',
      provider: 'xAI',
      maxTokenAllowed: 256000,
      maxCompletionTokens: 100000,
    },
    { name: 'grok-4', label: 'xAI Grok 4', provider: 'xAI', maxTokenAllowed: 256000, maxCompletionTokens: 100000 },
    {
      name: 'grok-4-fast',
      label: 'xAI Grok 4 Fast',
      provider: 'xAI',
      maxTokenAllowed: 2000000,
      maxCompletionTokens: 100000,
    },
    {
      name: 'grok-code-fast-1',
      label: 'xAI Grok Code Fast 1',
      provider: 'xAI',
      maxTokenAllowed: 256000,
      maxCompletionTokens: 32768,
    },

    // ===== Grok 3 Series (February 2025) =====
    { name: 'grok-3', label: 'xAI Grok 3', provider: 'xAI', maxTokenAllowed: 131072, maxCompletionTokens: 16384 },
    {
      name: 'grok-3-fast',
      label: 'xAI Grok 3 Fast',
      provider: 'xAI',
      maxTokenAllowed: 131072,
      maxCompletionTokens: 16384,
    },
    {
      name: 'grok-3-mini',
      label: 'xAI Grok 3 Mini',
      provider: 'xAI',
      maxTokenAllowed: 131072,
      maxCompletionTokens: 16384,
    },
    {
      name: 'grok-3-mini-fast',
      label: 'xAI Grok 3 Mini Fast',
      provider: 'xAI',
      maxTokenAllowed: 131072,
      maxCompletionTokens: 16384,
    },

    // ===== Grok 2 Series (August 2024) =====
    { name: 'grok-2', label: 'xAI Grok 2', provider: 'xAI', maxTokenAllowed: 131072, maxCompletionTokens: 16384 },
    {
      name: 'grok-2-mini',
      label: 'xAI Grok 2 Mini',
      provider: 'xAI',
      maxTokenAllowed: 131072,
      maxCompletionTokens: 16384,
    },
    {
      name: 'grok-2-vision',
      label: 'xAI Grok 2 Vision',
      provider: 'xAI',
      maxTokenAllowed: 32768,
      maxCompletionTokens: 16384,
    },

    // ===== Grok Beta (2023) =====
    { name: 'grok-beta', label: 'xAI Grok Beta', provider: 'xAI', maxTokenAllowed: 32768, maxCompletionTokens: 4096 },
    {
      name: 'grok-vision-beta',
      label: 'xAI Grok Vision Beta',
      provider: 'xAI',
      maxTokenAllowed: 8192,
      maxCompletionTokens: 4096,
    },
  ];

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'XAI_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const openai = createOpenAI({
      baseURL: 'https://api.x.ai/v1',
      apiKey,
    });

    return openai(model);
  }
}
