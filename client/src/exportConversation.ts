import type { ChatMessage } from "./types";

function roleHeading(message: ChatMessage): string {
  if (message.auto) return "text2scad · auto-check";
  return message.role === "user" ? "You" : "text2scad";
}

/** Renders the conversation as Markdown — code blocks are already embedded
 *  in each message's content, so this is mostly just headings + spacing. */
export function conversationToMarkdown(messages: ChatMessage[]): string {
  const lines = [`# text2scad conversation`, `Exported ${new Date().toISOString()}`, ""];

  for (const m of messages) {
    if (!m.content.trim() && !m.error) continue;
    lines.push(`## ${roleHeading(m)}`, "");
    lines.push(m.error ? `⚠️ ${m.error}` : m.content.trim());
    lines.push("");
  }

  return lines.join("\n");
}

export function downloadConversation(messages: ChatMessage[]): void {
  const markdown = conversationToMarkdown(messages);
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "text2scad-conversation.md";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
