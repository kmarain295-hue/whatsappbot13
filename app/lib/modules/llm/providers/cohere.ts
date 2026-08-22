import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createCohere } from '@ai-sdk/cohere';

export default class CohereProvider extends BaseProvider {
  name = 'Cohere';
  getApiKeyLink = 'https://dashboard.cohere.com/api-keys';

  config = {
    apiTokenKey: 'COHERE_API_KEY',
  };

  staticModels: ModelInfo[] = [
    // ===== Command A (Latest - March 2025) =====
    {
      name: 'command-a-03-2025',
      label: 'Command A (Latest Flagship)',
      provider: 'Cohere',
      maxTokenAllowed: 256000,
      maxCompletionTokens: 8000,
    },

    // ===== Command R Series (2024) =====
    {
      name: 'command-r-plus-08-2024',
      label: 'Command R+ (08-2024)',
      provider: 'Cohere',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 4000,
    },
    {
      name: 'command-r-08-2024',
      label: 'Command R (08-2024)',
      provider: 'Cohere',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 4000,
    },
    {
      name: 'command-r7b-12-2024',
      label: 'Command R7B (12-2024)',
      provider: 'Cohere',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 4000,
    },
    {
      name: 'command-r-plus',
      label: 'Command R+',
      provider: 'Cohere',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 4000,
    },
    {
      name: 'command-r',
      label: 'Command R',
      provider: 'Cohere',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 4000,
    },

    // ===== Command Series (2023) =====
    {
      name: 'command',
      label: 'Command',
      provider: 'Cohere',
      maxTokenAllowed: 4096,
      maxCompletionTokens: 4000,
    },
    {
      name: 'command-nightly',
      label: 'Command Nightly',
      provider: 'Cohere',
      maxTokenAllowed: 4096,
      maxCompletionTokens: 4000,
    },
    {
      name: 'command-light',
      label: 'Command Light',
      provider: 'Cohere',
      maxTokenAllowed: 4096,
      maxCompletionTokens: 4000,
    },
    {
      name: 'command-light-nightly',
      label: 'Command Light Nightly',
      provider: 'Cohere',
      maxTokenAllowed: 4096,
      maxCompletionTokens: 4000,
    },

    // ===== Aya Series (Multilingual, 2024) =====
    {
      name: 'c4ai-aya-expanse-32b',
      label: 'Aya Expanse 32B',
      provider: 'Cohere',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 4000,
    },
    {
      name: 'c4ai-aya-expanse-8b',
      label: 'Aya Expanse 8B',
      provider: 'Cohere',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 4000,
    },
    {
      name: 'aya-23-35b',
      label: 'Aya 23 35B',
      provider: 'Cohere',
      maxTokenAllowed: 8192,
      maxCompletionTokens: 4000,
    },
    {
      name: 'aya-23-8b',
      label: 'Aya 23 8B',
      provider: 'Cohere',
      maxTokenAllowed: 8192,
      maxCompletionTokens: 4000,
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
      defaultApiTokenKey: 'COHERE_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const cohere = createCohere({
      apiKey,
    });

    return cohere(model);
  }
}
