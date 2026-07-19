import { Router } from "express";
import { getProvider, resolveModel, VisionNotSupportedError } from "../lib/providers/index.js";
import { RenderError, renderScadToPng } from "../lib/openscadRenderer.js";
import { extractCode, SYSTEM_PROMPT } from "../lib/systemPrompt.js";

export const critiqueRouter = Router();

const MAX_CODE_LENGTH = 50_000;

critiqueRouter.post("/critique", async (req, res) => {
  const { code, prompt, provider: providerOverride, model: modelOverride } = req.body || {};

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

  let provider, model;
  try {
    provider = getProvider(providerOverride);
    model = resolveModel(providerOverride, modelOverride);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  if (!provider.supportsVision) {
    return res.status(501).json({
      error: `Visual critique isn't supported by the "${provider.name}" provider (no vision-capable model configured).`,
    });
  }

  const askedFor = typeof prompt === "string" && prompt.trim() ? prompt.trim() : "the object described earlier";

  try {
    const result = await provider.generateWithImage({
      system: SYSTEM_PROMPT,
      imageBase64: png.toString("base64"),
      mediaType: "image/png",
      text:
        `(visual critique request) Here is a rendered snapshot of the current design, built for: "${askedFor}". ` +
        `The OpenSCAD source that produced it:\n\n\`\`\`scad\n${code}\n\`\`\`\n\n` +
        `Look at the image and judge whether it actually looks right.`,
      model,
    });

    if (!result.text.trim()) {
      // Adaptive thinking (Anthropic) can consume the whole budget before writing any reply.
      return res.status(502).json({
        error:
          result.stopReason === "max_tokens"
            ? "The model spent its whole response budget thinking and never wrote a reply. Try again."
            : "The model returned an empty response.",
      });
    }

    const revisedCode = extractCode(result.text);
    res.json({ reply: result.text, code: revisedCode });
  } catch (err) {
    if (err instanceof VisionNotSupportedError) {
      return res.status(501).json({ error: err.message });
    }
    console.error("Critique request failed:", err);
    res.status(500).json({ error: err.message || "The critique request failed." });
  }
});
