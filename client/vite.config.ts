import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The client builds straight into app/public, which is what Express already
// serves as static. That keeps `node server.js` the single command that runs
// the whole product — the API, the database and the built interface — and it
// leaves every route, the SQLite schema and the 44 server tests untouched.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    outDir: path.resolve(__dirname, '../public'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    // In dev, Vite serves the interface and forwards the API to Express.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
