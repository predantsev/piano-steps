import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Ports: this project owns the 9xxx block (startup-rules/PORTS.md). Dev: web 9300 → API 9301.
// Parallel worktrees pick their own pair via WEB_PORT / API_PORT.
const webPort = Number(process.env.WEB_PORT ?? 9300);
const apiPort = Number(process.env.API_PORT ?? 9301);

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    strictPort: true,
    host: process.env.HOST ?? '127.0.0.1',
    allowedHosts: ['piano-steps.localhost', '.local'],
    proxy: { '/api': `http://127.0.0.1:${apiPort}` },
  },
  preview: { port: webPort, proxy: { '/api': `http://127.0.0.1:${apiPort}` } },
});
