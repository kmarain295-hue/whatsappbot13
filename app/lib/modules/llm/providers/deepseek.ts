import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';

export default class DeepseekProvider extends BaseProvider {
  name = 'Deepseek';
  getApiKeyLink = 'https://platform.deepseek.com/apiKeys';

  config = {
    apiTokenKey: 'DEEPSEEK_API_KEY',
  };

  staticModels: ModelInfo[] = [
    // ===== DeepSeek V3.2-Exp (Latest - 2025) =====
    {
      name: 'deepseek-v3.2-Exp',
      label: 'DeepSeek V3.2-Exp (Latest)',
      provider: 'Deepseek',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 64000,
    },
    {
      name: 'deepseek-v3.2-speciale',
      label: 'DeepSeek V3.2 Speciale (High-Compute)',
      provider: 'Deepseek',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 64000,
    },
    {
      name: 'deepseek-v3.2',
      label: 'DeepSeek V3.2 (Coding + Tool Use)',
      provider: 'Deepseek',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 64000,
    },

    // ===== DeepSeek R1 Series (2025) =====
    {
      name: 'deepseek-r1-0528',
      label: 'DeepSeek R1 (0528)',
      provider: 'Deepseek',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 64000,
    },
    {
      name: 'deepseek-reasoner',
      label: 'DeepSeek Reasoner (R1)',
      provider: 'Deepseek',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 64000,
    },
    {
      name: 'deepseek-r1',
      label: 'DeepSeek R1',
      provider: 'Deepseek',
      maxTokenAllowed: 64000,
      maxCompletionTokens: 32768,
    },

    // ===== DeepSeek V3 (2024) =====
    {
      name: 'deepseek-chat',
      label: 'DeepSeek Chat (V3.2)',
      provider: 'Deepseek',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 64000,
    },
    {
      name: 'deepseek-v3',
      label: 'DeepSeek V3',
      provider: 'Deepseek',
      maxTokenAllowed: 64000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'deepseek-v2.5',
      label: 'DeepSeek V2.5',
      provider: 'Deepseek',
      maxTokenAllowed: 32000,
      maxCompletionTokens: 8192,
    },

    // ===== DeepSeek Coder (2024) =====
    {
      name: 'deepseek-coder',
      label: 'DeepSeek Coder',
      provider: 'Deepseek',
      maxTokenAllowed: 64000,
      maxCompletionTokens: 8192,
    },
  ];

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>,
  ): Promise<ModelInfo[]> {
    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'DEEPSEEK_API_KEY',
    });

    if (!apiKey) {
      return [];
    }

    try {
      const response = await fetch('https://api.deepseek.com/models', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: this.createTimeoutSignal(5000),
      });

      if (!response.ok) {
        console.error(`DeepSeek API error: ${response.statusText}`);
        return [];
      }

      const data = (await response.json()) as any;
      const staticModelIds = this.staticModels.map((m) => m.name);

      // Filter out models we already have in staticModels
      const dynamicModels =
        data.data
          ?.filter((model: any) => !staticModelIds.includes(model.id))
          .map((m: any) => ({
            name: m.id,
            label: `${m.id} (Dynamic)`,
            provider: this.name,
            maxTokenAllowed: 64000, // Default, adjust per model if available
            maxCompletionTokens: 8192,
          })) || [];

      return dynamicModels;
    } catch (error) {
      console.error(`Failed to fetch DeepSeek models:`, error);
      return [];
    }
  }

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
      defaultApiTokenKey: 'DEEPSEEK_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const deepseek = createDeepSeek({
      apiKey,
    });

    return deepseek(model, {
      // simulateStreaming: true,
    });
  }
}
