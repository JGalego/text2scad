import type { Backend, ChatOptions, RenderQuality } from "./types";
import type { ChatMessage } from "../types";
import type { StreamHandlers } from "./types";

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

export async function streamChat(
  messages: Pick<ChatMessage, "role" | "content">[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
  options?: ChatOptions
): Promise<void> {
  const backend = await getBackend();
  return backend.streamChat(messages, handlers, signal, options);
}

export async function renderScad(code: string, quality: RenderQuality = "draft") {
  const backend = await getBackend();
  return backend.renderScad(code, quality);
}

export async function critiqueScad(code: string, prompt: string, options?: ChatOptions) {
  const backend = await getBackend();
  return backend.critiqueScad(code, prompt, options);
}

export async function getProvidersConfig() {
  const backend = await getBackend();
  return backend.getProvidersConfig();
}
