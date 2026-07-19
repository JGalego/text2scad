import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { chatRouter } from "./routes/chat.js";
import { critiqueRouter } from "./routes/critique.js";
import { providersRouter } from "./routes/providers.js";
import { renderRouter } from "./routes/render.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", chatRouter);
app.use("/api", renderRouter);
app.use("/api", critiqueRouter);
app.use("/api", providersRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error." });
});

const LLM_PROVIDER = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
const PROVIDER_KEY_ENV = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };

app.listen(PORT, () => {
  console.log(`text2scad server listening on http://localhost:${PORT}`);
  console.log(`LLM provider: ${LLM_PROVIDER}`);
  const requiredKey = PROVIDER_KEY_ENV[LLM_PROVIDER];
  if (requiredKey && !process.env[requiredKey]) {
    console.warn(
      `WARNING: ${requiredKey} is not set. Copy server/.env.example to server/.env and add your key.`
    );
  }
});
