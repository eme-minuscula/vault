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

  // Short build id so the running version is visible in Settings — makes a stale
  // cached build obvious instead of a mystery. CI provides the commit SHA.
  const buildId = (process.env.GITHUB_SHA ?? 'dev').slice(0, 7);

  return {
    base,
    define: {
      __APP_BUILD__: JSON.stringify(buildId),
    },
    plugins: [
      react(),
      tailwindcss(),
      cspPlugin(),
      VitePWA({
        // Deliberately 'prompt', NOT 'autoUpdate': autoUpdate hard-reloads the page
        // the moment a new worker activates, which would discard whatever is in the
        // editor (note state lives in memory, there is no autosave). We keep manual
        // control and apply the update ourselves as soon as it is *safe* — see
        // src/ui/UpdatePrompt.tsx — so the app still converges on the latest build
        // without ever reloading mid-edit.
        registerType: 'prompt',
        injectRegister: null,
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
          icons: [
            { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'icon-512-maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // The app shell is cached for offline use. Vault content is cached
          // separately in IndexedDB by the data layer, never by the service worker,
          // so private note bodies never land in the Cache Storage of a shared device.
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // The WYSIWYG editor bundle is large and rarely the first thing used, so
          // keep it out of the install-time precache and fetch it on demand (then
          // cache it, so offline editing still works after the first use).
          globIgnores: ['**/editor-*.js', '**/editor-*.css'],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => /\/editor-[^/]+\.(js|css)$/.test(url.pathname),
              handler: 'CacheFirst',
              options: {
                cacheName: 'vault-editor',
                expiration: { maxEntries: 6 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
          navigateFallback: `${base}index.html`,
          navigateFallbackDenylist: [/^\/api/],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          // Consolidate the editor-only libraries (Milkdown/ProseMirror/CodeMirror,
          // and Vue which Crepe's UI uses) into one on-demand `editor` chunk. These
          // are not used by the reader, so this never bloats the critical path — and
          // it gives the chunk a stable name the service worker can exclude above.
          manualChunks(id) {
            if (
              id.includes('/@milkdown/') ||
              id.includes('/prosemirror') ||
              id.includes('/@codemirror/') ||
              id.includes('/@vue/') ||
              id.includes('/node_modules/vue/') ||
              id.includes('/@floating-ui/')
            ) {
              return 'editor';
            }
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  };
});
