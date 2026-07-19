import { useEffect, useState } from "react";
import { getProvidersConfig } from "../api/client";
import type { ChatOptions, ProviderInfo, ProvidersConfig } from "../api/types";
import { clearKey, getKey, setKey, type ByokProviderId } from "../byok/keyStore";

const PREF_KEY = "text2scad:chatOptions";

interface Props {
  onChange: (options: ChatOptions) => void;
}

function loadSavedPrefs(): ChatOptions {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePrefs(prefs: ChatOptions): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage unavailable — the choice just won't persist across reloads.
  }
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  local: "Local (in-browser SLM)",
  "anthropic-byok": "Anthropic (your key)",
  "openai-byok": "OpenAI (your key)",
};

function providerLabel(p: ProviderInfo): string {
  const label = PROVIDER_LABELS[p.name] ?? p.name;
  return p.available ? label : `${label} (unavailable)`;
}

/** Lets the user pick which LLM provider + model handles chat/critique
 *  requests. In the standalone (GitHub Pages) build there's no server-mediated
 *  provider, only the in-browser SLM plus the BYOK options below — same
 *  component, driven by whatever getProvidersConfig() returns for the active
 *  backend, merged with the always-offered BYOK entries (see api/client.ts). */
export function ProviderModelPicker({ onChange }: Props) {
  const [config, setConfig] = useState<ProvidersConfig | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [keySaved, setKeySaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getProvidersConfig()
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);

        const saved = loadSavedPrefs();
        const providerEntry =
          cfg.providers.find((p) => p.name === saved.provider && p.available) ??
          cfg.providers.find((p) => p.name === cfg.activeProvider && p.available) ??
          cfg.providers.find((p) => p.available) ??
          cfg.providers[0];

        const resolvedProvider = providerEntry?.name ?? "";
        const resolvedModel =
          saved.provider === resolvedProvider && saved.model && providerEntry?.models.includes(saved.model)
            ? saved.model
            : providerEntry?.defaultModel ?? "";

        setProvider(resolvedProvider);
        setModel(resolvedModel);
        if (providerEntry?.requiresApiKey) {
          setApiKeyInput(getKey(resolvedProvider as ByokProviderId) ?? "");
        }
        onChange({ provider: resolvedProvider, model: resolvedModel });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load provider config."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleProviderChange(name: string) {
    const entry = config?.providers.find((p) => p.name === name);
    const nextModel = entry?.defaultModel ?? "";
    setProvider(name);
    setModel(nextModel);
    setKeySaved(false);
    setApiKeyInput(entry?.requiresApiKey ? getKey(name as ByokProviderId) ?? "" : "");
    savePrefs({ provider: name, model: nextModel });
    onChange({ provider: name, model: nextModel });
  }

  function handleModelChange(nextModel: string) {
    setModel(nextModel);
    savePrefs({ provider, model: nextModel });
    onChange({ provider, model: nextModel });
  }

  function handleSaveKey() {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    setKey(provider as ByokProviderId, trimmed);
    setKeySaved(true);
    window.setTimeout(() => setKeySaved(false), 2000);
  }

  function handleClearKey() {
    clearKey(provider as ByokProviderId);
    setApiKeyInput("");
    setKeySaved(false);
  }

  if (error) {
    return (
      <span className="provider-picker-error" title={error}>
        Provider config unavailable
      </span>
    );
  }
  if (!config) return null;

  const activeEntry = config.providers.find((p) => p.name === provider);

  return (
    <div className="provider-picker">
      <div className="provider-picker-selects">
        <select value={provider} onChange={(e) => handleProviderChange(e.target.value)} title="LLM provider">
          {config.providers.map((p) => (
            <option key={p.name} value={p.name} disabled={!p.available}>
              {providerLabel(p)}
            </option>
          ))}
        </select>
        <select value={model} onChange={(e) => handleModelChange(e.target.value)} title="Model">
          {(activeEntry?.models ?? []).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {activeEntry?.requiresApiKey && (
        <div className="byok-key-entry">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={`${PROVIDER_LABELS[provider]?.replace(" (your key)", "") ?? "API"} key`}
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            title="Stored only in this browser's localStorage — sent directly to the provider's API, never to our server."
          />
          <button className="ghost" onClick={handleSaveKey} disabled={!apiKeyInput.trim()}>
            {keySaved ? "Saved" : "Save"}
          </button>
          <button className="ghost" onClick={handleClearKey} disabled={!apiKeyInput}>
            Clear
          </button>
          <span className="byok-note">Stored only in your browser — sent straight to the provider, never to our server.</span>
        </div>
      )}
    </div>
  );
}
