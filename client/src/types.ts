export type Role = "user" | "assistant";

export type Stage =
  | "thinking"
  | "streaming"
  | "rendering"
  | "checking"
  | "done"
  | "error";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  code?: string | null;
  streaming?: boolean;
  error?: string;
  stage?: Stage;
  /** True for synthetic system-style turns (auto-fix nudges), not real user input. */
  auto?: boolean;
  /** Short inline status line shown under the bubble (render failure, auto-fix notice, etc). */
  note?: string;
}
