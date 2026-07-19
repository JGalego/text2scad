import { anthropicProvider, ALLOWED_MODELS as ANTHROPIC_MODELS, DEFAULT_MODEL as ANTHROPIC_DEFAULT } from "./anthropic.js";
import { openaiProvider, ALLOWED_MODELS as OPENAI_MODELS, DEFAULT_MODEL as OPENAI_DEFAULT } from "./openai.js";
import { localProvider, ALLOWED_MODELS as LOCAL_MODELS, DEFAULT_MODEL as LOCAL_DEFAULT } from "./local.js";

const PROVIDERS = {
  anthropic: {
    impl: anthropicProvider,
    models: ANTHROPIC_MODELS,
    defaultModel: ANTHROPIC_DEFAULT,
    available: () => Boolean(process.env.ANTHROPIC_API_KEY),
  },
  openai: {
    impl: openaiProvider,
    models: OPENAI_MODELS,
    defaultModel: OPENAI_DEFAULT,
    available: () => Boolean(process.env.OPENAI_API_KEY),
  },
  local: {
    impl: localProvider,
    models: LOCAL_MODELS,
    defaultModel: LOCAL_DEFAULT,
    // No API key needed — the model just downloads (and is cached) on first use.
    available: () => true,
  },
};

function resolveProviderName(name) {
  return (name || process.env.LLM_PROVIDER || "anthropic").toLowerCase();
}

function requireEntry(key) {
  const entry = PROVIDERS[key];
  if (!entry) {
    throw new Error(`Unknown provider "${key}". Expected one of: ${Object.keys(PROVIDERS).join(", ")}.`);
  }
  return entry;
}

export function listProviders() {
  return Object.entries(PROVIDERS).map(([name, entry]) => ({
    name,
    available: entry.available(),
    supportsVision: entry.impl.supportsVision,
    models: entry.models,
    defaultModel: entry.defaultModel,
  }));
}

export function getProvider(name) {
  const key = resolveProviderName(name);
  const entry = requireEntry(key);
  return entry.impl;
}

/** Validates a requested model against the given provider's allow-list,
 *  falling back to that provider's default when none was requested — this is
 *  the guard against a client asking the server to load an arbitrary/unbounded
 *  model (a real resource concern for the `local` provider in particular). */
export function resolveModel(name, requestedModel) {
  const key = resolveProviderName(name);
  const entry = requireEntry(key);
  if (!requestedModel) return entry.defaultModel;
  if (!entry.models.includes(requestedModel)) {
    throw new Error(`Model "${requestedModel}" isn't in the allow-list for provider "${key}".`);
  }
  return requestedModel;
}

export { VisionNotSupportedError } from "./errors.js";
