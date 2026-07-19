import type {
  Backend,
  ChatOptions,
  CritiqueFailure,
  CritiqueResult,
  ProvidersConfig,
  RenderFailure,
  RenderQuality,
  RenderResult,
  StreamHandlers,
} from "./types";
import type { ChatMessage } from "../types";

/** Parses a single SSE frame ("event: x\ndata: {...}") into {event, data}. */
function parseFrame(frame: string): { event: string; data: unknown } | null {
  let event = "message";
  let dataLine = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
  }
  if (!dataLine) return null;
  try {
    return { event, data: JSON.parse(dataLine) };
  } catch {
    return null;
  }
}

/**
 * Streams a chat reply from the Express backend. Never throws — any failure
 * (network error, dropped connection, non-2xx response) is reported via
 * handlers.onError instead, so callers can rely on exactly one of
 * onDone/onError firing.
 */
async function streamChat(
  messages: Pick<ChatMessage, "role" | "content">[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
  options?: ChatOptions
): Promise<void> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, ...options }),
      signal,
    });

    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}));
      handlers.onError(body.error || `Request failed with status ${res.status}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const parsed = parseFrame(frame);
        if (!parsed) continue;

        if (parsed.event === "delta") {
          handlers.onDelta((parsed.data as { text: string }).text);
        } else if (parsed.event === "done") {
          handlers.onDone(parsed.data as { reply: string; code: string | null });
        } else if (parsed.event === "error") {
          handlers.onError((parsed.data as { message: string }).message);
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    handlers.onError(err instanceof Error ? err.message : "The chat request failed.");
  }
}

// Comfortably above the server's own timeout for each quality tier (see
// server/.env.example) so the server always gets a chance to reply first;
// this is a last-resort backstop in case the request never comes back at all
// (dropped connection, backend down, a render that ignores the kill signal).
const CLIENT_RENDER_TIMEOUT_MS: Record<RenderQuality, number> = {
  draft: 30_000,
  final: 120_000,
};

async function renderScad(code: string, quality: RenderQuality = "draft"): Promise<RenderResult | RenderFailure> {
  const controller = new AbortController();
  const timeoutMs = CLIENT_RENDER_TIMEOUT_MS[quality];
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, quality }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        ok: false,
        error: body.error || `Render failed with status ${res.status}`,
        details: body.details,
      };
    }

    const buffer = await res.arrayBuffer();
    const countHeader = res.headers.get("X-Component-Count");
    const sceneHeader = res.headers.get("X-Scene-Parts");
    return {
      ok: true,
      buffer,
      componentCount: countHeader ? Number(countHeader) : undefined,
      scenePartCount: sceneHeader ? Number(sceneHeader) : undefined,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, error: `Render timed out after ${timeoutMs}ms with no response from the server.` };
    }
    return { ok: false, error: err instanceof Error ? err.message : "The render request failed." };
  } finally {
    clearTimeout(timer);
  }
}

/** One-shot vision critique of a rendered design. Never throws. */
async function critiqueScad(
  code: string,
  prompt: string,
  options?: ChatOptions
): Promise<CritiqueResult | CritiqueFailure> {
  try {
    const res = await fetch("/api/critique", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, prompt, ...options }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: body.error || `Critique request failed with status ${res.status}` };
    }
    return { ok: true, reply: body.reply, code: body.code };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The critique request failed." };
  }
}

async function getProvidersConfig(): Promise<ProvidersConfig> {
  const res = await fetch("/api/providers");
  if (!res.ok) throw new Error(`Failed to load provider config (status ${res.status}).`);
  return res.json();
}

export const remoteBackend: Backend = { streamChat, renderScad, critiqueScad, getProvidersConfig };
