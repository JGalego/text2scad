import type { ChatMessage } from "./types";

export interface Conversation {
  id: string;
  title: string;
  /** True once the user has manually renamed this conversation — after that,
   *  the title stops auto-updating from the first user message. */
  titleIsCustom?: boolean;
  messages: ChatMessage[];
  currentCode: string | null;
  createdAt: number;
  updatedAt: number;
}

const LIST_KEY = "text2scad:conversations";
const ACTIVE_KEY = "text2scad:activeConversationId";

let idCounter = 0;
function nextId(): string {
  return `c${Date.now()}-${idCounter++}`;
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** All storage access is wrapped defensively — private browsing / a full quota
 *  can make localStorage throw, and losing history shouldn't crash the app. */
export function loadAll(): Conversation[] {
  try {
    const list = safeParse<Conversation[]>(localStorage.getItem(LIST_KEY), []);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveAll(list: Conversation[]): void {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
  } catch {
    // localStorage unavailable/full — conversation history just won't persist this session.
  }
}

export function getActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // ignore
  }
}

export function titleFor(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && !m.auto && m.content.trim());
  if (!firstUser) return "New conversation";
  const text = firstUser.content.trim().replace(/\s+/g, " ");
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}

export function createConversation(messages: ChatMessage[], currentCode: string | null = null): Conversation {
  const now = Date.now();
  return {
    id: nextId(),
    title: titleFor(messages),
    messages,
    currentCode,
    createdAt: now,
    updatedAt: now,
  };
}
