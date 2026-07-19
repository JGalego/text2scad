import type { Backend, ChatOptions, ProviderInfo, ProvidersConfig, RenderQuality } from "./types";
import type { ChatMessage } from "../types";
import type { StreamHandlers } from "./types";
import { ANTHROPIC_BYOK_DEFAULT_MODEL, ANTHROPIC_BYOK_MODELS, OPENAI_BYOK_DEFAULT_MODEL, OPENAI_BYOK_MODELS } from "../byok/models";

export type {
  Backend,
  ChatOptions,
  CritiqueFailure,
  CritiqueResult,
  ProviderInfo,
  ProvidersConfig,
  RenderFailure,
  RenderQuality,
  RenderResult,
  StreamHandlers,
} from "./types";

// Standalone (GitHub Pages) builds run entirely in the browser — no Express
// server to talk to — so they load the transformers.js/openscad-wasm backend
// instead. Both branches are dynamic imports so a normal build never bundles
// the (large) standalone-only dependencies, and vice versa.
const STANDALONE = import.meta.env.VITE_STANDALONE === "true";

let backendPromise: Promise<Backend> | null = null;
function getBackend(): Promise<Backend> {
  if (!backendPromise) {
    backendPromise = STANDALONE
      ? import("../local/localBackend").then((m) => m.localBackend)
      : import("./remote").then((m) => m.remoteBackend);
  }
  return backendPromise;
}

// BYOK ("bring your own key") providers are always offered, in both builds —
// unlike the remote/local backend above, these never involve our server at
// all: the browser talks straight to Anthropic's/OpenAI's own API using a key
// the user enters and that lives only in this browser's localStorage (see
// ../byok/keyStore.ts). Dynamically imported so picking neither never pulls
// either SDK into the bundle.
type ByokBackend = Pick<Backend, "streamChat" | "critiqueScad">;
const BYOK_LOADERS: Record<string, () => Promise<ByokBackend>> = {
  "anthropic-byok": () => import("../byok/anthropicBackend"),
  "openai-byok": () => import("../byok/openaiBackend"),
};

const BYOK_PROVIDER_INFO: ProviderInfo[] = [
  {
    name: "anthropic-byok",
    available: true,
    supportsVision: false, // not wired up for BYOK yet — see anthropicBackend.ts's critiqueScad
    models: ANTHROPIC_BYOK_MODELS,
    defaultModel: ANTHROPIC_BYOK_DEFAULT_MODEL,
    requiresApiKey: true,
  },
  {
    name: "openai-byok",
    available: true,
    supportsVision: false,
    models: OPENAI_BYOK_MODELS,
    defaultModel: OPENAI_BYOK_DEFAULT_MODEL,
    requiresApiKey: true,
  },
];

export async function streamChat(
  messages: Pick<ChatMessage, "role" | "content">[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
  options?: ChatOptions
): Promise<void> {
  const byokLoad = options?.provider && BYOK_LOADERS[options.provider];
  if (byokLoad) {
    const byok = await byokLoad();
    return byok.streamChat(messages, handlers, signal, options);
  }
  const backend = await getBackend();
  return backend.streamChat(messages, handlers, signal, options);
}

export async function renderScad(code: string, quality: RenderQuality = "draft") {
  const backend = await getBackend();
  return backend.renderScad(code, quality);
}

export async function critiqueScad(code: string, prompt: string, options?: ChatOptions) {
  const byokLoad = options?.provider && BYOK_LOADERS[options.provider];
  if (byokLoad) {
    const byok = await byokLoad();
    return byok.critiqueScad(code, prompt, options);
  }
  const backend = await getBackend();
  return backend.critiqueScad(code, prompt, options);
}

export async function getProvidersConfig(): Promise<ProvidersConfig> {
  const backend = await getBackend();
  const base = await backend.getProvidersConfig();
  return {
    activeProvider: base.activeProvider,
    providers: [...base.providers, ...BYOK_PROVIDER_INFO],
  };
}
