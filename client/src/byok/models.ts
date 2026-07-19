// Plain metadata only — no SDK imports here, so listing BYOK providers in the
// picker (client/src/api/client.ts's getProvidersConfig) never pulls in
// @anthropic-ai/sdk or openai just to show the option exists. The actual SDK
// clients live in anthropicBackend.ts/openaiBackend.ts, dynamically imported
// only once a BYOK provider is actually used.

export const ANTHROPIC_BYOK_MODELS = ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001"];
export const ANTHROPIC_BYOK_DEFAULT_MODEL = ANTHROPIC_BYOK_MODELS[0];

export const OPENAI_BYOK_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"];
export const OPENAI_BYOK_DEFAULT_MODEL = OPENAI_BYOK_MODELS[0];
