/**
 * Vite Configuration for Decentralized Health DB Frontend
 * 
 * References:
 * - Vite Configuration: https://vitejs.dev/config/
 * - React Plugin: https://github.com/vitejs/vite-plugin-react
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  
  server: {
    port: 3000,
    open: true,
    // Proxy API requests to backend during development
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  },
  
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  
  // Environment variable prefix for client-side exposure
  envPrefix: 'VITE_'
});
