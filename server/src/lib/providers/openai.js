import OpenAI from "openai";

let client = null;

function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Copy server/.env.example to server/.env and add your key."
    );
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

const CURATED_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"];
export const DEFAULT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
export const ALLOWED_MODELS = Array.from(new Set([DEFAULT_MODEL, ...CURATED_MODELS]));

export const openaiProvider = {
  name: "openai",
  supportsVision: true,

  async streamChat({ system, messages, onDelta, signal, model }) {
    const openai = getClient();

    const stream = await openai.chat.completions.create(
      {
        model: model || DEFAULT_MODEL,
        messages: [{ role: "system", content: system }, ...messages],
        stream: true,
      },
      { signal }
    );

    let text = "";
    let stopReason = null;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        onDelta(delta);
      }
      if (chunk.choices[0]?.finish_reason) {
        stopReason = chunk.choices[0].finish_reason;
      }
    }

    return { text, stopReason };
  },

  async generateWithImage({ system, imageBase64, mediaType, text, model }) {
    const openai = getClient();

    const completion = await openai.chat.completions.create({
      model: model || DEFAULT_MODEL,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
            { type: "text", text },
          ],
        },
      ],
    });

    const choice = completion.choices[0];
    return { text: choice?.message?.content || "", stopReason: choice?.finish_reason };
  },
};
