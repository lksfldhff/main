import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the production build works from any sub-folder of a normal web server.
  base: './',
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 5500 // Rapier ships its WASM inlined (~3 MB),
  },
});
