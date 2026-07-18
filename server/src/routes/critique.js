import { Router } from "express";
import { CHAT_MODEL, getAnthropicClient } from "../lib/anthropic.js";
import { RenderError, renderScadToPng } from "../lib/openscadRenderer.js";
import { extractCode, SYSTEM_PROMPT } from "../lib/systemPrompt.js";

export const critiqueRouter = Router();

const MAX_CODE_LENGTH = 50_000;

critiqueRouter.post("/critique", async (req, res) => {
  const { code, prompt } = req.body || {};

  if (typeof code !== "string" || !code.trim()) {
    return res.status(400).json({ error: "code must be a non-empty string." });
  }
  if (code.length > MAX_CODE_LENGTH) {
    return res.status(400).json({ error: `code exceeds ${MAX_CODE_LENGTH} character limit.` });
  }

  let png;
  try {
    png = await renderScadToPng(code);
  } catch (err) {
    if (err instanceof RenderError) {
      return res.status(422).json({ error: err.message, details: err.details });
    }
    console.error("Unexpected snapshot error:", err);
    return res.status(500).json({ error: "Unexpected server error while rendering a snapshot." });
  }

  let client;
  try {
    client = getAnthropicClient();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const askedFor = typeof prompt === "string" && prompt.trim() ? prompt.trim() : "the object described earlier";

  try {
    const message = await client.messages.create({
      model: CHAT_MODEL,
      // Generous headroom: adaptive thinking runs by default on this model
      // (see below) and shares this budget with the actual text response.
      max_tokens: 8192,
      // Explicit even though "adaptive" is the default — omitting `thinking`
      // still runs adaptive, but leaving it implicit reads as "no thinking".
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: png.toString("base64") },
            },
            {
              type: "text",
              text:
                `(visual critique request) Here is a rendered snapshot of the current design, built for: "${askedFor}". ` +
                `The OpenSCAD source that produced it:\n\n\`\`\`scad\n${code}\n\`\`\`\n\n` +
                `Look at the image and judge whether it actually looks right.`,
            },
          ],
        },
      ],
    });

    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    if (!text.trim()) {
      // Adaptive thinking consumed the whole budget before writing any reply.
      return res.status(502).json({
        error:
          message.stop_reason === "max_tokens"
            ? "The model spent its whole response budget thinking and never wrote a reply. Try again."
            : "The model returned an empty response.",
      });
    }

    const revisedCode = extractCode(text);
    res.json({ reply: text, code: revisedCode });
  } catch (err) {
    console.error("Critique request failed:", err);
    res.status(500).json({ error: err.message || "The critique request failed." });
  }
});
