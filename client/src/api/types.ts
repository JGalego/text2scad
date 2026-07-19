import type { ChatMessage } from "../types";

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onDone: (payload: { reply: string; code: string | null }) => void;
  onError: (message: string) => void;
  /** Only ever called by the standalone/local backend, while a model is being
   *  downloaded into the browser cache — the remote backend never calls this. */
  onProgress?: (info: { status: "downloading" | "ready"; progress?: number; file?: string }) => void;
}

/** Which provider/model to use for a chat or critique request. Omit either
 *  field to fall back to the backend's own default. */
export interface ChatOptions {
  provider?: string;
  model?: string;
}

export type RenderQuality = "draft" | "final";

export interface RenderResult {
  ok: true;
  buffer: ArrayBuffer;
  /**
   * Number of disconnected pieces in the rendered mesh (see server's
   * meshAnalysis.js). 1 is normal; >1 means some part likely isn't actually
   * fused to the rest (a floating handle, foot, etc.) even though the code
   * rendered without error. Objects with a fully enclosed cavity legitimately
   * report 2+ too, so treat this as a hint worth a second look, not proof —
   * and not meaningful at all when scenePartCount > 0 (see below).
   */
  componentCount?: number;
  /** >0 if the code used the SCENE PARTS convention — multiple disconnected
   *  components are then expected/correct, not a defect to auto-fix. */
  scenePartCount?: number;
}

export interface RenderFailure {
  ok: false;
  error: string;
  details?: string;
}

export interface CritiqueResult {
  ok: true;
  reply: string;
  code: string | null;
}

export interface CritiqueFailure {
  ok: false;
  error: string;
}

/** One provider/model choice as reported by the backend (remote: from
 *  GET /api/providers; local/standalone: a static list of in-browser models)
 *  or a BYOK entry (client/src/byok/ — always listed, in both builds). */
export interface ProviderInfo {
  name: string;
  available: boolean;
  supportsVision: boolean;
  models: string[];
  defaultModel: string;
  /** True for "bring your own key" providers (client/src/byok/): the picker
   *  shows a key-entry field for these instead of treating `available` as
   *  final — the key lives only in this browser's localStorage and every
   *  request goes straight from here to the provider's own API, never
   *  through our server. */
  requiresApiKey?: boolean;
}

export interface ProvidersConfig {
  providers: ProviderInfo[];
  activeProvider: string;
}

/** The contract both the remote (Express-backed) and local (in-browser)
 *  backends implement — App.tsx and the provider picker talk to this, not to
 *  either implementation directly. */
export interface Backend {
  streamChat(
    messages: Pick<ChatMessage, "role" | "content">[],
    handlers: StreamHandlers,
    signal?: AbortSignal,
    options?: ChatOptions
  ): Promise<void>;
  renderScad(code: string, quality?: RenderQuality): Promise<RenderResult | RenderFailure>;
  critiqueScad(code: string, prompt: string, options?: ChatOptions): Promise<CritiqueResult | CritiqueFailure>;
  getProvidersConfig(): Promise<ProvidersConfig>;
}
