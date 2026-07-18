import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Keep in sync with server PORT: set VITE_BACKEND_PORT in client/.env(.local)
// if you change the backend's PORT away from the shared 3001 default.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendPort = env.VITE_BACKEND_PORT || "3001";

  return {
    plugins: [react()],
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
