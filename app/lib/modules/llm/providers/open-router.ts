import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

interface OpenRouterModel {
  name: string;
  id: string;
  context_length: number;
  pricing: {
    prompt: number;
    completion: number;
  };
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

export default class OpenRouterProvider extends BaseProvider {
  name = 'OpenRouter';
  getApiKeyLink = 'https://openrouter.ai/settings/keys';

  config = {
    apiTokenKey: 'OPEN_ROUTER_API_KEY',
  };

  staticModels: ModelInfo[] = [
    /*
     * Static fallback models for OpenRouter — ordered latest (top) → oldest (bottom).
     * OpenRouter also fetches its full dynamic catalog when an API key is present.
     */

    /*
     * FREE MODELS — sourced from https://openrouter.ai/collections/free-models
     * (queried via the OpenRouter /api/v1/models endpoint, filtering for
     * pricing.prompt === '0' && pricing.completion === '0').
     * These are always available in the "Free models only" list, even without
     * an API key. Labels include "(free)" so the isModelLikelyFree() filter
     * in ModelSelector.tsx detects them.
     */
    {
      name: 'openai/gpt-oss-20b:free',
      label: 'gpt-oss-20b (free)',
      provider: 'OpenRouter',
      maxTokenAllowed: 131072,
    },
    {
      name: 'google/gemma-4-31b-it:free',
      label: 'Gemma 4 31B (free)',
      provider: 'OpenRouter',
      maxTokenAllowed: 262144,
    },
    {
      name: 'google/gemma-4-26b-a4b-it:free',
      label: 'Gemma 4 26B A4B (free)',
      provider: 'OpenRouter',
      maxTokenAllowed: 262144,
    },
    {
      name: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      label: 'Nemotron 3 Ultra 550B (free)',
      provider: 'OpenRouter',
      maxTokenAllowed: 1000000,
    },
    {
      name: 'nvidia/nemotron-3-super-120b-a12b:free',
      label: 'Nemotron 3 Super 120B (free)',
      provider: 'OpenRouter',
      maxTokenAllowed: 1000000,
    },
    {
      name: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      label: 'Nemotron 3 Nano Omni 30B (free)',
      provider: 'OpenRouter',
      maxTokenAllowed: 256000,
    },
    {
      name: 'nvidia/nemotron-3-nano-30b-a3b:free',
      label: 'Nemotron 3 Nano 30B (free)',
      provider: 'OpenRouter',
      maxTokenAllowed: 256000,
    },
    {
      name: 'nvidia/nemotron-nano-12b-v2-vl:free',
      label: 'Nemotron Nano 12B V2 VL (free)',
      provider: 'OpenRouter',
      maxTokenAllowed: 128000,
    },
    {
      name: 'nvidia/nemotron-nano-9b-v2:free',
      label: 'Nemotron Nano 9B V2 (free)',
      provider: 'OpenRouter',
      maxTokenAllowed: 32000,
    },
    {
      name: 'cohere/north-mini-code:free',
      label: 'North Mini Code (free)',
      provider: 'OpenRouter',
      maxTokenAllowed: 256000,
    },
    {
      name: 'inclusionai/ling-3.0-tiny:free',
      label: 'Ling 3.0 Tiny (free)',
      provider: 'OpenRouter',
      maxTokenAllowed: 262144,
    },
    {
      name: 'poolside/laguna-s-2.1:free',
      label: 'Laguna S 2.1 (free)',
      provider: 'OpenRouter',
      maxTokenAllowed: 1048576,
    },
    {
      name: 'poolside/laguna-xs-2.1:free',
      label: 'Laguna XS 2.1 (free)',
      provider: 'OpenRouter',
      maxTokenAllowed: 262144,
    },

    // Latest flagship models
    {
      name: 'anthropic/claude-opus-4.1',
      label: 'Claude Opus 4.1',
      provider: 'OpenRouter',
      maxTokenAllowed: 200000,
    },
    {
      name: 'anthropic/claude-sonnet-4.5',
      label: 'Claude Sonnet 4.5',
      provider: 'OpenRouter',
      maxTokenAllowed: 200000,
    },
    {
      name: 'openai/gpt-5',
      label: 'GPT-5',
      provider: 'OpenRouter',
      maxTokenAllowed: 400000,
    },
    {
      name: 'google/gemini-2.5-pro',
      label: 'Gemini 2.5 Pro',
      provider: 'OpenRouter',
      maxTokenAllowed: 2000000,
    },
    {
      name: 'x-ai/grok-4',
      label: 'Grok 4',
      provider: 'OpenRouter',
      maxTokenAllowed: 256000,
    },
    {
      name: 'deepseek/deepseek-v3.2',
      label: 'DeepSeek V3.2',
      provider: 'OpenRouter',
      maxTokenAllowed: 128000,
    },
    {
      name: 'z-ai/glm-4.6',
      label: 'GLM-4.6',
      provider: 'OpenRouter',
      maxTokenAllowed: 200000,
    },

    // Claude 4 / 3.5 family
    {
      name: 'anthropic/claude-opus-4',
      label: 'Claude Opus 4',
      provider: 'OpenRouter',
      maxTokenAllowed: 200000,
    },
    {
      name: 'anthropic/claude-sonnet-4',
      label: 'Claude Sonnet 4',
      provider: 'OpenRouter',
      maxTokenAllowed: 200000,
    },
    {
      name: 'anthropic/claude-3.5-sonnet',
      label: 'Claude 3.5 Sonnet',
      provider: 'OpenRouter',
      maxTokenAllowed: 200000,
    },

    // OpenAI GPT-4.1 / 4o family
    {
      name: 'openai/gpt-4.1',
      label: 'GPT-4.1',
      provider: 'OpenRouter',
      maxTokenAllowed: 1047576,
    },
    {
      name: 'openai/gpt-4o',
      label: 'GPT-4o',
      provider: 'OpenRouter',
      maxTokenAllowed: 128000,
    },

    // Google Gemini 2.0 / 1.5
    {
      name: 'google/gemini-2.0-flash-001',
      label: 'Gemini 2.0 Flash',
      provider: 'OpenRouter',
      maxTokenAllowed: 1000000,
    },
    {
      name: 'google/gemini-1.5-pro',
      label: 'Gemini 1.5 Pro',
      provider: 'OpenRouter',
      maxTokenAllowed: 2000000,
    },

    // Meta Llama (oldest)
    {
      name: 'meta-llama/llama-3.3-70b-instruct',
      label: 'Llama 3.3 70B',
      provider: 'OpenRouter',
      maxTokenAllowed: 131072,
    },
    {
      name: 'meta-llama/llama-3.1-405b-instruct',
      label: 'Llama 3.1 405B',
      provider: 'OpenRouter',
      maxTokenAllowed: 131072,
    },
  ];

  async getDynamicModels(
    _apiKeys?: Record<string, string>,
    _settings?: IProviderSetting,
    _serverEnv: Record<string, string> = {},
  ): Promise<ModelInfo[]> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = (await response.json()) as OpenRouterModelsResponse;

      return data.data
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((m) => {
          // Get accurate context window from OpenRouter API
          const contextWindow = m.context_length || 32000; // Use API value or fallback

          // Cap at reasonable limits to prevent issues (OpenRouter has some very large models)
          const maxAllowed = 1000000; // 1M tokens max for safety
          const finalContext = Math.min(contextWindow, maxAllowed);

          return {
            name: m.id,
            label: `${m.name} - in:$${(m.pricing.prompt * 1_000_000).toFixed(2)} out:$${(m.pricing.completion * 1_000_000).toFixed(2)} - context ${finalContext >= 1000000 ? Math.floor(finalContext / 1000000) + 'M' : Math.floor(finalContext / 1000) + 'k'}`,
            provider: this.name,
            maxTokenAllowed: finalContext,
          };
        });
    } catch (error) {
      console.error('Error getting OpenRouter models:', error);
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
      defaultApiTokenKey: 'OPEN_ROUTER_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const openRouter = createOpenRouter({
      apiKey,
    });
    const instance = openRouter.chat(model) as LanguageModelV1;

    return instance;
  }
}
