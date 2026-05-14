import { defineConfig } from 'vite'

export default defineConfig({
  base: './',              // relative asset paths — required for Electron file:// loading
  publicDir: 'public',
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    open: false,
  },
})
