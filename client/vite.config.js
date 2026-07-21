import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const rootDir = path.resolve(__dirname, '..');

export default defineConfig(({ mode }) => {
  // Load PORT / API_PORT from repo-root .env.local so proxy matches npm run dev
  const env = loadEnv(mode, rootDir, '');
  const apiPort = Number(env.API_PORT || env.PORT) || 8080;
  const apiTarget = `http://localhost:${apiPort}`;

  return {
    envDir: rootDir,
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: {
      port: Number(process.env.VITE_PORT) || 5173,
      host: process.env.VITE_HOST === '0.0.0.0' || process.env.DEV_LAN === '1',
      proxy: {
        '/auth': { target: apiTarget, changeOrigin: true },
        '/api': { target: apiTarget, changeOrigin: true },
        '/uploads': { target: apiTarget, changeOrigin: true },
        '/dev': { target: apiTarget, changeOrigin: true },
      },
    },
  };
});
