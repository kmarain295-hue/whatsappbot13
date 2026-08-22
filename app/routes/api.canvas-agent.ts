import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import ZAI from 'z-ai-web-dev-sdk';

/*
 * /api/canvas-agent — generates the AI Agent node's output for the canvas
 * automation run.
 *
 * When the user double-clicks an "On Message" trigger node, types a message in
 * the chat, and presses Enter, the canvas automation walks the trigger→agent→
 * utility graph. For the AGENT node, runCanvasAutomation (client-side) POSTs
 * the user's message + the agent's label + any MEMORY context to this route,
 * which calls the z-ai-web-dev-sdk LLM to generate a real AI response. That
 * response is then shown in the chat as the agent's output.
 *
 * Request:  POST /api/canvas-agent  { "message": string, "agentLabel": string, "memory"?: MemoryEntry[] }
 * Response: { "output": string }
 *
 * MEMORY: when memory nodes are connected to the agent, their stored
 * conversation history (previous user/assistant exchanges) is passed as
 * `memory`. The LLM receives it as prior conversation turns so it has context
 * from previous runs (e.g. remembers the user's name). This makes the memory
 * node "completely workable" — the agent properly uses it.
 *
 * SPEED: the system prompt is SHORT + max_tokens is capped at 200 so the LLM
 * responds fast (1-3 sentences). The SDK MUST be used in backend code only.
 */

interface MemoryEntry {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { message, agentLabel, memory } = (await request.json().catch(() => ({}))) as {
      message?: string;
      agentLabel?: string;
      memory?: MemoryEntry[];
    };

    const userMessage = (message ?? '').trim();

    if (!userMessage) {
      return Response.json({ output: 'No message provided to the agent.' }, { status: 200 });
    }

    const label = agentLabel ?? 'AI Agent';
    const zai = await ZAI.create();

    // Build the messages array. Start with a SHORT system prompt (keeps the LLM
    // fast — long prompts slow down generation). Then append the memory history
    // (previous exchanges from connected memory nodes) as real conversation
    // turns so the LLM has context. Finally the current user message.
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: `You are ${label}. Respond directly and concisely (1-3 sentences). Be conversational.`,
      },
    ];

    // Append memory history (if any) as prior conversation turns.
    if (memory && memory.length > 0) {
      for (const entry of memory) {
        messages.push({ role: entry.role, content: entry.content });
      }
    }

    // The current user message.
    messages.push({ role: 'user', content: userMessage });

    const completion = await zai.chat.completions.create({
      messages,
      thinking: { type: 'disabled' },
      // Cap the output length so the response is fast — short responses
      // generate in ~1-2 seconds vs 5+ seconds for uncapped.
      max_tokens: 200,
    } as any);

    const output = completion.choices[0]?.message?.content?.trim() || 'I processed the message but had no specific output.';

    return Response.json({ output }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    return Response.json({ output: `Agent error: ${message}`, error: true }, { status: 500 });
  }
}
