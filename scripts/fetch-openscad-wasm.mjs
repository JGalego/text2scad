#!/usr/bin/env node
// Downloads a prebuilt OpenSCAD-WASM build (openscad.js + openscad.wasm) from
// OpenSCAD's own playground build server and vendors it into
// client/public/vendor/openscad-wasm/, for the standalone (GitHub Pages)
// build's in-browser renderer (see client/src/local/openscadWorker.js).
//
// There's no npm package for this: github.com/openscad/openscad-wasm ships no
// npm artifact and its GitHub Releases are years stale. files.openscad.org's
// playground build server is the actual up-to-date source — the same one
// openscad-playground and openscad-web-gui vendor from. Not committed to git
// (see .gitignore) — this script re-fetches it on every clean checkout/CI run.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEST_DIR = path.join(__dirname, "..", "client", "public", "vendor", "openscad-wasm");
const INDEX_URL = "https://files.openscad.org/playground/";
const FORCE = process.argv.includes("--force");

async function findLatestWebZipUrl() {
  const res = await fetch(INDEX_URL);
  if (!res.ok) throw new Error(`Failed to list ${INDEX_URL}: HTTP ${res.status}`);
  const html = await res.text();
  const matches = [...html.matchAll(/href="([^"]*-WebAssembly-web\.zip)"/g)].map((m) => m[1]);
  if (matches.length === 0) throw new Error("No *-WebAssembly-web.zip build found in the playground index.");
  // Filenames are OpenSCAD-YYYY.MM.DD.wasmNNNNN-WebAssembly-web.zip, so plain
  // lexicographic sort is also chronological.
  matches.sort();
  return INDEX_URL + matches[matches.length - 1];
}

async function main() {
  const jsPath = path.join(DEST_DIR, "openscad.js");
  const wasmPath = path.join(DEST_DIR, "openscad.wasm");

  if (!FORCE && existsSync(jsPath) && existsSync(wasmPath)) {
    console.log(`[fetch-openscad-wasm] already present at ${DEST_DIR} (use --force to re-download)`);
    return;
  }

  const zipUrl = await findLatestWebZipUrl();
  console.log(`[fetch-openscad-wasm] downloading ${zipUrl}`);

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "openscad-wasm-"));
  try {
    const zipPath = path.join(tmpDir, "openscad-wasm.zip");
    const res = await fetch(zipUrl);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));

    execFileSync("unzip", ["-o", "-q", zipPath, "-d", tmpDir]);

    mkdirSync(DEST_DIR, { recursive: true });
    for (const file of ["openscad.js", "openscad.wasm"]) {
      const src = path.join(tmpDir, file);
      if (!existsSync(src)) throw new Error(`Expected ${file} in the downloaded zip but it wasn't there.`);
      writeFileSync(path.join(DEST_DIR, file), readFileSync(src));
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`[fetch-openscad-wasm] vendored openscad.js + openscad.wasm into ${DEST_DIR}`);
}

main().catch((err) => {
  console.error("[fetch-openscad-wasm]", err.message);
  process.exit(1);
});
