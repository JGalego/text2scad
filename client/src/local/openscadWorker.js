// Dedicated Web Worker running the OpenSCAD-WASM build (vendored at build
// time by scripts/fetch-openscad-wasm.mjs into client/public/vendor/openscad-wasm/
// — see that script for why there's no npm package to depend on instead).
// Plain JS, not TS: it runs in a worker global scope, not a DOM one, and the
// project's tsconfig only has "DOM" lib configured for the main app.
//
// Each compile gets a brand-new OpenSCAD module instance rather than reusing
// one across calls — verified directly (see fetch-openscad-wasm.mjs's sibling
// research) that a fresh instance per call behaves correctly; reusing one
// instance's virtual filesystem across unrelated compiles was never tested
// and isn't worth the risk for what's already a slow, best-effort renderer.

self.onmessage = async (e) => {
  const { id, code, args } = e.data;
  const stderrLines = [];

  try {
    // BASE_URL accounts for GitHub Pages project sites served from a
    // subpath (e.g. /text2scad/) rather than the domain root.
    const base = import.meta.env.BASE_URL;
    const { default: OpenSCAD } = await import(/* @vite-ignore */ `${base}vendor/openscad-wasm/openscad.js`);
    const instance = await OpenSCAD({
      noInitialRun: true,
      print: () => {},
      printErr: (line) => stderrLines.push(line),
    });

    instance.FS.writeFile("/input.scad", code);
    const exitCode = instance.callMain(["/input.scad", "-o", "/out.stl", "--export-format=binstl", ...args]);

    if (exitCode !== 0) {
      self.postMessage({ id, ok: false, error: "OpenSCAD failed to render this model.", details: stderrLines.join("\n") });
      return;
    }

    let stl;
    try {
      stl = instance.FS.readFile("/out.stl");
    } catch {
      self.postMessage({
        id,
        ok: false,
        error: "OpenSCAD produced no output file — the design may have no top-level geometry.",
        details: stderrLines.join("\n"),
      });
      return;
    }

    if (!stl || stl.length === 0) {
      self.postMessage({ id, ok: false, error: "OpenSCAD produced an empty file.", details: stderrLines.join("\n") });
      return;
    }

    // .slice() to get a right-sized, standalone ArrayBuffer we can safely
    // transfer (the Emscripten heap-backed buffer isn't ours to transfer away).
    const owned = stl.slice();
    self.postMessage({ id, ok: true, stl: owned }, [owned.buffer]);
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      details: stderrLines.join("\n"),
    });
  }
};
