import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const server = `http://localhost:${process.env.PORT ?? 3000}`

export default defineConfig({
  plugins: [react()],
  // One page that is mostly the editor: splitting it would only add round trips.
  build: { outDir: 'dist/client', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server: {
    port: 5173,
    proxy: {
      '/api': server,
      '/collab': { target: server, ws: true },
    },
  },
  test: {
    include: ['server/**/*.test.ts'],
  },
})
