import { type ActionFunctionArgs } from '@remix-run/cloudflare';

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  UI-ONLY PROTOTYPE — backend AI removed
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  This route used to be the heart of the AI backend: it parsed the chat
 *  request, ran task-type detection, built a data stream, called
 *  `streamText()` (which talked to Anthropic / OpenAI / Google / …), and
 *  streamed the model's tokens back to the client.
 *
 *  All of that has been removed. The app is now a UI-only prototype:
 *  the main webapp UI, the chat-history panel and the coding workbench
 *  are preserved, but no LLM is ever called.
 *
 *  The frontend's `useChat()` hook (from @ai-sdk/react) still POSTs to
 *  `/api/chat`, so this action must return a valid Data-Stream-Protocol
 *  response. We emit a single short text delta and close the stream —
 *  enough for `useChat` to mark the turn as finished and render the
 *  assistant message. The workbench is opened proactively on the client
 *  (see Chat.client.tsx) the moment the user sends any message, so the
 *  coding environment appears immediately regardless of this response.
 * ──────────────────────────────────────────────────────────────────────────
 */

export async function action(_args: ActionFunctionArgs) {
  const encoder = new TextEncoder();

  const prototypeMessage =
    'This is a UI-only prototype. The main webapp UI, the chat-history panel and the ' +
    'Export-to-GitHub feature are fully interactive; the AI backend and coding workbench ' +
    'have been removed.';

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Data-Stream-Protocol text part: `0:"<json string>"\n`
      controller.enqueue(encoder.encode(`0:${JSON.stringify(prototypeMessage)}\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Text-Encoding': 'chunked',
    },
  });
}
