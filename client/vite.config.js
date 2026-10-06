import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const backend = { target: 'http://127.0.0.1:3000', changeOrigin: false };

export default defineConfig({
  base: './', // relative: the same build works at / and under /buuflood/ (hash routing, relative URLs)
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    fs: { allow: ['..'] },
    // Phone testing over HTTPS (GPS and camera need it): cloudflared tunnel --url http://localhost:5173
    allowedHosts: ['.trycloudflare.com'],
    proxy: { '/api': backend, '/auth': backend, '/print': backend },
  },
});
