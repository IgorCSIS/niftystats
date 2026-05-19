import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Vite config.
//
// `base` is set to '/niftystats/' because the production bundle is served from
// https://<username>.github.io/niftystats/. If we ever move to a custom domain
// at the apex, switch this back to '/'.
//
// The `@` path alias mirrors the convention used by shadcn/ui and most modern
// React templates. It saves us from writing '../../../lib/utils' everywhere.
export default defineConfig({
  base: '/niftystats/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Pyodide ships its own .wasm and .data files. We exclude it from Vite's
  // dependency optimizer so it loads at runtime from the CDN (or copied to
  // /public if we self-host later).
  optimizeDeps: {
    exclude: ['pyodide'],
  },
})
