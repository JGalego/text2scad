export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  code?: string | null;
  streaming?: boolean;
  error?: string;
}
