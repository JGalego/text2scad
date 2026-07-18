import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { chatRouter } from "./routes/chat.js";
import { critiqueRouter } from "./routes/critique.js";
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

app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`text2scad server listening on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "WARNING: ANTHROPIC_API_KEY is not set. Copy server/.env.example to server/.env and add your key."
    );
  }
});
