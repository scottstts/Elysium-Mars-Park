import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 2048,
  },
})
