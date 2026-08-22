import { type LoaderFunctionArgs, json } from '@remix-run/cloudflare';
import { LLMManager } from '~/lib/modules/llm/manager';

/**
 * GET /api/models
 *
 * Returns the full static model list across every registered provider.
 *
 * This route previously did not exist, so Remix returned the HTML index
 * document (404) and the frontend's `response.json()` failed with
 * "Unexpected token '<'". The loader below returns real JSON.
 */
export async function loader(_args: LoaderFunctionArgs) {
  try {
    const manager = LLMManager.getInstance(import.meta.env);
    const providers = manager.getAllProviders();

    const modelList = providers.flatMap((provider) => provider.staticModels ?? []);

    return json({ modelList });
  } catch (error) {
    console.error('GET /api/models failed:', error);

    return json({ modelList: [] });
  }
}
