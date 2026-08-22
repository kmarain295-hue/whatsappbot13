import { type LoaderFunctionArgs, json } from '@remix-run/cloudflare';
import { LLMManager } from '~/lib/modules/llm/manager';

interface ConfiguredProvider {
  name: string;
  isConfigured: boolean;
  configMethod: 'environment' | 'none';
}

/**
 * GET /api/configured-providers
 *
 * Reports which providers have their API key available on the server (via env
 * vars). In this sandbox no provider keys are configured, so every provider is
 * returned with `isConfigured: false` — which is exactly what the settings
 * store expects so it can fall back to cookie-based keys.
 *
 * Previously missing → Remix returned the HTML 404 document and the frontend's
 * `response.json()` failed with "Unexpected token '<'".
 */
export async function loader(_args: LoaderFunctionArgs) {
  try {
    const manager = LLMManager.getInstance(import.meta.env);
    const providers = manager.getAllProviders();

    const result: ConfiguredProvider[] = providers.map((provider) => {
      const envKeyName = provider.config?.apiTokenKey;
      const isConfigured = !!(envKeyName && typeof process !== 'undefined' && process.env?.[envKeyName]);

      return {
        name: provider.name,
        isConfigured,
        configMethod: isConfigured ? 'environment' : 'none',
      };
    });

    return json({ providers: result });
  } catch (error) {
    console.error('GET /api/configured-providers failed:', error);

    return json({ providers: [] });
  }
}
