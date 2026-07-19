// API keys entered here are stored ONLY in this browser's localStorage, under
// keys namespaced below — never sent to, logged by, or even visible to our
// own server. Every BYOK request (anthropicBackend.ts/openaiBackend.ts) goes
// directly from the browser to the provider's own API; our server is never
// in that request path at all. Treat this like any other client-side secret
// storage: readable by other JS on the same origin (e.g. a browser extension,
// or an XSS bug elsewhere on the page) — normal locally-stored-token caveats
// apply, same as e.g. a self-hosted API playground would have.

export type ByokProviderId = "anthropic-byok" | "openai-byok";

const STORAGE_PREFIX = "text2scad:byok:";

export function getKey(provider: ByokProviderId): string | null {
  try {
    return localStorage.getItem(STORAGE_PREFIX + provider);
  } catch {
    return null;
  }
}

export function setKey(provider: ByokProviderId, key: string): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + provider, key);
  } catch {
    // localStorage unavailable (private browsing, quota) — key just won't persist.
  }
}

export function clearKey(provider: ByokProviderId): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + provider);
  } catch {
    // ignore
  }
}

export function hasKey(provider: ByokProviderId): boolean {
  return Boolean(getKey(provider));
}
