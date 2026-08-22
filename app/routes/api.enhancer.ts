import { type ActionFunctionArgs } from '@remix-run/cloudflare';

/*
 * UI-ONLY PROTOTYPE — backend AI removed.
 *
 * The prompt enhancer used to call `streamText()` (an LLM call) to rewrite
 * the user's prompt. That backend has been removed. We now simply echo the
 * original message back as a text stream so the `usePromptEnhancer` hook
 * (which reads the response body as a stream) keeps working without errors.
 */

export async function action({ request }: ActionFunctionArgs) {
  const { message } = await request.json<{ message: string }>().catch(() => ({ message: '' }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(message || ''));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache',
    },
  });
}
