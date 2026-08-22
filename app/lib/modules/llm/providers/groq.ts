import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

export default class GroqProvider extends BaseProvider {
  name = 'Groq';
  getApiKeyLink = 'https://console.groq.com/keys';

  config = {
    apiTokenKey: 'GROQ_API_KEY',
  };

  staticModels: ModelInfo[] = [
    // ===== Kimi K2 (Latest - 2025) =====
    {
      name: 'moonshotai/kimi-k2-instruct',
      label: 'Kimi K2 Instruct (Groq)',
      provider: 'Groq',
      maxTokenAllowed: 256000,
      maxCompletionTokens: 8192,
    },

    // ===== GPT-OSS Series (2025) =====
    {
      name: 'gpt-oss-120b',
      label: 'GPT-OSS 120B (Reasoning)',
      provider: 'Groq',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 32768,
    },
    {
      name: 'gpt-oss-20b',
      label: 'GPT-OSS 20B (Reasoning)',
      provider: 'Groq',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 32768,
    },

    // ===== Qwen 2.5 Series (2025) =====
    {
      name: 'qwen-2.5-72b',
      label: 'Qwen 2.5 72B',
      provider: 'Groq',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'qwen-2.5-32b',
      label: 'Qwen 2.5 32B',
      provider: 'Groq',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },

    // ===== DeepSeek R1 Distill Series (2025) =====
    {
      name: 'deepseek-r1-distill-llama-70b',
      label: 'DeepSeek R1 Distill Llama 70B',
      provider: 'Groq',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 32768,
    },
    {
      name: 'deepseek-r1-distill-qwen-32b',
      label: 'DeepSeek R1 Distill Qwen 32B',
      provider: 'Groq',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 32768,
    },

    // ===== Llama 3.3 Series (2024) =====
    {
      name: 'llama-3.3-70b-versatile',
      label: 'Llama 3.3 70B',
      provider: 'Groq',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },

    // ===== Llama 3.2 Series (2024) =====
    {
      name: 'llama-3.2-90b-vision-preview',
      label: 'Llama 3.2 90B Vision (Preview)',
      provider: 'Groq',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'llama-3.2-11b-vision-preview',
      label: 'Llama 3.2 11B Vision (Preview)',
      provider: 'Groq',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'llama-3.2-3b-preview',
      label: 'Llama 3.2 3B (Preview)',
      provider: 'Groq',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'llama-3.2-1b-preview',
      label: 'Llama 3.2 1B (Preview)',
      provider: 'Groq',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },

    // ===== Llama 3.1 Series (2024) =====
    {
      name: 'llama-3.1-8b-instant',
      label: 'Llama 3.1 8B Instant',
      provider: 'Groq',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'llama3-70b-8192',
      label: 'Llama 3 70B',
      provider: 'Groq',
      maxTokenAllowed: 8192,
      maxCompletionTokens: 8192,
    },
    {
      name: 'llama3-8b-8192',
      label: 'Llama 3 8B',
      provider: 'Groq',
      maxTokenAllowed: 8192,
      maxCompletionTokens: 8192,
    },

    // ===== Gemma 2 Series (2024) =====
    {
      name: 'gemma2-9b-it',
      label: 'Gemma 2 9B IT',
      provider: 'Groq',
      maxTokenAllowed: 8192,
      maxCompletionTokens: 8192,
    },

    // ===== Mixtral Series (2024) =====
    {
      name: 'mixtral-8x7b-32768',
      label: 'Mixtral 8x7B',
      provider: 'Groq',
      maxTokenAllowed: 32768,
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
      defaultApiTokenKey: 'GROQ_API_KEY',
    });

    if (!apiKey) {
      throw `Missing Api Key configuration for ${this.name} provider`;
    }

    const response = await fetch(`https://api.groq.com/openai/v1/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const res = (await response.json()) as any;

    const data = res.data.filter(
      (model: any) => model.object === 'model' && model.active && model.context_window > 8000,
    );

    return data.map((m: any) => ({
      name: m.id,
      label: `${m.id} - context ${m.context_window ? Math.floor(m.context_window / 1000) + 'k' : 'N/A'} [ by ${m.owned_by}]`,
      provider: this.name,
      maxTokenAllowed: Math.min(m.context_window || 8192, 16384),
      maxCompletionTokens: 8192,
    }));
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
      defaultApiTokenKey: 'GROQ_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const openai = createOpenAI({
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey,
    });

    return openai(model);
  }
}
