import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HELPER_LIBRARY_SCAD } from "./helperLibrary.js";
import { mapWithConcurrency, mergeBinarySTLs } from "./meshMerge.js";
import { countConnectedComponents } from "./meshAnalysis.js";
import { splitSceneParts } from "./sceneParts.js";

const OPENSCAD_BIN = process.env.OPENSCAD_BIN || "openscad";
// "draft" quality (used on every chat turn, for the live viewer) forces $fn
// down via a CLI override — STL export goes through OpenSCAD's exact CGAL
// boolean path, which scales very badly with facet count and hull()/
// minkowski() usage; a multi-object scene (a house + several trees + figures)
// measured at 2m5s at the model's own $fn=48 rendered in 2.3s at $fn=8. PNG
// preview snapshots don't need this — they use OpenSCAD's fast OpenCSG
// preview path already (verified: 0 CGAL polyhedrons, ~5s on the same scene).
const DRAFT_FN = Number(process.env.DRAFT_FN || 8);
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS || 20000);
// "final" quality (on-demand, e.g. before a download) can afford to wait —
// draft renders keep the interactive loop fast, so this is rarely exercised.
const RENDER_TIMEOUT_MS_FINAL = Number(process.env.RENDER_TIMEOUT_MS_FINAL || 90000);
const SCENE_PART_CONCURRENCY = Number(process.env.SCENE_PART_CONCURRENCY || 4);

export class RenderError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "RenderError";
    this.details = details;
  }
}

const HELPER_PREFIX = `${HELPER_LIBRARY_SCAD}\n\n// ---- generated model ----\n`;
const HELPER_LINE_COUNT = HELPER_PREFIX.split("\n").length - 1;

function withHelpers(code) {
  return `${HELPER_PREFIX}${code}`;
}

// A CLI `-D '$fn=N'` override only sets the *default* special variable — it
// has no effect on calls that pass $fn directly as a named argument (e.g.
// `sphere(r, $fn=24)`), which is common, idiomatic OpenSCAD and exactly what
// the system prompt's own detail-budgeting advice encourages. Since a
// per-call $fn always shadows the surrounding default, the only way to
// actually cap detail everywhere is a text-level substitution before the
// file is written. Caps rather than replaces outright, so code that already
// asked for something cheaper (e.g. $fn=6) isn't forced back up.
function capFnForDraft(code, maxFn) {
  return code.replace(/\$fn\s*=\s*(\d+(?:\.\d+)?)/g, (match, value) => {
    const capped = Math.min(Math.round(Number(value)), maxFn);
    return `$fn=${capped}`;
  });
}

// Error text quotes "line N" against the combined (helpers + model) file;
// remap it back to the user's own code so it doesn't look like the error is
// somewhere in code they never wrote or saw.
function remapLineNumbers(text) {
  if (!text) return text;
  return text.replace(/\bline (\d+)\b/g, (match, n) => {
    const original = Number(n) - HELPER_LINE_COUNT;
    return original > 0 ? `line ${original}` : match;
  });
}

async function runOpenscad(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      OPENSCAD_BIN,
      args,
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const timedOut = error.killed && error.signal;
          reject(
            new RenderError(
              timedOut
                ? `Render timed out after ${timeoutMs}ms — the model may be too complex.`
                : "OpenSCAD failed to render this model.",
              (stderr || stdout || error.message || "").trim()
            )
          );
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

async function renderOneStl(code, { quality, timeoutMs }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "text2scad-"));
  const inputPath = path.join(dir, "model.scad");
  const outputPath = path.join(dir, "model.stl");

  try {
    const source = quality === "draft" ? capFnForDraft(withHelpers(code), DRAFT_FN) : withHelpers(code);
    await writeFile(inputPath, source, "utf8");
    const args = ["-o", outputPath, "--export-format=binstl"];
    // Still pass the CLI default too, as a safety net for any $fn expressed
    // as a non-literal (e.g. a variable reference) that the regex above
    // can't safely rewrite.
    if (quality === "draft") args.push("-D", `$fn=${DRAFT_FN}`);
    args.push(inputPath);

    try {
      await runOpenscad(args, timeoutMs);
    } catch (err) {
      if (err instanceof RenderError) err.details = remapLineNumbers(err.details);
      throw err;
    }

    const stl = await readFile(outputPath);
    if (stl.length === 0) {
      throw new RenderError(
        "OpenSCAD produced an empty file — the design may have no top-level geometry."
      );
    }
    return stl;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Renders OpenSCAD source to a binary STL buffer using the openscad CLI.
 * Each call gets its own temp directory so concurrent renders never collide.
 *
 * `quality: "draft"` overrides $fn down for a fast interactive preview;
 * `"final"` (default) renders at the model's own detail level with a much
 * longer timeout, for downloads.
 *
 * If the code uses the scene-parts convention (see sceneParts.js), each part
 * renders independently and in parallel, then the resulting meshes are
 * concatenated (no CGAL boolean needed — the parts don't overlap). This is
 * what makes multi-object scenes tractable at all: one giant combined render
 * pays CGAL's cost once for the whole tree, while N small independent renders
 * each pay it for a tiny tree and run concurrently.
 *
 * Also reports how many disconnected mesh components the result has, as a
 * (best-effort) signal that a protrusion may not actually be fused to the
 * body it was meant to attach to — not meaningful for scene renders, where
 * multiple components are the correct, expected topology.
 */
export async function renderScadToStl(code, { quality = "final" } = {}) {
  if (typeof code !== "string" || !code.trim()) {
    throw new RenderError("No OpenSCAD code provided.");
  }

  const timeoutMs = quality === "draft" ? RENDER_TIMEOUT_MS : RENDER_TIMEOUT_MS_FINAL;
  const scene = splitSceneParts(code);

  if (!scene) {
    const stl = await renderOneStl(code, { quality, timeoutMs });
    return { stl, componentCount: countConnectedComponents(stl), partCount: 0 };
  }

  const partStls = await mapWithConcurrency(scene.parts, SCENE_PART_CONCURRENCY, (part) =>
    renderOneStl(`${scene.defs}\n${part}`, { quality, timeoutMs })
  );
  const stl = mergeBinarySTLs(partStls);
  return { stl, componentCount: countConnectedComponents(stl), partCount: scene.parts.length };
}

/**
 * Renders a PNG snapshot of the model for the visual critique pass. Uses
 * OpenSCAD's own offscreen renderer (works headless in this environment
 * without an X server — verified directly before relying on it). Always
 * fast regardless of scene complexity: PNG export uses OpenSCAD's OpenCSG
 * preview path, not the CGAL exact-boolean path STL export requires — so
 * unlike renderScadToStl, this needs no quality tier or scene-parts split.
 */
export async function renderScadToPng(code, { width = 640, height = 480 } = {}) {
  if (typeof code !== "string" || !code.trim()) {
    throw new RenderError("No OpenSCAD code provided.");
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), "text2scad-png-"));
  const inputPath = path.join(dir, "model.scad");
  const outputPath = path.join(dir, "model.png");

  try {
    await writeFile(inputPath, withHelpers(code), "utf8");
    await runOpenscad(
      [
        "-o",
        outputPath,
        `--imgsize=${width},${height}`,
        "--autocenter",
        "--viewall",
        "--colorscheme=Tomorrow",
        inputPath,
      ],
      RENDER_TIMEOUT_MS_FINAL
    );
    const png = await readFile(outputPath);
    if (png.length === 0) {
      throw new RenderError("OpenSCAD produced an empty snapshot image.");
    }
    return png;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
