import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Dev-only stand-in for the Cloudflare Pages Function at /api/status. */
function devApi(): Plugin {
  return {
    name: 'k1000-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/status', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ system: 'K1000 DIGITAL TWIN', status: 'online', edge: 'DEV', illustrative: true }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi()],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('camera-controls')) return 'three';
          if (id.includes('node_modules/react')) return 'react';
          return undefined;
        },
      },
    },
  },
  server: { host: true },
});
