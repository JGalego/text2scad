import { rmSync, readdirSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

// The remote (Express-backed) build's live code never reaches src/local/** —
// api/client.ts only dynamically imports it when VITE_STANDALONE is true —
// but Vite still discovers and emits that branch's static assets (the
// vendored openscad-wasm files, onnxruntime-web's own .wasm, the worker
// chunk) during its transform pass, before tree-shaking removes the dead JS
// that would have referenced them. They're never fetched by any live code
// path, just dead weight sitting in dist/, so strip them for non-standalone
// builds rather than shipping ~30MB nobody will ever load.
function stripStandaloneOnlyAssets(): Plugin {
  return {
    name: "strip-standalone-only-assets",
    apply: "build",
    closeBundle() {
      const distDir = path.resolve(__dirname, "dist");
      rmSync(path.join(distDir, "vendor"), { recursive: true, force: true });
      const assetsDir = path.join(distDir, "assets");
      let entries: string[] = [];
      try {
        entries = readdirSync(assetsDir);
      } catch {
        return;
      }
      for (const file of entries) {
        if (file.startsWith("openscadWorker-") || file.startsWith("ort-wasm")) {
          rmSync(path.join(assetsDir, file), { force: true });
        }
      }
    },
  };
}

// Keep in sync with server PORT: set VITE_BACKEND_PORT in client/.env(.local)
// if you change the backend's PORT away from the shared 3001 default.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendPort = env.VITE_BACKEND_PORT || "3001";
  const standalone = env.VITE_STANDALONE === "true";

  return {
    plugins: [react(), !standalone && stripStandaloneOnlyAssets()],
    // The standalone build is deployed as a GitHub Pages *project* site
    // (https://<user>.github.io/text2scad/), not the domain root, so asset
    // URLs need the repo name as a base path. The Express-served build stays
    // at "/". Update this if the repo is ever renamed.
    base: standalone ? "/text2scad/" : "/",
    worker: {
      // Matches the `{ type: "module" }` used when constructing the OpenSCAD
      // worker — keeps it a real ES module (with working dynamic import())
      // instead of Vite's default IIFE worker bundle.
      format: "es",
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
