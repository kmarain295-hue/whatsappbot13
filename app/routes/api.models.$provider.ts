import { type LoaderFunctionArgs, json } from '@remix-run/cloudflare';
import { LLMManager } from '~/lib/modules/llm/manager';

/**
 * GET /api/models/:provider
 *
 * Returns the static model list for a single provider (e.g. `/api/models/SDK`).
 *
 * Previously missing → Remix returned the HTML 404 document and the frontend's
 * `response.json()` failed with "Unexpected token '<'".
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const providerName = params.provider;

  if (!providerName) {
    return json({ modelList: [] });
  }

  try {
    const manager = LLMManager.getInstance(import.meta.env);
    const provider = manager.getAllProviders().find((p) => p.name === providerName);

    return json({ modelList: provider?.staticModels ?? [] });
  } catch (error) {
    console.error(`GET /api/models/${providerName} failed:`, error);

    return json({ modelList: [] });
  }
}
