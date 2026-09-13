import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    root: 'client',
    envDir: '..',
    plugins: [react()],
    server: {
      host: '127.0.0.1', port: 5173, strictPort: true,
      proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT || env.API_PORT || '8787'}` },
    },
    build: { outDir: '../dist', emptyOutDir: false },
  };
});
