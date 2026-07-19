import { Router } from "express";
import { getProvider, resolveModel } from "../lib/providers/index.js";
import { extractCode, SYSTEM_PROMPT } from "../lib/systemPrompt.js";

export const chatRouter = Router();

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

const MAX_MESSAGES = 40;

chatRouter.post("/chat", async (req, res) => {
  const { messages, provider: providerOverride, model: modelOverride } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages must be a non-empty array." });
  }

  const cleaned = messages
    .slice(-MAX_MESSAGES)
    .filter((m) => m && typeof m.content === "string" && m.content.trim())
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

  if (cleaned.length === 0) {
    return res.status(400).json({ error: "messages must contain non-empty content." });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let provider, model;
  try {
    provider = getProvider(providerOverride);
    model = resolveModel(providerOverride, modelOverride);
  } catch (err) {
    sseSend(res, "error", { message: err.message });
    return res.end();
  }

  const abortController = new AbortController();

  // req's readable stream 'close' fires as soon as its body is fully read, not
  // when the client disconnects — so we watch res instead, and only treat it
  // as a real client disconnect if we hadn't finished writing the response yet.
  res.on("close", () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  try {
    const result = await provider.streamChat({
      system: SYSTEM_PROMPT,
      messages: cleaned,
      onDelta: (delta) => sseSend(res, "delta", { text: delta }),
      signal: abortController.signal,
      model,
    });
    if (!result.text.trim()) {
      // Adaptive thinking (Anthropic) can consume the whole budget before writing any reply.
      sseSend(res, "error", {
        message:
          result.stopReason === "max_tokens"
            ? "The model spent its whole response budget thinking and never wrote a reply. Try again."
            : "The model returned an empty response.",
      });
      return;
    }
    const code = extractCode(result.text);
    sseSend(res, "done", { reply: result.text, code });
  } catch (err) {
    if (!res.writableEnded) {
      sseSend(res, "error", { message: err.message || "The model stream failed." });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
});
