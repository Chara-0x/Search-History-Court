import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === "serve" ? "/" : "/static/react/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
  build: {
    outDir: "../server/static/react",
    emptyOutDir: true,
  },
}))
