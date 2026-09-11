import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The consolidated dashboard is a composition, not a source tree: its root holds
// only index.html, the view registry and App.jsx. Every surface it renders is
// imported from packages/<section> through the `@markets/*` workspace names, so
// there is exactly one copy of each and editing a section is editing what the
// dashboard shows. Sections are also buildable on their own — see each package's
// dev/vite.config.js.
//
// The build lands in dist/, which the gateway serves. In dev, Vite owns the page
// and proxies /api through to Express.
//
// Unlike the old company-supply-graph setup, there is NO dev-server API plugin:
// every /api route lives in the gateway, so the built site has the same
// capabilities as the dev site (the graph's refresh/scan/sweep buttons used to
// be dev-only and silently dead in production).
export default defineConfig({
  root: 'apps/consolidated',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': { target: `http://localhost:${process.env.PORT || 3778}`, changeOrigin: true } },
  },
});
