import Anthropic from "@anthropic-ai/sdk";

let client = null;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy server/.env.example to server/.env and add your key."
    );
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

const CURATED_MODELS = ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001"];
export const DEFAULT_MODEL = process.env.CHAT_MODEL || "claude-sonnet-5";
export const ALLOWED_MODELS = Array.from(new Set([DEFAULT_MODEL, ...CURATED_MODELS]));

export const anthropicProvider = {
  name: "anthropic",
  supportsVision: true,

  async streamChat({ system, messages, onDelta, signal, model }) {
    const anthropic = getClient();

    const stream = anthropic.messages.stream({
      model: model || DEFAULT_MODEL,
      // Generous headroom: adaptive thinking runs by default on this model
      // (see below) and shares this budget with the actual text response.
      max_tokens: 8192,
      // Explicit even though "adaptive" is the default — omitting `thinking`
      // still runs adaptive, but leaving it implicit reads as "no thinking".
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system,
      messages,
    });

    stream.on("text", (delta) => onDelta(delta));

    if (signal) {
      const abort = () => stream.controller?.abort?.();
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }

    const finalMessage = await stream.finalMessage();
    const text = finalMessage.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return { text, stopReason: finalMessage.stop_reason };
  },

  async generateWithImage({ system, imageBase64, mediaType, text, model }) {
    const anthropic = getClient();

    const message = await anthropic.messages.create({
      model: model || DEFAULT_MODEL,
      max_tokens: 8192,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
            { type: "text", text },
          ],
        },
      ],
    });

    const replyText = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return { text: replyText, stopReason: message.stop_reason };
  },
};
