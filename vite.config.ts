/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// The app is served from https://<user>.github.io/vault/ on GitHub Pages, so it
// needs a matching base path. Override with VITE_BASE for other hosts / local.
const base = process.env.VITE_BASE ?? '/vault/';

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Vault',
        short_name: 'Vault',
        description: 'A clean, mobile-first front end for a private markdown knowledge vault.',
        theme_color: '#0f0f0f',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: base,
        scope: base,
        // SVG icon keeps M0 dependency-free; dedicated PNG + maskable icons land
        // in the M5 polish pass.
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        // The app shell is cached for offline use. Vault content is cached
        // separately in IndexedDB by the data layer, never by the service worker,
        // so private note bodies never land in the Cache Storage of a shared device.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/api/],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
