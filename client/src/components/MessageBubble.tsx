import type { ReactNode } from "react";
import type { ChatMessage } from "../types";

function renderContent(content: string) {
  const parts = content.split(/```(?:scad|openscad)?\n[\s\S]*?```/gi);
  const codeMatches = [...content.matchAll(/```(?:scad|openscad)?\n([\s\S]*?)```/gi)];

  const nodes: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part) nodes.push(<p key={`t${i}`}>{part.trim()}</p>);
    if (codeMatches[i]) {
      nodes.push(
        <pre key={`c${i}`} className="code-block">
          <code>{codeMatches[i][1].trim()}</code>
        </pre>
      );
    }
  });
  return nodes;
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div className={`bubble bubble-${message.role}`}>
      <div className="bubble-role">{message.role === "user" ? "You" : "text2scad"}</div>
      <div className="bubble-content">
        {message.error ? (
          <p className="bubble-error">{message.error}</p>
        ) : (
          renderContent(message.content)
        )}
        {message.streaming && <span className="cursor" />}
      </div>
    </div>
  );
}
