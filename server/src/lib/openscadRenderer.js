import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const OPENSCAD_BIN = process.env.OPENSCAD_BIN || "openscad";
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS || 20000);

export class RenderError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "RenderError";
    this.details = details;
  }
}

/**
 * Renders OpenSCAD source to a binary STL buffer using the openscad CLI.
 * Each call gets its own temp directory so concurrent renders never collide.
 */
export async function renderScadToStl(code) {
  if (typeof code !== "string" || !code.trim()) {
    throw new RenderError("No OpenSCAD code provided.");
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), "text2scad-"));
  const inputPath = path.join(dir, "model.scad");
  const outputPath = path.join(dir, "model.stl");

  try {
    await writeFile(inputPath, code, "utf8");

    await new Promise((resolve, reject) => {
      execFile(
        OPENSCAD_BIN,
        ["-o", outputPath, "--export-format=binstl", inputPath],
        { timeout: RENDER_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            const timedOut = error.killed && error.signal;
            reject(
              new RenderError(
                timedOut
                  ? `Render timed out after ${RENDER_TIMEOUT_MS}ms — the model may be too complex.`
                  : "OpenSCAD failed to render this model.",
                (stderr || stdout || error.message || "").trim()
              )
            );
            return;
          }
          resolve();
        }
      );
    });

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
