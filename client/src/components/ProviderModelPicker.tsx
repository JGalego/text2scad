import { useEffect, useState } from "react";
import { getProvidersConfig } from "../api/client";
import type { ChatOptions, ProvidersConfig } from "../api/types";

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

/** Lets the user pick which LLM provider + model handles chat/critique
 *  requests. In the standalone (GitHub Pages) build there's only ever one
 *  "provider" (the in-browser model), so this mostly reduces to a model
 *  picker there — same component, driven by whatever GET-equivalent
 *  getProvidersConfig() returns for the active backend. */
export function ProviderModelPicker({ onChange }: Props) {
  const [config, setConfig] = useState<ProvidersConfig | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    savePrefs({ provider: name, model: nextModel });
    onChange({ provider: name, model: nextModel });
  }

  function handleModelChange(nextModel: string) {
    setModel(nextModel);
    savePrefs({ provider, model: nextModel });
    onChange({ provider, model: nextModel });
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
      <select value={provider} onChange={(e) => handleProviderChange(e.target.value)} title="LLM provider">
        {config.providers.map((p) => (
          <option key={p.name} value={p.name} disabled={!p.available}>
            {p.name}
            {p.available ? "" : " (unavailable)"}
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
  );
}
