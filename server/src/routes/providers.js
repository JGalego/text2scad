import { Router } from "express";
import { listProviders } from "../lib/providers/index.js";

export const providersRouter = Router();

providersRouter.get("/providers", (_req, res) => {
  res.json({
    providers: listProviders(),
    activeProvider: (process.env.LLM_PROVIDER || "anthropic").toLowerCase(),
  });
});
