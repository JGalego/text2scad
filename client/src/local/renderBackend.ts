import type { RenderFailure, RenderQuality, RenderResult } from "../api/types";
import { capFnForDraft, countConnectedComponents, mergeBinarySTLs, splitSceneParts, withHelpers } from "./scadTools";

// Mirrors server/src/lib/openscadRenderer.js's DRAFT_FN default — kept fixed
// (not configurable) since there's no server .env for a static site to read.
const DRAFT_FN = 8;

interface WorkerSuccess {
  id: number;
  ok: true;
  stl: Uint8Array;
}
interface WorkerFailure {
  id: number;
  ok: false;
  error: string;
  details?: string;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (stl: Uint8Array) => void; reject: (err: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./openscadWorker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerSuccess | WorkerFailure>) => {
      const msg = e.data;
      const request = pending.get(msg.id);
      if (!request) return;
      pending.delete(msg.id);
      if (msg.ok) {
        request.resolve(msg.stl);
      } else {
        request.reject(Object.assign(new Error(msg.error), { details: msg.details }));
      }
    };
  }
  return worker;
}

function compile(code: string, args: string[]): Promise<Uint8Array> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, code, args });
  });
}

function renderOneStl(code: string, quality: RenderQuality): Promise<Uint8Array> {
  const source = quality === "draft" ? capFnForDraft(withHelpers(code), DRAFT_FN) : withHelpers(code);
  const args = quality === "draft" ? ["-D", `$fn=${DRAFT_FN}`] : [];
  return compile(source, args);
}

/**
 * Client-side equivalent of server/src/lib/openscadRenderer.js's
 * renderScadToStl, run entirely in-browser via a Web Worker + OpenSCAD-WASM.
 * Scene parts render sequentially through the one worker rather than in
 * parallel (unlike the server's mapWithConcurrency) — reusing/parallelizing
 * Emscripten module instances in one worker wasn't verified as safe, and this
 * is already a slow, best-effort demo renderer, not a performance target.
 */
export async function renderScad(code: string, quality: RenderQuality = "draft"): Promise<RenderResult | RenderFailure> {
  if (typeof code !== "string" || !code.trim()) {
    return { ok: false, error: "No OpenSCAD code provided." };
  }

  try {
    const scene = splitSceneParts(code);

    if (!scene) {
      const stl = await renderOneStl(code, quality);
      return {
        ok: true,
        buffer: stl.buffer as ArrayBuffer,
        componentCount: countConnectedComponents(stl),
        scenePartCount: 0,
      };
    }

    const partStls: Uint8Array[] = [];
    for (const part of scene.parts) {
      partStls.push(await renderOneStl(`${scene.defs}\n${part}`, quality));
    }
    const merged = mergeBinarySTLs(partStls);
    return {
      ok: true,
      buffer: merged.buffer as ArrayBuffer,
      componentCount: countConnectedComponents(merged),
      scenePartCount: scene.parts.length,
    };
  } catch (err) {
    const details = (err as { details?: string } | undefined)?.details;
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The in-browser render failed.",
      details,
    };
  }
}
