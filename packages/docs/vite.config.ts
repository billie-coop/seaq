import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Set DOCS_BASE for subpath deploys (GitHub Pages uses /seaq/)
  base: process.env.DOCS_BASE || '/',
  // Off the common dev-port ranges (3000/5173/8080) so this doesn't collide
  // with other local Vite projects.
  // Cross-origin isolation lifts the browser's performance.now() clamping
  // (100µs in Chrome otherwise) so sub-millisecond timings are readable.
  // GitHub Pages can't send these headers, so the live site stays coarse.
  server: { port: 5417, headers: isolationHeaders },
  preview: { port: 5417, headers: isolationHeaders },
});
