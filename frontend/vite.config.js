import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // Load shared env from repo root so frontend + backend share one .env
  const rootEnv = loadEnv(mode, path.resolve(__dirname, ".."), "");
  Object.assign(process.env, rootEnv);

  const apiProxy = process.env.VITE_API_BASE || "http://127.0.0.1:5000";

  return {
    base: command === "serve" ? "/" : "/static/react/",
    plugins: [react()],
    server: {
      proxy: {
        "/api": apiProxy,
      },
    },
    build: {
      outDir: "../server/static/react",
      emptyOutDir: true,
    },
  };
});
