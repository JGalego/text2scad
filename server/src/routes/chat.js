import { Router } from "express";
import { CHAT_MODEL, getAnthropicClient } from "../lib/anthropic.js";
import { extractCode, SYSTEM_PROMPT } from "../lib/systemPrompt.js";

export const chatRouter = Router();

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

const MAX_MESSAGES = 40;

chatRouter.post("/chat", async (req, res) => {
  const { messages } = req.body || {};

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

  let full = "";
  let client;
  try {
    client = getAnthropicClient();
  } catch (err) {
    sseSend(res, "error", { message: err.message });
    return res.end();
  }

  const stream = client.messages.stream({
    model: CHAT_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: cleaned,
  });

  stream.on("text", (delta) => {
    full += delta;
    sseSend(res, "delta", { text: delta });
  });

  // req's readable stream 'close' fires as soon as its body is fully read, not
  // when the client disconnects — so we watch res instead, and only treat it
  // as a real client disconnect if we hadn't finished writing the response yet.
  res.on("close", () => {
    if (!res.writableEnded) {
      stream.controller?.abort?.();
    }
  });

  try {
    await stream.finalMessage();
    const code = extractCode(full);
    sseSend(res, "done", { reply: full, code });
  } catch (err) {
    if (!res.writableEnded) {
      sseSend(res, "error", { message: err.message || "The model stream failed." });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
});
