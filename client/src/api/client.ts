import type { ChatMessage } from "../types";

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onDone: (payload: { reply: string; code: string | null }) => void;
  onError: (message: string) => void;
}

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
 * Streams a chat reply. Never throws — any failure (network error, dropped
 * connection, non-2xx response) is reported via handlers.onError instead, so
 * callers can rely on exactly one of onDone/onError firing.
 */
export async function streamChat(
  messages: Pick<ChatMessage, "role" | "content">[],
  handlers: StreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
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

export interface RenderResult {
  ok: true;
  buffer: ArrayBuffer;
}

export interface RenderFailure {
  ok: false;
  error: string;
  details?: string;
}

// Comfortably above the server's own RENDER_TIMEOUT_MS (default 20s) so the
// server always gets a chance to reply first; this is a last-resort backstop
// in case the request never comes back at all (dropped connection, backend
// down, a render that somehow ignores the server-side kill signal).
const CLIENT_RENDER_TIMEOUT_MS = 45_000;

export async function renderScad(code: string): Promise<RenderResult | RenderFailure> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_RENDER_TIMEOUT_MS);

  try {
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
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
    return { ok: true, buffer };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, error: `Render timed out after ${CLIENT_RENDER_TIMEOUT_MS}ms with no response from the server.` };
    }
    return { ok: false, error: err instanceof Error ? err.message : "The render request failed." };
  } finally {
    clearTimeout(timer);
  }
}
