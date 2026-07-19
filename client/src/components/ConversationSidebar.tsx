import { useState } from "react";
import type { Conversation } from "../conversations";

interface Props {
  conversations: Conversation[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

export function ConversationSidebar({ conversations, activeId, onSelect, onNew, onDelete, onRename }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  function startRename(c: Conversation) {
    setEditingId(c.id);
    setDraftTitle(c.title);
  }

  function commitRename(id: string) {
    const trimmed = draftTitle.trim();
    if (trimmed) onRename(id, trimmed);
    setEditingId(null);
  }

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <nav className="conversation-sidebar">
      <button className="new-conversation" onClick={onNew}>
        + New chat
      </button>
      <ul className="conversation-list">
        {sorted.map((c) => (
          <li
            key={c.id}
            className={`conversation-item${c.id === activeId ? " active" : ""}`}
            onClick={() => editingId !== c.id && onSelect(c.id)}
          >
            {editingId === c.id ? (
              <input
                className="conversation-title-input"
                autoFocus
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={() => commitRename(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(c.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="conversation-title" title="Double-click to rename" onDoubleClick={() => startRename(c)}>
                {c.title}
              </span>
            )}
            <button
              className="conversation-delete"
              title="Delete conversation"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
