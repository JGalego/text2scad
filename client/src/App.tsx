import { useEffect, useRef, useState } from "react";
import { renderScad, streamChat } from "./api/client";
import { ChatInput } from "./components/ChatInput";
import { MessageBubble } from "./components/MessageBubble";
import { makeStlDownloadUrl, scadBlobUrl, Viewer } from "./components/Viewer";
import type { ChatMessage } from "./types";

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Describe an object in plain English and I'll generate an OpenSCAD model and preview it in 3D. Try something like “a low-poly vase” or “a phone stand at a 60 degree angle”, then ask me to tweak it.",
};

let idCounter = 0;
const nextId = () => `m${Date.now()}-${idCounter++}`;

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [isChatting, setIsChatting] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [currentCode, setCurrentCode] = useState<string | null>(null);
  const [stlBuffer, setStlBuffer] = useState<ArrayBuffer | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function handleRender(code: string) {
    setIsRendering(true);
    setRenderError(null);
    const result = await renderScad(code);
    setIsRendering(false);
    if (result.ok) {
      setStlBuffer(result.buffer);
    } else {
      setRenderError(result.details ? `${result.error}\n${result.details}` : result.error);
    }
  }

  async function handleSend(text: string) {
    const userMsg: ChatMessage = { id: nextId(), role: "user", content: text };
    const assistantId = nextId();
    const history = [...messages, userMsg];

    setMessages([...history, { id: assistantId, role: "assistant", content: "", streaming: true }]);
    setIsChatting(true);

    try {
      await streamChat(
        history.map(({ role, content }) => ({ role, content })),
        {
          onDelta: (delta) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m))
            );
          },
          onDone: ({ reply, code }) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: reply, code, streaming: false } : m
              )
            );
            if (code) {
              setCurrentCode(code);
              handleRender(code);
            }
          },
          onError: (message) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, streaming: false, error: message } : m
              )
            );
          },
        }
      );
    } finally {
      setIsChatting(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>text2scad</h1>
        <p>Chat your way to a 3D-printable OpenSCAD model.</p>
      </header>

      <main className="app-main">
        <section className="chat-panel">
          <div className="chat-messages" ref={scrollRef}>
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </div>
          <ChatInput onSend={handleSend} disabled={isChatting} />
        </section>

        <section className="viewer-panel">
          <div className="viewer-toolbar">
            <span className="status">
              {isRendering
                ? "Rendering with OpenSCAD…"
                : renderError
                ? "Render failed"
                : stlBuffer
                ? "Ready"
                : "No model yet"}
            </span>
            <div className="toolbar-actions">
              <button
                className="ghost"
                disabled={!currentCode}
                onClick={() => setShowCode((v) => !v)}
              >
                {showCode ? "Hide code" : "View code"}
              </button>
              <a
                className={`ghost${currentCode ? "" : " disabled"}`}
                href={currentCode ? scadBlobUrl(currentCode) : undefined}
                download="model.scad"
              >
                Download .scad
              </a>
              <a
                className={`ghost${stlBuffer ? "" : " disabled"}`}
                href={stlBuffer ? makeStlDownloadUrl(stlBuffer) : undefined}
                download="model.stl"
              >
                Download .stl
              </a>
            </div>
          </div>

          <div className="viewer-canvas">
            <Viewer buffer={stlBuffer} />
            {renderError && (
              <div className="render-error-overlay">
                <pre>{renderError}</pre>
              </div>
            )}
          </div>

          {showCode && currentCode && (
            <pre className="source-view">
              <code>{currentCode}</code>
            </pre>
          )}
        </section>
      </main>
    </div>
  );
}
