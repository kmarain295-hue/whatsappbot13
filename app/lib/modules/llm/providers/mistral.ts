import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createMistral } from '@ai-sdk/mistral';

export default class MistralProvider extends BaseProvider {
  name = 'Mistral';
  getApiKeyLink = 'https://console.mistral.ai/api-keys/';

  config = {
    apiTokenKey: 'MISTRAL_API_KEY',
  };

  staticModels: ModelInfo[] = [
    // ===== Magistral Series (Latest - 2025, Reasoning) =====
    {
      name: 'magistral-medium-latest',
      label: 'Magistral Medium (Reasoning)',
      provider: 'Mistral',
      maxTokenAllowed: 40000,
      maxCompletionTokens: 40000,
    },
    {
      name: 'magistral-small-latest',
      label: 'Magistral Small (Reasoning)',
      provider: 'Mistral',
      maxTokenAllowed: 40000,
      maxCompletionTokens: 40000,
    },

    // ===== Devstral Series (2025, Coding) =====
    {
      name: 'devstral-medium-latest',
      label: 'Devstral Medium (Coding)',
      provider: 'Mistral',
      maxTokenAllowed: 256000,
      maxCompletionTokens: 128000,
    },
    {
      name: 'devstral-small-latest',
      label: 'Devstral Small (Coding)',
      provider: 'Mistral',
      maxTokenAllowed: 256000,
      maxCompletionTokens: 128000,
    },

    // ===== Mistral Large 2 (Latest Flagship) =====
    {
      name: 'mistral-large-latest',
      label: 'Mistral Large 2 (Latest)',
      provider: 'Mistral',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 128000,
    },
    {
      name: 'mistral-medium-3-latest',
      label: 'Mistral Medium 3 (Latest)',
      provider: 'Mistral',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 128000,
    },

    // ===== Mistral Small 3 (2025) =====
    {
      name: 'mistral-small-latest',
      label: 'Mistral Small 3 (Latest)',
      provider: 'Mistral',
      maxTokenAllowed: 32000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'mistral-saba-latest',
      label: 'Mistral Saba',
      provider: 'Mistral',
      maxTokenAllowed: 32000,
      maxCompletionTokens: 8192,
    },

    // ===== Ministral Series (2024) =====
    {
      name: 'ministral-8b-latest',
      label: 'Ministral 8B',
      provider: 'Mistral',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'ministral-3b-latest',
      label: 'Ministral 3B',
      provider: 'Mistral',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },

    // ===== Codestral (2024) =====
    {
      name: 'codestral-latest',
      label: 'Codestral',
      provider: 'Mistral',
      maxTokenAllowed: 256000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'open-codestral-mamba',
      label: 'Codestral Mamba',
      provider: 'Mistral',
      maxTokenAllowed: 256000,
      maxCompletionTokens: 8192,
    },

    // ===== Open Models (2024) =====
    {
      name: 'open-mistral-nemo',
      label: 'Mistral Nemo',
      provider: 'Mistral',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'open-mixtral-8x22b',
      label: 'Mistral 8x22B',
      provider: 'Mistral',
      maxTokenAllowed: 64000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'open-mixtral-8x7b',
      label: 'Mistral 8x7B',
      provider: 'Mistral',
      maxTokenAllowed: 32000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'open-mistral-7b',
      label: 'Mistral 7B',
      provider: 'Mistral',
      maxTokenAllowed: 32000,
      maxCompletionTokens: 8192,
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
      defaultApiTokenKey: 'MISTRAL_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const mistral = createMistral({
      apiKey,
    });

    return mistral(model);
  }
}
