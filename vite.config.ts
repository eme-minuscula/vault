/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Content-Security-Policy, injected only into the production build. GitHub Pages
// can't set HTTP headers, so a <meta> CSP is the only lever. It is deliberately
// strict: the app loads only its own same-origin assets and talks only to the
// GitHub API. This is the primary defense for the runtime PAT and for rendering
// untrusted note content. It is NOT applied in dev (Vite needs inline/eval/ws).
//
// - style-src allows 'unsafe-inline' because Tailwind/React emit inline styles;
//   inline *scripts* remain forbidden, which is what matters for XSS.
// - img-src allows data: so note images fetched as base64 can render inline.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self' https://api.github.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'vault-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</title>',
        `</title>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  // Production builds are served from https://<user>.github.io/vault/ on GitHub
  // Pages, so they need a matching base path. The dev server serves from root.
  // Override either with VITE_BASE.
  const base = process.env.VITE_BASE ?? (command === 'build' ? '/vault/' : '/');

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      cspPlugin(),
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
  };
});
