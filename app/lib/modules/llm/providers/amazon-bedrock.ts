import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { LanguageModelV1 } from 'ai';
import type { IProviderSetting } from '~/types/model';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

interface AWSBedRockConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export default class AmazonBedrockProvider extends BaseProvider {
  name = 'AmazonBedrock';
  getApiKeyLink = 'https://console.aws.amazon.com/iam/home';

  config = {
    apiTokenKey: 'AWS_BEDROCK_CONFIG',
  };

  staticModels: ModelInfo[] = [
    // ===== Claude Opus 4.1 (Latest - August 2025) =====
    {
      name: 'anthropic.claude-opus-4-1-20250805-v1:0',
      label: 'Claude Opus 4.1 (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 200000,
    },

    // ===== Claude Sonnet 4.5 (September 2025) =====
    {
      name: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
      label: 'Claude Sonnet 4.5 (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 200000,
    },

    // ===== Claude Haiku 4.5 (October 2025) =====
    {
      name: 'anthropic.claude-haiku-4-5-20251001-v1:0',
      label: 'Claude Haiku 4.5 (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 200000,
    },

    // ===== Claude 3.7 Sonnet (February 2025) =====
    {
      name: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
      label: 'Claude 3.7 Sonnet (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 200000,
    },

    // ===== Claude 3.5 Series (2024) =====
    {
      name: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      label: 'Claude 3.5 Sonnet v2 (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 200000,
    },
    {
      name: 'anthropic.claude-3-5-haiku-20241022-v1:0',
      label: 'Claude 3.5 Haiku (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 200000,
    },
    {
      name: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      label: 'Claude 3.5 Sonnet (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 200000,
    },

    // ===== Claude 3 Series (2024) =====
    {
      name: 'anthropic.claude-3-opus-20240229-v1:0',
      label: 'Claude 3 Opus (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 200000,
    },
    {
      name: 'anthropic.claude-3-sonnet-20240229-v1:0',
      label: 'Claude 3 Sonnet (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 200000,
    },
    {
      name: 'anthropic.claude-3-haiku-20240307-v1:0',
      label: 'Claude 3 Haiku (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 200000,
    },

    // ===== Amazon Nova Series (2024) =====
    {
      name: 'amazon.nova-premier-v1:0',
      label: 'Amazon Nova Premier (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 1000000,
    },
    {
      name: 'amazon.nova-pro-v1:0',
      label: 'Amazon Nova Pro (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 300000,
    },
    {
      name: 'amazon.nova-lite-v1:0',
      label: 'Amazon Nova Lite (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 300000,
    },
    {
      name: 'amazon.nova-micro-v1:0',
      label: 'Amazon Nova Micro (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 128000,
    },

    // ===== Meta Llama Series (2024) =====
    {
      name: 'meta.llama3-3-70b-instruct-v1:0',
      label: 'Llama 3.3 70B Instruct (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 128000,
    },
    {
      name: 'meta.llama3-1-405b-instruct-v1:0',
      label: 'Llama 3.1 405B Instruct (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 128000,
    },
    {
      name: 'meta.llama3-1-70b-instruct-v1:0',
      label: 'Llama 3.1 70B Instruct (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 128000,
    },
    {
      name: 'meta.llama3-1-8b-instruct-v1:0',
      label: 'Llama 3.1 8B Instruct (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 128000,
    },

    // ===== Mistral Series (2024) =====
    {
      name: 'mistral.mistral-large-2402-v1:0',
      label: 'Mistral Large 24.02 (Bedrock)',
      provider: 'AmazonBedrock',
      maxTokenAllowed: 128000,
    },
  ];

  private _parseAndValidateConfig(apiKey: string): AWSBedRockConfig {
    let parsedConfig: AWSBedRockConfig;

    try {
      parsedConfig = JSON.parse(apiKey);
    } catch {
      throw new Error(
        'Invalid AWS Bedrock configuration format. Please provide a valid JSON string containing region, accessKeyId, and secretAccessKey.',
      );
    }

    const { region, accessKeyId, secretAccessKey, sessionToken } = parsedConfig;

    if (!region || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'Missing required AWS credentials. Configuration must include region, accessKeyId, and secretAccessKey.',
      );
    }

    return {
      region,
      accessKeyId,
      secretAccessKey,
      ...(sessionToken && { sessionToken }),
    };
  }

  getModelInstance(options: {
    model: string;
    serverEnv: any;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'AWS_BEDROCK_CONFIG',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const config = this._parseAndValidateConfig(apiKey);
    const bedrock = createAmazonBedrock(config);

    return bedrock(model);
  }
}
