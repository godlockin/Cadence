import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react' }), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env['API_PROXY'] ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  base: './',
})
