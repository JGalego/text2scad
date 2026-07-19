import OpenAI from "openai";
import type { ChatMessage } from "../types";
import type { ChatOptions, CritiqueFailure, StreamHandlers } from "../api/types";
import { extractCode } from "../local/scadTools";
import { FULL_SYSTEM_PROMPT } from "../prompts";
import { OPENAI_BYOK_DEFAULT_MODEL } from "./models";
import { getKey } from "./keyStore";

function getClient(): OpenAI {
  const apiKey = getKey("openai-byok");
  if (!apiKey) {
    throw new Error('No OpenAI API key set — enter one next to "OpenAI (your key)" in the picker above.');
  }
  // dangerouslyAllowBrowser: see anthropicBackend.ts — this is the whole
  // point of BYOK, the key never leaves this browser except straight to
  // OpenAI's own API.
  return new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
}

export async function streamChat(
  messages: Pick<ChatMessage, "role" | "content">[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
  options?: ChatOptions
): Promise<void> {
  let client: OpenAI;
  try {
    client = getClient();
  } catch (err) {
    handlers.onError(err instanceof Error ? err.message : "No OpenAI API key set.");
    return;
  }

  try {
    const stream = await client.chat.completions.create(
      {
        model: options?.model || OPENAI_BYOK_DEFAULT_MODEL,
        messages: [{ role: "system", content: FULL_SYSTEM_PROMPT }, ...messages],
        stream: true,
      },
      { signal }
    );

    let text = "";
    let stopReason: string | null = null;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        handlers.onDelta(delta);
      }
      if (chunk.choices[0]?.finish_reason) {
        stopReason = chunk.choices[0].finish_reason;
      }
    }

    if (!text.trim()) {
      handlers.onError(
        stopReason === "length" ? "The model hit its token limit before writing a reply. Try again." : "The model returned an empty response."
      );
      return;
    }
    handlers.onDone({ reply: text, code: extractCode(text) });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    handlers.onError(err instanceof Error ? err.message : "The OpenAI request failed.");
  }
}

export async function critiqueScad(): Promise<CritiqueFailure> {
  return {
    ok: false,
    error:
      "Visual critique isn't wired up for BYOK yet — it needs a rendered PNG snapshot, and only the Express server can currently produce one.",
  };
}
