import { cloudflareDevProxyVitePlugin as remixCloudflareDevProxy, vitePlugin as remixVitePlugin } from '@remix-run/dev';
import UnoCSS from 'unocss/vite';
import { defineConfig, type ViteDevServer } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { optimizeCssModules } from 'vite-plugin-optimize-css-modules';
import tsconfigPaths from 'vite-tsconfig-paths';
import * as dotenv from 'dotenv';

// Load environment variables from multiple files
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
dotenv.config();

/*
 * Memory-optimized Vite config for bolt.diy (4GB sandbox).
 * Optimizations:
 *  - Cloudflare dev proxy (workerd) is kept ON by default. Removing it saves
 *    ~150MB but breaks SSR because `remix-island` imports `react-dom/server`
 *    which only exposes `renderToReadableStream` as a named ESM export in the
 *    worker/browser build that workerd resolves to. Set SKIP_CLOUDFLARE_PROXY=1
 *    only if you have also patched entry.server.tsx + remix-island.
 *  - COOP/COEP headers are ON by default (ENABLE_COOP_COEP=1 in .env.local)
 *    because bolt.diy loads @webcontainer/api which needs SharedArrayBuffer.
 *  - HMR overlay disabled (minor RAM, less noise).
 *  - strictPort: true so the watchdog can recover from port collisions.
 *  - build.sourcemap: false (build only; no effect on dev but cheaper if built).
 */
const skipCloudflareProxy = process.env.SKIP_CLOUDFLARE_PROXY === '1';
const enableCoopCoep = process.env.ENABLE_COOP_COEP !== '0';

export default defineConfig((config) => {
  return {
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    },
    build: {
      target: 'esnext',
      sourcemap: false,
    },
    plugins: [
      nodePolyfills({
        include: ['buffer', 'process', 'util', 'stream'],
        globals: {
          Buffer: true,
          process: true,
          global: true,
        },
        protocolImports: true,
        exclude: ['child_process', 'fs', 'path'],
      }),
      {
        name: 'buffer-polyfill',
        transform(code, id) {
          if (id.includes('env.mjs')) {
            return {
              code: `import { Buffer } from 'buffer';\n${code}`,
              map: null,
            };
          }

          return null;
        },
      },
      !skipCloudflareProxy && config.mode !== 'test' && remixCloudflareDevProxy(),
      remixVitePlugin({
        future: {
          v3_fetcherPersist: true,
          v3_relativeSplatPath: true,
          v3_throwAbortReason: true,
          v3_lazyRouteDiscovery: true,
        },
      }),
      UnoCSS(),
      tsconfigPaths(),
      chrome129IssuePlugin(),
      config.mode === 'production' && optimizeCssModules({ apply: 'build' }),
    ],
    envPrefix: [
      'VITE_',
      'OPENAI_LIKE_API_BASE_URL',
      'OPENAI_LIKE_API_MODELS',
      'OLLAMA_API_BASE_URL',
      'LMSTUDIO_API_BASE_URL',
      'TOGETHER_API_BASE_URL',
    ],
    optimizeDeps: {
      include: ['html2canvas'],
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
        },
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: true,
      // strictPort: true so Vite EXITS instead of silently moving to 3001
      // (Caddy reverse-proxies to 3000 only). The watchdog then retries
      // every 3s until TIME_WAIT sockets from a previous crash clear and
      // 3000 becomes bindable again. This keeps bolt.diy reachable at the
      // Caddy-fronted root URL instead of an unreachable 3001.
      strictPort: true,
      hmr: {
        overlay: false,
      },
      headers: enableCoopCoep
        ? {
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin',
          }
        : undefined,
    },
    test: {
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/cypress/**',
        '**/.{idea,git,cache,output,temp}/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
        '**/tests/preview/**', // Exclude preview tests that require Playwright
      ],
    },
  };
});

function chrome129IssuePlugin() {
  return {
    name: 'chrome129IssuePlugin',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const raw = req.headers['user-agent']?.match(/Chrom(e|ium)\/([0-9]+)\./);

        if (raw) {
          const version = parseInt(raw[2], 10);

          if (version === 129) {
            res.setHeader('content-type', 'text/html');
            res.end(
              '<body><h1>Please use Chrome Canary for testing.</h1><p>Chrome 129 has an issue with JavaScript modules & Vite local development, see <a href="https://github.com/stackblitz/bolt.new/issues/86#issuecomment-2395519258">for more information.</a></p><p><b>Note:</b> This only impacts <u>local development</u>. `pnpm run build` and `pnpm run start` will work fine in this browser.</p></body>',
            );

            return;
          }
        }

        next();
      });
    },
  };
}