/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    // `pnpm dev:api` runs the API on :4000. Without it, /api calls fail and the site uses static defaults.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
  build: {
    chunkSizeWarningLimit: 700, // jsPDF alone is ~585 kB; it lives in its own chunk
    rollupOptions: {
      output: {
        // Keep the PDF library and the worldwide airport dataset in their own cacheable chunks.
        manualChunks: (id) => {
          if (id.includes('node_modules/jspdf') || id.includes('node_modules/html2canvas') || id.includes('node_modules/dompurify')) return 'pdf'
          if (id.endsWith('airports.json')) return 'airports'
          if (id.includes('node_modules/react')) return 'react'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/src/**/*.test.ts'],
  },
})
