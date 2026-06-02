import { defineConfig, type Plugin } from 'vite';

// Stage 1 UI build. Vanilla TS, no framework (matches the build plan + the cleanest
// path to Tauri packaging at Stage 6).
//
// The Stockfish engine is NOT bundled: scripts/copy-engine.mjs copies the prebuilt
// WASM build into public/sf, Vite serves it verbatim as a static asset, and we run
// it in a classic Web Worker (see src/engine/workerEngine.ts). The default
// single-threaded "lite-single" build needs no SharedArrayBuffer.
//
// Stage 2 (analysis) benefits a lot from the THREADED "lite" build, which needs
// SharedArrayBuffer and therefore cross-origin isolation. The plugin below sets the
// COOP/COEP headers on dev + preview so that switching ENGINE_FILE to
// 'stockfish-18-lite.js' "just works". Everything this app loads is same-origin
// (the engine, its .wasm, bundled CSS/sprites), so these headers are inert and safe
// for the default lite-single build — they break nothing.
const crossOriginIsolation = (): Plugin => {
  const setHeaders = (res: { setHeader(name: string, value: string): void }): void => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  };
  return {
    name: 'cross-origin-isolation',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        setHeaders(res);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        setHeaders(res);
        next();
      });
    },
  };
};

export default defineConfig({
  // Relative base keeps asset URLs portable (works under `vite preview`, and when
  // the dist/ is opened outside a web root — handy for the later Tauri packaging).
  base: './',
  plugins: [crossOriginIsolation()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
