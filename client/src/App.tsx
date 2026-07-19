import { useEffect, useRef, useState } from "react";
import { critiqueScad, renderScad, streamChat } from "./api/client";
import type { ChatOptions } from "./api/types";
import { ChatInput } from "./components/ChatInput";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { MessageBubble } from "./components/MessageBubble";
import { ProviderModelPicker } from "./components/ProviderModelPicker";
import { makeStlDownloadUrl, scadBlobUrl, Viewer } from "./components/Viewer";
import * as store from "./conversations";
import { downloadConversation } from "./exportConversation";
import type { ChatMessage } from "./types";

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Describe an object in plain English and I'll generate an OpenSCAD model and preview it in 3D. Try something like “a low-poly vase” or “a phone stand at a 60 degree angle”, then ask me to tweak it.",
};

// How many automatic correction rounds to allow after detecting a mesh with
// disconnected parts, before giving up and just showing the result as-is.
const MAX_AUTO_FIXES = 2;

let idCounter = 0;
const nextId = () => `m${Date.now()}-${idCounter++}`;

const STAGE_LABEL: Record<string, string> = {
  thinking: "Thinking…",
  streaming: "Replying…",
  rendering: "Rendering with OpenSCAD…",
  checking: "Checking realism…",
  done: "Done",
  error: "Failed",
};

export default function App() {
  const [conversations, setConversations] = useState<store.Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [isChatting, setIsChatting] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [currentCode, setCurrentCode] = useState<string | null>(null);
  const [stlBuffer, setStlBuffer] = useState<ArrayBuffer | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [chatOptions, setChatOptions] = useState<ChatOptions>({});
  const [modelLoadStatus, setModelLoadStatus] = useState<{ progress?: number; file?: string } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const autoFixAttemptsRef = useRef(0);
  const lastUserPromptRef = useRef<string>("an object");

  useEffect(() => {
    messagesRef.current = messages;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Load conversation history from localStorage once on mount.
  useEffect(() => {
    let all = store.loadAll();
    const savedActiveId = store.getActiveId();
    let initial = all.find((c) => c.id === savedActiveId) ?? all[0];
    if (!initial) {
      initial = store.createConversation([WELCOME]);
      all = [initial];
      store.saveAll(all);
    }
    store.setActiveId(initial.id);
    setConversations(all);
    setActiveId(initial.id);
    setMessages(initial.messages.length ? initial.messages : [WELCOME]);
    setCurrentCode(initial.currentCode);
    if (initial.currentCode) {
      const codeMsg =
        [...initial.messages].reverse().find((m) => m.code) ?? initial.messages[initial.messages.length - 1];
      void renderForTurn(initial.currentCode, codeMsg.id, { allowAutoFix: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave the active conversation shortly after messages/code settle.
  useEffect(() => {
    if (!activeId) return;
    const timer = window.setTimeout(() => {
      setConversations((prev) => {
        const existing = prev.find((c) => c.id === activeId);
        const updated: store.Conversation = {
          ...(existing ?? store.createConversation(messages, currentCode)),
          id: activeId,
          messages,
          currentCode,
          title: existing?.titleIsCustom ? existing.title : store.titleFor(messages),
          updatedAt: Date.now(),
        };
        const next = existing ? prev.map((c) => (c.id === activeId ? updated : c)) : [updated, ...prev];
        store.saveAll(next);
        return next;
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [messages, currentCode, activeId]);

  function patchMessage(id: string, patch: Partial<ChatMessage>) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function activateConversation(target: store.Conversation) {
    store.setActiveId(target.id);
    setActiveId(target.id);
    setMessages(target.messages.length ? target.messages : [WELCOME]);
    setCurrentCode(target.currentCode);
    setStlBuffer(null);
    setRenderError(null);
    setShowCode(false);
    autoFixAttemptsRef.current = 0;
    lastUserPromptRef.current =
      [...target.messages].reverse().find((m) => m.role === "user" && !m.auto)?.content ?? "an object";
    if (target.currentCode) {
      const codeMsg = [...target.messages].reverse().find((m) => m.code) ?? target.messages[target.messages.length - 1];
      void renderForTurn(target.currentCode, codeMsg.id, { allowAutoFix: false });
    }
  }

  function handleNewConversation() {
    const created = store.createConversation([WELCOME]);
    const next = [created, ...conversations];
    store.saveAll(next);
    setConversations(next);
    activateConversation(created);
  }

  function handleSelectConversation(id: string) {
    if (id === activeId) return;
    const target = conversations.find((c) => c.id === id);
    if (target) activateConversation(target);
  }

  function handleDeleteConversation(id: string) {
    const next = conversations.filter((c) => c.id !== id);
    store.saveAll(next);
    setConversations(next);
    if (id !== activeId) return;
    if (next.length > 0) {
      activateConversation(next[0]);
    } else {
      const created = store.createConversation([WELCOME]);
      store.saveAll([created]);
      setConversations([created]);
      activateConversation(created);
    }
  }

  function handleRenameConversation(id: string, title: string) {
    const next = conversations.map((c) => (c.id === id ? { ...c, title, titleIsCustom: true } : c));
    store.saveAll(next);
    setConversations(next);
  }

  /** Renders `code` (draft quality — fast, forced-low $fn) for the given
   *  assistant turn, and follows up with an automatic correction round if
   *  the mesh looks like it has a genuinely disconnected part (not just a
   *  hollow cavity — see meshAnalysis.js, and not for a multi-part scene,
   *  where separate components are the correct, expected topology).
   *  `allowAutoFix: false` is used when re-rendering a restored conversation's
   *  code (on load/switch) so that alone never triggers a new chat turn. */
  async function renderForTurn(code: string, assistantId: string, opts: { allowAutoFix?: boolean } = {}) {
    const { allowAutoFix = true } = opts;
    setIsRendering(true);
    setRenderError(null);
    patchMessage(assistantId, { stage: "rendering" });

    const result = await renderScad(code, "draft");
    setIsRendering(false);

    if (!result.ok) {
      setRenderError(result.details ? `${result.error}\n${result.details}` : result.error);
      patchMessage(assistantId, { stage: "error", note: `⚠️ Render failed: ${result.error}` });
      return;
    }

    setStlBuffer(result.buffer);
    patchMessage(assistantId, { stage: "done" });

    const componentCount = result.componentCount ?? 1;
    const isScene = (result.scenePartCount ?? 0) > 0;
    if (allowAutoFix && !isScene && componentCount > 1 && autoFixAttemptsRef.current < MAX_AUTO_FIXES) {
      autoFixAttemptsRef.current += 1;
      patchMessage(assistantId, {
        note: `⚠️ Mechanical check found ${componentCount} disconnected mesh pieces — asking the model to fix the overlap (attempt ${autoFixAttemptsRef.current}/${MAX_AUTO_FIXES})…`,
      });
      const note: ChatMessage = {
        id: nextId(),
        role: "user",
        auto: true,
        content: `(auto-check: mechanical inspection found ${componentCount} disconnected mesh components in the design you just produced — some part isn't actually touching/fused to the rest. Increase the overlap so everything forms a single connected solid, and restate the full corrected code.)`,
      };
      await runTurn(note);
    }
  }

  /** Appends `newMessage` (a real user send or a synthetic auto-fix note) to
   *  the conversation and streams the reply. Always builds the API payload
   *  from the live message state (messagesRef), never a threaded snapshot —
   *  otherwise patches applied between turns (like the note above) get
   *  silently overwritten when this replaces the message list. */
  async function runTurn(newMessage: ChatMessage) {
    const assistantId = nextId();
    const apiHistory = [...messagesRef.current, newMessage];
    setMessages((prev) => [
      ...prev,
      newMessage,
      { id: assistantId, role: "assistant" as const, content: "", streaming: true, stage: "thinking" as const },
    ]);
    setIsChatting(true);

    try {
      await streamChat(
        apiHistory.map(({ role, content }) => ({ role, content })),
        {
          onDelta: (delta) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + delta, stage: "streaming" } : m
              )
            );
          },
          onDone: ({ reply, code }) => {
            patchMessage(assistantId, { content: reply, code, streaming: false, stage: code ? "rendering" : "done" });
            if (code) {
              setCurrentCode(code);
              void renderForTurn(code, assistantId);
            }
          },
          onError: (message) => {
            patchMessage(assistantId, { streaming: false, stage: "error", error: message });
          },
          onProgress: (info) => {
            setModelLoadStatus(info.status === "ready" ? null : { progress: info.progress, file: info.file });
          },
        },
        undefined,
        chatOptions
      );
    } finally {
      setIsChatting(false);
    }
  }

  function handleSend(text: string) {
    autoFixAttemptsRef.current = 0;
    lastUserPromptRef.current = text;
    void runTurn({ id: nextId(), role: "user", content: text });
  }

  async function handleCheckRealism() {
    if (!currentCode || isChecking) return;
    setIsChecking(true);
    const assistantId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", streaming: true, stage: "checking" },
    ]);

    const result = await critiqueScad(currentCode, lastUserPromptRef.current, chatOptions);
    setIsChecking(false);

    if (!result.ok) {
      patchMessage(assistantId, { streaming: false, stage: "error", error: result.error });
      return;
    }

    patchMessage(assistantId, { content: result.reply, code: result.code, streaming: false, stage: result.code ? "rendering" : "done" });
    if (result.code && result.code !== currentCode) {
      setCurrentCode(result.code);
      void renderForTurn(result.code, assistantId);
    }
  }

  /** The live viewer always shows a fast draft render. Downloads deserve the
   *  real thing, so this re-renders at full quality on demand rather than
   *  reusing the draft buffer — worth the wait since it's an explicit,
   *  occasional action rather than something blocking the chat loop. */
  async function handleDownloadStl() {
    if (!currentCode || isFinalizing) return;
    setIsFinalizing(true);
    setRenderError(null);
    const result = await renderScad(currentCode, "final");
    setIsFinalizing(false);

    if (!result.ok) {
      setRenderError(result.details ? `${result.error}\n${result.details}` : result.error);
      return;
    }
    const url = makeStlDownloadUrl(result.buffer);
    const link = document.createElement("a");
    link.href = url;
    link.download = "model.stl";
    link.click();
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>text2scad</h1>
        <p>Chat your way to a 3D-printable OpenSCAD model.</p>
      </header>

      <main className="app-main">
        <ConversationSidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={handleSelectConversation}
          onNew={handleNewConversation}
          onDelete={handleDeleteConversation}
          onRename={handleRenameConversation}
        />

        <section className="chat-panel">
          <div className="chat-toolbar">
            <ProviderModelPicker onChange={setChatOptions} />
            <button
              className="ghost"
              disabled={messages.length <= 1}
              onClick={() => downloadConversation(messages)}
            >
              Export conversation
            </button>
          </div>
          {modelLoadStatus && (
            <div className="model-load-banner">
              Downloading model{modelLoadStatus.file ? ` (${modelLoadStatus.file})` : ""}
              {typeof modelLoadStatus.progress === "number" ? ` — ${Math.round(modelLoadStatus.progress)}%` : "…"}
            </div>
          )}
          <div className="chat-messages" ref={scrollRef}>
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} stageLabel={m.stage ? STAGE_LABEL[m.stage] : undefined} />
            ))}
          </div>
          <ChatInput onSend={handleSend} disabled={isChatting || isChecking} />
        </section>

        <section className="viewer-panel">
          <div className="viewer-toolbar">
            <span className="status">
              {isRendering
                ? "Rendering with OpenSCAD…"
                : isFinalizing
                ? "Rendering final quality…"
                : isChecking
                ? "Checking realism…"
                : renderError
                ? "Render failed"
                : stlBuffer
                ? "Ready (draft preview)"
                : "No model yet"}
            </span>
            <div className="toolbar-actions">
              <button className="ghost" disabled={!currentCode || isChecking} onClick={handleCheckRealism}>
                {isChecking ? "Checking…" : "Check realism"}
              </button>
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
              <button
                className="ghost"
                disabled={!currentCode || isFinalizing}
                onClick={handleDownloadStl}
                title="Renders at full quality (slower) before downloading"
              >
                {isFinalizing ? "Rendering final…" : "Download .stl"}
              </button>
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
