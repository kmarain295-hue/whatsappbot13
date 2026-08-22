import { type LoaderFunctionArgs, json } from '@remix-run/cloudflare';
import { LLMManager } from '~/lib/modules/llm/manager';

/**
 * GET /api/check-env-key?provider=NAME
 *
 * Returns whether the given provider's API key is set in the server environment.
 * In this sandbox no provider keys are configured, so this always reports
 * `isSet: false` and the UI prompts the user to enter a key (stored in a cookie).
 *
 * Previously missing → Remix returned the HTML 404 document and the frontend's
 * `response.json()` failed with "Unexpected token '<'".
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const providerName = url.searchParams.get('provider');

  if (!providerName) {
    return json({ isSet: false });
  }

  try {
    const manager = LLMManager.getInstance(import.meta.env);
    const provider = manager.getAllProviders().find((p) => p.name === providerName);

    const envKeyName = provider?.config?.apiTokenKey;
    const isSet = !!(envKeyName && typeof process !== 'undefined' && process.env?.[envKeyName]);

    return json({ isSet });
  } catch (error) {
    console.error(`GET /api/check-env-key?provider=${providerName} failed:`, error);

    return json({ isSet: false });
  }
}
