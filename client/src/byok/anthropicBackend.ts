import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "../types";
import type { ChatOptions, CritiqueFailure, StreamHandlers } from "../api/types";
import { extractCode } from "../local/scadTools";
import { FULL_SYSTEM_PROMPT } from "../prompts";
import { ANTHROPIC_BYOK_DEFAULT_MODEL } from "./models";
import { getKey } from "./keyStore";

function getClient(): Anthropic {
  const apiKey = getKey("anthropic-byok");
  if (!apiKey) {
    throw new Error('No Anthropic API key set — enter one next to "Anthropic (your key)" in the picker above.');
  }
  // dangerouslyAllowBrowser: this is the whole point of BYOK — the key is the
  // visiting user's own, entered by them into this browser's localStorage,
  // and every request goes straight from here to Anthropic's API. It never
  // touches our server, so there's no "less dangerous" server-side option.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

export async function streamChat(
  messages: Pick<ChatMessage, "role" | "content">[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
  options?: ChatOptions
): Promise<void> {
  let client: Anthropic;
  try {
    client = getClient();
  } catch (err) {
    handlers.onError(err instanceof Error ? err.message : "No Anthropic API key set.");
    return;
  }

  try {
    // No explicit `thinking`/`output_config` here (unlike the server's
    // anthropic.js provider): the installed SDK's TS types (0.32.1) don't
    // declare those newer fields, and per that provider's own comment,
    // omitting them changes nothing behaviorally — adaptive thinking already
    // runs by default on this model either way.
    const stream = client.messages.stream(
      {
        model: options?.model || ANTHROPIC_BYOK_DEFAULT_MODEL,
        max_tokens: 8192,
        system: FULL_SYSTEM_PROMPT,
        messages,
      },
      { signal }
    );

    let text = "";
    stream.on("text", (delta) => {
      text += delta;
      handlers.onDelta(delta);
    });

    const finalMessage = await stream.finalMessage();
    if (!text.trim()) {
      handlers.onError(
        finalMessage.stop_reason === "max_tokens"
          ? "The model spent its whole response budget thinking and never wrote a reply. Try again."
          : "The model returned an empty response."
      );
      return;
    }
    handlers.onDone({ reply: text, code: extractCode(text) });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    handlers.onError(err instanceof Error ? err.message : "The Anthropic request failed.");
  }
}

export async function critiqueScad(): Promise<CritiqueFailure> {
  return {
    ok: false,
    error:
      "Visual critique isn't wired up for BYOK yet — it needs a rendered PNG snapshot, and only the Express server can currently produce one.",
  };
}
