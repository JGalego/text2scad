import type { TextGenerationPipeline } from "@huggingface/transformers";
import { pipeline, TextStreamer } from "@huggingface/transformers";
import type { ChatMessage } from "../types";
import type { ChatOptions, CritiqueFailure, ProvidersConfig, StreamHandlers } from "../api/types";
import { LOCAL_SYSTEM_PROMPT } from "../prompts";
import { extractCode } from "./scadTools";

export const LOCAL_MODELS = [
  "onnx-community/Qwen2.5-Coder-0.5B-Instruct",
  "onnx-community/Qwen2.5-Coder-1.5B-Instruct",
  "HuggingFaceTB/SmolLM2-360M-Instruct",
];
export const DEFAULT_MODEL = LOCAL_MODELS[0];

const MAX_NEW_TOKENS = 2048;

function supportsWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

const generatorCache = new Map<string, Promise<TextGenerationPipeline>>();

function loadGenerator(
  model: string,
  onProgress?: StreamHandlers["onProgress"]
): Promise<TextGenerationPipeline> {
  let cached = generatorCache.get(model);
  if (!cached) {
    const device = supportsWebGPU() ? "webgpu" : "wasm";
    cached = pipeline("text-generation", model, {
      device,
      dtype: device === "webgpu" ? "q4f16" : "q4",
      progress_callback: (info: { status?: string; file?: string; progress?: number }) => {
        if (info?.status === "progress") {
          onProgress?.({ status: "downloading", progress: info.progress, file: info.file });
        }
      },
    }) as Promise<TextGenerationPipeline>;
    generatorCache.set(model, cached);
  }
  cached.then(() => onProgress?.({ status: "ready" }));
  return cached;
}

/**
 * Client-side, in-browser equivalent of server/src/lib/providers/local.js's
 * streamChat, using transformers.js instead of the Node-only @huggingface
 * pipeline (same underlying library, browser build). System prompt in
 * ../prompts.ts, code extraction in ./scadTools.ts.
 */
export async function streamChat(
  messages: Pick<ChatMessage, "role" | "content">[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
  options?: ChatOptions
): Promise<void> {
  try {
    const model = options?.model || DEFAULT_MODEL;
    const generator = await loadGenerator(model, handlers.onProgress);

    const chatMessages = [{ role: "system", content: LOCAL_SYSTEM_PROMPT }, ...messages];

    let text = "";
    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (chunk: string) => {
        // Best-effort cancellation, same caveat as the server's local provider:
        // generation itself can't be interrupted mid-flight here.
        if (signal?.aborted) return;
        text += chunk;
        handlers.onDelta(chunk);
      },
    });

    await generator(chatMessages as never, {
      max_new_tokens: MAX_NEW_TOKENS,
      // Pure greedy decoding (do_sample: false) is the main reason small
      // models fall into repeating the same line/paragraph forever — see
      // server/src/lib/providers/local.js's identical settings for the
      // directly-observed failure this fixes.
      do_sample: true,
      temperature: 0.6,
      top_p: 0.9,
      repetition_penalty: 1.3,
      no_repeat_ngram_size: 4,
      streamer,
    });

    if (!text.trim()) {
      handlers.onError("The model returned an empty response.");
      return;
    }
    handlers.onDone({ reply: text, code: extractCode(text) });
  } catch (err) {
    handlers.onError(err instanceof Error ? err.message : "The in-browser model failed to generate a reply.");
  }
}

export async function critiqueScad(): Promise<CritiqueFailure> {
  return {
    ok: false,
    error:
      "Visual critique isn't available in the standalone browser build (no vision-capable in-browser model). Run the full app with LLM_PROVIDER=anthropic or openai for this feature.",
  };
}

export async function getProvidersConfig(): Promise<ProvidersConfig> {
  return {
    activeProvider: "local",
    providers: [
      {
        name: "local",
        available: true,
        supportsVision: false,
        models: LOCAL_MODELS,
        defaultModel: DEFAULT_MODEL,
      },
    ],
  };
}
