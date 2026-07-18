import { Router } from "express";
import { RenderError, renderScadToStl } from "../lib/openscadRenderer.js";

export const renderRouter = Router();

const MAX_CODE_LENGTH = 50_000;

renderRouter.post("/render", async (req, res) => {
  const { code, quality } = req.body || {};

  if (typeof code !== "string" || !code.trim()) {
    return res.status(400).json({ error: "code must be a non-empty string." });
  }
  if (code.length > MAX_CODE_LENGTH) {
    return res.status(400).json({ error: `code exceeds ${MAX_CODE_LENGTH} character limit.` });
  }
  if (quality !== undefined && quality !== "draft" && quality !== "final") {
    return res.status(400).json({ error: "quality must be 'draft' or 'final'." });
  }

  try {
    const { stl, componentCount, partCount } = await renderScadToStl(code, { quality });
    res.set("Content-Type", "model/stl");
    res.set("X-Component-Count", String(componentCount));
    res.set("X-Scene-Parts", String(partCount));
    res.set("Access-Control-Expose-Headers", "X-Component-Count, X-Scene-Parts");
    res.send(stl);
  } catch (err) {
    if (err instanceof RenderError) {
      return res.status(422).json({ error: err.message, details: err.details });
    }
    console.error("Unexpected render error:", err);
    res.status(500).json({ error: "Unexpected server error while rendering." });
  }
});
