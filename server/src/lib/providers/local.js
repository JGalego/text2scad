import { VisionNotSupportedError } from "./errors.js";

const CURATED_MODELS = [
  "onnx-community/Qwen2.5-Coder-0.5B-Instruct",
  "onnx-community/Qwen2.5-Coder-1.5B-Instruct",
  "HuggingFaceTB/SmolLM2-360M-Instruct",
];
export const DEFAULT_MODEL = process.env.LOCAL_MODEL || CURATED_MODELS[0];
export const ALLOWED_MODELS = Array.from(new Set([DEFAULT_MODEL, ...CURATED_MODELS]));

// q4 (not q4f16) since this runs on CPU via onnxruntime-node, not a browser GPU.
const LOCAL_MODEL_DTYPE = process.env.LOCAL_MODEL_DTYPE || "q4";
const LOCAL_MAX_NEW_TOKENS = Number(process.env.LOCAL_MAX_NEW_TOKENS || 2048);

// Keyed by model id: switching models in the UI loads (and then caches) a
// separate pipeline per model, rather than replacing a single shared one.
const generatorCache = new Map();

// Lazy import: @huggingface/transformers pulls in onnxruntime-node, which is
// unnecessary weight for anyone who only ever uses the anthropic/openai providers.
async function getGenerator(model) {
  if (!generatorCache.has(model)) {
    generatorCache.set(
      model,
      (async () => {
        const { pipeline } = await import("@huggingface/transformers");
        return pipeline("text-generation", model, { dtype: LOCAL_MODEL_DTYPE });
      })()
    );
  }
  return generatorCache.get(model);
}

export const localProvider = {
  name: "local",
  supportsVision: false,

  async streamChat({ system, messages, onDelta, signal, model }) {
    const { TextStreamer } = await import("@huggingface/transformers");
    const resolvedModel = model || DEFAULT_MODEL;
    const generator = await getGenerator(resolvedModel);

    const chatMessages = [{ role: "system", content: system }, ...messages];

    let text = "";
    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (chunk) => {
        // Best-effort cancellation: token generation itself can't be interrupted
        // mid-flight here, but we stop forwarding output once aborted.
        if (signal?.aborted) return;
        text += chunk;
        onDelta(chunk);
      },
    });

    await generator(chatMessages, {
      max_new_tokens: LOCAL_MAX_NEW_TOKENS,
      do_sample: false,
      streamer,
    });

    return { text, stopReason: "end_turn" };
  },

  async generateWithImage({ model }) {
    throw new VisionNotSupportedError(
      `The local provider (${model || DEFAULT_MODEL}) does not support vision, so visual critique is unavailable. Switch provider to anthropic or openai to use it.`
    );
  },
};
